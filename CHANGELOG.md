# Changelog

## 3.0.0-alpha.0

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
