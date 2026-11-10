# SharePoint test data and debug runs

`packman sharepoint` (alias `packman sp`) prepares test data on a SharePoint **dev** site and loads
every SPFx component from its local dev server into that site, then sorts what the page reports.
Sources: `src/cli/sharepoint.ts`, `src/sharepoint/*`. Command options:
[Commands](commands.md#sharepoint). File format: [packman.sharepoint.json](configuration.md#packmansharepointjson).

> Use a dev site only. Components read **and write** their lists while they run, and `seed`/`clean`
> create and delete lists, columns, items, files and folders.

## Workflow

```bash
packman sp requirements                 # 1. what the components need
packman sp requirements --write         # 2. add it to packman.sharepoint.json
#                                         3. edit types, choices, items and file contents by hand
packman sp seed --site <url>            # 4. dry run: what would be created
packman sp seed --site <url> --apply    #    create it
packman sp test --site <url>            # 5. load every component
packman sp requirements --write         # 6. add columns found in the recorded requests, seed again
packman sp test --site <url> --properties  # 7. drive the property panes
packman sp clean --site <url>           # 8. remove what seed created
```

`--site` can be omitted when `site` is set in `packman.sharepoint.json`; without either, commands
stop with `No SharePoint site: pass --site or set "site" in packman.sharepoint.json.`

## 1. requirements

`scanRequirements` (`src/sharepoint/requirements.ts`) reads `.ts`, `.tsx`, `.js`, `.jsx` files under
each selected project's `src/` (not `.d.ts`, not `node_modules` or dot folders). It finds:

- **lists**: every `getByTitle('<title>')`; columns from `.select(...)`, `.orderBy(...)` (string
  literals and spread constant arrays in the same file), the left side of comparisons in
  `.filter('...')`, keys of `.add({...})`/`.update({...})`, and `$select`/`$filter`/`$orderby` in URLs
  within the statement that follows the access (up to `;`, the next list access, or 900
  characters). Built-in columns (`Id`, `Title`, `Created`, `Author`, `FileLeafRef`, ...) are dropped.
  A list is marked `writes` when the statement adds, updates, deletes, recycles or posts. Pages
  libraries (`Site Pages`, `Pagine del sito`, `SitePages`, `Websiteseiten`) are ignored.
- **type hints**: a column compared with `1`, `0`, `true` or `false` is a probable Yes/No; a column
  whose name contains `data`, `date`, `fine` or `inizio` compared with a date is a probable Date.
- **files**: `SiteAssets/...` paths ending in `.json`, `.css`, `.svg`, `.png`, `.jpg`, `.jpeg`,
  `.txt`, `.html`.
- **Graph**: `.api('/me')`, `.api('/users/{id}/...')` and PnPjs `graph.me`, `graph.users.getById(x).photo`,
  `graph.groups.getById(x).members` and similar, reported as resources such as `users/{id}/photo`.
- **search**: projects that call `_api/search/`, `SearchQueryBuilder` or `sp.search(`.

Unless `--no-from-test` is given, the newest `.packman/validation/*-sharepoint/summary.json` is read
too: the REST requests recorded during `sp test` carry the real `$select`, `$filter` and `$orderby`,
including columns the code builds at run time. Requests other than `GET` mark the list as written.

`--write` merges the result into `packman.sharepoint.json` (`mergeRequirements`):

- new lists are added as `generic`, new columns as `Boolean` (Yes/No hint), `DateTime` (date hint)
  or `Text`;
- existing lists, columns (matched case-insensitively), items and file contents are never changed;
  only `usedBy` and `writes` are refreshed;
- new files are added with `path` and `usedBy` only.

The file is written directly, without backup or confirmation, as formatted JSON (comments in a
hand-edited file are not kept).

## 2-3. Fixtures

Complete by hand: column `type`, `choices`, `list` for lookups, `items`, and `content`, `from` or
`placeholder` for files. Value conventions (`"@me"`, `"@aad"`, `{ "lookup": "<Title>" }`, relative
dates, library `file`/`placeholder`/`content`) are described in
[Configuration](configuration.md#item-values).

## 4. seed

`seed` (`src/sharepoint/seed.ts`) first signs in (also for the dry run, which reads the site), then:

1. Orders lists so that lookup targets come first.
2. **Lists**: an existing visible list with the same title (case-insensitive) is left as is.
   Otherwise the list is created with its template and the description `packman test data`.
3. **Columns**: a column whose internal name or title already exists is left as is; otherwise it is
   created from CAML. A `Lookup` column needs its target list on the site (or created earlier in the
   same run).
4. **Items**: an item whose Title (lists) or file name (libraries) already exists is left as is.
   List items are posted; library items are uploaded (text `content`, or a generated PNG) and then
   their other columns are set.
5. **Files**: content is the string, the formatted JSON, the `from` file, or a generated PNG. A file
   that exists is never replaced unless packman created it earlier and its text changed. Missing
   folders are created outermost first.
6. **Content types** (`contentTypes`, `src/sharepoint/pages.ts`): a content type whose name already
   exists in the web is reused; otherwise it is created under its `parent` (default: Site Page) in
   the group `packman test data`. It is added to its `list` (default `Site Pages`; content types are
   enabled on the list first) and its columns are added to that list when missing. SharePoint can
   answer `500` to `AddAvailableContentType` for a content type made a moment ago; packman retries
   after 2, 5 and 10 seconds (`retrying`, also on `503`) before it reports `failed`. The dry run
   lists a content type missing from its library as `planned ... add to library`.
7. **Pages** (`pages`): a page whose file name already exists in its library is left as is.
   Otherwise packman creates the modern page file, checks it out to the signed-in user (unless it
   is checked out already: a new page answers `423 Locked` to changes otherwise), sets its title,
   content type and column values (same value conventions as list items). A plain item update
   answers `204` but leaves `PromotedState` and `Description` of a page unchanged, so these two go
   through `ValidateUpdateListItem` while the page is checked out: `news: true` sets
   `PromotedState` to 2 (a news post), and a `Description` field sets the page description. Then
   the page is checked in as a major version. A `423` on the column change is retried after 2, 5
   and 10 seconds. A page that fails half way is deleted, so a rerun tries again.
   Content types are seeded before pages.
8. **Subsites** (`webs`): after the site itself, each subsite is created when it does not answer
   (`webinfos/add` with its `title`, `language`, `template`, inherited permissions), then its own
   `lists`, `files`, `contentTypes` and `pages` are seeded the same way. Targets are printed with
   the `<url>/` prefix.

Without `--apply` every change is reported as `planned` and the command ends with
`Dry run: nothing written. Use --apply to create it.` (or `The site already has everything in the
fixtures.`). With `--apply` it asks `Create N lists, columns, items and files on <site>?` unless `-y`.

What seed creates is recorded per site in `.packman/sharepoint/seeded.json`: lists it created,
columns it added to lists it did not create, item ids, files, folders, content types, pages, and
per subsite whether packman created it plus that subsite's own record. Outcomes are printed as
`created`, `exists` (hidden), `planned`, `skipped` or `failed`; any `failed` sets exit code 1.

## 5. test

For every selected SPFx project (`src/cli/sharepoint.ts`, `src/sharepoint/debug.ts`):

1. **Skips** projects that have neither `node_modules/gulp/bin/gulp.js` nor
   `node_modules/@rushstack/heft/bin/heft` (`neither gulp nor heft is installed in the project`),
   and projects without a compatible installed Node.
2. Reads the port from `config/serve.json` (default `4321`). If something already answers on
   `https://localhost:<port>/temp/build/manifests.js`, the project fails with
   `port <port> is already in use; stop the other dev server first`.
3. Starts the dev server with the project's Node (`devServerCommand`): `gulp serve --nobrowser` for
   gulp projects (SPFx up to 1.21 and gulp-based 1.22), `heft start --nobrowser` for Heft projects
   (SPFx 1.22+). With both installed, the `start` or `serve` script of `package.json` decides
   (`heft` in it selects Heft), gulp otherwise. Output goes to `<project>-serve.log`. It waits up to
   300 seconds for `temp/build/manifests.js` or `temp/manifests.js`; the manifests list the web
   parts and extensions. Messages name the tool (`heft start exited, see <log>`).
4. For each **web part** without a `page` in its fixture: opens `about:blank`, clears the workbench
   state kept in `sessionStorage`, opens `<site>/_layouts/15/workbench.aspx?debug=true&noredir=true&debugManifestsFile=<manifests>`
   plus the component's `query`, clicks "Load debug scripts" (English, Italian or Ukrainian label),
   opens the toolbox and adds the web part by its id. It counts as rendered when it could be added;
   then it waits 12 seconds and takes the text of the canvas. With `properties` in the fixture, the
   browser's copy of `manifests.js` gets them laid over the web part's preconfigured properties
   (`patchManifests` in `src/sharepoint/host.ts`), so the toolbox adds the web part with them: a
   dropdown key such as `videoType`, or the `items` a collection editor would fill.
5. For each **web part with a `page`** (`components.<alias>.page`, site-relative): opens
   `<site>/<page>?debug=true&noredir=true&debugManifestsFile=<manifests>` plus `query`. The page's
   HTML is changed as the browser receives it (`hostOnPage`): the canvas embedded in
   `spClientSidePageContext` gets the web part, with the manifest's preconfigured properties and the
   fixture's `properties`, in a new one-column section above the others (or merged into an instance
   the page already has). Service workers are bypassed so the page comes from the network. The web
   part then runs with the page's real context (list item, list, canvas DOM). It counts as rendered
   when the page was changed and a script from the dev server loaded with status 200; the text is
   that of the web part's element. `--properties` is not run on pages (the property pane needs edit
   mode, which saves a draft).
