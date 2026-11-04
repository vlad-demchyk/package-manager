# Getting started

## Requirements

- **packman itself runs on Node >= 22.12** (`engines` in `package.json`).
- **Your projects keep their own Node.** packman never switches the global Node. Every npm command it
  runs (`install`, `relock`, store installs, builds) starts the `node` binary that fits the project,
  with `npm-cli.js` from that Node's installation, and puts that Node's folder first in `PATH`
  (`src/exec/run.ts`).
- Installed Node versions are found without running any manager (`src/node/toolchain.ts`):
  - nvm-windows: every folder under `%NVM_HOME%`;
  - nvm: `$NVM_DIR/versions/node` (default `~/.nvm`);
  - fnm: `$FNM_DIR`, `%APPDATA%\fnm` on Windows, `~/.local/share/fnm`, `~/.fnm` (`node-versions/*/installation`);
  - Volta: `$VOLTA_HOME` (default `%LOCALAPPDATA%\Volta` on Windows, `~/.volta`), `tools/image/node`;
  - the Node that runs packman (`manager: current`).
- The launcher `bin/packman.cjs` is plain CommonJS, so it starts on any old Node. When the active Node
  is older than 22.12 it looks for the newest installed Node >= 22.12 in nvm-windows, nvm, fnm and
  Volta and re-runs itself with it. If there is none, it exits with code 1 and asks you to install
  one (for example `nvm install 24`).
- npm must be installed next to each Node that packman uses for npm commands; otherwise the run fails
  with `npm not found next to <node>`.

## Install

packman is not published to the npm registry (`"private": true`). Install it from the repository:

```bash
git clone https://github.com/vlad-demchyk/package-manager.git
cd package-manager
npm ci
npm run build
npm link        # exposes `packman` and `pm` globally
```

`packman` and `pm` are the same binary. If `dist/` is missing, the launcher stops with
`packman is not built: run npm run build`.

## First check

```bash
cd path/to/repository
packman check
```

