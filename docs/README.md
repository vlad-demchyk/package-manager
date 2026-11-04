# packman documentation

Documentation for packman 3.0 (`3.0.0-alpha.0`, branch `feat/packman-3`). Every page describes the
behaviour of the code in `src/`; where the code leaves something open, the page says so.

| Page                                        | What it covers                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md)       | Requirements, install, the first `check`, reading the report, `fix`, `tui` and `init`.                             |
| [Commands](commands.md)                     | Every command and subcommand with its options, defaults, files read and written, exit codes and JSON.              |
| [Configuration](configuration.md)           | `packman.config.json` (projects, policy groups, profiles, target, checks, language) and `packman.sharepoint.json`. |
| [Rules](rules.md)                           | Every finding `ruleId`, its severity, what triggers it and the fixes it offers with their risk.                    |
| [Shared store](shared-store.md)             | Exact and union stores, keys, verified sets, tree checks, lock sync, junction layout, drift, hooks.                |
| [SharePoint testing](sharepoint-testing.md) | `packman sp`: requirements, fixtures, seed, test, property pane runs, clean, sign-in and limits.                   |
| [Upgrade](upgrade.md)                       | `packman upgrade`: target selection, SPFx migration edits, ESLint migration, blockers, `--shared --verify`.        |
| [Architecture](architecture.md)             | Module map, analysis pipeline, providers, data files, i18n, reports, TUI, store, tests.                            |
| [Troubleshooting](troubleshooting.md)       | Common messages and situations, what causes them and what to do.                                                   |

The [project README](../README.md) is the short overview; the [changelog](../CHANGELOG.md) records
what changed between releases.