6. For each **extension**: opens the extension page (`--page`, or the site's welcome page) with
   `debugManifestsFile`, `loadSPFX=true` and a `customActions` entry at
   `ClientSideExtension.ApplicationCustomizer`, clicks "Load debug scripts" and waits 15 seconds. It
   counts as rendered when a JavaScript file from the dev server loaded with status 200.
7. Takes a screenshot `<project>-<alias>.png`, stops the dev server (`taskkill /T /F` on Windows,
   `SIGTERM` elsewhere) after the project's components.

Nothing is saved on the site by packman during `test`: fixture `properties` and `page` change only
the browser's copy of the manifests and the page (DevTools `Fetch` interception). The components
themselves may read and write their lists.

### Issue classes

`classify` sorts the page's exceptions, console errors and responses:

| Class     | Meaning                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load`    | A response with status >= 400 from the dev server, or chunk/loader errors (`ChunkLoadError`, `Loading chunk`, `Failed to load component`, `Could not load`, `SPLoaderError`, `Cannot find module`). |
| `runtime` | An exception or console error that mentions the dev server origin and is not a "missing" message.                                                                                                   |
| `data`    | A 404 from `/_api/` or `/SiteAssets/`, any error status from `graph.microsoft.com`, or a "does not exist / File Not Found / 404" message about a list, `_api`, `SiteAssets` or HTTP.                |
| `host`    | Everything else the workbench logs, including PnP controls telemetry (`PnPTelemetry`).                                                                                                              |
| `known`   | Any issue whose text contains one of the component's `known` strings.                                                                                                                               |

Component status: `failed` when not rendered or with a `load` or `runtime` issue, `needs-data` with
a `data` issue, `ok` otherwise. `host` and `known` issues never fail a run. The text output hides
`host` issues.

### Outputs

`.packman/validation/<ISO time>-sharepoint/`:

- `summary.json`: one entry per component (`project`, `component` `{ id, alias, type }`, `bundles`,
  `rendered`, `page` (when hosted on a page), `status`, `issues` `[{ kind, text }]`, `requests` `[{ method, url }]` of SharePoint REST,
  Graph and SiteAssets calls, `screenshot`, `text`, `properties`), or per skipped/failed project
  `{ project, status: "skipped"|"failed", reason }`;
- `<project>-<alias>.png` and, with `--properties`, `<project>-<alias>-property-<n>.png` for steps
  that broke the web part;
- `<project>-serve.log`: dev server output.

`requirements` reads the newest `summary.json` of this folder.

## 6-7. test --properties

After a web part renders, `exploreProperties` (`src/sharepoint/properties.ts`) opens its property
pane (selecting the web part and its edit button, up to 5 attempts), expands collapsed groups and
drives every control:

- **dropdowns**: every option except the current one; lists with more than 8 options are sampled
  (first, second, middle, last);
- **toggles and checkboxes**: the other state;
- **choice groups**: every unselected choice, then the original one again;
- **text fields**: a typed value chosen from the label: `https://example.com/packman-test` for URL,
  link, site or path labels, `test@example.invalid` for mail, `3` for numeric values or number/count
  labels, otherwise `packman test`. Fields whose value starts with `[` or `{`, or whose label mentions
  JSON, are left alone.

After each change it clicks Apply (when present), waits 2.5 seconds and records the new issues,
whether SharePoint replaced the web part with its error message (`crashed`), the start of the web
part's text, and the controls the change revealed (new controls, or dropdowns whose options changed,
such as the fields of a selected template). Revealed controls are explored too: the code descends
while the depth is below 2 (`depth < 2` in `step`), so controls revealed by a revealed control are
driven as well. Every change is restored afterwards (an empty dropdown selection cannot be restored;
later changes are then compared with the pane as it is). At most 150 steps run; beyond that the run is
marked `truncated`.

