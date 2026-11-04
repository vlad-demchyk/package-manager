# Upgrade

`packman upgrade` converges the selected projects on the newest stack version **already present in
the repository**. Sources: `src/cli/upgrade.ts`, `src/upgrade/*`. Options:
[Commands](commands.md#upgrade).

```bash
packman upgrade                               # plan and diffs; nothing written
packman upgrade --json                        # plan, blockers and build order as JSON
packman upgrade --stack spfx --to 1.21        # explicit target line
packman upgrade --apply                       # write edits and policy, relock
packman upgrade --apply --install --verify -y # also install and build each project
packman upgrade --apply --shared --verify -y  # install once, link, build every member
```

## Families and target selection

`planUpgrade` in `src/upgrade/plan.ts`:

1. Each project belongs to one **family**, its primary stack: `spfx`, `angular`, `next`, `electron`,
   `vue`, `vite`, `react`, `typescript`, `eslint`, `vitest`, `jest`, or `node` when none is detected.
   `--stack` restricts the families; an unknown name stops with `unknown upgrade stack`.
2. For each family the **baseline** is the project with the highest valid stack version (ties: by
   project id). For `node` the stack version is the selected Node.
3. The **target** is the baseline's version. A repository with SPFx 1.18.2, 1.20.0 and 1.21.1
   converges on 1.21.1. Separate families have separate baselines.
4. `--to <version|range>` needs exactly one family (`--to requires one framework family; select it
with --stack`). For SPFx it picks the highest **non-withdrawn version of the bundled matrix**
   (`data/spfx.json`) matching the range; for other families the highest version **already used by a
   project of that family** that matches. No match stops with `no supported <stack> target matches
<range>`.
5. SPFx toolchain: gulp when the target version is a gulp release, or when the baseline uses gulp and
   the target has a gulp variant that is not unsupported; Heft otherwise.

## Node selection

- Ranges: the SPFx matrix Node range of the target; for other frameworks the baseline's stack ranges
  and its `engines.node`; for `node` the target version itself.
- `--node <version|range>` or `target.node` from the config is added (an invalid range stops with
  `invalid target Node version`).
- The Node is the highest Node already selected by a baseline that satisfies everything, else the
  highest installed Node that does, else the requested exact version, else the recommended release.
- Blockers: `node-incompatible` when no version satisfies every range; `node-policy-scope` when the
  config has `target.node`, the plan picks another Node, and only part of the repository is
  migrated. `node-missing` (review) when the chosen Node is not installed; `--apply` with any npm run
  (relock, `--install`, `--verify`, `--shared`) then stops with
  `Node <version> is not installed; install it before running npm or verifying builds.`

## Edits for every family

For every migrated project:

- Every non-peer dependency used by any project of the family is set to one version: the baseline's
  resolved version, else the highest resolved version among the family, else the baseline's
  declared spec. `@pnp/sp`, `@pnp/graph`, `@pnp/logging`, `@pnp/core` and `@pnp/queryable` follow the
  `@pnp/sp` version. A package moved between sections is removed from the other section. For SPFx,
  packages owned by the SPFx migration below are skipped here.
- Non-SPFx families: the anchor package (`react`, `vite`, `next`, `@angular/core`, ...) is set to the
  target, `react-dom` follows `react`, Angular framework packages follow `@angular/core`, the Node
  edits below are applied, and a `framework-review` issue reminds you to review source and config
  migration and run the build.
- Node edits (`nodeEdits` in `src/upgrade/edits.ts`): `engines.node` set to the exact Node version,
  `.nvmrc` written with it (created when missing), `.node-version` rewritten when present,
  `volta.node` when set, the `node` entry of `devEngines.runtime`, and the `node`/`nodejs` line of
  `.tool-versions`.

Each project's edits become fix `upgrade/<project id>` (risk `review`).

## SPFx migration edits

`spfxMigration` in `src/upgrade/spfx.ts`, based on the target's scaffold (`data/spfx-scaffold.json`)
for the project's component types and React usage:

- **Removed**: `tslint` and `@microsoft/sp-tslint-rules` when the target lints with ESLint; every
  `@microsoft/rush-stack-compiler-*`; on Heft also `gulp`, `gulp-sass`, `ajv`,
  `@microsoft/sp-build-web`, `@microsoft/sp-build-core-tasks`.
- **Runtime, build and lint packages**: every declared `@microsoft/sp-*`, `@microsoft/spfx-*`,
  `@microsoft/eslint-*` and `@microsoft/decorators` is set to the scaffold version (the baseline's
  resolved version or the resolved pin when it satisfies the scaffold spec, else the lowest version
  of the spec), or to the target version when the scaffold does not list it.
- **Scaffold packages**: required scaffold packages are added; optional ones are updated when
  declared; `@types/react` and `@types/react-dom` when React is used.
- **React**: `react` and `react-dom` set to the version the target requires, when React is used.
- **Lint toolchain**: `@rushstack/eslint-config`, `@typescript-eslint/parser`,
  `@typescript-eslint/eslint-plugin` and `@typescript-eslint/utils` set from the dependency metadata
  of the target's `@microsoft/eslint-config-spfx` (`src/upgrade/lint.ts`), read from the baseline's
  lockfile when it has a matching version, otherwise from the npm registry (cached). Without that
  metadata the plan has a `lint-metadata` blocker.
- **TypeScript options**: when the target TypeScript is 5.0+ and `tsconfig.json` sets
  `suppressImplicitAnyIndexErrors`, `suppressExcessPropertyErrors`, `keyofStringsOnly`,
  `noStrictGenericChecks`, `importsNotUsedAsValues`, `preserveValueImports` or `charset`: on 5.5+
  they are removed, on 5.0-5.4 `compilerOptions.ignoreDeprecations` is set to `"5.0"`.
- **gulp targets**: the expected `@microsoft/rush-stack-compiler-*` is added and `tsconfig.json`
  `extends` points to its `includes/tsconfig-web.json`; a missing `build` script becomes
  `gulp bundle`.
- **Heft targets**: `tsconfig.json` extends the web build rig's `tsconfig-base.json`;
  `config/rig.json`, `config/sass.json` and `config/typescript.json` are written (static assets
  `.resx`, `.jpg`, `.png`, `.woff`, `.eot`, `.ttf`, `.svg`, `.gif`, globs `webparts/*/loc/*.js`);
  on 1.24.0+ `watchOptions.excludeDirectories` gets `**/teams` and `**/temp/copilot`. When the project
  moves from gulp to Heft:
  - a standard `gulpfile.js` (only `require('@microsoft/sp-build-web')` and `build.initialize(...)`)
    is deleted; anything else is a `custom-gulp` blocker;
  - scripts made of `gulp bundle|clean|test|serve|package-solution [--ship]` parts are mapped to
    `heft build|clean|test|start|package-solution [--production]`; other gulp commands are a
    `custom-script` blocker; a missing `build` becomes `heft build`;
  - legacy ESLint configs have `@microsoft/spfx/import-requires-chunk-name` and
    `pair-react-dom-render-unmount` renamed to `@rushstack/...`;
  - `config/sass.json` with keys other than `$schema` and `extends` is a `custom-sass` blocker.
- **ESLint** (when the target lints with ESLint): `tslint.json` is deleted.
  - Target ESLint 9+ (flat config): a legacy config identical to the default SPFx profile is deleted,
    any other legacy config is a `custom-eslint` blocker; `eslint.config.cjs` with the SPFx flat
    profile is written when no flat config exists.
  - Older ESLint: `.eslintrc.cjs` with the SPFx default profile is written when no legacy config
    exists. When the pinned `@typescript-eslint/eslint-plugin` is 8+, kept `.eslintrc.js`, `.cjs` and
    `.json` files are migrated: `ban-types`, `no-throw-literal` and `no-useless-template-literals`
    move to their successors (`no-restricted-types` plus the rules covering `ban-types` defaults,
    `only-throw-error`, `no-unnecessary-template-expression`) and
    `@typescript-eslint/no-unused-vars` gets `caughtErrors: 'none'` when it has an options object
    without it. Without this, every file warns and `gulp bundle --ship` fails. After installation
    `eslint/unknown-rule` checks the config against the plugin actually installed (see
    [Rules](rules.md#frameworks-and-tools)).
- **Node**: the Node edits above.
- **Generator metadata**: `.yo-rc.json` `@microsoft/generator-sharepoint.version` set to the target
  and `useGulp` to whether the toolchain is gulp.

### SPFx source checks

| Code               | Level   | When                                                                                                                                                               |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platform`         | blocker | `.yo-rc.json` environment is not `spo` and the target does not support it.                                                                                         |
| `controls`         | blocker | `@pnp/spfx-controls-react` or `@pnp/spfx-property-controls` would stay on a release built for another SPFx minor.                                                  |
| `react-api`        | blocker | Target React 18+ and the source calls `ReactDOM.render`/`unmountComponentAtNode` (or imports them from `react-dom`).                                               |
| `pnp-major`        | review  | `@pnp/sp` changes major.                                                                                                                                           |
| `pnp-api`          | blocker | Target PnPjs 4+ and the source uses `getAll`, `getPaged`, `@pnp/sp/items/get-all`, `@pnp/common`, `@pnp/odata`, or `.paged()` on `@pnp/graph` 4+. Lists the files. |
| `pnp-async-target` | review  | With `pnp-api`: `tsconfig` `target` is ES3-ES2017 without `downlevelIteration`, so `for await` fails with TS2495.                                                  |

Sources are read from `src/` with comments stripped.

## Repository policy

The plan also carries fix `upgrade/policy` for `packman.config.json`:

- Whole-repository runs (no `--project`/`--exclude`): for each family a profile `packman-<stack>`
  with `projects: ["**", "."]`, `stack: <stack>`, the most common declared version of every package
  of the migrated projects, `engines.node` set to the Node version and the scripts all members
  share; `target.<stack>` set to the target; `target.node` when every project of the repository was
  selected; a policy group `packman-<stack>` (same globs, `stack`, `node`, empty `pins`) placed before
  the existing groups. Other `packman-*` profiles and groups of the same family are removed.
- Scoped runs (`--project` or `--exclude`): a profile and group named
  `packman-<stack>-scope-<hash>` with the selected project ids; no `target` is written.

Because generated profiles and groups have a `stack` filter, future projects of that stack follow
them while an unrelated project does not. `check` then reports deviations
(`policy/target-stack`, `policy/target-node`) and `profile apply` enforces the saved versions.

A hand-written profile that matches a migrated project and would put back another version, a
deprecated package or another script is a `profile-conflict` blocker.

## Blockers and issues

Every issue has a code, a level (`blocker` or `review`) and a message. Besides the SPFx codes above:

| Code                                                           | Level   | Meaning                                                                                                      |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `unknown-version`                                              | blocker | The family's version cannot be determined.                                                                   |
| `unknown-spfx`                                                 | blocker | The SPFx target has no migration data.                                                                       |
| `node-incompatible`, `node-policy-scope`                       | blocker | See [Node selection](#node-selection).                                                                       |
| `node-missing`                                                 | review  | The chosen Node is not installed.                                                                            |
| `downgrade`                                                    | blocker | A project is newer than the target.                                                                          |
| `linked`                                                       | blocker | The project is linked to the shared store (without `--shared`); unlink it first.                             |
| `package-version`, `lint-metadata`                             | blocker | No version of a package matching the needed range in project locks or the registry (cache when `--offline`). |
| `custom-gulp`, `custom-script`, `custom-sass`, `custom-eslint` | blocker | Custom build or lint configuration to port by hand.                                                          |
| `profile-conflict`                                             | blocker | A hand-written profile contradicts the migration.                                                            |
| `cycle`                                                        | blocker | A dependency cycle between local projects; build order is ambiguous.                                         |
| `framework-review`                                             | review  | Non-SPFx framework version change.                                                                           |
| `no-build`                                                     | blocker | With `--verify`: a non-SPFx project has no `build`/`test` script.                                            |
| `shared-family`, `shared-excluded`, `shared-lock`              | blocker | With `--shared`: see below.                                                                                  |

With blockers, `upgrade` prints the plan and the diff as a dry run, then
`N blockers require changes before this migration can be applied.` and exits 1, even with `--apply`.

**Build order**: projects are ordered so that a local project another one depends on (matched by
package name) comes first.

## Applying

With `--apply` and no blockers (`src/cli/upgrade.ts`):

1. Backs up `package.json` and the lockfile of every migrated project (journal `upgrade:backup`).
2. Shows the diff and asks for confirmation (`-y` skips it), writes the edits with backups.
3. Without `--shared`: relocks the changed npm projects (default; `--no-relock` keeps lockfiles).
4. `--install` or `--verify` without `--shared`: runs `npm install --no-audit --no-fund` in each
   migrated project in build order with the plan's Node; the first failure stops with its exit code
   (journal `upgrade:install`).
5. `--verify`: runs the verify script of each project in build order (`build`, else `test`;
   journal `upgrade:verify` per project); a failure sets the exit code and the next project still
   runs. Passing projects get verified sets (and stores whose members all passed, see
   [Shared store](shared-store.md#verified-sets)).

`--install` and `--verify` do nothing without `--apply`. `--json --apply` is refused
(`--json prints a read-only migration plan`).

## --shared

`--shared` migrates the family into one shared store (union mode):

- Checked before applying: exactly one family and at least two projects (`shared-family`); the
  migrated manifests, simulated with the plan's Node, must form one union group (`shared-excluded`);
  every lockfile must be an npm lockfile (`shared-lock`). The `linked` blocker does not apply.
- After writing the edits (no per-project relock), the union group of the migrated projects is
  linked with `--replace-existing` and lock sync: one `npm install`, tree check, members' lockfiles
  rewritten from the store tree, local `node_modules` deleted only after the install succeeded, and
  junctions created. Only manifests and lockfiles are backed up. The verified store set of the group
  is used as seed when it exists. Journal `upgrade:shared`.
- A later `upgrade --shared` can replace that shared installation without running npm in each
  linked project.
- With `--verify`, builds run in the linked projects; when they all pass, the store lockfile becomes
  the group's verified set.

## What upgrade does not do

- It does not select a release newer than the repository's own versions unless `--to` is given, and
  for non-SPFx families `--to` only chooses among versions already in the repository.
- It does not port custom gulp tasks, custom lint settings or removed React/PnPjs APIs: these are
  reported as blockers.
- Major API changes still need code review; `--verify` runs the build to catch what compiles.
