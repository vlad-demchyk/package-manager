# packman

Dependency manager for repositories that hold many JS/TS projects, each with its own `package.json`
(for example dozens of SharePoint Framework solutions). packman detects the stack and versions of every
project, checks compatibility and known vulnerabilities, groups projects by version set, aligns versions
inside a group, runs npm with the right Node for each project and can share one `node_modules` per group.

It never changes a repository unless you ask: `check` only reads, `fix` is a dry run until `--apply`,
and manifest/config edits are backed up in `.packman/backups/`. `clean` removes the requested
modules/lockfiles; npm commands update installation files directly.

The full documentation is in [docs/](docs/README.md): [getting started](docs/getting-started.md),
[commands](docs/commands.md), [configuration](docs/configuration.md), [rules](docs/rules.md),
[shared store](docs/shared-store.md), [SharePoint testing](docs/sharepoint-testing.md),
[upgrade](docs/upgrade.md), [architecture](docs/architecture.md) and
[troubleshooting](docs/troubleshooting.md).

## Requirements

- packman runs on **Node >= 22.12**. Your projects can use any Node version: packman starts npm for
  each project with that project's own Node binary.
- If the active Node is older (for example `nvm use 18` for an SPFx 1.18 project), the launcher finds
  a newer installed Node (nvm-windows, nvm, fnm, Volta) and re-runs itself with it.

## Install

```bash
git clone https://github.com/vlad-demchyk/package-manager.git
cd package-manager
npm ci
npm run build
npm link        # exposes `packman` and `pm` globally
```

## Quick start

```bash
cd path/to/repository
packman                 # interactive TUI in a terminal, `check` otherwise
packman check           # report: groups, findings, suggested fixes
packman check --json    # machine-readable report (CI, scripts)
packman check --md report.md
packman fix             # preview fixes marked `safe`
packman fix --risk review --rule spfx/lockstep-mismatch --apply
packman node            # installed Node versions, support status and CVEs
packman install         # npm ci in every project with its own Node
packman init --with-groups   # create packman.config.json from the detected groups
packman upgrade             # plan convergence on the newest project stack already in this repository
```

All commands accept `--project <globs...>`, `--exclude <globs...>`, `--depth <n>`, `--lang en|it|uk`.
Commands that edit files print a diff and write only with `--apply` (backups in `.packman/backups/`,
history in `.packman/journal.jsonl`). When the edits change versions, the lockfiles of the changed
projects are regenerated with their own Node (`--no-relock` keeps them; `--relock` also relocks
projects without version edits or lockfile).

| 2.x menu                                                      | 3.0 command                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Update configs (dependencies-config.js)                       | `packman profile apply [--apply] [--no-relock] [--install]` with `profiles` in `packman.config.json`                   |
| Generate dependencies config                                  | `packman profile generate --name <name> [--strategy highest\|common] [--tsconfig-from <project>\|latest-ts] [--write]` |
| Install / reinstall / clean (normal, legacy-peer-deps, force) | `packman install [--mode ...] [--clean]`, `packman clean [--lock] [--modules]`                                         |
| Compare versions between all projects                         | `packman versions [--diverging] [--package <globs>]`, TUI tab Versions                                                 |
| Version alignment between projects                            | `packman align --base <a> [--to <b>] [--only ...] [--pin]`, `packman align --package <name> [--version <v>]`           |
| npm outdated / audit / package-lock-only                      | `packman outdated`, `packman audit`, `packman relock`                                                                  |
| Depcheck + whitelist                                          | rules `npm/unused-*` with fixes, `packman ignore add\|remove\|list`                                                    |
| Logs                                                          | `packman log [-n 30] [--prune <days>]`                                                                                 |
| List components, recursive search                             | `packman list`, `projects.maxDepth` / `--depth`, `projects.requiredFiles`, `projects.match`                            |
| Workspace mode (Yarn)                                         | `packman store ...` (below)                                                                                            |

`check` exits with code 1 when there are findings of severity `error` or worse (`--fail-on` changes it).

The TUI collects fixes the same way everywhere and writes them only after a diff and a confirmation
(tab 7 Fixes, key `a`): `space` selects the fix of a finding, aligns a diverging package in Versions
(like `align --package`) or raises an outdated package to the newest release of its major in
Outdated (tab 4, exact, `^` and `~` specs only); `u` selects every profile fix (like `profile apply`).
Store (tab 6) shows the union plan and which projects are linked; linking stays a CLI command because
it installs and replaces `node_modules`.

## What it checks

