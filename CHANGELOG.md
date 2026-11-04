# Changelog

## Unreleased

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
  another (an anima build failed with `Unknown keyword formatMinimum`). Every dependency edge of the
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