`check` only reads. It discovers projects (every folder with a `package.json`, up to depth 4 by
default), detects their stacks, resolves Node for each one, scans sources for imports, queries npm
advisories for every installed or locked package (one cached request for the workspace) and prints the
findings. Without arguments in an interactive terminal, `packman` opens the TUI instead; in CI or with
redirected output it runs `check` (see [Commands](commands.md#default-command)).

Useful variants:

```bash
packman check --severity warning      # hide info findings
packman check -v                      # every evidence line instead of the first 4
packman check --json > report.json    # machine-readable report
packman check --md report.md          # also write a Markdown report
packman check --offline               # advisories from cache only
packman check --no-security --no-usage  # skip advisories and the source scan (fast)
packman check -p "c106-*" -x legacy-old # select projects by id glob
```

## Reading the report

The text report has four parts (`src/report/text.ts`):

1. **Header**: `packman report - <root>` and a data line with the dates of the SPFx matrix, the Node
   release schedule, the Node CVE list and the npm advisories source. When the Node data is older
   than 30 days the line ends with `(data N days old: packman data update)`.
2. **Version groups**: projects grouped by primary stack version and Node line (or by your
   `policy.groups`); the largest group is marked `[baseline]`.
3. **Workspace findings**: findings that span projects (group divergence, pins, Node fragmentation,
   repository target).
4. **Projects**: one block per project:

   ```text
   x apps/c106-news (spfx@1.18.2, react@17.0.1, typescript@4.7.4)
       Node: installed 18.20.8 (nvm-windows), recommended 18.20.8 | Runs in: browser | Network calls
       x Lockfile out of sync with package.json (2 packages) npm/lockfile-drift
           react: package.json 17.0.1, lockfile ^17.0.1
       ! 3 dependencies use version ranges instead of exact versions npm/range-spec
           ...
           -> Pin ranges to the installed versions [npm/pin-installed, safe]
   ```

   - The status mark is `x` (critical or error findings), `!` (warnings) or `ok`.
   - Severity icons: `!!` critical, `x` error, `!` warning, `i` info.
   - The rule id follows each message; [Rules](rules.md) explains every one.
   - `-> title [fix-id, risk]` lines are the fixes `packman fix` can apply.
   - `Runs in` is the exposure used to weight vulnerabilities: `browser`, `server` or `unknown`
     (see [security rules](rules.md#security)).
   - `Network calls` appears when the project declares a known HTTP/REST package or its source
     matches a network pattern from `data/network.json`.

The last line counts critical, error, warning and info findings. `check` exits with code 1 when there
is a finding of severity `error` or worse; `--fail-on` changes the threshold (`none` never fails).

## Applying fixes

```bash
packman fix                                   # preview the `safe` fixes (dry run)
packman fix --risk review                     # include `review` fixes in the preview
packman fix --rule npm/range-spec --apply     # write the fixes of one rule
packman fix --fix spfx/align-lockstep --risk review --apply -y
```

`fix` prints a diff of every file it would change and writes nothing until `--apply`. With
`--apply` it asks for confirmation (skip it with `-y`; without a terminal the answer is "no"), backs
up every touched file under `.packman/backups/<time>-<random>/`, records the operation in
`.packman/journal.jsonl` and, when the edits changed dependency versions in a `package.json`,
regenerates the lockfiles of the changed npm projects with each project's Node
(`npm install --package-lock-only`). `--no-relock` keeps lockfiles; `--relock` also relocks changed
projects without version edits or without a lockfile. If a file changed between the preview and the
write, nothing is written and the command stops with `file changed since preview`.

Fix risk levels: `safe` (mechanical, no behaviour change expected), `review` (check the diff and
build), `breaking` (crosses a major version). `--risk` is the highest level included.

## Interactive TUI

```bash
packman tui
packman            # same, in an interactive terminal
```

Tabs (keys `1`-`7`, or `tab` / arrows): Overview, Projects, Versions, Outdated, Node, Store, Fixes.

| Key                                  | Action                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `↑` `↓` `j` `k`, PgUp/PgDn, Home/End | move                                                                                                                                                      |
| `enter`                              | open a project (Projects tab)                                                                                                                             |
| `esc`, backspace                     | back                                                                                                                                                      |
| `space`                              | select the fixes of a finding; in Versions, align the package (like `align --package`); in Outdated, raise the package to the newest release of its major |
| `u`                                  | select (or deselect) every profile fix, like `profile apply`                                                                                              |
| `s`                                  | cycle the minimum severity shown                                                                                                                          |
| `a`                                  | in Fixes: apply the selected fixes after a `y` confirmation                                                                                               |
| `r`                                  | reload                                                                                                                                                    |
| `q`, `ctrl+c`                        | quit                                                                                                                                                      |

Applying in the TUI writes the previewed files with backups in `.packman/backups/`, then reloads. It
does not relock lockfiles and does not write a journal entry (`src/tui/run.tsx`); run
`packman relock` afterwards when versions changed. The Outdated tab offers in-major bumps only for
exact, `^` and `~` specs. The Store tab is read-only: linking is a CLI command because it installs
and replaces `node_modules`.

## Creating a configuration

```bash
packman init                 # packman.config.json with the defaults
packman init --with-groups   # also policy.groups from the detected version groups
packman init --force         # overwrite an existing file (a backup is kept)
```

The generated file contains `language`, `projects`, `policy` and `checks` with their defaults. With
`--with-groups`, each detected group becomes a `policy.groups` entry with its project ids, the
installed Node selected for its first project that has one, and empty `pins`. See
[Configuration](configuration.md) for every key.

## Next steps

- [Commands](commands.md) for the full reference.
- [Shared store](shared-store.md) to share one `node_modules` per group.
- [Upgrade](upgrade.md) to converge a repository on one stack version.
- [Troubleshooting](troubleshooting.md) when a command refuses to run.