| Area                 | Examples of rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm (any project)    | ranges instead of exact versions, pre-release/nightly versions, lockfile missing or out of sync, installed packages different from `package.json`, the same package declared twice, peer dependencies not satisfied, deprecated packages, several copies of runtime singletons (React, SPFx runtime, Fluent UI), packages of one family on different majors (PnPjs, React, Angular, typescript-eslint), imports without a declared dependency, declared dependencies never imported |
| SharePoint Framework | version from `@microsoft/sp-core-library` (`.yo-rc.json` only as a hint), runtime and build tools from different SPFx releases, wrong `rush-stack-compiler` for the SPFx version, `typescript` that does not match the compiler that really runs, React and `@types/react` required by the SPFx version, gulp and Heft mixed, PnP controls built for another SPFx, PnPjs major, withdrawn and pre-release SPFx versions, staged upgrade path (same toolchain first, then latest)    |
| Node                 | requirements from `devEngines`, `.nvmrc`, `.node-version`, `.tool-versions`, Volta and `engines`; pins that contradict the stack, `engines` wider than the stack allows, no installed Node fits, end of life, known CVEs and the patched release to move to                                                                                                                                                                                                                         |
| Security             | npm advisories for every installed package (one request for the whole workspace, cached), Node core CVEs from the Node.js security working group; severity is weighted by exposure: build-only packages go down, networking packages in projects that make HTTP/REST calls go up, Node CVEs count as build-machine only for browser stacks such as SPFx                                                                                                                             |
| Groups               | projects grouped by stack version and Node line, the largest group is the baseline; inside a group every shared package must resolve to one version                                                                                                                                                                                                                                                                                                                                 |
| SPFx core packages   | packages the official generator scaffolds for the SPFx version, toolchain (gulp/Heft), component types (from `*.manifest.json`) and React usage (`data/spfx-scaffold.json`, extracted from `@microsoft/generator-sharepoint` 1.0-1.24): never reported as unused; missing ones are errors (`spfx/core-missing`), ones present only as transitive dependencies are warnings (`spfx/core-transitive`), without lockfile they cannot be verified (`spfx/core-unverified`)              |
| Profiles             | `profile/*`: versions, misplaced sections, missing, deprecated, scripts, engines, overrides, tsconfig leaves differing from the project's profile                                                                                                                                                                                                                                                                                                                                   |
| Locked tree          | every dependency edge of the npm lockfile, transitive ones included, resolved the way Node does: a dependency outside its range is an error (`npm/tree-broken`), unmet peers of nested packages a warning (`npm/tree-peer`); locked versions that moved away from the set the last passing build used (`npm/unverified-versions`)                                                                                                                                                   |
| ESLint               | rules a config sets that the installed `@typescript-eslint/eslint-plugin` does not have, `no-unused-vars` without `caughtErrors` on plugin 8+: both make SPFx `--ship` builds fail on warnings; fixes move removed rules to their successors                                                                                                                                                                                                                                        |
| Other stacks         | React, TypeScript (including TypeScript 7 with tools that need its API), Vite, Next.js, Angular, Vue, Electron, ESLint (legacy config ignored by ESLint 10), Jest, Vitest; Angular, Next.js and Vite majors carry Node and companion ranges from `data/frameworks.json` (TypeScript, rxjs, zone.js; React) even before installation                                                                                                                                                 |

Compatibility data lives in `data/` with the date it was verified and its sources:
`spfx.json` (SPFx 1.0 to 1.24), `node.json` (release schedule), `node-vulns.json` (Node CVEs),
`frameworks.json` (Angular 14+, Next.js 13+, Vite 4+ from the npm registry), `families.json`,
`network.json`, `spfx-scaffold.json`.

`packman data update [--dry-run]` refreshes `node.json`, `node-vulns.json` and `frameworks.json` from the
Node release schedule, `nodejs.org/dist/index.json`, nodejs/security-wg and the npm registry, prints what changed and saves the result
in the per-user data folder (`%LOCALAPPDATA%\packman\data`, `~/.cache/packman/data`; `PACKMAN_DATA_DIR`
overrides it). Bundled files are never modified; an updated copy is used while it is at least as recent
as the bundled one. A result with fewer release lines or vulnerabilities than already known is
refused. The SPFx, scaffold, family and network files are curated by hand. `packman data status` shows
which copy each check uses.

Lockfiles: `package-lock.json`/`npm-shrinkwrap.json` (v1-v3), `yarn.lock` (classic and berry) and
`pnpm-lock.yaml` (v5-v9). yarn and pnpm do not record a `node_modules` layout, so their packages are
placed the way npm would hoist them; store, relock and upgrade commands still require npm lockfiles.

