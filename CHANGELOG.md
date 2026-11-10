# Changelog

## Unreleased

- API breaks are data (`data/api-breaks.json`: PnPjs 2/3/4, React 16/18/19, Fluent UI 8, Microsoft
  Graph client 2/3, SPFx `MSGraphClientV3` and Heft, PnP controls 2/3, each with old and new API
  patterns, the official guide and migration steps). `check` reports `api/migration-required` when
  the installed version and the code sit on different sides of a break (`sp.setup` with PnPjs 3,
  `getAll()` with PnPjs 4, `ReactDOM.render` with React 18, `office-ui-fabric-react` imports with
  `@fluentui/react` 8, ...) with `file:line` places, and `api/migration-split` when projects of the
  repository are on both sides and the old ones still use the old API. Every fix whose version edit
  crosses a break is `breaking` and its finding lists the places to change; `fix`, `align`,
  `profile apply` and `upgrade` print them before the diff, and the upgrade plan shows a
  `Code changes required` block per project (`codeChanges` in `--json`).
- `packman compat <package> -p <project> [--to <version>] [--json]`: one package in one project:
  current version, the ranges the stack gives it (SPFx lockstep, scaffold, PnP controls line,
  recommended PnPjs major, compiler TypeScript, framework matrix), peer ranges of the installed
  packages, its own `engines.node` against the project's Node, the API breaks between the current
  and the target version (or every later break) with the places to change, and the version path.
- `upgrade --no-policy` migrates the selected projects without writing targets, profiles or groups
  to `packman.config.json`.
- Packages named by string in build and lint configs count as used (`loader: 'babel-loader'` in
  `gulpfile.js`, `webpack.*.config.*`, `jest.config.*`, `vite.config.*`, `.eslintrc`, `.babelrc`,
  `config/*.json`), with comments stripped first; `fix --risk review` no longer removes them.