Buttons that are not part of a known control (pickers, collection editors and other custom controls)
are listed as `not driven`. Output per web part:
`properties: N changes on M controls, K broke the web part`, then each breaking change. When the pane
does not open, `properties: the property pane did not open, nothing was checked` and exit code 1.

## 8. clean

`clean` reads `.packman/sharepoint/seeded.json` for the site, prints one line per object it would
remove (subsites, pages, content types, items, columns, lists, files, folders; `recordEntries` in
`src/sharepoint/seed.ts`), or `Nothing to clean.` when the record is empty, asks `Delete what packman created on <site>?` (before signing in), then deletes,
in this order (`clean` in `src/sharepoint/seed.ts`):

1. subsites: a subsite packman created is deleted whole; in a subsite it did not create, its own
   record is cleaned the same way;
2. pages packman created;
3. content types packman created (first their copies on the library, then the site content type);
4. items and columns it added to lists it did not create;
5. whole lists it created;
6. files it created;
7. folders it created, innermost first, only when empty (non-empty folders are `skipped`).

A `404` counts as removed. When every deletion succeeded, the site's record is replaced by an empty
one (`emptyRecord`: lists, columns, items, files, folders, content types, pages and subsites);
otherwise the record is kept, the exit code is 1 and the next `clean` retries what is left. Journal
command: `sharepoint clean`.

