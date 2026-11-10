# Troubleshooting

Situations derived from the code paths and messages of packman (English messages from
`src/i18n/en.ts` and the errors thrown in `src/`). Run with `PACKMAN_DEBUG=1` to see the stack trace
of an unexpected error.

## General

### `Aborted.` without being asked anything

Prompts read from an interactive stdin; without one (CI, pipes, some IDE terminals) every
confirmation answers "no". Pass `-y` to commands that ask (`fix`, `align`, `profile apply`,
`install`, `clean`, `store link`, `store prune`, `upgrade`, `sp seed`, `sp clean`).

### `Dry run: nothing was written. Re-run with --apply to write the changes.`

Edit commands only preview unless `--apply` is given.

### `file changed since preview: <file>; review the changes again`

A file was modified between the preview and the write (for example by an editor or another session).
Nothing was written; run the command again to see the new diff.

### Exit code 2 with a message about `packman.config.json`

The file is not valid JSON(C) or fails validation, for example `policy.groups.0.node: invalid Node
version or range` or `target.spfx: target must be an exact version`. Fix the key named in the
message; see [Configuration](configuration.md).

### `No projects found under <root>`

Discovery found no `package.json` that passes the filters. Check `--depth` / `projects.maxDepth`
(default 4), `projects.include`/`exclude`, `requiredFiles`, `match`, and `--project`/`--exclude`.
Folders whose name starts with `.` and build folders (`dist`, `lib`, `temp`, `release`, ...) are never
searched. The root project is analyzed only with `includeRoot: true` or when it is the only project.

### `packman requires Node >= 22.12 (active: vX) and no newer installed Node was found.`

The launcher needs a Node 22.12+ installed by nvm-windows, nvm, fnm or Volta. Install one (for
example `nvm install 24`); the active Node of your shell can stay what your project needs.

### `packman is not built: run npm run build`

`dist/` is missing in the packman checkout. Run `npm run build` there.

### `npm not found next to <node>`

The Node chosen for a project has no bundled npm (`node_modules/npm/bin/npm-cli.js` next to the
executable or in `../lib`). Reinstall that Node with its manager.

### The report says `(data N days old: packman data update)`

The Node release schedule or the Node CVE list is older than 30 days. Run `packman data update`
(it writes to the per-user data folder; bundled files stay unchanged). `packman data status` shows
which copy each check uses.

## Lockfiles and installs

### `<project>: package-lock.json does not match package.json; run packman relock and review the changes`

`install` refuses projects with `npm/lockfile-drift`: a lockfile out of sync would let npm pick
versions on its own, so the change goes through a reviewed relock instead. Run `packman relock -p <project>`, review the lockfile
diff (versions that moved away from the verified set are listed), then install. `--mode force` runs
`npm install --force` on request.

### `N locked versions differ from the set <script> last passed with (<date>)`

`npm/unverified-versions`: the lockfile moved away from the versions of the last passing build. If
the change is wanted, run the build (`packman store verify` for linked projects, or
`packman upgrade --verify`) to record a new verified set; otherwise restore the lockfile from
`.packman/backups/` or git.

### TUI changes did not update lockfiles

Applying fixes in the TUI writes files with backups but does not relock and does not write the
journal. Run `packman relock` for the changed projects.

## Node

### `No installed Node satisfies <ranges> (recommended <version>)`

`node/not-installed`: the stack, pins, `engines`, group or target ranges have no installed match.
Install the recommended version with your manager. If `engines.node` is an exact version nobody has
installed while another installed Node fits the stack, `packman fix --rule node/not-installed
--risk review` offers to set `engines.node` to the stack range. Commands that need npm skip such
projects with exit code 1; `install --clean` checks every project before removing anything.

### `Node pin <pin> (<file>) conflicts with <range> required by <source>`

`node/pin-conflict`: a `.nvmrc`, `.node-version`, `volta`, `devEngines` or group/target pin does not
intersect the stack's range. The conflicting project pin is ignored for selection; for `.nvmrc` and
`.node-version` `packman fix --rule node/pin-conflict --apply` writes the recommended version.

## Shared store

### `Pass --group <key> or --of <project>.`

`store link` needs one of them. Keys are printed by `packman store plan` (or `--union`).