Unused-dependency rules count as used: imports from code and styles (`~pkg`, `pkg:`), tools implied by
config files and npm scripts (including the executables of installed packages), plugins of configured
tools, `@types/*`, peer/optional dependencies, SPFx core packages, and packages that other packages
require (a top-level declaration then pins a transitive version).

## Verified version sets

Floating ranges let npm pick newer versions on its own. packman keeps the versions a build has
proven instead:

- When `store verify` or `upgrade --verify` passes, each passing project's locked versions are saved
  as its verified set, and a shared store whose members all passed keeps its lockfile
  (`.packman/verified/`).
- The next union store of the same projects is resolved from that lockfile: npm keeps those versions
  and changes only what the manifests changed. `store link --refresh` resolves the tree fresh.
- Every version that moved away from a verified set is listed as not verified by a build: after
  `store link`, `relock`, `install --clean`, and in `check` (`npm/unverified-versions`).
- `npm/range-spec` pins `^`/`~` dependencies to the verified version when there is one.
- `install` runs `npm ci`. A lockfile out of sync with `package.json` stops the install for that
  project with a pointer to `packman relock`, instead of a silent `npm install` that re-resolves
  versions (`--mode force` still runs `npm install` on request).

## One target stack for the repository

`upgrade` selects the highest existing framework version in the selected projects, with the matching
project as its baseline. A repository with SPFx 1.18.2, 1.20.0 and 1.21.1 converges on **1.21.1**;
it does not select a newer release from npm. Different framework families have separate baselines.
Node defaults to a compatible Node already used by those baselines, then a compatible installed Node.

```bash
packman upgrade                         # plan and diffs; no project files changed
packman upgrade --json                   # machine-readable plan, blockers and build order
packman upgrade --stack spfx --to 1.21   # explicit override to a supported version line
packman upgrade --apply --shared --verify -y  # install once, link, then build every member
```

SPFx migrations update runtime/build/lint packages, compiler/TypeScript, React/types, engines and Node
pins, generator metadata and tsconfig. A Heft transition creates rig/Sass/TypeScript configs and maps
standard Gulp scripts. Custom tasks and known removed React/PnPjs APIs are reported as source blockers.
Major API changes still need code review; build verification is available with `--verify`.

Applied upgrades save `target`, a `packman-<stack>` profile and a matching group. Generated profiles
and groups use a `stack` filter, so future SPFx projects follow the same policy while an unrelated
Vite/React project does not receive SPFx packages. Existing conflicting profiles block the migration.
`check` reports target deviations; `profile apply` enforces the saved versions. Names starting with `packman-`
are reserved for generated profiles. A filtered `--project` migration saves only the selected scope.

```json
{ "target": { "spfx": "1.21.1", "node": "22.19.0" } }
```

`--shared` needs one compatible family with at least two projects and npm locks. It installs once,
synchronizes standalone project lockfiles from the resulting tree and then links the group. A later
`upgrade --shared` can replace that shared installation without running npm in each linked project.
`--verify` records a separate build result for every project in the journal. A failed build returns a
nonzero status; backups remain available for review.

## Shared node_modules per group

One installation per group of projects, each project linked only to what it needs, through directory
junctions (no administrator rights needed on Windows).

```bash
packman store plan --union      # per version group: union of the aligned dependencies, or what to align first
packman store link --group <key> --union [--replace-existing]
packman store verify --script build
packman store status
packman store unlink [--restore]
packman store prune [--trash]   # unused stores; --trash also cleans legacy module backups
packman store plan              # exact mode: identical manifests and lockfiles share one folder junction
```

How the union store works:

- Direct dependencies have one version for the whole group: projects that declare different versions
  are not grouped until they are aligned (`store plan --union` lists what to align).
- npm resolves the store tree fresh from the group manifest; members' lockfiles are not pieced
  together (they were resolved at different times, and mixing them broke builds). Where a package
  needs a dependency version the group cannot share, npm gives it its own nested copy.
- Every dependency edge of the installed tree is then checked the way Node resolves it. A dependency
  outside its range stops the link (nothing is linked); peer ranges the group does not meet are
  listed as incompatibilities to fix in the projects. `store link` also lists the majors that moved
  from a member's previous lockfile.
- After a successful check the members' lockfiles are rewritten from the shared tree (backed up first),
  so they lock the versions the projects actually run with; `--no-sync-locks` leaves them unchanged.
