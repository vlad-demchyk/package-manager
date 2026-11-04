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

### Upgrade blocker `<project> is already linked; unlink it before changing its dependency set.`

`upgrade` without `--shared` refuses linked projects. Unlink them, or migrate the whole group with
`upgrade --apply --shared`.

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

### `gulp serve exited, see <log>` or `gulp serve did not start in 300 s, see <log>`

The dev server failed or was too slow. Read `<project>-serve.log` in the run folder under
`.packman/validation/`.

### `no gulp toolchain installed (Heft projects are not supported yet)`

`sp test` skips Heft projects and projects without `node_modules/gulp`. Install the project first.

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