- `packman add <pkg>[@range]... -p <project>` and `packman remove <pkg>... -p <project>`: change
  dependencies through packman instead of bare npm. The version comes from the group (pin, members'
  spec, profile, SPFx matrix, other groups, the project's transitive resolution, then the registry
  version compatible with the project's Node and peers) and the source is printed. Before writing,
  engines, peer ranges, SPFx lockstep, package families, runtime singletons and the group's spec are
  checked; a failed check stops the command. Writes go through preview, `--apply`, backup and
  journal. A standalone project then runs `npm install` with its Node; a project linked to the shared
  store never runs npm in its folder: its group store is rebuilt from the verified set, all members
  relinked and their lockfiles synchronized (`--verify [script]` records the new verified set).
  The selected projects' sources are scanned, so an edit across a documented API break lists the
  `file:line` places and the migration steps one per line; `remove` warns when the package is still
  imported, referenced by a config file or called from an npm script. `--verify` on a standalone
  project says it applies to linked projects only.
- `install`: linked projects are no longer `skipped`; each line says whether the link is up to date
  or stale and which command rebuilds it. `install --sync-store` rebuilds and relinks the groups with
  stale members (no npm inside the projects); `--refresh` without it says it has no effect.
- Store lock sync: a nested package whose hoist does not settle stays nested and is reported with the
  tree size instead of silently; a store tree that a recorded link still points to is never deleted
  before a rebuild.
- `store plan`: the Vite `cacheDir` warning is only given for exact groups (one `node_modules`
  junction); union groups keep Vite's cache per project. New warning when a member's `gulpfile.js`
  has a webpack rule with `include`/`exclude` on `path.join|resolve(__dirname, 'node_modules', ...)`,
  which stops matching under store links because webpack resolves junctions to the store path; wrap
  it in `fs.realpathSync(...)`. Under `versions-differ` candidates the plan prints the order
  `packman check`, `packman fix --apply`, `packman align --package <name>`.
- Lock sync (`store link --union`) hoists each project's subset of the store tree the way a
  standalone `npm ci` would (`hoistLockTree`): nested packages move into free top-level slots while
  every resolution is kept, peers resolve from the parent level and are never nested. The written
  lockfiles are usable for an independent `npm ci`.
- `align --package` warns when peer ranges of packages the projects install exclude the chosen
  version and advises `packman fix --apply` first; the chosen version is still the most common one.
- Docs: SPFx production checks run `store verify --script <script with --ship>` (the scaffold's
  `build` has no `--ship`). TUI tests render into a fixed 100x40 virtual terminal, so `npm run check`
  no longer depends on the terminal size.
- `packman sharepoint` (`sp`): `requirements` collects the lists, columns, files and Graph calls SPFx
  components use, from the source and from the requests of the last test run, into
  `packman.sharepoint.json`; `seed` creates the missing lists, columns, items and files on a dev site
  (dry run by default, idempotent, recorded); `clean` removes exactly what seed created; `test` loads
  every component from its dev server into the hosted workbench (or a page, for application
  customizers) and classifies load, runtime and missing-data problems. Sign-in happens in a browser
  packman opens; it never handles passwords or tokens. `test --properties` drives every property
  pane control, including the fields a template selection reveals, and reports the changes that
  break the web part.
- Linked projects are checked against their link record: `store status` and `check`
  (`store/link-drift`, `store/link-stale`) show links npm replaced with real copies, removed, or
  packages it added. Relinking moves those copies to `.packman/trash` instead of failing on them;
  `store link --of <project>` finds the project's current group without its key.
- `packman hooks install|uninstall`: git `post-merge`/`post-checkout` hooks that report linked
  projects to relink after a pull or a branch switch (`store status --check`).
- ESLint configs are checked against the `@typescript-eslint/eslint-plugin` actually installed:
  rules it no longer has (`eslint/unknown-rule`) and `no-unused-vars` without `caughtErrors` on plugin
  8+ (`eslint/caught-errors`), which make SPFx `--ship` builds fail on warnings. Fixes move removed
  rules to their successors (`ban-types` to `no-restricted-types` with the same types) and keep catch
  bindings unchecked; `upgrade` applies the same migration to kept `.eslintrc` files. Projects whose
  gulpfile suppresses warnings get warnings instead of errors.
- `upgrade` plans convergence on the newest framework stack already present in the repository;
  published releases are selected only with an explicit `--to`. Separate framework families have
  separate baselines, with target-policy findings, generated stack-filtered profiles and build order.
- SPFx migration edits cover runtime/build/lint packages, compiler/TypeScript, React/types, Node pins,
  generator metadata and Heft configs. Known removed APIs, custom Gulp tasks and conflicting profiles
  are reported as blockers. `--shared --verify` installs once and checks each migrated project.
- Shared transitions delete local `node_modules` after successful installation. Only manifests and
  lockfiles are backed up; `unlink --restore` restores those files and never restores installed modules.
- Per-project npm locks can be synchronized from the shared tree for independent installation later.
- Migration resolves the ESLint parser/plugin family from the target config's actual dependencies and
  handles deprecated TypeScript compiler options.
- `yarn.lock` (classic and berry) and `pnpm-lock.yaml` (v5-v9) are read: resolved versions, dev
  flags, peers, engines and deprecations feed the same checks and advisories as npm lockfiles, laid out
  the way npm would hoist them. Drift reports specs missing from yarn descriptors or pnpm specifiers.
- `packman data update [--dry-run]` and `packman data status`: Node release lines and Node core
  vulnerabilities are refreshed from their public sources into the per-user data folder; bundled data
  stays unchanged and is used unless the update is at least as recent.
- Commands without a workspace session (`data`, `log`, `ignore`) detect the output language like the
  others instead of always printing English; the test suite pins English and bundled data.
- `check` checks every dependency edge of npm lockfiles, transitive ones included:
  `npm/tree-broken` (a package would load a dependency outside its range) and `npm/tree-peer`.
- Verified version sets: passing `store verify`/`upgrade --verify` builds save the locked versions
  in `.packman/verified`; the next union store resolves from them (`--refresh` for a fresh tree),
  versions that move away are reported (`npm/unverified-versions`, after relock and links), and
  `npm/range-spec` pins ranges to verified versions. `install` stops on a lockfile out of sync
  instead of falling back to `npm install`.
- `data/frameworks.json`: Node and companion ranges per Angular (14+), Next.js (13+) and Vite (4+)
  major, read from the npm registry and refreshed by `data update`; they feed Node selection and
  `constraint/package` before anything is installed.
- CLI: `update` is `profile apply`, `matrix` is `versions`, `reinstall` is `install --clean`,
  `--lock-only` is `relock`. TUI tabs: Overview, Projects, Versions, Outdated, Node, Store, Fixes.
- Union stores are resolved fresh by npm from the group manifest instead of piecing members'
  lockfiles together path by path, which mixed a parent from one lockfile with nested packages of
  another (a real SPFx build failed with `Unknown keyword formatMinimum`). Every dependency edge of the
  installed tree is checked: a broken edge stops the link, unmet peers are reported as project
  incompatibilities, and majors that moved from members' lockfiles are listed. Store keys and link
  records carry the store format, so stores built the old way are rebuilt rather than reused.
- `store link --union` rewrites members' lockfiles from the checked tree by default
  (`--no-sync-locks` opts out). `fix`, `update`, `align` and `upgrade` relock changed projects after
  version edits by default (`--no-relock` opts out).
- `upgrade` warns (`pnp-async-target`) when PnPjs code must move to async iterators but tsconfig
  targets below ES2018 without `downlevelIteration`: `for await` fails there with TS2495.
- TUI: align from Matrix, Outdated tab with in-major bumps, `u` for profile fixes, read-only Store tab.
- CLI: `store unlink` takes `--project`/`--exclude` globs; `store plan`, `store status` and `log` have
  `--json`; `spfx` accepts `--lang`.
- `profile generate --tsconfig-from <project|latest-ts>` puts a project's tsconfig.json (without
  `files` and `references`) into the profile; `latest-ts` picks the highest TypeScript, as 2.x did.