- Each project gets a real `node_modules` folder with one junction per package of the transitive closure
  of its roots: declared dependencies, SPFx core packages, packages imported by code and styles, and
  packages referenced by config files (`parser`, `extends`, `plugins`, `presets`, `types`, `require`).
  Tools that resolve from the project directory (SPFx Sass `~pkg`, ESLint parsers) find what they need,
  and a project never sees packages only other projects use.
- npm never runs in linked projects (`packman install` skips them). With `--replace-existing`, a real
  local `node_modules` is deleted after the store install succeeds. Only `package.json` and lockfiles
  are backed up; modules are never moved to trash. `unlink --restore` restores those files, and
  `packman install` recreates local modules when needed. Unlink without `--restore` keeps current files.
- If the store install fails, nothing is linked.
- Completed stores are reused on re-link. Node versions, member lockfiles and the store format identify
  separate stores, so a new installation does not rebuild a store that other projects are using, and a
  store built the old way is rebuilt.
- Project-relative dependencies (`file:`, `link:`, `workspace:`) are excluded: moving their manifest
  into the store would change what those paths resolve to.
- npm run inside a linked project never touches the store (junctions are not followed), but it does
  change the project: `npm install` and `npm update` replace links with real copies, `npm install <pkg>`
  adds folders the group does not have, `npm uninstall` removes links, `npm ci` replaces the whole
  folder. `store status` and `check` (`store/link-drift`, `store/link-stale`) list exactly what
  changed. `packman store link --of <project> --union` relinks the group the project belongs to now
  (keys change with manifests and locks); copies npm left behind go to `.packman/trash`, never deleted.
  After `npm ci` the folder is no longer packman's, so relinking asks for `--replace-existing`.
- Editors and tools see the store through the links: TypeScript (and the VS Code TS server) resolves
  modules to their real paths in the store, ESLint loads parsers and plugins from the project folder.
- `packman hooks install` adds `post-merge` and `post-checkout` git hooks that run
  `packman store status --check` after a pull or branch switch and print what to relink. They never
  relink by themselves and never fail the git command; hooks packman did not write are left alone, and
  `packman hooks uninstall` removes only its own.

Verified on a copy of a real SPFx 1.21.1 repository (3 web parts): `gulp bundle` and
`gulp bundle --ship && gulp package-solution --ship` pass through the store, and the production bundle
has the same size and the same normalized code as a build with the project's own `node_modules`
(module ids and minified names differ because webpack derives them from file paths).

## SharePoint test data and debug runs

For SPFx projects whose components read SharePoint lists, configuration files and Microsoft Graph.
Use a dev site only: components write to these lists while they run.

```bash
packman sp requirements [--write]          # lists, columns, files and Graph calls the components use
packman sp seed --site <url> [--apply]     # create what packman.sharepoint.json describes (dry run by default)
packman sp test --site <url>               # load every component from its dev server into the site
packman sp clean --site <url>              # remove what seed created
```

- `requirements` reads the source (list titles, `$select`/`$filter`/`orderBy` columns, `items.add`
  writes, `SiteAssets/...` files, Graph calls) and the REST requests recorded by the last `sp test`,
  which carry the columns the code builds at run time. `--write` adds what is missing to
  `packman.sharepoint.json` with guessed types (Yes/No for `eq 1`, dates for date comparisons); types,
  choices and items are completed by hand and never overwritten.
- `packman.sharepoint.json` holds the site, lists (`generic`, `documents`, `events`, `pictures`),
  columns (Text, Note, Number, Boolean, DateTime, Choice, MultiChoice, URL, User, Lookup), items,
  files, page content types (`contentTypes`), modern pages (`pages`, also news) and subsites (`webs`)
  with their own lists, files, content types and pages.
  Item values may be `"@me"` (signed-in user: User column or site user id), `"@aad"` (their Entra
  object id), `{ "lookup": "<Title>" }` and relative dates such as `today+3d` or `now-1h`. Library items
  take a `file` name and a `placeholder` color (a generated PNG) or text `content`. Files take JSON or
  text `content`, a `placeholder`, or `from` (a workspace file such as a sample menu).
- `seed` creates only what is missing: an existing list, column, item with the same Title (file name
  in libraries) or a file a person made is left alone. What it creates is recorded in
  `.packman/sharepoint/seeded.json`; `clean` removes exactly that, and whole lists only when packman
  created them.