## Sign-in model

- packman opens (or reuses) a Chromium browser with a DevTools debugging port (`--port`, default
  `9333`) and its own profile in the per-user packman folder: `%LOCALAPPDATA%\packman\browser` on
  Windows, `~/.cache/packman/browser` elsewhere (`packmanHome()` in `src/core/data.ts`). The sign-in
  survives between runs.
- Browser: `PACKMAN_BROWSER`, otherwise Microsoft Edge, then Google Chrome in their standard install
  paths (on Linux also `/usr/bin/chromium`). Without one: `No Edge or Chrome found; set PACKMAN_BROWSER`.
- packman waits until the page is on the site's host and `/_api/web` answers 200, printing
  `Sign in to <site> in the browser packman opened; waiting...` once. The CLI waits up to 10 minutes,
  then stops with `Not signed in to <site> within 600 s.`
- packman never handles passwords or tokens: every REST call runs as `fetch` inside the signed-in
  page, with the request digest from `/_api/contextinfo` for writes.

## Limits

- **Dev server**: `test` runs `gulp serve` or `heft start` (see step 3); a project with neither
  installed is skipped.
- **Web parts** load in the hosted workbench unless `components.<alias>.page` names a page: the
  workbench has no page list item and no page canvas. Use `query` for query string parameters a web
  part reads, `page` for components that read the page, `properties` for values a person would set.
- **Page hosting** relies on the page HTML embedding `spClientSidePageContext = JSON.parse('...')`,
  as SharePoint Online serves modern pages today; a page without it is not changed and the web part
  does not load.
- **Extensions** of every type are loaded through a `ClientSideExtension.ApplicationCustomizer`
  custom action on one page; whether field customizers, command sets and other extension types work
  that way is not handled specially by the code.
- **Property pane**: pickers, collection editors and custom property controls are not driven, only
  listed.
- Classification is text based; unknown host messages land in `host` and are hidden from the text
  output (they are in `summary.json`).
- `seed` reads at most 5000 items per list when checking for existing items.