## 3.0.0-alpha.0

### Fixed after the integration review

- Reload configuration, manifests, locks and installed versions after edits and on TUI refresh.
- Honour group Node settings; plan npm against the target stack during upgrades; fail when no
  compatible Node is installed and check before destructive reinstall cleanup.
- Stop update/install after declined changes or failed relock; install only projects changed by update.
- Reuse completed stores, separate stores by Node and lockfile metadata, scan imports when linking,
  traverse nested dependency closures, preserve recovery records across re-links and partial failures.
- Exclude dependencies whose relative paths would break inside the store; safely clean unrecorded junctions.
- Detect stale previews, keep distinct backups and back up configuration edits from init/profile/ignore.
- Handle TUI preview/apply errors and stale async results; keep long paths inside the terminal header.
- Keep advisory caches for independent package sets; classify a package as runtime when any copy is runtime.
- Provide the ESM entrypoint declared in package exports; remove unused store settings from generated configs.

### Original rewrite

Complete rewrite. 2.x remains available on the `common/public` branch.

### Added

- TypeScript strict ESM codebase with ESLint, Prettier and Vitest; one analysis core shared by the CLI
  and the TUI.
- Stack providers: npm (any project), SharePoint Framework, React, TypeScript, Vite, Next.js, Angular,
  Vue, Electron, ESLint, Jest, Vitest.
- SPFx compatibility matrix 1.0 to 1.24 with sources; detection from installed packages instead of
  `.yo-rc.json`; lockstep, compiler, React, toolchain, PnP library and upgrade path rules.
- Node requirements from `devEngines`, `.nvmrc`, `.node-version`, `.tool-versions`, Volta and `engines`;
  installed Node discovery (nvm-windows, nvm, fnm, Volta) and per-project npm runs with that Node.
- Vulnerabilities: npm advisories for the whole workspace in one cached request, Node core CVEs and end of
  life, severity weighted by exposure (build, browser, server, network calls).
- Version groups with a baseline, divergence detection and alignment fixes.
- Fixes as previewable edits that preserve JSON formatting, applied only with `--apply` and backed up.
- Shared `node_modules` per group through directory junctions (`packman store`), exact and union modes.
- Commands: `check`, `fix`, `tui`, `groups`, `node`, `install`, `init`, `store`, `spfx`.
- English, Italian and Ukrainian messages.

### Added after the first alpha cut (parity with 2.x)

- Dependency profiles (`update`, `profile generate`), pairwise and per-package alignment (`align`),
  version matrix (`matrix`, TUI tab), `outdated`, `audit`, `clean`, `reinstall`, `relock`, `list`,
  `ignore`, `log` with an operation journal, `install --mode --lock-only`, discovery filters
  (`requiredFiles`, `match`, `--exclude`, `--depth`).
- SPFx core packages from the official generator for every version, component type and toolchain;
  unused devDependencies with implicit usage (config files, script executables, plugins, transitive pins);
  merge fix for duplicated declarations; `tslint.json` leftover rule.
- Union store: merged lockfile, per-project links to the transitive closure, `store prune`, journal.

### Fixed during live runs on a copy of a real SPFx repository

- Union store re-resolved every range without a lockfile (88 of 179 runtime packages moved to newer
  versions); now seeded with the members' lockfiles.
- Linked projects missed transitive packages that tools resolve from the project directory (Sass `~`,
  ESLint parser); links now cover the transitive closure.
- Re-linking forgot where the project's own node_modules was moved, so `unlink --restore` restored nothing.
- A fix removing a package from a section could be undone by another fix writing to the same path.
- `install` used `npm ci` on a lockfile out of sync after an alignment; it now falls back to `npm install`.
- Refusals printed stack traces; `--lang` was rejected by some subcommands; store commands were not journaled.

### Removed

- The 2.x `postinstall` setup that copied files and edited the root `package.json` of the host project.
- Yarn 1 workspace mode, regex-based config edits and the interactive `readline` menu.
