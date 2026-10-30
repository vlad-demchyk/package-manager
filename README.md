# packman

Dependency manager for repositories that hold many JS/TS projects, each with its own `package.json`
(for example dozens of SharePoint Framework solutions). packman detects the stack and versions of every
project, checks compatibility and known vulnerabilities, groups projects by version set, aligns versions
inside a group, runs npm with the right Node for each project and can share one `node_modules` per group.

It never changes a repository unless you ask: `check` only reads, `fix` is a dry run until `--apply`,
and manifest/config edits are backed up in `.packman/backups/`. `clean` removes the requested
modules/lockfiles; npm commands update installation files directly.

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
```

All commands accept `--project <globs...>`, `--exclude <globs...>`, `--depth <n>`, `--lang en|it|uk`.
Commands that edit files print a diff and write only with `--apply` (backups in `.packman/backups/`,
history in `.packman/journal.jsonl`); `--relock` regenerates the lockfiles of changed projects with
their own Node.

| 2.x menu                                                      | 3.0 command                                                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Update configs (dependencies-config.js)                       | `packman update [--apply] [--relock] [--install]` with `profiles` in `packman.config.json`                            |
| Generate dependencies config                                  | `packman profile generate --name <name> [--strategy highest\|common] [--write]`                                       |
| Install / reinstall / clean (normal, legacy-peer-deps, force) | `packman install [--mode ...] [--lock-only]`, `packman reinstall [--lock-only]`, `packman clean [--lock] [--modules]` |
| Compare versions between all projects                         | `packman matrix [--diverging] [--package <globs>]`, TUI tab Matrix                                                    |
| Version alignment between projects                            | `packman align --base <a> [--to <b>] [--only ...] [--pin]`, `packman align --package <name> [--version <v>]`          |
| npm outdated / audit / package-lock-only                      | `packman outdated`, `packman audit`, `packman relock`, `packman install --lock-only`                                  |
| Depcheck + whitelist                                          | rules `npm/unused-*` with fixes, `packman ignore add\|remove\|list`                                                   |
| Logs                                                          | `packman log [-n 30] [--prune <days>]`                                                                                |
| List components, recursive search                             | `packman list`, `projects.maxDepth` / `--depth`, `projects.requiredFiles`, `projects.match`                           |
| Workspace mode (Yarn)                                         | `packman store ...` (below)                                                                                           |

`check` exits with code 1 when there are findings of severity `error` or worse (`--fail-on` changes it).

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
| Other stacks         | React, TypeScript (including TypeScript 7 with tools that need its API), Vite, Next.js, Angular, Vue, Electron, ESLint (legacy config ignored by ESLint 10), Jest, Vitest                                                                                                                                                                                                                                                                                                           |

Compatibility data lives in `data/` with the date it was verified and its sources:
`spfx.json` (SPFx 1.0 to 1.24), `node.json` (release schedule), `node-vulns.json` (Node CVEs),
`families.json`, `network.json`, `spfx-scaffold.json`.

Unused-dependency rules count as used: imports from code and styles (`~pkg`, `pkg:`), tools implied by
config files and npm scripts (including the executables of installed packages), plugins of configured
tools, `@types/*`, peer/optional dependencies, SPFx core packages, and packages that other packages
require (a top-level declaration then pins a transitive version).

## Shared node_modules per group

One installation per group of projects, each project linked only to what it needs, through directory
junctions (no administrator rights needed on Windows).

```bash
packman store plan --union      # per version group: union of the aligned dependencies, or what to align first
packman store link --group <key> --union [--replace-existing]
packman store verify --script build
packman store status
packman store unlink [--restore]
packman store prune [--trash]   # stores and moved folders nothing links to
packman store plan              # exact mode: identical manifests and lockfiles share one folder junction
```

How the union store works:

- The store lockfile is merged from the members' lockfiles: agreed versions are kept, conflicting ones
  resolve to the version most members lock, and `store link` lists every conflict. npm then only resolves
  what is missing, so the store keeps the versions the projects are locked to.
- Each project gets a real `node_modules` folder with one junction per package of the transitive closure
  of its roots: declared dependencies, SPFx core packages, packages imported by code and styles, and
  packages referenced by config files (`parser`, `extends`, `plugins`, `presets`, `types`, `require`).
  Tools that resolve from the project directory (SPFx Sass `~pkg`, ESLint parsers) find what they need,
  and a project never sees packages only other projects use.
- npm never runs in linked projects (`packman install` skips them). A real `node_modules` is moved to
  `.packman/trash/` with `--replace-existing` and brought back by `unlink --restore`, also after re-links.
- If the store install fails, nothing is linked.
- Completed stores are reused on re-link. Node versions and member lockfiles identify separate stores,
  so a new installation does not rebuild a store that other projects are using.
- Project-relative dependencies (`file:`, `link:`, `workspace:`) are excluded: moving their manifest
  into the store would change what those paths resolve to.

Verified on a copy of a real SPFx 1.21.1 repository (3 web parts): `gulp bundle` and
`gulp bundle --ship && gulp package-solution --ship` pass through the store, and the production bundle
has the same size and the same normalized code as a build with the project's own `node_modules`
(module ids and minified names differ because webpack derives them from file paths).

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
stack. Commands fail when a compatible Node is unavailable; `reinstall` checks before cleaning.

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