### `Group <key> not found; run packman store plan.`

- Keys change whenever a member's manifest, lockfile or Node version changes; use
  `packman store link --of <project> --union` to link the group the project belongs to now.
- `--union` must match how the plan was made: exact keys come from `store plan`, union keys (`u-...`)
  from `store plan --union`.
- The project may not be in any group: `store plan --union` lists `versions-differ` candidates with
  `align first: <packages>`, `node-differs` candidates, and `--json` shows excluded projects with the
  reason (local `file:`/`link:`/`workspace:` dependencies, install scripts, missing npm lockfile v2+ in
  exact mode).

### `real node_modules folders found (...); re-run with --replace-existing ...`

Members have their own installed `node_modules`. `--replace-existing` deletes them, but only after the
store installation succeeds; `package.json` and lockfiles are backed up, installed modules are not.
`packman store unlink --restore` brings the manifests and lockfiles back and `packman install`
recreates local modules.

### `npm ci failed in <store> (exit N); nothing was linked`

The store install failed (the message says `npm ci` also for union stores, which run
`npm install --no-audit --no-fund`). No project was changed. Read npm's output above the message.

### `store <key> has dependencies outside their ranges; nothing was linked`

The installed store tree has broken edges (a package would load a dependency outside its range).
Align the versions named in the listed edges, or relink with `--refresh` if a verified seed lockfile
caused it.

### `store <key> is linked but has no completed installation; unlink its projects before rebuilding`

A store folder referenced by link records has no `.packman-ready.json` for that key and Node. Run
`packman store unlink -p <members>` and link again.

### `stale` or `drift` in `store status`, `store/link-stale` or `store/link-drift` in `check`

- `stale`: `package.json` changed since linking. Run `packman store plan --union`, align if needed,
  then `packman store link --of <project> --union`.
- `drift`: npm was run inside a linked project. `npm install`/`npm update` replaced links with real
  copies, `npm install <pkg>` added folders, `npm uninstall` removed links. Declare packages in
  `package.json`, then relink with `--of`; the copies npm left go to `.packman/trash`.
- After `npm ci` the folder is a plain `node_modules` again: relinking needs `--replace-existing`.
- `packman hooks install` reports these after `git pull` and branch switches.

### `linked to the store, package.json changed: run packman add/remove, or packman store link --of <project> --union`

`packman install` found a linked project whose dependency fields changed since it was linked (the
same state `store status` calls `stale`). npm is not run there because it would replace the junctions.
Either run `packman install --sync-store` (rebuilds the group store from the verified set, relinks,
writes the lockfiles), or `packman store link --of <project> --union`. Next time change dependencies
with `packman add <pkg> -p <project> --apply`, which does the rebuild itself.

### `add`: `group: <name>@<spec> differs from the group's ...: the project would leave group <group>`

The version chosen (or requested) is not the spec the other members of the union group declare, and
the union store needs one spec per package. Options, in the order printed:

- `packman add <name>@<group spec> -p <project>`: take the group's version.
- `packman align --package <name> --version <wanted>` (after `packman check`/`fix` if peer ranges
  object), then `packman store link --of <project> --union`: move the whole group.
- `packman store unlink -p <project> --restore`, then `packman add` and `packman install`: the project
  leaves the store and installs on its own.

### `add`: `peer: <name>@<version> wants <peer>@<range>, the project has <peer> <have>`

The registry version was chosen for the Node and the peers the project resolves, but the requested or
group version wants another peer line (React 19 components in a React 17 SPFx project, say). Pick a
version built for the peer the project has, or upgrade the peer in the whole group first
(`packman align --package <peer>`).

### `add`: `family: react-dom@19.0.0 and react@18.3.1 must share the same version`

`data/families.json` ties packages released together (`react`/`react-dom`, Angular framework
packages, `@typescript-eslint/*`, PnPjs majors). Add the family member at the version printed in the
suggestion, or upgrade the whole family with `packman upgrade`.

### `add`: `lockstep: <name> is an SPFx <version> package and must be exactly <version>`

SPFx runtime and build packages are released in lockstep; `packman add <name>` without a range picks
the right version from the matrix. A different requested version is refused.

