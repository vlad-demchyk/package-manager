# Architecture

packman is a TypeScript (strict, ESM) CLI with an Ink TUI. One analysis core serves the CLI, the TUI
and the library entry point (`src/index.ts`, exported as `.` in `package.json`).

## Module map

| Path                                              | Role                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/packman.cjs`                                 | CommonJS launcher: checks Node >= 22.12, re-runs with a newer installed Node, imports `dist/cli/bin.js`.                                                                                                                                                                                                       |
| `src/cli/bin.ts`, `main.ts`                       | Entry point; `buildProgram()` (commander) registers `check`, `fix`, `tui`, `init`, `store`, `groups`, `node`, `spfx`; `main()` picks the TUI in a terminal and maps errors to exit codes.                                                                                                                      |
| `src/cli/commands.ts`                             | `install`, `clean`, `profile`, `align`, `versions`, `outdated`, `audit`, `list`, `ignore`, `log`, `data`, `relock`.                                                                                                                                                                                            |
| `src/cli/upgrade.ts`, `sharepoint.ts`, `hooks.ts` | `upgrade`, `sharepoint`/`sp`, `hooks`.                                                                                                                                                                                                                                                                         |
| `src/cli/context.ts`                              | `openSession` (config, language, discovery) and `runAnalysis` (reloads config and projects, then `analyze`).                                                                                                                                                                                                   |
| `src/cli/shared.ts`                               | Common options, confirmation, `reviewAndApply` (diff, apply, journal, relock), `relock`, verified-set recording.                                                                                                                                                                                               |
| `src/analyze.ts`                                  | The analysis pipeline and the `Report` type.                                                                                                                                                                                                                                                                   |
| `src/core/`                                       | Config schema (`config.ts`), discovery, lockfile readers (`lockfile.ts`, `lockfile-text.ts` for yarn and pnpm), JSON with comments and format-preserving edits (`json.ts`), version helpers, tree check (`tree.ts`), verified sets, data loading (`data.ts`), finding/fix constructors (`findings.ts`), types. |
| `src/providers/`                                  | Stack providers: `npm.ts`, `spfx/` (provider, matrix, scaffold core packages), `frameworks.ts` (React, TypeScript, Vite, Next.js, Angular, Vue, Electron, ESLint, Jest, Vitest).                                                                                                                               |
| `src/node/`                                       | Node requirements, installed Node discovery (`toolchain.ts`), release and CVE data, Node planning and rules (`plan.ts`).                                                                                                                                                                                       |
| `src/scan/`                                       | Source import scan (`sources.ts`), implicit tool usage and config references (`implicit.ts`).                                                                                                                                                                                                                  |
| `src/security/`                                   | npm advisories (`advisories.ts`) and exposure weighting (`exposure.ts`).                                                                                                                                                                                                                                       |
| `src/policy/`                                     | Version groups, profiles, repository targets.                                                                                                                                                                                                                                                                  |
| `src/fixes/apply.ts`                              | Edit merging, previews, backups, writes, line diff.                                                                                                                                                                                                                                                            |
| `src/ops/`                                        | Command operations: align, clean, data update/status, profile generation, journal, version matrix, outdated.                                                                                                                                                                                                   |
| `src/store/store.ts`                              | Shared store planning, linking, drift, unlink, prune.                                                                                                                                                                                                                                                          |
| `src/upgrade/`                                    | Upgrade planning, SPFx migration, edits, lint metadata, targets.                                                                                                                                                                                                                                               |
| `src/sharepoint/`                                 | Fixtures schema, requirement scan, seed/clean, browser (DevTools protocol), dev server and component checks, property pane runs.                                                                                                                                                                               |
| `src/report/`                                     | Report model and JSON (`model.ts`), text and Markdown renderers.                                                                                                                                                                                                                                               |
| `src/tui/`                                        | Ink app (`App.tsx`), components, runner.                                                                                                                                                                                                                                                                       |
| `src/i18n/`                                       | Message catalogues `en.ts`, `it.ts`, `uk.ts` and `t()`/`tm()`.                                                                                                                                                                                                                                                 |
| `src/exec/run.ts`                                 | Runs npm (or another tool) with a given Node binary, without a shell.                                                                                                                                                                                                                                          |
| `data/`                                           | Bundled compatibility, release and vulnerability data.                                                                                                                                                                                                                                                         |

## Analysis pipeline

`analyze(workspace, options)` in `src/analyze.ts`:

1. **Discovery** (`discoverWorkspace`): projects with their manifest, declared dependencies,
   lockfile summary (npm v1-v3, yarn classic and berry, pnpm v5-v9; yarn and pnpm packages are laid
   out the way npm would hoist them), `node_modules` state (`absent`, `folder`, `link`), installed
   versions of declared dependencies and the verified set.
2. With `targetVersions` (install, relock, store, upgrade) installed and locked top-level versions
   that no longer satisfy the manifest are dropped, so Node is planned against the target manifest.
3. Per project (`analyzeProject`):
   - read Node requirements, then run every provider's `detect` in the order of `PROVIDERS` (npm,
     spfx, react, typescript, vite, next, angular, vue, electron, eslint, jest, vitest);
   - add `target.node` and the matching `policy.groups[].node` as pinned Node requirements;
   - for each detected stack: `constraints`, `implicitlyUsed`, `virtualModules`, `check`;
   - `constraint/package` for package constraints no provider reported;
   - profile findings; usage findings (or only duplicate declarations with `--no-usage`);
   - `planNode` (selection, recommendation, Node rules), exposure, network usage, Node CVE findings.
4. npm advisories for every package version in the workspace (unless `security: false`), turned into
   `security/package-vulnerability` findings per project.
5. Groups (`buildGroups`), group findings, repository target and Node fragmentation findings.
6. Per project: target findings and link findings (`store/link-stale`, `store/link-drift`).
7. Disabled rules are removed; findings are sorted by severity, project and rule.

The `Report` holds projects (`ProjectReport`: stacks, constraints, Node plan, exposure, network,
implicit packages, imports, config references, findings), groups, workspace findings, installed
Nodes, link records and the data dates.

## Providers

`StackProvider` in `src/providers/types.ts`:

```ts
interface StackProvider {
  id: string;
  detect(ctx): StackInfo | undefined | Promise<...>;
  constraints?(ctx, stack): Constraint[];          // Node ranges and package ranges
  check?(ctx, stack): Finding[] | Promise<Finding[]>;
  implicitlyUsed?(ctx, stack): string[] | Promise<string[]>; // never "unused", linked by the store
  virtualModules?(ctx, stack): Promise<string[]>;   // import names resolved by the build
}
```

`ProjectContext` gives the workspace, project, config, Node requirements, stacks detected by earlier
providers and a lazy cached source scan (`ctx.sources()`).

`StackInfo` has `provider`, `version`, `confidence` (`high`, `medium`, `low`), `evidence` and
`details`. The **primary stack** of a project is the first detected of the list in
`src/policy/groups.ts` and drives groups, profiles' `stack`, targets and upgrade families.

### Adding a provider

1. Implement `StackProvider` (for a framework anchored on one package, `frameworkProvider(spec,
check)` in `src/providers/frameworks.ts` already handles detection, locked `engines.node` and
   `data/frameworks.json` constraints).
2. Add it to `PROVIDERS` in `src/analyze.ts` (order matters: later providers see earlier stacks).
3. If it should be a primary stack, add its id to `PRIMARY_STACKS` in `src/policy/groups.ts`; for
   `upgrade`, add its anchor to `STACK_ANCHORS` in `src/upgrade/targets.ts` and, if useful, to the
   `target` schema in `src/core/config.ts`.
4. Add messages to `src/i18n/en.ts`, `it.ts` and `uk.ts`.
5. Add tests (see below).

### Adding a rule

1. Produce the finding with `finding(ruleId, severity, project, msg(key, params), { evidence, fixes,
tags })` from `src/core/findings.ts`, inside a provider's `check` or a policy module.
2. Fixes are `fix(id, msg(...), risk, edits)` with edits `json-set`, `json-remove`, `file-write` or
   `file-delete`. Use `setDependency`/`removeDependency` for manifest changes so the declared section
   is kept. Write a whole file only when JSON paths cannot express the change.
3. Add the message key (and fix title key) to the three catalogues. `en.ts` defines the `MessageKey`
   type and `it.ts`/`uk.ts` are typed as `Catalogue`, so a missing translation is a type error.
4. Tag security findings with `security` so `audit` includes them.
5. Document it in [Rules](rules.md).

## Data files

| File                      | Content                                                                                                                                                                                                             | Updated by                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `data/spfx.json`          | SPFx 1.0.0-1.24.0: Node, toolchain, TypeScript, compiler, React and types, lint, SharePoint environments, build tools version, withdrawn; compilers, lockstep lists, PnP controls libraries, PnPjs majors; sources. | hand                                                    |
| `data/spfx-scaffold.json` | Packages the official generator scaffolds per SPFx version, component type, toolchain and React usage.                                                                                                              | hand (generated from `@microsoft/generator-sharepoint`) |
| `data/node.json`          | Node release lines: latest release and end of life.                                                                                                                                                                 | `packman data update`                                   |
| `data/node-vulns.json`    | Node core vulnerabilities.                                                                                                                                                                                          | `packman data update`                                   |
| `data/frameworks.json`    | Node and companion ranges per Angular (14+), Next.js (13+), Vite (4+) major.                                                                                                                                        | `packman data update`                                   |
| `data/families.json`      | Package families and runtime singletons.                                                                                                                                                                            | hand                                                    |
| `data/network.json`       | Networking packages, code patterns, network-relevant advisory packages.                                                                                                                                             | hand                                                    |

`loadData(name)` (`src/core/data.ts`) caches each file; for the three updatable files an updated
copy in the per-user data folder wins when its `fetchedAt` is at least as recent as the bundled one.
`packman data update` writes only that folder (atomically) and refuses results with fewer release
lines, vulnerabilities or framework majors than already known. `PACKMAN_DATA_DIR=''` disables
updated data.

## Edits, previews and journal

- `collectEdits` merges the edits of several fixes (later wins per JSON path; a removal is never
  undone by another fix's set).
- `previewEdits` computes the new text per file; JSON edits use `jsonc-parser` `modify`, keeping
  comments, key order, indentation and line endings.
- `applyPreviews` refuses stale previews, backs up every file into `.packman/backups/<time>-<random>/`
  and writes.
- `journal()` appends JSON lines to `.packman/journal.jsonl` and never throws.

## Reports

- `renderText` (`src/report/text.ts`): header, data line, groups, workspace findings, per-project
  blocks, summary.
- `renderMarkdown` (`src/report/markdown.ts`): the Markdown file of `check --md`.
- `toJson` (`src/report/model.ts`): the `check --json` document, with translated messages, message
  keys and params, and fix edits with root-relative paths.

## i18n

`t(key, params)` looks the key up in the current catalogue, then English, then returns the key, and
replaces `{param}` placeholders. Findings store a `Message` (`key` + `params`) and are translated
only when rendered, so JSON and the TUI translate the same data.

## TUI

`src/tui/run.tsx` renders `App` in the alternate screen with three callbacks: `load` (runs
`runAnalysis` with progress), `apply` (`applyPreviews`) and `loadOutdated`. The App keeps the selected
fixes per finding, computes previews with `collectEdits`/`previewEdits`, and after applying reloads
the analysis. Tabs: Overview, Projects, Versions, Outdated, Node, Store, Fixes.

## Store and SharePoint

- Store: [Shared store](shared-store.md). The CLI passes an `install(dir, node, mode)` callback to
  `linkGroup`, so the store module never spawns npm itself and tests can replace it.
- SharePoint: `SpClient` (`request(method, path, body?, binary?)`) abstracts REST calls;
  `browserClient` implements it inside the signed-in browser page; tests can pass a fake client.
  `Page` wraps the DevTools protocol over the global `WebSocket`.

## Testing

```bash
npm ci
npm run check        # typecheck + eslint + prettier --check + vitest
npm test             # vitest run
npm run test:watch
npm run build        # tsc -p tsconfig.build.json -> dist/
```

- Run them with Node 22.12 or newer (`engines.node`). The test suite and the CLI are not meant for
  older Node versions.
- Vitest (`vitest.config.ts`) runs `src/**/*.test.{ts,tsx}` and `test/**/*.test.{ts,tsx}` in the
  `node` environment with `PACKMAN_LANG=en` and `PACKMAN_DATA_DIR=''`, so assertions use English
  messages and bundled data on every machine.
- `test/helpers.ts`: `makeWorkspace(files)` creates a temporary workspace from a
  `{ 'relative/path': content }` map and returns `{ root, cleanup }`; `lockfile(name, specs, versions)`
  builds a minimal npm v3 lockfile; `fakeNodes(...versions)` builds installed Node entries;
  `TODAY` is the fixed date `2026-10-30T12:00:00Z` used for date-dependent rules.
- `test/fixtures/workspace/` is a sample repository (SPFx 1.7, 1.18 and 1.21 projects, a web app and
  an API server) used by analysis tests.
- CLI tests call `buildProgram().parseAsync(...)` with `listInstalledNodes` and `runWithNode` mocked
  (`vi.spyOn`), so no real npm or Node manager runs.
- ESLint ignores `dist/`, `coverage/`, `legacy/`, `test/fixtures/`, `bin/` and `.packman/`;
  the repository's own `packman.config.json` excludes `test/**` from the source scan.

The README notes an npm 11 issue on Windows: adding or removing a dependency can drop Vitest's
native rolldown binding from `package-lock.json`; if tests fail with "Cannot find native binding",
delete `node_modules` and `package-lock.json` and run `npm install` once.
