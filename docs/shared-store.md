# Shared store

`packman store` installs dependencies once per group of projects in `.packman/store/<key>/` and links
each project's `node_modules` to that installation with directory junctions (no administrator
rights needed on Windows). Implementation: `src/store/store.ts`; commands: `src/cli/main.ts`;
reference: [Commands](commands.md#store).

```bash
packman store plan --union                       # what can share, or what to align first
packman store link --group u-1a2b --union        # install once and link
packman store verify --script build              # build every linked project
packman store verify --script buildp             # SPFx: a script that runs gulp bundle --ship
packman store status                             # ok / stale / drift per linked project
packman store link --of apps/news --union        # relink a project's current group
packman store unlink [--restore]
packman store prune [--trash]
```

## Two modes

### Exact mode (`store plan`)

Projects share one folder when all of these are identical (`planExact`):

- the **manifest key**: SHA-256 (first 16 hex chars) of the canonical JSON of `dependencies`,
  `devDependencies`, `optionalDependencies` and `overrides`;
- the **lock fingerprint**: hash of the npm lockfile's content hash and every `location@version`
  (requires an npm lockfile v2+ with packages);
- the selected Node version.

The store copies the shared fields of the first member's manifest and its lockfile, runs `npm ci`
and links each member's whole `node_modules` folder to it (`folder` link mode). The group key is a
hash of manifest key, lock fingerprint and Node version.

Projects with identical manifests that differ in lockfile or Node are listed as candidates
(`lockfile-differs`, `node-differs`).

### Union mode (`store plan --union`)

One store per version group (see [policy groups](configuration.md#policy-groups)), with the union of
the members' dependencies (`planUnion`):

- Every shared non-peer package must have the same spec in every member, and `overrides` must be
  identical; otherwise the group is a candidate `versions-differ` with `align first: <packages>`.
- All members must have the same selected Node; otherwise `node-differs`.
- A package declared as a runtime dependency anywhere stays in the store's `dependencies`.
- At least two eligible members are needed.

The store manifest is that union (plus the first member's `overrides`); npm resolves it with
`npm install --no-audit --no-fund`. Each project gets its own `node_modules` folder with one junction
per package it needs (`packages` link mode).

### Exclusions (both modes)

- The root project (`.`).
- Projects with project-relative specs (`file:`, `link:`, `workspace:`, `portal:`, `./`, `../`):
  moving their manifest into the store would change what those paths resolve to.
- Projects whose scripts mention `husky`, `patch-package` or `postinstall-postinstall`: their install
  scripts write into the project directory and would target the store instead.
- Exact mode only: projects without an npm lockfile v2+ and projects without a compatible Node.

`store plan --json` lists them under `excluded` with the reason.

## Store keys

Union keys are `u-` plus a hash of `{ store: UNION_STORE_VERSION, manifest, overrides, node,
locks: [[projectId, lockFingerprint], ...] }`. Keys therefore change when a manifest, a member's
lockfile or the Node version changes. `UNION_STORE_VERSION` is `3`: npm resolves the store tree
fresh from the group manifest and the tree is checked edge by edge. Versions 1-2 pieced members'
lockfiles together path by path, which could mix a parent from one lockfile with nested packages of
another; a store built that way gets a different key and is rebuilt instead of reused.

When every member already has a link record with the same key, the current store version (union),
the same Node version, manifest key and lock fingerprint, `store plan` reports the existing key, so
re-linking reuses the existing store.

`store link --group <key>` accepts a prefix of the key. Because keys change with manifests and
locks, `store link --of <project>` finds the group the project belongs to now.

## Building a store

`linkGroup` in this order:

1. Refuses when the group has no installed Node, or (exact mode) when the source lockfile is missing.
2. Refuses when a member has a **real** `node_modules` folder and `--replace-existing` was not
   given: `real node_modules folders found (...); re-run with --replace-existing ...`. Nothing is
   installed or changed.
3. Reuses `.packman/store/<key>/` when its `.packman-ready.json` names the same key and Node and its
   `node_modules` exists. A store that is linked but not completed is refused (`unlink its projects
before rebuilding`).
4. Otherwise removes whatever an interrupted install left in the store's `node_modules` (npm fails
   with `ENOTEMPTY` on its own half-written tree), writes `package.json` (and the lockfile: exact
   mode the source lockfile; union mode the verified store lockfile when there is one, otherwise
   none) and runs the install with the group's Node. A nonzero exit, a missing `node_modules` or a missing `package-lock.json` stops with
   `...; nothing was linked`.
5. Checks every dependency edge of the installed tree ([tree check](#tree-check)). A broken edge
   stops with `store <key> has dependencies outside their ranges; nothing was linked` and up to 20
   offending edges. Unmet peers are saved in `.packman-check.json` and reported on every link.
6. Seeded stores: lists versions npm moved away from the verified set.
7. Writes `.packman-ready.json`.
8. Union mode: lists top-level packages whose major differs from a member's previous lockfile
   (`name: old (members) -> new`).
9. Union mode with lock sync (default): rewrites members' lockfiles ([lock sync](#lock-sync)).
10. Links every member ([layout](#junction-layout)).

## Verified sets

Source: `src/core/verified.ts`, `recordVerifiedBuilds` in `src/cli/shared.ts`.

- After `store verify` or `upgrade --verify`, every project whose script passed and that has an npm
  lockfile gets `.packman/verified/projects/<id with / as __>.json`:
  `{ at, node, script, versions: { "<lockfile location>": "<version>" } }`.
- Every store whose linked members **all** passed keeps its whole lockfile in
  `.packman/verified/stores/<hash of sorted member ids>.json`: `{ at, node, projectIds, lock }`.
- `store link --union` (without `--refresh`) looks up the store set for exactly the group's member
  ids and writes it as the store's `package-lock.json` (the **seedLock**) before `npm install`, so npm
  keeps those versions and changes only what the manifests changed. It prints
  `Resolving from the verified set of <date> (Node <version>); --refresh resolves fresh.`
- Versions that moved away from a verified set are listed after `store link`, `relock` and
  `install --clean`, and reported by `check` as `npm/unverified-versions`.
- `npm/range-spec` pins ranges to the verified version when it satisfies the spec.

## Tree check

`treeViolations` in `src/core/tree.ts` checks every entry of an npm v2/v3 lockfile the way Node
resolves modules: from the package's own `node_modules` upwards to the root.

- `broken`: a regular dependency resolves outside its range, or is missing (except for dependencies
  of optional packages). Specs that are not semver ranges (`npm:`, git, file, URL) are skipped.
- `peers`: a non-optional peer range is not met; missing peers are left to npm.

The store refuses a tree with broken edges. The same check produces `npm/tree-broken` and
`npm/tree-peer` in `check` for project lockfiles.

## Lock sync

With `--union` and without `--no-sync-locks` (and always in `upgrade --shared`), after the tree
check:

1. `package.json` and lockfiles of every member are backed up in `.packman/backups/`.
2. Each member's `package-lock.json` (or the existing npm lockfile path) is rewritten as
   `lockfileVersion: 3` containing the project's own root entry (dependencies, engines) and exactly
   the store entries reachable from its non-peer dependencies.
3. The subset is hoisted the way a standalone `npm ci` would lay it out (`hoistLockTree`). In the
   store a package is nested because the top-level slot holds another member's version; alone, the
   project would get it at the top, and tools that load packages the project never declared
   (`.eslintrc.js` with `@rushstack/eslint-config/patch/...`) rely on that. Each nested package whose
   top-level slot is free moves to the top, shallowest copy first, with its own nested packages; a
   dependency it found next to it and would no longer reach is copied under it. A move is kept only
   when every package still resolves each dependency to the same copy. Peer dependencies resolve
   from the parent level up (`resolveEdge`), as npm does, and are never nested under the package that
   declares them.

The members' lockfiles then lock the versions they actually run with, laid out so that a later
standalone `npm ci` reproduces them. Only a tree that passed the edge check is ever written back. A
yarn or pnpm project gets a new `package-lock.json` next to its own lockfile.

## Junction layout

### folder mode (exact)

`<project>/node_modules` is one junction to `.packman/store/<key>/node_modules`.

### packages mode (union)

`<project>/node_modules` is a real folder containing:

- `.packman-store`: marker with the store path and the linked package names;
- one junction per package of the transitive closure of the project's **roots**, by package name,
  over the store tree (`storeClosure`). Roots are the declared non-peer dependencies, packages the
  stack needs implicitly (SPFx scaffold packages, build tools), packages imported by code and styles,
  and packages referenced by config files;
- a junction `.bin` to the store's `.bin`.

Tools that resolve from the project directory (SPFx Sass `~pkg`, ESLint parsers and plugins) find
what a standalone install would give them, and a project does not see packages only other projects
use. Node, webpack and TypeScript follow junctions to their real paths in the store, where nested
dependencies resolve.

### Replacing existing folders

For each member, packman:

1. backs up `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock` and
   `pnpm-lock.yaml` (reusing the previous backup when manifest key, lock fingerprint and Node are
   unchanged);
2. removes the old state: an old junction is unlinked (a `folder` link already pointing to the same
   store is kept and reported `already linked`); a packages-mode folder has its real entries moved to
   trash and its junctions removed; a real folder (only with `--replace-existing`) is deleted
   recursively after checking that the path is exactly `<root>/<project>/node_modules` and is not a
   link;
3. writes the link record to `.packman/links.json` **before** creating junctions, so a member linked
   before a later failure stays tracked;
4. creates the junctions.

Installed modules are never backed up: `unlink --restore` restores manifests and lockfiles only, and
`packman install` recreates local modules.

## Link records

`.packman/links.json` is an array of records (`LinkRecord`):

| Field          | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `projectId`    | Project id.                                                      |
| `key`          | Store key.                                                       |
| `target`       | Absolute path of the store's `node_modules`.                     |
| `createdAt`    | ISO time.                                                        |
| `manifestKey`  | Manifest key when linked; a different current key means `stale`. |
| `lockKey`      | Lock fingerprint after linking (after lock sync when enabled).   |
| `nodeVersion`  | Node the store was built with.                                   |
| `storeVersion` | `UNION_STORE_VERSION` for union stores.                          |
| `mode`         | `folder` or `packages`.                                          |
| `packages`     | Packages linked in `packages` mode.                              |
| `roots`        | Roots that exist in the store.                                   |
| `backupDir`    | Backup of the project's manifest and lockfiles.                  |
| `movedTo`      | Legacy records only: where older releases moved `node_modules`.  |

## Link drift and relinking

`linkDrift` compares a linked project's `node_modules` with its record:

- folder mode: `node_modules` missing, or not a link into the store;
- packages mode: a recorded package missing (`missing`), not a junction into the store (`replaced`),
  or an entry packman did not link (`extra`; the marker, `.bin` and `.package-lock.json` are ignored).

`store status` prints `ok`, `stale` or `drift`; `check` reports `store/link-stale` (warning) and
`store/link-drift` (error) with the relink command.

### npm inside linked projects

npm never touches the store from a linked project (junctions are not followed for writes), but it
changes the project: `npm install` and `npm update` replace links with real copies, `npm install <pkg>`
adds folders the group does not have, `npm uninstall` removes links, and `npm ci` replaces the whole
folder. `packman install` never runs npm in a linked project and prints what to do instead (`up to
date`, or `package.json changed: run packman add/remove, or packman store link --of <project>
--union`; `install --sync-store` does that rebuild); `packman relock` skips linked projects;
`packman upgrade` refuses linked projects unless `--shared` is given.

## Adding a package to a linked project

```bash
packman add @pnp/sp -p apps/news                   # preview: version, source, checks
packman add @pnp/sp -p apps/news --apply -y        # write, rebuild the group store, relink, sync locks
packman add @pnp/sp -p apps/news --apply -y --verify buildp
packman remove @pnp/sp -p apps/news --apply -y
```

`packman add` ([commands](commands.md#add)) is the way to change dependencies of a project in the
store; a bare `npm install <pkg>` in the project would break its links. What happens, in order:

1. **Version**: without a range, the spec the group already declares for that package (verbatim, so
   the union keeps one spec per package); else a group pin, a profile, the SPFx matrix (lockstep
   packages exact, PnP controls library line), what other groups use, the version the project already
   resolves transitively, and last the registry (highest version compatible with the group Node and
   the peers the project resolves). The source is printed next to the choice.
2. **Checks**: engines, peer ranges in both directions, SPFx lockstep, package families and runtime
   singletons (`data/families.json`), and the group: a spec other members declare differently would
   make the group a `versions-differ` candidate, so for a linked project this is an error with three
   options (use the group's spec; `packman align --package <name>` for the whole group, then relink;
   or `packman store unlink -p <project> --restore` and install standalone). Nothing is written when
   a check fails.
3. **Write**: diff, `--apply`, confirmation, backup in `.packman/backups`, journal `add`.
4. **Store**: `planStore --union` on the fresh analysis finds the project's group (its key changed
   with the manifest), `linkGroup` builds `.packman/store/<new key>/` from the group's verified set
   (`--refresh` resolves fresh), checks the tree edge by edge, writes every member's lockfile from the
   store tree (lock sync, usable by a standalone `npm ci`) and relinks all members; copies npm left in
   linked folders go to `.packman/trash`. The old store folder stays until `store prune`.
5. **Verify** (`--verify [script]`): the script runs in every member with the group Node; when all
   pass, the new store lockfile becomes the group's verified set and seeds the next rebuild.

A package the group cannot agree on (incompatible with other members) is the moment to decide:
align the whole group, or move the project to its own group (its own `policy.groups` entry) and link
that group with `store link --of <project> --union`.

### Relinking

```bash
packman store plan --union
packman store link --of <project> --union
```

When the project's folder is still a packages-mode folder (it has the `.packman-store` marker),
relinking first moves every real entry npm left in it to `.packman/trash/<time>/<project>/` (nothing
is deleted) and reports `npm copies moved to .packman/trash before relinking`. After `npm ci` the
marker is gone, the folder is a real `node_modules`, and relinking asks for `--replace-existing`.

## Switching a linked group

`packman sync` and `upgrade` on linked projects move a whole group to the store its edited
manifests need without unlinking it and without npm in the projects (`switchGroup`,
`src/store/switch.ts`):

1. **Snapshot**: every manifest, lockfile and `.nvmrc` of the group, plus every file the pass edits,
   is copied to `.packman/backups/<time>/` before anything is written (files that did not exist are
   remembered and removed again on rollback).
2. **Prepare**: the new store is installed and tree-checked (`linkGroup` with `prepareOnly`). No
   project is touched; the members keep using the old store.
3. **Switch**: every member is relinked to the new store and its lockfile written from the store tree.
4. **Verify**: the build script runs in every member.

When prepare, switch or verify fails, the members get their previous links back (`restoreLinks`:
every previous store is checked to exist first; npm copies found in a linked folder go to
`.packman/trash`) and the snapshot is restored, so the group is in its previous working state. The
old store is never deleted by a switch (only `store prune` deletes unreferenced stores), which is
what makes the rollback free of npm. A member that was not linked before (first `--shared` link)
cannot go back to its deleted folder: the state is kept and reported as failed.

A switch that succeeded is recorded in `.packman/switches.json` (last 10): the members, the store
they moved to, their previous link records, the snapshot and a hash of every snapshot file right
after the switch. `packman store rollback` previews the last one and `--apply` undoes it the same
way (previous links, snapshot files, no npm). It refuses when the previous store is gone, a member
is no longer linked to the switched store, or a snapshot file changed since the switch (a later edit
would be lost). Without it, going back after a kept switch means a new `store link`: the store key
is computed from the current manifests and locks, so the old store is not found again by key.

## Unlink and prune

- `store unlink [-p ...] [-x ...]` unlinks recorded projects: a junction is unlinked; a packages-mode
  folder has its junctions and marker removed and is deleted only when empty (anything real added
  later stays in place). A real folder is never deleted: the project is skipped and keeps its record.
  `--restore` copies the backed-up manifest and lockfiles back.
- `store prune` deletes store folders no record points to. `--trash` also deletes the folders in
  `.packman/trash/`, including package copies moved there by relinking, except folders that still hold
  a legacy `movedTo` path.
- `clean` on a linked project only unlinks it.

## Git hooks

`packman hooks install` adds `post-merge` and `post-checkout` hooks to the repository's hooks folder
(`git rev-parse --git-path hooks`, so `core.hooksPath` is respected). The script is:

```sh
#!/bin/sh
# packman: added by `packman hooks install`
command -v packman >/dev/null 2>&1 || exit 0
cd "$(git rev-parse --show-toplevel)" || exit 0
packman store status --check "<workspace path relative to the repository>" >/dev/null 2>&1 || {
  echo 'packman: linked projects changed, run: packman store status <workspace path>'
}
exit 0
```

The hooks never relink (that may need a network install) and always exit 0, so they never fail the
git command. Existing hooks without the marker line are left alone (add the `store status --check`
call by hand); `packman hooks uninstall` removes only files with the marker.

## Safety guarantees as implemented

- If the store install fails, or the installed tree has a broken edge, nothing is linked and no
  project folder is changed (members are processed only after the store is complete).
- A real `node_modules` is deleted only with `--replace-existing`, only after the store installation
  succeeded, and only at the exact path `<root>/<project id>/node_modules` after re-checking that it
  is not a link.
- Junctions are unlinked, never followed, when removing links.
- Package copies npm left in a linked folder are moved to `.packman/trash`, not deleted (until
  `store prune --trash`).
- Manifests and lockfiles are backed up before linking and before lock sync.
- `store prune` never deletes a store referenced by `.packman/links.json`.
- Switching a linked group to a new store (`sync`, `upgrade` on linked projects) prepares the new
  store before any link changes and restores the previous links and files when a step fails
  ([Switching a linked group](#switching-a-linked-group)).
- A completed store is reused only when its ready marker matches the key and Node; Node versions,
  member lockfiles and the store format all enter the key, so a new installation does not rebuild a
  store other projects use.

## Stack notes

`store plan` adds warnings per group (`stackWarnings`):

- **Vite, exact groups only**: `vite: set cacheDir per project, node_modules/.vite would be shared`.
  In `folder` mode `node_modules` is one junction into the store, so Vite's default `cacheDir`
  (`node_modules/.vite`) would be shared by every member. Union groups keep a real `node_modules`
  folder per project, where `.vite` and `.vite-temp` stay local, so they get no warning.
- **SPFx**: `spfx: run packman store verify (gulp/heft build) on the linked projects`. The SPFx
  scaffold's `build` script does not pass `--ship`, so a production check needs a script that does:
  `packman store verify --script buildp` (or whatever script in your projects runs
  `gulp bundle --ship`).
- **gulpfile webpack rules against `<project>/node_modules`** (`gulpRuleWarnings`): a member's
  `gulpfile.js` with a rule `include:`/`exclude:` set to `path.join(__dirname, 'node_modules', '<pkg>')`
  or `path.resolve(__dirname, 'node_modules/<pkg>')`. Linking makes `node_modules/<pkg>` a junction;
  webpack resolves modules to their real path under `.packman/store/...` (SPFx keeps
  `resolve.symlinks` on), so the rule no longer matches and its loader is not applied. Whether that
  matters depends on the loader: webpack 5 parses ES2020 that older toolchains needed Babel for.
  The warning names the file and line and states the case:
  - not linked yet: `... stops matching once linked`;
  - linked, no passing build since the link: `... is inactive while linked ... Run packman store
verify -p <project>; if webpack reports "Module parse failed" in <pkg>: <edit>`;
  - linked and the project's verified set is newer than its link (a build passed linked):
    `info: ... is inactive while linked ...; \`buildp\` passed linked on <date>, so the loader is not
    needed with this toolchain`.
Every case proposes the same reviewable edit, `include: fs.realpathSync(path.join(__dirname,
    'node_modules', '<pkg>'))`with`const fs = require('fs')`, which matches both layouts; packman never
writes it. Copying from the same path (CopyWebpackPlugin `from`) reads through the junction and is
not reported. A rule over all of `node_modules`is a manual review item. A gulpfile that sets`symlinks: false` gets no warning. Rules in Heft or separate webpack config files are not inspected.