### `add`: `no version of <name> could be chosen offline`

With `--offline`, no cached registry metadata and no other project, pin, profile or matrix row that
names the package, packman does not guess. Pass `name@<version>` or drop `--offline`.

### `<project> no longer fits a shared group (<reason>); the store was not rebuilt`

After the manifest was written, `store plan --union` no longer places the project in a group:
`versions-differ: <packages>` (the new spec conflicts with another member; the pre-write check
catches the common case, this one appears when several projects were changed at once), or an
exclusion reason. The manifest change stays (backup in `.packman/backups`). Resolve with the options
in the message: the group's spec, `packman align --package`, or unlink and install standalone.

### Upgrade blocker `<project> is already linked; unlink it before changing its dependency set.`

`upgrade` without `--shared` refuses linked projects. Unlink them, or migrate the whole group with
`upgrade --apply --shared`.

### `store plan` warns `gulpfile.js webpack rule include matches <project>/node_modules ...`

Symptom: after linking, the SPFx bundle fails on a package that built fine with a local install
(SPFx 1.18 GlobalLoader: `Module parse failed`). Cause: `gulpfile.js` has a webpack rule whose
`include`/`exclude` is `path.join(__dirname, 'node_modules', '<pkg>')`; webpack follows the junction
to the real path in `.packman/store/...`, so the rule no longer matches and the package is bundled
without its loader. Action: wrap the path in `fs.realpathSync(...)`, for example
`include: fs.realpathSync(path.join(__dirname, 'node_modules', '<pkg>'))`. The warning only covers a
direct call in `gulpfile.js`; check Heft or separate webpack configs by hand.

### `npm ci` in a linked project installs a different layout than the store

