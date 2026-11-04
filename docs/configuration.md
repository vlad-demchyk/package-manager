# Configuration

Two optional files in the workspace root:

- [`packman.config.json`](#packmanconfigjson): discovery, policy, profiles, targets, checks, language.
- [`packman.sharepoint.json`](#packmansharepointjson): test data for SharePoint dev sites.

## packman.config.json

Schema: `configSchema` in `src/core/config.ts` (zod). Without the file packman uses the defaults
below. The file is read as JSON with comments (`jsonc-parser`). An invalid file stops every
command that opens the workspace with exit code 2 and a message `<file>: <path>: <problem>; ...`.

### Top level

| Key        | Type                             | Default   | Meaning                                                    |
| ---------- | -------------------------------- | --------- | ---------------------------------------------------------- |
| `$schema`  | string                           | none      | Ignored by packman; allowed for editors.                   |
| `language` | `"auto"`, `"en"`, `"it"`, `"uk"` | `"auto"`  | Output language when `--lang` is not given.                |
| `target`   | object                           | `{}`      | Repository targets, see [target](#target).                 |
| `projects` | object                           | see below | Project discovery, see [projects](#projects).              |
| `profiles` | record of profile                | `{}`      | Dependency profiles, see [profiles](#profiles).            |
| `policy`   | object                           | see below | Exact versions and version groups, see [policy](#policy).  |
| `checks`   | object                           | see below | Disabled rules and scan exclusions, see [checks](#checks). |

### projects

| Key             | Type           | Default  | Meaning                                                                                              |
| --------------- | -------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `include`       | string[]       | `["**"]` | Globs on project ids (picomatch, dot files not matched).                                             |
| `exclude`       | string[]       | `[]`     | Globs on project ids to leave out.                                                                   |
| `maxDepth`      | integer 0-12   | `4`      | How many folder levels below the root are searched. `--depth` overrides it.                          |
| `includeRoot`   | boolean        | `false`  | Analyze the root `package.json` too. A repository whose only project is the root is always analyzed. |
| `requiredFiles` | string[]       | `[]`     | Files or folders every project must contain, e.g. `["src", "tsconfig.json"]`.                        |
| `match`         | string (regex) | none     | Regular expression the project id must match.                                                        |

Discovery (`src/core/discovery.ts`): every folder with a `package.json` is a candidate. Folders whose
name starts with `.` are not entered, nor `node_modules`, `.git`, `.packman`, `dist`, `lib`,
`lib-amd`, `lib-commonjs`, `lib-dts`, `lib-esm`, `temp`, `release`, `coverage`, `.next`, `.turbo`,
`.cache`. A project id is the relative folder with `/` separators. `--project` and `--exclude` filter
on top of `include`/`exclude`. An unreadable `package.json` drops the project.

### policy

| Key             | Type           | Default | Meaning                                                                         |
| --------------- | -------------- | ------- | ------------------------------------------------------------------------------- |
| `exactVersions` | boolean        | `true`  | Report `^`/`~` and other ranges (`npm/range-spec`). `false` disables that rule. |
| `groups`        | array of group | `[]`    | Version groups, see below.                                                      |

#### Policy groups

| Key        | Type                    | Default  | Meaning                                                                                        |
| ---------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `name`     | string (non-empty)      | required | Group name.                                                                                    |
| `stack`    | string                  | none     | Only projects whose primary stack is this provider id (`spfx`, `react`, ..., `node` for none). |
| `projects` | string[] (at least one) | required | Globs on project ids.                                                                          |
| `node`     | string (semver range)   | none     | Node version or range the group is built with; must be a valid range.                          |
| `pins`     | record name -> version  | `{}`     | Versions every project of the group must resolve to.                                           |

How groups are used:

- Each project belongs to the **first** configured group whose `projects` globs match its id and
  whose `stack` (when set) equals the project's primary stack. The primary stack is the first
  detected of `spfx`, `angular`, `next`, `electron`, `vue`, `vite`, `react`, `typescript`, `eslint`,
  `vitest`, `jest` (`src/policy/groups.ts`).
- Projects without a configured group are grouped automatically as
  `<stack>@<version> / node <major of the recommended Node>`.
- The group with most projects (ties: by name) is the **baseline**.
- `node` adds a pinned Node requirement (source `policy.groups`) to every member; npm commands then
  use an installed Node that satisfies it. A project pin that contradicts it is reported
  (`node/pin-conflict`).
- `pins` produce `policy/pin-violation` for members that resolve another version.
- Inside every group with two or more projects, a package resolved to several versions produces
  `policy/group-divergence`.

### profiles

A profile is the 3.0 form of the 2.x `dependencies-config.js`. `profiles` maps a name to:

| Key                          | Type                    | Default  | Meaning                                                                                |
| ---------------------------- | ----------------------- | -------- | -------------------------------------------------------------------------------------- |
| `stack`                      | string                  | none     | Only projects whose primary stack is this provider id (`node` when none).              |
| `projects`                   | string[] (at least one) | required | Globs on project ids.                                                                  |
| `dependencies`               | record                  | `{}`     | Version enforced in `dependencies` when the package is declared or imported by source. |
| `devDependencies`            | record                  | `{}`     | Always present in `devDependencies` with this version.                                 |
| `conditionalDevDependencies` | record                  | `{}`     | Version enforced in `devDependencies` when the package is declared or imported.        |
| `deprecated`                 | string[]                | `[]`     | Removed from `dependencies`, `devDependencies` and `optionalDependencies`.             |
| `scripts`                    | record                  | `{}`     | `scripts.<name>` set as given.                                                         |
| `engines`                    | record                  | `{}`     | `engines.<name>` set as given.                                                         |
| `overrides`                  | record                  | `{}`     | `overrides.<name>` set as given (compared as JSON).                                    |
| `tsconfig`                   | object                  | `{}`     | Merged into `tsconfig.json` leaf by leaf (arrays are leaves).                          |

Rules (`src/policy/profiles.ts`):

- Every profile whose `projects` and `stack` match applies; they are merged in declaration order,
  later profiles win, and profiles whose name starts with `packman-` are merged last, so generated
  profiles override hand-written ones. Names starting with `packman-` are reserved for profiles
  written by `packman upgrade`.
- A declared spec matches an exact profile version only when identical; a range in the profile is
  matched when the lowest version of the declared spec satisfies it.
- A package in the wrong section is moved (removed from the other section, set in the right one).
- Differences become `profile/*` findings; `packman profile apply` applies all of them. See
  [Rules](rules.md#profiles).

Example:

```json
{
  "profiles": {
    "spfx121": {
      "stack": "spfx",
      "projects": ["c106-*"],
      "dependencies": { "react": "17.0.1", "@pnp/sp": "4.12.0" },
      "devDependencies": { "@types/webpack-env": "~1.15.2" },
      "conditionalDevDependencies": { "@types/jest": "29.5.14" },
      "deprecated": ["moment"],
      "scripts": { "build": "gulp bundle" },
      "engines": { "node": ">=22.14.0 <23.0.0" },
      "overrides": {},
      "tsconfig": { "compilerOptions": { "skipLibCheck": true } }
    }
  }
}
```

### target

Repository target versions, normally written by `packman upgrade --apply`. Keys: `spfx`, `node`,
`react`, `angular`, `next`, `electron`, `vue`, `vite`, `typescript`, `eslint`, `jest`, `vitest`.
Each value must be an **exact** version (`semver.valid`); ranges are rejected.

- `target.node` adds a pinned Node requirement (source `target`) to every project and produces
  `policy/target-node` when the selected Node differs or another requirement excludes it.
- `target.<stack>` produces `policy/target-stack` for projects whose primary stack is `<stack>` and
  whose detected version differs.

```json
{ "target": { "spfx": "1.21.1", "node": "22.19.0" } }
```

### checks

| Key            | Type     | Default | Meaning                                                                               |
| -------------- | -------- | ------- | ------------------------------------------------------------------------------------- |
| `disabled`     | string[] | `[]`    | Rule ids removed from every report (exact ids, no globs).                             |
| `ignoreUnused` | string[] | `[]`    | Packages never reported as unused (`packman ignore add/remove/list` edits this list). |
| `ignorePaths`  | string[] | `[]`    | Globs relative to each project, excluded from the source scan (e.g. `test/**`).       |

### language

`language` sets the output language when `--lang` is absent. `auto` uses `PACKMAN_LANG`, `LC_ALL`,
`LC_MESSAGES`, `LANG`, then the system locale (`uk*` Ukrainian, `it*` Italian, else English).

### Full example

```json
{
  "language": "auto",
  "target": { "spfx": "1.21.1", "node": "22.19.0" },
  "projects": {
    "include": ["**"],
    "exclude": ["legacy-*"],
    "maxDepth": 4,
    "includeRoot": false,
    "requiredFiles": ["src"],
    "match": "^c106-"
  },
  "profiles": {},
  "policy": {
    "exactVersions": true,
    "groups": [
      {
        "name": "spfx-1.21",
        "stack": "spfx",
        "projects": ["c106-*"],
        "node": "22.19.0",
        "pins": { "react": "17.0.1" }
      }
    ]
  },
  "checks": {
    "disabled": ["npm/range-spec"],
    "ignoreUnused": ["@microsoft/sp-office-ui-fabric-core"],
    "ignorePaths": ["test/**"]
  }
}
```

### Environment variables

| Variable                                                                  | Effect                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `PACKMAN_LANG`                                                            | Language for `auto`.                                                                       |
| `PACKMAN_DATA_DIR`                                                        | Folder for updated data files; empty disables updated data (the test suite sets it empty). |
| `PACKMAN_BROWSER`                                                         | Chromium browser executable for `packman sp`.                                              |
| `PACKMAN_DEBUG`                                                           | Print stack traces of unexpected errors.                                                   |
| `CI`                                                                      | Disables the automatic TUI.                                                                |
| `NVM_HOME`, `NVM_DIR`, `FNM_DIR`, `VOLTA_HOME`, `LOCALAPPDATA`, `APPDATA` | Where installed Node versions are looked for.                                              |

### Files packman writes

| Path                                                                                | Content                                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `.packman/backups/<time>-<random>/`                                                 | Copies of files before edits, with their workspace-relative paths.                                                             |
| `.packman/journal.jsonl`                                                            | One JSON line per operation (`packman log`).                                                                                   |
| `.packman/store/<key>/`                                                             | Shared store installations.                                                                                                    |
| `.packman/links.json`                                                               | Link records of linked projects.                                                                                               |
| `.packman/trash/<time>/<project>/`                                                  | Package copies npm left in linked folders, moved aside on relink.                                                              |
| `.packman/verified/projects/*.json`, `.packman/verified/stores/*.json`              | Verified version sets.                                                                                                         |
| `.packman/sharepoint/seeded.json`                                                   | What `sp seed` created, per site.                                                                                              |
| `.packman/validation/<time>-sharepoint/`                                            | `sp test` results.                                                                                                             |
| Per-user folder (`%LOCALAPPDATA%\packman` on Windows, `~/.cache/packman` elsewhere) | `data/` (updated data), `cache/` (npm advisories and registry documents, 12 h), `browser/` (browser profile for `packman sp`). |

---

## packman.sharepoint.json

Schema: `fixturesSchema` in `src/sharepoint/fixtures.ts`. Read as JSON with comments. Every key is
optional; a missing file means empty fixtures. `packman sp requirements --write` creates and extends
it; types, choices, items and contents are completed by hand. How it is used:
[SharePoint testing](sharepoint-testing.md).

### Top level

| Key            | Type                      | Default | Meaning                                                                                   |
| -------------- | ------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `site`         | URL                       | none    | Dev site the data belongs to; `--site` overrides it. Never a production site.             |
| `lists`        | array of list             | `[]`    | Lists and libraries.                                                                      |
| `files`        | array of file             | `[]`    | Site files such as `SiteAssets/...` configuration.                                        |
| `contentTypes` | array of content type     | `[]`    | Page or list content types, see [content types](#content-types).                          |
| `pages`        | array of page             | `[]`    | Modern pages, see [pages](#pages).                                                        |
| `webs`         | array of subsite          | `[]`    | Subsites with their own lists, files, content types and pages, see [subsites](#subsites). |
| `components`   | record alias -> component | `{}`    | How `sp test` hosts each component, keyed by manifest alias.                              |

`contentTypes`, `pages` and `webs` were added to the schema while this page was written
(uncommitted work in `src/sharepoint/fixtures.ts` and `src/sharepoint/pages.ts`).

### Lists

| Key        | Type                                                 | Default     | Meaning                                                     |
| ---------- | ---------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `title`    | string (non-empty)                                   | required    | List title (matched case-insensitively on the site).        |
| `template` | `"generic"`, `"documents"`, `"events"`, `"pictures"` | `"generic"` | Base template 100, 101, 106, 109.                           |
| `fields`   | array of field                                       | `[]`        | Columns.                                                    |
| `items`    | array of objects                                     | `[]`        | Items to add.                                               |
| `usedBy`   | string[]                                             | `[]`        | Projects that use the list (written by `requirements`).     |
| `writes`   | boolean                                              | `false`     | Whether components write to it (written by `requirements`). |

### Fields

| Key       | Type                                                                                              | Default  | Meaning                                           |
| --------- | ------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `name`    | string matching `^[A-Za-z_]\w*$`                                                                  | required | Internal and display name.                        |
| `type`    | `Text`, `Note`, `Number`, `Boolean`, `DateTime`, `Choice`, `MultiChoice`, `URL`, `User`, `Lookup` | `Text`   | Column type.                                      |
| `choices` | string[]                                                                                          | none     | Choices for `Choice` and `MultiChoice`.           |
| `list`    | string                                                                                            | none     | Target list title for `Lookup` (required for it). |

Columns are created from CAML (`fieldXml`): `Note` has 6 plain-text lines, `DateTime` uses date and
time format, `Choice` is a dropdown, `User` allows people only, `Lookup` shows the target's `Title`.

### Item values

Each item is an object of column name to value (`itemBody` in `src/sharepoint/fixtures.ts`):

| Value                                                       | Where                      | Written as                                                                               |
| ----------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `"@me"`                                                     | `User` column              | `<Name>Id` = the signed-in user's site user id.                                          |
| any other value                                             | `User` column              | `<Name>Id` = the value (a site user id).                                                 |
| `{ "lookup": "<Title>" }`                                   | `Lookup` column            | `<Name>Id` = id of the item with that Title (file name in libraries) in the target list. |
| a number                                                    | `Lookup` column            | `<Name>Id` = the number.                                                                 |
| `"@me"`                                                     | any other column           | The signed-in user's site user id (a number).                                            |
| `"@aad"`                                                    | any column but User/Lookup | The signed-in user's Entra object id (`msOnline-ObjectId` of their profile).             |
| `"today"`, `"now"`, `"today+3d"`, `"now-2h"`, `"today-15m"` | any string value           | ISO date: `today` is midnight UTC, `now` the current time; units `d`, `h`, `m`.          |
| other JSON values                                           | any column                 | As given.                                                                                |

The identity of an item is its `Title` in lists and its `file` in `documents` and `pictures`
libraries; an item without it fails. Library items take:

- `file`: the file name (required);
- `content`: text content, or
- `placeholder`: a color such as `"#3a7bd5"` for a generated 320x200 single-color PNG;
- without either, a grey (`#808080`) PNG is uploaded.

`file`, `placeholder` and `content` are not sent as column values; the other keys are set on the
uploaded file's item.

### Files

| Key           | Type     | Default  | Meaning                                                               |
| ------------- | -------- | -------- | --------------------------------------------------------------------- |
| `path`        | string   | required | Site-relative path, e.g. `SiteAssets/configIntranet/menuHeader.json`. |
| `content`     | any JSON | none     | A string is written as is; other JSON is written formatted.           |
| `from`        | string   | none     | Workspace-relative file read as text when `content` is absent.        |
| `placeholder` | string   | none     | Color of a generated PNG when there is no content.                    |
| `usedBy`      | string[] | `[]`     | Projects that load the file (written by `requirements`).              |

A file with neither content, `from` nor `placeholder` is skipped (`no content`). Note that commands
read `from` into `content` when loading the fixtures, so `sp requirements --write` saves the inlined
content back into the file (`readFixtures` in `src/cli/sharepoint.ts`).

### Components

Keyed by the component alias from its manifest (for example `EventoWebPart`):

| Key     | Type     | Default | Meaning                                                                                                               |
| ------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `query` | string   | none    | Query string added to the page URL. `{List/Title}` becomes the id of that item (`?` when missing).                    |
| `known` | string[] | `[]`    | Text of problems known not to come from the packages; matching issues are reported as `known` and never fail the run. |
| `note`  | string   | none    | Free text, not used by packman.                                                                                       |

### Example

```json
{
  "site": "https://contoso.sharepoint.com/sites/dev-intranet",
  "lists": [
    {
      "title": "Categorie",
      "fields": [{ "name": "Colore", "type": "Choice", "choices": ["Rosso", "Blu"] }],
      "items": [{ "Title": "Eventi aziendali", "Colore": "Blu" }]
    },
    {
      "title": "Eventi",
      "writes": true,
      "fields": [
        { "name": "DataInizio", "type": "DateTime" },
        { "name": "Pubblicato", "type": "Boolean" },
        { "name": "Referente", "type": "User" },
        { "name": "Categoria", "type": "Lookup", "list": "Categorie" },
        { "name": "OwnerAad", "type": "Text" }
      ],
      "items": [
        {
          "Title": "[test] Evento",
          "DataInizio": "today+3d",
          "Pubblicato": true,
          "Referente": "@me",
          "Categoria": { "lookup": "Eventi aziendali" },
          "OwnerAad": "@aad"
        }
      ]
    },
    {
      "title": "Immagini news",
      "template": "pictures",
      "items": [{ "file": "news-1.png", "placeholder": "#3a7bd5", "Title": "News 1" }]
    }
  ],
  "files": [
    { "path": "SiteAssets/configIntranet/menuHeader.json", "from": "c106-header/sample/menu.json" },
    { "path": "SiteAssets/configIntranet/settings.json", "content": { "showBanner": true } },
    { "path": "SiteAssets/img/logo.png", "placeholder": "#222222" }
  ],
  "components": {
    "EventoWebPart": { "query": "iditem={Eventi/[test] Evento}", "known": ["PnPTelemetry"] }
  }
}
```

Lists that are lookup targets are processed before the lists that point to them, so `Categorie`
above is created and filled first regardless of its position.
