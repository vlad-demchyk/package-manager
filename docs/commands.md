# Command reference

Every command, subcommand and option as defined in `src/cli/main.ts`, `src/cli/commands.ts`,
`src/cli/upgrade.ts`, `src/cli/sharepoint.ts` and `src/cli/hooks.ts`. `pm` is an alias of `packman`.

- [Conventions](#conventions)
- Analysis: [check](#check), [list](#list), [groups](#groups), [versions](#versions),
  [outdated](#outdated), [audit](#audit), [node](#node), [spfx](#spfx)
- Fixes and edits: [fix](#fix), [align](#align), [profile apply](#profile-apply),
  [profile generate](#profile-generate), [install](#install), [clean](#clean), [relock](#relock),
  [ignore](#ignore), [data](#data)
- [upgrade](#upgrade)
- Store: [store plan](#store-plan), [store link](#store-link), [store status](#store-status),
  [store verify](#store-verify), [store unlink](#store-unlink), [store prune](#store-prune)
- SharePoint: [sp requirements](#sp-requirements), [sp seed](#sp-seed), [sp clean](#sp-clean),
  [sp test](#sp-test)
- [hooks](#hooks), [tui](#tui), [init](#init), [log](#log)

## Conventions

### Common options

Commands marked "common options" accept these (`commonOptions` in `src/cli/shared.ts`):

| Option                     | Meaning                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `[path]`                   | Workspace root. Default `.`.                                                       |
| `-p, --project <globs...>` | Only these project ids or globs (picomatch on the project id).                     |
| `-x, --exclude <globs...>` | Leave out these project ids or globs.                                              |
| `--depth <n>`              | How deep to search for projects; overrides `projects.maxDepth`. Whole number >= 0. |
| `--lang <language>`        | `auto`, `en`, `it`, `uk`.                                                          |
| `--offline`                | Do not use the network: npm advisories and registry data come from the cache only. |
| `--no-security`            | Skip the npm advisories lookup.                                                    |
| `--no-usage`               | Skip the source scan (undeclared/unused imports, network usage).                   |

A project id is the workspace-relative folder with forward slashes (`.` for the root). Several
commands force `--no-security` and some also `--no-usage` internally because they do not need them;
the table of each command says which.

Commands without the common options (`node`, `spfx`, `store status`, `store unlink`,
`store prune`, `log`, `data`, `ignore`, `hooks`) take only the options listed for them; most still
accept `--lang`.

### Default command

`check` is the default command. In addition, `main()` in `src/cli/main.ts` opens the **TUI** when
stdout and stdin are terminals, the `CI` variable is not set and no argument starts with a lowercase
letter (except `.`). So `packman` and `packman ../repo` open the TUI in a terminal, while
`packman > out.txt` or a CI job runs `check`.

### Language

`--lang` wins. Commands that open a workspace then apply `language` from `packman.config.json`
when `--lang` is not given. `auto` reads `PACKMAN_LANG`, then `LC_ALL`, `LC_MESSAGES`, `LANG`, then
the system locale: `uk*` gives Ukrainian, `it*` Italian, anything else English.

### Dry run, confirmation and backups

- Commands that edit files share one flow (`reviewAndApply` in `src/cli/shared.ts`): print a diff
  per file, stop with `Dry run: nothing was written` unless `--apply`, ask
  `Apply N changes to M files? [y/N]` unless `-y`, write with a backup of every touched file in
  `.packman/backups/<ISO time>-<random>/`, and append to `.packman/journal.jsonl`.
- Confirmation prompts read `y`, `yes`, `s`, `si`, `т`, `так`. Without an interactive stdin every
  prompt answers "no", so scripts must pass `-y`.
- Before writing, every file is compared with its preview; a file changed in between stops the
  write with `file changed since preview: <file>; review the changes again` (nothing is written).
- After writing, when an edit changed a dependency field (`dependencies`, `devDependencies`,
  `optionalDependencies`, `peerDependencies`, `overrides`) of a `package.json`, the changed projects
  that have an npm lockfile are relocked with their Node (`npm install --package-lock-only
--ignore-scripts --no-audit --no-fund`). `--no-relock` skips that; `--relock` relocks every changed
  project, with or without lockfile, even without version edits. A failed relock sets exit code 1.

### Exit codes

| Code | When                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 0    | Success.                                                                                                           |
| 1    | Command-specific failure (listed per command), or any refused operation (`Error` message printed without a stack). |
| 2    | `packman.config.json` cannot be parsed or fails validation (`ConfigError`).                                        |
| n    | Commands that run npm or scripts return the failing npm/script exit code where noted.                              |

Set `PACKMAN_DEBUG=1` to get the stack trace of an unexpected error instead of the one-line message.

---

## Analysis

### check

```text
packman check [options] [path]
```

Analyze the selected projects and print findings. Common options, plus:

| Option               | Default | Meaning                                                                           |
| -------------------- | ------- | --------------------------------------------------------------------------------- |
| `--json`             |         | Print the report as JSON on stdout (progress is not printed).                     |
| `--md <file>`        |         | Also write a Markdown report to `<file>`.                                         |
| `--severity <level>` | `info`  | Minimum severity to print: `critical`, `error`, `warning`, `info`.                |
| `--fail-on <level>`  | `error` | Exit 1 at this severity or worse: `critical`, `error`, `warning`, `info`, `none`. |
| `-v, --verbose`      |         | Print all evidence lines (default: the first 4 per finding).                      |

Reads: manifests, lockfiles, `node_modules/<dep>/package.json`, sources (unless `--no-usage`), Node
pin files, `.packman/links.json`, `.packman/verified/`, the npm advisories endpoint or its cache
(unless `--no-security`). Writes: only `--md` and the advisory cache in the per-user folder.

Exit codes: 1 when no project is found (`No projects found under <root>`), 1 when a finding reaches
`--fail-on`; `--severity` only filters printing and does not change the exit code.

`--json` shape (`toJson` in `src/report/model.ts`):

```jsonc
{
  "root": "C:\\repo",
  "generatedAt": "2026-11-04T10:00:00.000Z",
  "data": {
    "spfx": "2026-10-30",
    "node": "2026-10-30",
    "nodeVulns": "2026-10-30",
    "advisories": { "checked": true, "source": "...", "fetchedAt": "..." },
  },
  "summary": { "critical": 0, "error": 3, "warning": 5, "info": 2 },
  "installedNodes": [{ "version": "22.19.0", "manager": "nvm-windows" }],
  "groups": [
    {
      "name": "spfx@1.21.1 / node 22",
      "origin": "auto",
      "stack": "spfx",
      "stackVersion": "1.21.1",
      "node": "22.21.1",
      "projectIds": ["a", "b"],
      "pins": {},
      "baseline": true,
    },
  ],
  "workspaceFindings": [/* finding */],
  "projects": [
    {
      "id": "a",
      "name": "a",
      "stacks": [
        {
          "provider": "spfx",
          "version": "1.21.1",
          "confidence": "high",
          "evidence": ["..."],
          "details": { "toolchain": "gulp" },
        },
      ],
      "node": {
        "effective": [">=22.14.0 <23.0.0"],
        "recommended": "22.21.1",
        "selected": { "version": "22.19.0", "manager": "nvm-windows" },
        "requirements": [{ "range": "22.19.0", "source": ".nvmrc" }],
      },
      "exposure": "browser",
      "network": { "used": true, "signals": ["@pnp/sp"] },
      "summary": { "critical": 0, "error": 1, "warning": 2, "info": 0 },
      "findings": [
        {
          "ruleId": "npm/range-spec",
          "severity": "warning",
          "projectId": "a",
          "message": "2 dependencies use version ranges instead of exact versions",
          "key": "npm.rangeSpec",
          "params": { "count": 2 },
          "evidence": ["react@^17.0.1"],
          "tags": ["alignment"],
          "fixes": [
            {
              "id": "npm/pin-installed",
              "title": "Pin ranges to the installed versions",
              "risk": "safe",
              "edits": [
                {
                  "kind": "json-set",
                  "file": "a/package.json",
                  "path": ["dependencies", "react"],
                  "value": "17.0.1",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
```

Edit kinds are `json-set`, `json-remove`, `file-delete` and `file-write`; `file` is relative to the
root. The values above are illustrative.

### list

```text
packman list [options] [path]
```

Projects found and their state. Common options (security and usage are forced off), plus `--json`.

Text: one line per project with id, primary stack (`provider@version`), `tsconfig` yes/no, `src`
yes/no, `node_modules` (`absent`, `folder`, `link`), lockfile (`npm v3`, `yarn v1`, `pnpm v9`, ...)
and the selected Node.

`--json`: an array of `{ id, name, stack, tsconfig, src, nodeModules, lockfile, node }` (`stack`,
`lockfile` and `node` are strings, `-` when unknown).

### groups

```text
packman groups [options] [path]
```

Version groups and the baseline. Common options (security and usage forced off), plus `--json`.

Groups come from `policy.groups` (first matching entry) or are derived as
`<primary stack>@<version> / node <major>`; the group with most projects is the baseline. See
[Configuration](configuration.md#policy-groups).

`--json`: the array of groups, each `{ name, origin: "config"|"auto", stack?, stackVersion?, node?,
projectIds, pins, baseline }`.

### versions

```text
packman versions [options] [path]
```

Version of every declared package in every project (peer dependencies excluded). Common options
(security and usage forced off), plus:

| Option                 | Meaning                                   |
| ---------------------- | ----------------------------------------- |
| `--diverging`          | Only packages with more than one version. |
| `--package <globs...>` | Only these package names (picomatch).     |
| `--json`               | Print as JSON.                            |

The version of a cell is the installed version, else the locked one, else the lowest of the spec
(`resolveVersion`). Text output marks diverging packages with `≠` and lists which projects use each
version.

`--json`: `{ projects: string[], rows: [{ name, cells: { <projectId>: { spec, section, version? } },
versions: string[], diverging: boolean }] }`.

### outdated

```text
packman outdated [options] [path]
```

Current, wanted and latest versions from the npm registry, for registry specs only. Common options
(security and usage forced off; `--offline` uses cached registry data), plus `--json`.

A row is printed when the current version is lower than `latest` or `wanted`, or when the current
version is deprecated. `wanted` is the highest stable version the spec allows. Registry documents are
cached for 12 hours in `<per-user folder>/cache/packuments`. A latest on another major is printed in
red.

`--json`: an array of `{ projectId, name, spec, current?, wanted?, latest?, latestInMajor?,
deprecated? }`.

### audit

```text
packman audit [options] [path]
```

Only security findings (`security/package-vulnerability`, `security/node-vulnerable` and any other
finding tagged `security`, such as `node/eol` and `node/patched-available`). Common options; security
is always on (`--no-security` is ignored), `--offline` uses the advisory cache.

Exit code 1 when any of these findings is `critical` or `error`.

`--json`: an array of raw findings `{ ruleId, severity, projectId?, message: { key, params },
evidence, fixes, tags }`. Unlike `check --json`, `message` is not translated.

### node

```text
packman node [--json] [--lang <language>]
```

Installed Node versions with release phase, end of life, latest patch of the line and the number of
known Node core CVEs. Does not take a path or project options.

`--json`: an array of `{ version, executable, manager, phase, end, latest, vulnerabilities, worst }`.
For an EOL line the text output says `EOL: N known CVE, later ones not assessed or patched`.

### spfx

```text
packman spfx [--json] [--lang <language>]
```

Prints the SPFx compatibility matrix from `data/spfx.json` (version, Node range, React, compiler,
`withdrawn`, `gulp`/`heft`). `--json` prints the whole matrix object (`verifiedAt`, `sources`,
`notes`, `versions`, `compilers`, `lockstep`, `libraries`, `pnpjs`).

---

## Fixes and edits

### fix

```text
packman fix [options] [path]
```

Preview or apply the fixes attached to findings. Common options, plus:

| Option                | Default | Meaning                                                         |
| --------------------- | ------- | --------------------------------------------------------------- |
| `-r, --rule <ids...>` |         | Only fixes of findings with these rule ids.                     |
| `-f, --fix <ids...>`  |         | Only these fix ids.                                             |
| `--risk <level>`      | `safe`  | Highest risk to include: `safe`, `review`, `breaking`.          |
| `--apply`             |         | Write the changes (backups in `.packman/backups`).              |
| `--relock`            |         | Regenerate lockfiles of all changed projects with their Node.   |
| `--no-relock`         |         | Keep lockfiles unchanged (default: relock after version edits). |
| `-y, --yes`           |         | Do not ask for confirmation.                                    |

Selection: every fix of every finding (workspace and projects) whose rule matches `--rule`, whose
risk is at most `--risk` and whose id matches `--fix`. Edits of several fixes are merged: a later
edit on the same JSON path wins, but a removal made by one fix is never undone by another fix
(`collectEdits` in `src/fixes/apply.ts`). Fix ids and risks are listed in [Rules](rules.md).

See [dry run, confirmation and backups](#dry-run-confirmation-and-backups). Journal command: `fix`.

### align

```text
packman align [options] [path]
```

Align one project to another, or one package everywhere. Common options (security and usage forced
off), plus:

| Option                                            | Meaning                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `--base <project>`                                | Project to change.                                                                         |
| `--to <project>`                                  | Project to copy versions from.                                                             |
| `--package <name>`                                | Align this package across the selected projects.                                           |
| `--version <version>`                             | Version for `--package` (default: most common resolved version, then highest).             |
| `--only <names...>`                               | With `--base`/`--to`: only these packages.                                                 |
| `--pin`                                           | Drop range prefixes (`^`, `~`) from copied versions (uses the lowest version of the spec). |
| `--include-missing`                               | With `--base`/`--to`: also add packages the base does not declare.                         |
| `--apply`, `--relock`, `--no-relock`, `-y, --yes` | As for `fix`.                                                                              |

Modes:

- `--package <name> [--version <v>]`: sets the declared spec of `<name>` in every section that
  declares it (`dependencies`, `devDependencies`, `optionalDependencies`; never
  `peerDependencies`) of every selected project. Fix `align/package`, risk `breaking` when a
  declared major differs from the target, `review` otherwise.
- `--base <a>` without `--to`: lists up to 15 projects that share the most identical declared specs
  with `<a>`, then exits.
- `--base <a> --to <b>`: prints the differing packages (`different`, `onlyBase`, `onlyTarget`) and
  copies `<b>`'s specs into `<a>` (fix `align/project`, risk `review`). A package missing in `<a>` is
  added only with `--include-missing`, in `<b>`'s section.

Exit code 1 for an unknown project id or when neither `--package` nor `--base` is given.

### profile apply

```text
packman profile apply [options] [path]
```

Apply every fix of every `profile/*` finding (all risk levels), that is: make the selected projects
match their profiles in `packman.config.json`. Common options (security forced off), plus:

| Option                     | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `--apply`                  | Write the changes.                                             |
| `--relock` / `--no-relock` | As for `fix`.                                                  |
| `--install`                | After a successful `--apply`, run npm in the changed projects. |
| `-y, --yes`                | Do not ask for confirmation.                                   |

Without profiles it prints `No profiles in packman.config.json` and exits 0. `--install` runs the
same npm command as [`install`](#install) (`npm ci` for npm lockfiles) without another
confirmation, only in projects with a file changed by the profile fixes. Journal commands:
`profile apply`, `profile apply:install`. See [profiles](configuration.md#profiles).

### profile generate

```text
packman profile generate --name <name> [options] [path]
```

Build a profile from the selected projects. Common options (security and usage forced off), plus:

| Option                      | Default   | Meaning                                                                                                      |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `-n, --name <name>`         | required  | Profile name.                                                                                                |
| `--strategy <strategy>`     | `highest` | Version to keep when projects differ: `highest` or `common` (most used, then highest).                       |
| `--declared`                |           | Use declared specs instead of resolved (installed or locked) versions.                                       |
| `--tsconfig-from <project>` |           | Put a project's `tsconfig.json` into the profile; `latest-ts` picks the project with the highest TypeScript. |
| `--write`                   |           | Write the profile into `packman.config.json` (`profiles.<name>`).                                            |

Placement: a package declared in `dependencies` at least as often as in `devDependencies` goes to
`dependencies`; a dev package declared by every selected project goes to `devDependencies`; other dev
packages go to `conditionalDevDependencies`. Peer and optional dependencies are ignored. `projects`
is the `--project` globs, or the selected project ids. When every selected project is SPFx and they
share one stack Node range, `engines.node` is set to it. `files` and `references` are dropped from a
copied tsconfig.

The profile JSON is always printed on stdout. Without `--write` it ends with
`Not written: add --write to save it`. With `--write` the config file is edited (backup in
`.packman/backups/`, journal `profile generate`) without a confirmation prompt. Exit code 1 when the
`--tsconfig-from` project has no readable `tsconfig.json`.

### install

```text
packman install [options] [path]
```

Run npm in each selected project with that project's Node. Common options (security and usage forced
off; Node is planned against the manifest, ignoring installed or locked roots that no longer satisfy
it), plus:

| Option          | Default  | Meaning                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `--mode <mode>` | `normal` | `normal`, `legacy-peer-deps`, `force`.                                   |
| `--clean`       |          | Remove `node_modules` and lockfiles first, then install (2.x reinstall). |
| `-y, --yes`     |          | Do not ask for confirmation.                                             |

npm arguments per project: `ci` when the project has an npm lockfile and the mode is not `force`,
otherwise `install` (so yarn, pnpm and lockfile-less projects get `npm install`); plus
`--legacy-peer-deps` or `--force` for those modes; always `--no-audit --no-fund`.

- Projects linked to the shared store are listed as `linked to the store, skipped` and never run npm.
- A project with an `npm/lockfile-drift` finding is not installed (unless `--mode force`): it prints
  `package-lock.json does not match package.json; run packman relock and review the changes` and the
  exit code becomes 1. The other projects still run.
- A project without a compatible installed Node is skipped with exit code 1 (journal `failed`).
- A failing npm run sets the exit code to npm's.

`--clean`: first checks that every non-linked project has a compatible Node (otherwise prints the
missing ranges and exits 1 without removing anything), lists what it removes, asks
`Clean and reinstall N projects?`, removes `node_modules` and the lockfile of every non-linked
project, runs the install without asking again (npm resolves every version afresh, so it runs
`npm install`), and finally prints the versions that moved away from each project's verified set.
Journal commands: `install`, `install:clean`.

### clean

```text
packman clean [options] [path]
```

Remove `node_modules` and/or lockfiles. Common options (security and usage forced off), plus:

| Option      | Meaning                      |
| ----------- | ---------------------------- |
| `--lock`    | Remove lockfiles.            |
| `--modules` | Remove `node_modules`.       |
| `-y, --yes` | Do not ask for confirmation. |

Without `--lock` and `--modules` both are removed. A linked `node_modules` is only unlinked (the
store and its link record are handled like [`store unlink`](#store-unlink) without `--restore`); a
real folder is deleted recursively. Prints `Nothing to clean.` when there is nothing; otherwise asks
`Remove N items?`. Journal command: `clean`.

### relock

```text
packman relock [options] [path]
```

Regenerate the lockfile of every selected project with its own Node:
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`. Common options (security and
usage forced off). No confirmation prompt. Linked projects are skipped. Projects without a compatible
Node are reported and counted as failures. After each successful relock, versions that moved away
from the project's verified set are printed. Exit code 1 when any relock failed. Journal command:
`relock` (one entry per project).

### ignore

```text
packman ignore add <packages...> [-C <path>] [--lang <language>]
packman ignore remove <packages...> [-C <path>] [--lang <language>]
packman ignore list [-C <path>] [--lang <language>]
```

Edit `checks.ignoreUnused` (packages never reported as unused). `-C, --cwd <path>` is the workspace
root (default `.`). `add`/`remove` rewrite the sorted list in `packman.config.json` (creating the file
when missing, backup in `.packman/backups/`) and print it; there is no confirmation. `list` prints
the list or `(empty)`.

Note: these subcommands open the workspace without passing `--lang`, so the config `language` (or
`auto` detection) applies to their output after `--lang` is read (`src/cli/commands.ts`).

### data

```text
packman data status [--json] [--lang <language>]
packman data update [--dry-run] [--json] [--lang <language>]
```

The data behind the checks (`src/ops/data.ts`, `src/core/data.ts`).

`status` lists every data file with the date of the bundled copy, the date of the updated copy (or
`-`, or `curated` for files edited by hand) and which copy is used. `--json`:
`{ dir: string | null, files: [{ name, bundled, updated?, active: "bundled"|"updated", updatable }] }`.

`update` downloads, in parallel:

- the Node release schedule (`nodejs/Release` `schedule.json`) and `https://nodejs.org/dist/index.json`
  into `node.json`;
- Node core vulnerabilities (`nodejs/security-wg` `vuln/core/index.json`) into `node-vulns.json`;
- registry documents of `@angular/core`, `@angular/compiler-cli`, `next` and `vite` into
  `frameworks.json` (Angular 14+, Next.js 13+, Vite 4+).

It prints the changes per file. Without `--dry-run` it writes the three files to the per-user data
folder (`%LOCALAPPDATA%\packman\data` on Windows, `~/.cache/packman/data` elsewhere,
`PACKMAN_DATA_DIR` overrides it, an empty value disables updated data). The update is refused when a
release line already known is missing, when there are fewer vulnerabilities than already known, or
when a framework has fewer majors than already known. Bundled files in `data/` are never modified;
an updated copy is used only while its `fetchedAt` is at least as recent as the bundled one.
`--json` prints `{ dir, files: [{ name, before, after, changes: string[] }] }`.

---

## upgrade

```text
packman upgrade [options] [path]
```

Converge projects on the newest stack already present in the repository. Full explanation in
[Upgrade](upgrade.md). Common options (security forced off; analysis against target versions), plus:

| Option                     | Meaning                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stack <names...>`       | Framework families to migrate: `spfx`, `angular`, `next`, `electron`, `vue`, `vite`, `react`, `typescript`, `eslint`, `jest`, `vitest`, `node`. |
| `--to <version>`           | Explicit target version or line (default: newest existing project). Needs one family.                                                           |
| `--node <version>`         | Explicit Node version or range (default: a common installed Node).                                                                              |
| `--json`                   | Print the migration plan as JSON (read-only; cannot be combined with `--apply`).                                                                |
| `--apply`                  | Write the reviewed migration and the repository policy.                                                                                         |
| `--relock` / `--no-relock` | As for `fix` (ignored with `--shared`, which writes locks from the store).                                                                      |
| `--install`                | Install migrated projects (`npm install` with the plan's Node).                                                                                 |
| `--shared`                 | Install once, delete local modules and link the migrated group; back up manifests/locks only.                                                   |
| `--verify`                 | Install and run the build (or test) script of every migrated project.                                                                           |
| `-y, --yes`                | Do not ask for confirmation.                                                                                                                    |

Without `--apply` it prints the plan and the diff and writes nothing. Exit codes: 1 when the plan has
blockers (also with `--json`, after printing the plan), 1 when no project matches, the npm or script
exit code when an install or a verification build fails. `--json` prints the `UpgradePlan`
(`src/upgrade/types.ts`): `{ root, targets, projects, order, fixes, issues, nodeVersion?, node? }`.

---

## Store

Shared `node_modules` per group of projects. Concepts and guarantees: [Shared store](shared-store.md).

### store plan

```text
packman store plan [options] [path]
```

Which projects can share one install. Common options (security and usage forced off), plus:

| Option    | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| `--union` | One install per version group with the union of aligned dependencies. |
| `--json`  | Machine-readable output.                                              |

Text: each group with its key, Node and members, its warnings, then candidates that cannot share yet
(`~ versions-differ: ...` with `align first: <packages>`, `node-differs`, `lockfile-differs`).
Excluded projects are only in `--json`.

`--json`: `{ groups: [{ key, mode: "exact"|"union", projectIds, node?, nodeMajor?, lockSource?,
manifest?, warnings }], candidates: [{ projectIds, reason, packages? }], excluded: [{ projectId,
reason }] }`.

### store link

```text
packman store link (--group <key> | --of <project>) [options] [path]
```

Install a group once and link its projects to it. Common options (security forced off), plus:

| Option               | Meaning                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `-g, --group <key>`  | Group key from `store plan` (a prefix is enough: the first group whose key starts with it).          |
| `--of <project>`     | The group this project belongs to now (keys change with manifests and locks).                        |
| `--union`            | The group comes from `store plan --union`.                                                           |
| `--replace-existing` | Delete local `node_modules` after the store installation succeeds; back up manifests and locks only. |
| `--refresh`          | Union: resolve the store fresh instead of from the verified set.                                     |
| `--no-sync-locks`    | Union: leave project lockfiles unchanged instead of writing the group tree into them.                |
| `-y, --yes`          | Do not ask for confirmation.                                                                         |

Prints the members, the Node and the warnings, then asks `Install the store and link these projects?`.
The store is installed in `.packman/store/<key>/` (`npm ci` for exact groups,
`npm install --no-audit --no-fund` for union groups). After linking it prints major version changes
against members' previous lockfiles (`~ name: old (members) -> new`), unmet peer requirements,
versions that moved away from the verified set, and packages moved to `.packman/trash`. Journal
command: `store link`.

Exit code 1 without `--group`/`--of` (`Pass --group <key> or --of <project>.`) or when no group
matches (`Group <x> not found; run packman store plan.`). Refusals (real `node_modules` without
`--replace-existing`, failed install, broken tree) print the reason and exit 1.

### store status

```text
packman store status [path] [--json] [--check] [--lang <language>]
```

Linked projects and whether they still match the store. Reads `.packman/links.json` and each
linked project's `package.json` and `node_modules`.

- `ok`: matches the link record.
- `stale`: the project's dependency fields changed since linking (manifest key differs).
- `drift`: `node_modules` differs from what packman linked; the next line says what is missing,
  replaced by real copies, or not from the store.

`--check`: exit code 1 when any project is stale or drifted (used by the git hooks). `--json`: an
array of `{ projectId, target, stale, drift?: { missing, replaced, extra } }`.

### store verify

```text
packman store verify [options] [path]
```

Run an npm script in every linked project with the project's selected Node. Common options (security
and usage forced off), plus `--script <name>` (default `build`).

A project without a compatible Node is reported and sets exit code 1. A failing script sets the exit
code to the script's. Each run is journaled (`store verify`). Afterwards, every passing project with
an npm lockfile gets a verified set, and every store whose linked members all passed keeps its
lockfile as the store's verified set (`.packman/verified/`). See
[verified sets](shared-store.md#verified-sets).

### store unlink

```text
packman store unlink [path] [-p <globs...>] [-x <globs...>] [--restore] [--lang <language>]
```

Remove links created by packman; never deletes a real folder. `-p`/`-x` select linked project ids
(picomatch); without them every link is removed. `--restore` copies the backed-up `package.json` and
lockfiles back; run `packman install` to recreate local modules. A project whose `node_modules` is a
real folder is skipped (`node_modules is a real folder, left untouched`) and keeps its record.
Journal command: `store unlink`.

### store prune

```text
packman store prune [path] [--trash] [-y] [--lang <language>]
```

Delete store folders under `.packman/store/` that no link record points to. With `--trash`, also
delete every timestamped folder under `.packman/trash/`, except folders that still hold a legacy
`movedTo` path of a link record. Lists the targets and asks `Remove N items?` unless `-y`. Journal
command: `store prune`.

---

## SharePoint

`packman sharepoint` (alias `packman sp`). Workflow and safety: [SharePoint testing](sharepoint-testing.md).

### sp requirements

```text
packman sp requirements [options] [path]
```

Lists, columns, files, Microsoft Graph resources and search usage the components need. Common
options, plus:

| Option           | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| `--json`         | Print as JSON.                                              |
| `--write`        | Add what is missing to `packman.sharepoint.json`.           |
| `--no-from-test` | Ignore the requests recorded by the last `sharepoint test`. |

`--json`: `{ lists: [{ title, fields, booleans, dates, writes, usedBy }], files: [{ path, usedBy }],
graph: [{ resource, usedBy }], search: string[] }`. `--write` writes the file directly (no backup,
no confirmation).

### sp seed

```text
packman sp seed [options] [path]
```

Create the lists, columns, items and files of `packman.sharepoint.json` (dry run unless `--apply`).
Common options are accepted; project selection does not apply. Plus:

| Option         | Meaning                                         |
| -------------- | ----------------------------------------------- |
| `--site <url>` | Dev site URL (default: `site` in the fixtures). |
| `--apply`      | Write to the site.                              |
| `-y, --yes`    | Do not ask for confirmation.                    |
| `--port <n>`   | Browser debugging port (default 9333).          |

Always signs in first (the dry run reads the site). Exit code 1 when an action failed. Writes
`.packman/sharepoint/seeded.json`. Journal command: `sharepoint seed`.

### sp clean

```text
packman sp clean [options] [path]
```

Remove what seed recorded for the site. Options: `--site <url>`, `-y, --yes`, `--port <n>`, plus the
common options. Asks `Delete what packman created on <site>?` before signing in. Exit code 1 when a
deletion failed (the record is then kept). Journal command: `sharepoint clean`.

### sp test

```text
packman sp test [options] [path]
```

Load every SPFx component from its dev server into a SharePoint dev site. Common options, plus:

| Option         | Meaning                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `--site <url>` | Dev site URL (default: `site` in the fixtures).                        |
| `--page <url>` | Modern page for application customizers (default: the site home page). |
| `--port <n>`   | Browser debugging port (default 9333).                                 |
| `--json`       | Print the results as JSON.                                             |
| `--properties` | Also drive every property pane control of each web part.               |

Writes `.packman/validation/<ISO time>-sharepoint/` (`summary.json`, screenshots, dev server logs).
Exit code 1 when a component or project failed, or when `--properties` could not open the property
pane of a rendered web part. `--json` prints the array written to `summary.json`. Journal command:
`sharepoint test`.

---

## hooks

```text
packman hooks install [path] [--lang <language>]
packman hooks uninstall [path] [--lang <language>]
```

`install` writes `post-merge` and `post-checkout` hooks into the git hooks folder of the repository
holding `path` (`git rev-parse --git-path hooks`, so `core.hooksPath` is respected). A hook file
that exists and does not contain packman's marker line is left as is
(`left as is, not written by packman`); packman's own hooks are rewritten. Journal command:
`hooks install`. `uninstall` deletes only hook files that contain the marker. Details:
[Shared store](shared-store.md#git-hooks).

## tui

```text
packman tui [options] [path]
```

Interactive terminal UI with common options. Keys and behaviour: [Getting started](getting-started.md#interactive-tui).

## init

```text
packman init [options] [path]
```

Create `packman.config.json` in the workspace root. Common options, plus:

| Option          | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `--with-groups` | Pre-fill `policy.groups` from the detected version groups. |
| `--force`       | Overwrite an existing `packman.config.json`.               |

Exit code 1 when the file exists and `--force` is not given. No confirmation; with `--force` the old
file is backed up in `.packman/backups/`.

## log

```text
packman log [path] [-n <n>] [--prune <days>] [--json] [--lang <language>]
```

Operations recorded in `.packman/journal.jsonl`.

| Option            | Default | Meaning                                              |
| ----------------- | ------- | ---------------------------------------------------- |
| `-n, --limit <n>` | `30`    | Entries to show (the newest).                        |
| `--prune <days>`  |         | Delete entries older than this many days, then exit. |
| `--json`          |         | Machine-readable output.                             |

Each entry is `{ at, command, projects, files?, result: "ok"|"failed"|"aborted", detail? }`. The
journal never blocks an operation: a failed journal write is ignored.