Symptom: a project linked with `--union` is installed on its own (CI, another machine) and tools that
load undeclared packages (`.eslintrc.js` with `@rushstack/eslint-config/patch/...`) fail, or the
layout differs from the store. Cause: the lockfile was written by an older lock sync, which kept the
store's nested locations. Action: relink with `packman store link --of <project> --union` (lock sync
on by default). Lock sync now hoists the project's subset of the store tree the way npm would
([lock sync](shared-store.md#lock-sync)), so `npm ci` from that lockfile reproduces the versions in a
standalone layout.

### `N peer ranges exclude <name>@<version>; run packman fix --apply first` from `align --package`

Symptom: `packman align --package <name>` prints this warning, or `npm install` after aligning fails
with `ERESOLVE`. Cause: a package some project installs directly declares a peer range on `<name>`
that excludes the chosen (most common) version; it is usually the package off the stack (SPFx 1.18
with `rush-stack-compiler-5.3`). Action: run `packman check`, then `packman fix --apply` (it moves
that package), then `packman align --package <name>` again. `store plan` prints the same order under
its `versions-differ` candidates.

## SPFx builds

### `gulp bundle --ship` fails on ESLint warnings after an upgrade

typescript-eslint 8 removed rules (`ban-types`, `no-throw-literal`, `no-useless-template-literals`,
...) and changed the default of `no-unused-vars` `caughtErrors` from `none` to `all`. ESLint then
warns in every file, and SPFx `--ship` builds fail on warnings unless the gulpfile suppresses them
(`build.addSuppression(/Warning/gi)`). `check` reports `eslint/unknown-rule` and
`eslint/caught-errors`. Fix:

```bash
packman fix --rule eslint/unknown-rule eslint/caught-errors --risk review --apply
```

### `store verify` passes but `gulp bundle --ship` fails

The SPFx scaffold's `build` script runs `gulp bundle` without `--ship`, and `store verify` runs
`build` by default, so lint warnings and other `--ship`-only failures are not seen. Verify with the
script that passes `--ship`: `packman store verify --script buildp` (or the name your projects use).

### `spfx/tsconfig-compiler`: the build uses another TypeScript than the compiler package

The declared `@microsoft/rush-stack-compiler-*` is the right one for the SPFx version, but
`tsconfig.json` still `extends` a file of another `rush-stack-compiler-<x>` folder (typical after an
upgrade that changed the compiler). Apply the safe fix, which rewrites `extends` to the expected
compiler:

```bash
packman fix --rule spfx/tsconfig-compiler --apply
```

When the compiler package itself is wrong, `spfx/compiler-mismatch` is reported instead and its
fix also rewrites `extends`.

### `ESLint <version> ignores .eslintrc...; migrate to eslint.config.js`

`eslint/legacy-config-ignored`: ESLint 10 no longer reads legacy configs. Migrate to a flat config by
hand (or with `packman upgrade` for SPFx targets with ESLint 9+, which writes `eslint.config.cjs` when
the legacy config is the default SPFx profile).

## SharePoint runs

### `No SharePoint site: pass --site or set "site" in packman.sharepoint.json.`

Give the dev site URL with `--site` or in the fixtures file.

### `Sign in to <site> in the browser packman opened; waiting...`

Sign in in the browser window packman opened (profile in the per-user packman folder, `browser/`).
packman continues as soon as `/_api/web` answers 200 on the site's host. After 10 minutes it stops
with `Not signed in to <site> within 600 s.` If another Chromium already listens on the debugging
port (default 9333), packman connects to that browser instead of starting its own; use `--port` to
pick another port.

### `No Edge or Chrome found; set PACKMAN_BROWSER to a Chromium browser.`

Set `PACKMAN_BROWSER` to the executable of a Chromium-based browser.

### `port 4321 is already in use; stop the other dev server first`

Another `gulp serve` (or anything serving `https://localhost:<port>/temp/build/manifests.js`) is
running. The port comes from the project's `config/serve.json` (default 4321). Stop it and run
`sp test` again.

### `gulp serve exited, see <log>` or `heft start did not start in 300 s, see <log>`

The dev server (`gulp serve` or `heft start`, named in the message) failed or was too slow. Read
`<project>-serve.log` in the run folder under `.packman/validation/`. A project with both gulp and
Heft installed runs Heft only when its `start` or `serve` script mentions `heft`.

### `neither gulp nor heft is installed in the project`

`sp test` skips projects without `node_modules/gulp/bin/gulp.js` and
`node_modules/@rushstack/heft/bin/heft`. Install the project first.

### `sp seed` reports `HTTP 423` for a page

The page was locked when packman set its columns. packman checks a new page out before that change
and retries a `423` after 2, 5 and 10 seconds; the failed page is deleted, so `sp seed --apply` can
simply run again. If it keeps failing, someone (or another tool) holds the page open for editing.

### `sp seed` reports `HTTP 500` adding a content type to a library

SharePoint answers `500` to `AddAvailableContentType` for a few seconds after it creates the content
type. packman retries after 2, 5 and 10 seconds; when all fail, run `sp seed --apply` again: the
content type exists then and only the missing steps run.

### A web part with `page` in its fixture does not render

packman adds the web part to the page's canvas as the browser receives it. That needs the page HTML
to embed `spClientSidePageContext = JSON.parse('...')` (modern pages in SharePoint Online) and the
page to exist: a 404 or a classic page leaves the page unchanged and the component fails as not
rendered. Check `page` (site-relative, e.g. `news/SitePages/test-news-1.aspx`) and the screenshot.

### Components fail with `load` issues and no bundles

The workbench asks whether to load debug scripts. packman clicks the button whose text matches
"Load debug scripts", "Carica script di debug", the Ukrainian label or contains "debug" (and not
"Don't"/"Non caricare"), for up to 15 seconds. With a site language whose button text matches none of
these, the debug manifests are not loaded. Check the screenshot of the component in the run folder.

### `properties: the property pane did not open, nothing was checked`

packman could not open the web part's property pane (it selects the web part and clicks its edit
button up to 5 times). The run's exit code is 1. Check the component screenshot; a web part that
renders an error or no canvas control cannot be configured.

### A data problem keeps failing although it comes from the page

Add the text to `components.<alias>.known` in `packman.sharepoint.json`: matching issues are reported
as `known` and do not fail the run. Missing lists and columns are `data` issues
(`needs-data`): run `packman sp requirements --write`, complete the fixtures and `sp seed --apply`.

## Development

### Tests fail with "Cannot find native binding"

With npm 11 on Windows, adding or removing a dependency can drop Vitest's native rolldown binding
from `package-lock.json`. Delete `node_modules` and `package-lock.json` and run `npm install` once.