- `test` starts `gulp serve` (or `heft start` for Heft projects) for each SPFx project with its Node, opens the hosted workbench with the
  debug manifests, adds each web part from the toolbox (application customizers load on the site home
  page or `--page`), and sorts what the page reports: `load` (a bundle or chunk did not arrive),
  `runtime` (an exception from the component's own bundle), `data` (a list, column or file the site
  lacks) and `host` (workbench noise). Results, REST requests, screenshots and dev server logs go to
  `.packman/validation/<time>-sharepoint/`. Every component starts on an empty workbench (it keeps
  its canvas in session storage otherwise).
- `test --properties` then drives the property pane: every dropdown option, both states of toggles
  and checkboxes, every choice, and a typed value in text fields (URLs, e-mails and numbers where the
  label asks for them; JSON fields are left alone). Controls a change reveals, such as the fields of a
  selected template, are driven one level deeper. Each change is restored and reported with what the
  web part showed, the problems it caused and a screenshot when it broke. Pickers and collection
  editors are listed as not driven.
- `components` in `packman.sharepoint.json` set per web part alias: `query` for the page URL
  (`iditem={Eventi/[test] Evento}` puts in the id of that item), `properties` the web part starts
  with (a dropdown key, the `items` of a collection editor), `page` to host it on a real modern page
  instead of the workbench (for components that read the page item or canvas), and `known` problems
  that come from the hosting page rather than the packages, reported without failing the run.
  `properties` and `page` change only what the browser receives; nothing is saved on the site.
- Sign-in happens in a browser packman opens with its own profile (`browser/` in the per-user
  packman folder: `%LOCALAPPDATA%\packman` on Windows, `~/.cache/packman` elsewhere; Edge or Chrome,
  or `PACKMAN_BROWSER`). packman never handles passwords or tokens: REST calls run inside the
  signed-in page.

Details: [SharePoint testing](docs/sharepoint-testing.md), the
[`packman.sharepoint.json` reference](docs/configuration.md#packmansharepointjson) and
[troubleshooting](docs/troubleshooting.md#sharepoint-runs).

## Configuration

`packman.config.json` in the repository root is optional; without it packman uses the defaults below.

```json
{
  "language": "auto",
  "projects": {
    "include": ["**"],
    "exclude": ["legacy-*"],
    "maxDepth": 4,
    "includeRoot": false,
    "requiredFiles": ["src"],
    "match": "^c106-"
  },
  "profiles": {
    "spfx121": {
      "projects": ["c106-*"],
      "dependencies": { "react": "17.0.1", "@pnp/sp": "4.12.0" },
      "devDependencies": { "@types/webpack-env": "~1.15.2" },
      "conditionalDevDependencies": {},
      "deprecated": ["moment"],
      "scripts": { "build": "gulp bundle" },
      "engines": { "node": ">=22.14.0 <23.0.0" },
      "overrides": {},
      "tsconfig": { "compilerOptions": { "skipLibCheck": true } }
    }
  },
  "policy": {
    "exactVersions": true,
    "groups": [
      {
        "name": "spfx-1.21",
        "projects": ["c106-*"],
        "node": "22.23.4",
        "pins": { "react": "17.0.1" }
      }
    ]
  },
  "checks": {
    "disabled": ["npm/range-spec"],
    "ignoreUnused": ["@microsoft/sp-office-ui-fabric-core"],
    "ignorePaths": ["test/**"]
  }
}
```

## Node selection and edits

`policy.groups[].node` selects the installed Node used by npm commands for the matching projects.
Stack-incompatible group settings are reported and block execution. npm operations plan upgrades
against the target manifest, even when an older stack is still installed. `check` reports the installed
stack. Commands fail when a compatible Node is unavailable; `install --clean` checks before cleaning.

If a file changes after the preview, applying it stops so the new content can be reviewed first.

## Languages

Messages and reports are available in English, Italian and Ukrainian: `--lang en|it|uk`, the `language`
setting or the `PACKMAN_LANG` environment variable. `auto` follows the system locale.

## Development

```bash
npm ci
npm run check      # type-check, ESLint, Prettier, tests
npm run build
```

With npm 11 on Windows, adding or removing a dependency can drop the native rolldown binding used by
Vitest from `package-lock.json` (npm/cli#4828). If tests fail with "Cannot find native binding", delete
`node_modules` and `package-lock.json` and run `npm install` once.

Sources are TypeScript (strict, ESM) in `src/`: `core/` (workspace model, lockfiles, JSON edits),
`providers/` (stack detection and rules), `node/`, `security/`, `policy/`, `store/`, `fixes/`,
`report/`, `cli/` and `tui/`. Commits follow Conventional Commits.

## License

MIT
