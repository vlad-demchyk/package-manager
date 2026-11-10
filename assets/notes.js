/* global window */
// Explanations of packman commands and options. Command and flag names come from assets/data.js
// (generated from commander); this file holds only the text, checked against src/cli/**.
// Option key: the long flag (`--rule`). `noop`: options a command accepts but ignores
// (for example, quickReport turns advisories and the usage scan off by itself).
window.PM_NOTES = {
  common: {
    '--project':
      'Only projects with these ids or glob masks (picomatch). A project id is its relative folder with `/`, for example `apps/news-feed`.',
    '--exclude':
      'Skip projects with these ids or masks. Applies on top of `projects.include/exclude` from the configuration.',
    '--depth':
      'How many folder levels to search for `package.json` (overrides `projects.maxDepth`, default 4).',
    '--lang':
      'Output language: `auto` (from `PACKMAN_LANG`, `LANG` or the OS locale), `en`, `it`, `uk`.',
    '--offline': 'No network: npm advisories and registry documents from the cache only (12 h).',
    '--no-security':
      'Do not query npm advisories: faster, but no `security/package-vulnerability` findings.',
    '--no-usage':
      'Do not scan sources: no `npm/undeclared-import`, `npm/unused-*` and no network calls detection.',
    '--json': 'Machine-readable JSON on stdout (for scripts and CI).',
    '--apply': 'Write the changes. Without it the command only shows a diff (dry run).',
    '--yes':
      'Do not ask for confirmation. Without a TTY (CI, pipes) the answer is always "no", so `-y` is required there.',
    '--relock':
      'After writing, regenerate the lockfiles of every changed project (`npm install --package-lock-only` with the project Node).',
    '--no-relock':
      'Leave lockfiles alone. By default packman relocks by itself after version edits in `package.json`.',
  },
  modes: {
    all: {
      label: 'Whole repository',
      hint: 'No `-p`: every discovered project; groups and the baseline are computed over the whole workspace.',
    },
    single: {
      label: 'One project',
      hint: '`-p <id>`: analysis and fixes for one project only, without aligning it with the others. The group is computed from that project alone.',
      sample: 'apps/news-feed',
    },
    group: {
      label: 'Group',
      hint: '`-p` with a glob mask: several projects by id (for example, every project in `apps/`). `policy.groups` are selected the same way, by the masks in their `projects`.',
      sample: 'apps/*',
    },
  },
  commands: {
    check: {
      summary:
        'Analyzes the projects and prints findings. The default command: `packman` without arguments in CI runs `check` too.',
      reads: [
        'package.json, lockfiles (npm, yarn, pnpm), node_modules',
        'sources (imports, network calls), unless `--no-usage`',
        'npm advisories over the network, unless `--no-security`/`--offline`',
        'installed Node versions (nvm-windows, nvm, fnm, Volta)',
      ],
      writes: ['nothing; only a file with `--md`'],
      confirm: 'never',
      exit: '1 when there is a finding at `--fail-on` or worse (default `error`); 2 on a `packman.config.json` error.',
      options: {
        '--md': 'Also write a Markdown report to this file.',
        '--severity':
          'Lowest severity to print: `critical`, `error`, `warning`, `info` (default `info`). Does not change the exit code.',
        '--fail-on':
          'Threshold for exit code 1: `critical` ... `info` or `none` (always 0). Default `error`.',
        '--verbose': 'Print every evidence line, not just the first 4.',
      },
      samples: { '--md': 'report.md' },
      out: [
        { key: 'check-p-error', need: ['@single', '--severity=error'] },
        { key: 'check-p', need: ['@single'] },
        { key: 'check-security', need: ['!--no-security'] },
        { key: 'check', need: [] },
      ],
    },
    fix: {
      summary:
        'Shows or applies fixes for findings. Without `--apply` it is always a dry run with a diff.',
      reads: ['the same as `check`'],
      writes: [
        'with `--apply`: package.json, tsconfig.json, .eslintrc*, .nvmrc and so on',
        'a backup of every file in `.packman/backups/<time>/`',
        'an entry in `.packman/journal.jsonl`',
        'lockfiles through relock after version edits',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when relock fails.',
      options: {
        '--rule': 'Only fixes for findings with these rule ids (see the Rules page).',
        '--fix': 'Only these fix ids (for example, `npm/pin-installed`).',
        '--risk': 'Highest risk to include: `safe` (default), `review`, `breaking`.',
      },
      samples: { '--rule': 'npm/range-spec', '--fix': 'npm/pin-installed' },
      out: [
        { key: 'fix-p-lockstep', need: ['@single', '--risk=review', '--rule'] },
        { key: 'fix-p-rule', need: ['@single', '--rule'] },
        { key: 'fix-review', need: [] },
      ],
    },
    tui: {
      summary:
        'Interactive terminal interface. `packman` without a command in an interactive terminal opens it.',
      reads: ['the same as `check`; the Outdated tab also reads the npm registry'],
      writes: [
        'only after `a` and `y` in the Fixes tab: files with backups, no relock and no journal',
      ],
      confirm: '`a`, then `y`',
      exit: '0',
      out: [],
    },
    init: {
      summary: 'Creates `packman.config.json` at the workspace root.',
      reads: ['the project list; with `--with-groups` also an analysis without advisories'],
      writes: ['packman.config.json (backup of the previous one with `--force`)'],
      confirm: 'no',
      exit: '1 when the file exists and `--force` is not given.',
      options: {
        '--with-groups': 'Fill `policy.groups` with the detected groups (with the group Node).',
        '--force': 'Overwrite an existing packman.config.json.',
      },
      noop: ['--no-security', '--offline'],
      out: [],
    },
    'store plan': {
      summary:
        'Shows which projects can share one node_modules installation. Warns about Vite `cacheDir` (exact groups only: there node_modules is shared by all members), about a gulpfile webpack rule with `include`/`exclude` on `<project>/node_modules` (wrap the path in `fs.realpathSync(...)`), and on `versions-differ` prints the order `check`, `fix --apply`, `align --package`.',
      reads: ['manifests, lockfiles, project Node'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      options: {
        '--union':
          'Union mode: one installation per group with the union of aligned dependencies. Without it (exact) only identical manifest+lock projects are grouped.',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [
        { key: 'store-plan-union', need: ['--union'] },
        { key: 'store-plan', need: [] },
      ],
    },
    'store link': {
      summary:
        'Installs a group once in `.packman/store/<key>` and links its projects to it with junctions.',
      reads: ['the store plan, verified sets in `.packman/verified`'],
      writes: [
        '`.packman/store/<key>/` (npm ci for exact, npm install for union)',
        'a `node_modules` junction in every project, `.packman/links.json`',
        'with union: project lockfiles are synced from the store tree; such a lockfile works for a plain `npm ci` in the project',
        'the journal',
      ],
      confirm: 'yes, unless `-y`',
      exit: '1 without `--group`/`--of` or when the group is not found.',
      options: {
        '--group': 'Group key from `packman store plan` (a prefix is enough).',
        '--of':
          'The group this project belongs to now. Handier than a key: keys change with manifests and lockfiles.',
        '--union': 'A group from `store plan --union` (keys `u-...`).',
        '--replace-existing':
          'Delete local node_modules after a successful store installation. Only manifests and lockfiles are backed up.',
        '--refresh': 'Union: resolve the store fresh instead of from the verified set.',
        '--no-sync-locks': 'Union: do not rewrite project lockfiles from the group tree.',
      },
      samples: { '--group': 'u-3f9c', '--of': 'apps/news-feed' },
      noop: ['--no-security', '--offline'],
      out: [],
    },
    'store unlink': {
      summary: 'Removes the links packman created. Never deletes real folders.',
      reads: ['`.packman/links.json`'],
      writes: [
        'removes junctions, updates links.json, the journal',
        'with `--restore`: puts package.json and lockfiles back from the backup',
      ],
      confirm: 'no (does not ask)',
      exit: '0',
      options: {
        '--restore':
          'Restore the backed-up package.json and lockfiles; then run `packman install` to get local modules back.',
      },
      out: [],
    },
    'store status': {
      summary: 'Linked projects and whether their manifest still matches the store.',
      reads: ['`.packman/links.json`, package.json, the store node_modules'],
      writes: ['nothing'],
      confirm: 'no',
      exit: 'with `--check`: 1 when anything is `stale` or `drift`.',
      options: {
        '--check': 'Exit code 1 on `stale`/`drift` (for git hooks and CI).',
      },
      out: [
        { key: 'store-status-json', need: ['--json'] },
        { key: 'store-status', need: [] },
      ],
    },
    'store verify': {
      summary:
        'Runs an npm script in every linked project with the group Node and records verified version sets.',
      reads: ['linked projects'],
      writes: ['`.packman/verified/` after successful builds', 'the journal'],
      confirm: 'no',
      exit: 'the npm exit code when the script fails; 1 when Node is missing.',
      options: {
        '--script':
          'npm script to run (default `build`). For gulp-based SPFx check the production build with a `--ship` script, for example `buildp`: `gulp bundle --ship && gulp package-solution --ship`.',
      },
      samples: { '--script': 'buildp' },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [],
    },
    'store prune': {
      summary: 'Deletes stores that no project is linked to.',
      reads: ['`.packman/store`, links.json'],
      writes: ['deletes store folders; with `--trash` also `.packman/trash`', 'the journal'],
      confirm: 'yes, unless `-y`',
      exit: '0',
      options: {
        '--trash': 'Also delete node_modules moved to `.packman/trash` on relinking.',
      },
      out: [],
    },
    groups: {
      summary: 'Version groups and the baseline.',
      reads: ['manifests, stacks, Node'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [{ key: 'groups', need: [] }],
    },
    node: {
      summary: 'Installed Node versions: support phase, EOL and known CVEs.',
      reads: ['nvm-windows, nvm, fnm, Volta folders; `node.json`, `node-vulns.json` data'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      out: [{ key: 'node', need: [] }],
    },
    spfx: {
      summary:
        'SPFx compatibility matrix: Node, React, compiler, toolchain (gulp/heft), withdrawn versions.',
      reads: ['`data/spfx.json`'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      out: [{ key: 'spfx', need: [] }],
    },
    compat: {
      summary:
        'Everything packman knows about one package inside one project: the resolved version and its source, the stack ranges (SPFx lockstep, scaffold, PnP controls line, PnPjs major, compiler TypeScript, framework matrix), the peer ranges installed packages place on it, its own engines.node against the project Node, and the documented API breaks ahead of the current version or between it and `--to`, with the file:line places that use the API being left and the migration steps.',
      reads: [
        'manifests, lockfiles, installed versions, sources (API usage)',
        '`data/spfx.json`, `data/frameworks.json`, `data/api-breaks.json`',
      ],
      writes: ['nothing'],
      confirm: 'no',
      exit: '1 when several projects are selected without `-p`.',
      options: {
        '--to':
          'Target version or range: every constraint is judged for the current and the target version, and the breaks between them are listed.',
      },
      samples: { '--to': '4.0.0' },
      noop: ['--no-security'],
      out: [],
      sample: [
        '@pnp/sp in apps/news-feed',
        'current 3.26.0 (lockfile), declared ^3.26.0 in dependencies',
        'Stack ranges',
        '  ^3.0.0  SPFx 1.18.2 recommended PnPjs major  current ok',
        'API breaks ahead',
        '  4.0.0: PnPjs 4 (https://pnp.github.io/pnpjs/transition-guide/)',
      ],
    },
    install: {
      summary:
        '`npm ci`/`npm install` in every project with its own Node. A project linked to the shared store never runs npm (that would replace its junctions): the line says whether it is up to date or stale and which command rebuilds its store.',
      reads: ['lockfiles, project Node, `.packman/links.json`'],
      writes: [
        'project node_modules',
        'with `--clean`: deletes node_modules and lockfiles first',
        'with `--sync-store`: the group store, every member link and their lockfiles',
        'the journal',
      ],
      confirm: 'yes, unless `-y`',
      exit: '1 when a lockfile has drifted from package.json, Node is missing or a stale linked project fits no group; otherwise the npm code.',
      options: {
        '--mode':
          '`normal` (npm ci when there is an npm lock), `legacy-peer-deps` (adds `--legacy-peer-deps`), `force` (npm install --force, even when the lockfile has drifted).',
        '--clean':
          'Delete node_modules and lockfiles, then install (2.x reinstall). Deletes nothing when any project has no Node.',
        '--sync-store':
          'For every group with a linked project whose package.json changed (`store status` says `stale`): rebuild the store from the verified set, relink all members, write their lockfiles. No npm inside the projects.',
        '--refresh':
          'With `--sync-store`: resolve the store fresh instead of from the verified set. Without `--sync-store` a line says it has no effect.',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [],
      sample: [
        'apps/news-feed: npm ci --no-audit --no-fund @ node 22.19.0',
        'tools/vite-a: linked to the store, up to date (use packman add <pkg> -p tools/vite-a to change it)',
        'Run npm in 1 projects? [y/N]',
      ],
    },
    add: {
      summary:
        'Adds packages to a project the way the repository wants them: the version comes from the group (pin, the spec other members declare, a profile, the SPFx matrix, other groups, what the project already resolves, then the registry version compatible with the project Node and peers) and the source is printed. Engines, peer ranges, SPFx lockstep, package families, runtime singletons and the group spec are checked before anything is written; the sources of the selected projects are scanned, so an edit across a documented API break lists the file:line places and the migration steps one per line. A project with its own node_modules then runs `npm install`; a project linked to the shared store never runs npm: its group store is rebuilt, every member relinked and their lockfiles synced.',
      reads: [
        'manifests, lockfiles, installed versions, groups and profiles, `.packman/links.json`',
        'the npm registry for versions and peer metadata (cache with `--offline`)',
      ],
      writes: [
        'with `--apply`: package.json (backup, journal `add`)',
        'standalone project: node_modules and lockfile through `npm install` (journal `add:install`)',
        'linked project: `.packman/store/<new key>/`, every member link, their lockfiles (journal `add:store`), verified sets with `--verify`',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when a check fails (nothing written), when no project matches `-p`, or when a linked project no longer fits a group; otherwise the npm code.',
      options: {
        '--project': 'Required: ids or glob masks of the projects to change.',
        '--cwd': 'Workspace root (the packages are the positional arguments).',
        '--dev': 'Declare under `devDependencies`; moves the package there when it was elsewhere.',
        '--exact':
          'Pin registry picks to the exact version. The default follows `policy.exactVersions` (true); specs copied from the group are kept verbatim either way.',
        '--no-install': 'Only edit package.json: no npm, no store rebuild.',
        '--refresh': 'Linked projects: resolve the store fresh instead of from the verified set.',
        '--verify':
          'Linked projects: after relinking run this npm script (default `build`) in every member and record verified sets. A standalone project prints that it applies to linked projects only.',
      },
      samples: { '--project': 'tools/vite-a', '--verify': 'build' },
      out: [],
      sample: [
        'tools/vite-a: clsx@2.1.1 -> dependencies (registry: npm registry, latest)',
        'tools/vite-a/package.json',
        '+     "clsx": "2.1.1"',
        'Dry run: nothing was written. Re-run with --apply to write the changes.',
      ],
    },
    remove: {
      summary:
        'Removes packages from `dependencies`, `devDependencies` and `optionalDependencies` of a project (`peerDependencies` stay). The sources and config files are scanned first: a package that is still imported, referenced by a config file or called from an npm script is reported as still used (a warning, the write still happens). Then it installs like `add`: `npm install` in a standalone project, store rebuild and relink for a linked one.',
      reads: [
        'manifests, `.packman/links.json`, the sources and config files of the selected projects',
      ],
      writes: [
        'with `--apply`: package.json (backup, journal `remove`)',
        'standalone project: node_modules and lockfile (journal `remove:install`)',
        'linked project: the group store, every member link and lockfile (journal `remove:store`)',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when no project matches `-p` or a linked project no longer fits a group; otherwise the npm code.',
      options: {
        '--project': 'Required: ids or glob masks of the projects to change.',
        '--cwd': 'Workspace root (the packages are the positional arguments).',
        '--no-install': 'Only edit package.json: no npm, no store rebuild.',
        '--refresh': 'Linked projects: resolve the store fresh instead of from the verified set.',
        '--verify':
          'Linked projects: after relinking run this npm script (default `build`) in every member and record verified sets. A standalone project prints that it applies to linked projects only.',
      },
      samples: { '--project': 'tools/vite-a' },
      out: [],
      sample: [
        'tools/vite-a/package.json',
        '-     "clsx": "2.1.1"',
        'Dry run: nothing was written. Re-run with --apply to write the changes.',
      ],
    },
    clean: {
      summary: 'Deletes node_modules and/or lockfiles. Linked projects are only unlinked.',
      reads: ['the project list'],
      writes: ['deletes node_modules / lockfiles', 'the journal'],
      confirm: 'yes, unless `-y`',
      exit: '0',
      options: {
        '--lock': 'Lockfiles only.',
        '--modules': 'node_modules only. Without either flag both are deleted.',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [],
      sample: [
        'apps/news-feed: modules apps\\news-feed\\node_modules',
        'apps/news-feed: lockfile apps\\news-feed\\package-lock.json',
        'Remove 2 items? [y/N]',
      ],
    },
    'profile apply': {
      summary: 'Aligns projects with the dependency profiles in packman.config.json (2.x update).',
      reads: ['profiles, manifests, imports (for conditional dependencies)'],
      writes: [
        'with `--apply`: package.json, tsconfig.json; backups, journal, relock',
        'with `--install`: npm install in the changed projects',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when relock fails.',
      options: { '--install': 'Run npm install in the changed projects after writing.' },
      noop: ['--no-security', '--offline'],
      out: [],
    },
    'profile generate': {
      summary: 'Builds a profile from the selected projects (2.x "genera configurazione").',
      reads: ['manifests, installed versions'],
      writes: ['nothing without `--write`; with it: `profiles.<name>` in packman.config.json'],
      confirm: 'no',
      exit: '0',
      options: {
        '--name': 'Required profile name.',
        '--strategy':
          '`highest` (default) or `common`: which version to take when projects differ.',
        '--declared': 'Take declared specs instead of installed versions.',
        '--tsconfig-from':
          'Put a project tsconfig.json in the profile, or `latest-ts` (the one with the newest TypeScript).',
        '--write': 'Write the profile to packman.config.json.',
      },
      samples: { '--name': 'demo', '--tsconfig-from': 'latest-ts' },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [{ key: 'profile-generate', need: [] }],
    },
    align: {
      summary:
        'Aligns one project with another (`--base`/`--to`) or one package everywhere (`--package`).',
      reads: ['manifests and installed versions'],
      writes: ['with `--apply`: package.json, backups, journal, relock'],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 without `--base`/`--package` or for an unknown project.',
      options: {
        '--base':
          'The project that changes. Without `--to` prints the 15 closest projects by shared versions.',
        '--to': 'The project versions are copied from.',
        '--package': 'Align this package in the selected projects.',
        '--version': 'Version for `--package` (default: the most common, then the highest).',
        '--only': 'With `--base/--to`: only these packages.',
        '--pin': 'Drop `^`, `~` prefixes from copied versions.',
        '--include-missing': 'With `--base/--to`: also add packages the base does not declare.',
      },
      samples: {
        '--base': 'webparts/team-calendar',
        '--to': 'apps/news-feed',
        '--package': 'react',
        '--version': '17.0.1',
        '--only': 'react react-dom',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [
        { key: 'align-base-to', need: ['--base', '--to'] },
        { key: 'align-base', need: ['--base'] },
        { key: 'align-package-pnp', need: ['--package=@pnp/sp'] },
        { key: 'align-package', need: ['--package'] },
      ],
    },
    versions: {
      summary: 'Versions of every package in every project (2.x matrix).',
      reads: ['manifests, lockfiles'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      options: {
        '--diverging': 'Only packages with more than one version.',
        '--package': 'Only these packages (glob masks).',
      },
      samples: { '--package': '"@pnp/*"' },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [{ key: 'versions', need: ['--package'] }],
    },
    outdated: {
      summary: 'Current, wanted and latest versions from the npm registry.',
      reads: ['npm registry (12 h cache; `--offline` cache only)'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      noop: ['--no-security', '--no-usage'],
      out: [{ key: 'outdated', need: [] }],
    },
    audit: {
      summary: 'Known vulnerabilities only: npm packages and Node.',
      reads: ['npm advisories (always), Node CVEs'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '1 on a `critical` or `error` security finding.',
      noop: ['--no-security'],
      out: [{ key: 'audit', need: [] }],
    },
    list: {
      summary:
        'Discovered projects and their state: stack, tsconfig, src, node_modules (`link` for the store), lock, Node.',
      reads: ['folder structure, manifests'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [{ key: 'list', need: [] }],
    },
    'ignore add': {
      summary: 'Add packages that are never reported as unused (`checks.ignoreUnused`).',
      reads: ['packman.config.json'],
      writes: ['packman.config.json (with a backup)'],
      confirm: 'no',
      exit: '0',
      options: {
        '--cwd': 'Workspace root (`ignore` takes the path this way, not as an argument).',
      },
      args: { packages: 'tslib' },
      out: [],
    },
    'ignore remove': {
      summary: 'Remove packages from `checks.ignoreUnused`.',
      reads: ['packman.config.json'],
      writes: ['packman.config.json (with a backup)'],
      confirm: 'no',
      exit: '0',
      options: { '--cwd': 'Workspace root.' },
      args: { packages: 'tslib' },
      out: [],
    },
    'ignore list': {
      summary: 'Show `checks.ignoreUnused`.',
      reads: ['packman.config.json'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      options: { '--cwd': 'Workspace root.' },
      out: [],
    },
    log: {
      summary: 'Operations from the `.packman/journal.jsonl` journal.',
      reads: ['the journal'],
      writes: ['nothing; `--prune` deletes old entries'],
      confirm: 'no',
      exit: '0',
      options: {
        '--limit': 'How many recent entries to show (default 30).',
        '--prune': 'Delete entries older than N days.',
      },
      samples: { '--limit': '5', '--prune': '90' },
      out: [
        { key: 'log-n', need: ['--limit'] },
        { key: 'log', need: [] },
      ],
    },
    'data status': {
      summary: 'Dates of the bundled and updated data files (SPFx matrix, Node schedule, CVEs).',
      reads: ['`data/`, the user data folder'],
      writes: ['nothing'],
      confirm: 'no',
      exit: '0',
      out: [{ key: 'data-status', need: [] }],
    },
    'data update': {
      summary: 'Updates the Node schedule and Node core CVEs from public sources.',
      reads: ['the network'],
      writes: [
        'the user data folder (`%LOCALAPPDATA%\\packman\\data`); bundled files do not change',
      ],
      confirm: 'no',
      exit: '0',
      options: { '--dry-run': 'Show the changes without saving anything.' },
      out: [],
    },
    relock: {
      summary:
        'Regenerates lockfiles with each project Node (`npm install --package-lock-only --ignore-scripts`).',
      reads: ['manifests, project Node'],
      writes: ['lockfiles (no packman backup: the change is visible in git)', 'the journal'],
      confirm: 'no (does not ask)',
      exit: '1 when any relock fails or Node is missing.',
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [],
      sample: ['', '> apps/news-feed: npm install --package-lock-only (node 22.19.0)'],
    },
    upgrade: {
      summary:
        'Migration plan to the newest stack already in the repository; published releases only with an explicit `--to`.',
      reads: ['stacks, profiles, npm registry (unless `--offline`)'],
      writes: [
        'with `--apply`: manifests, tsconfig, .nvmrc, .yo-rc.json, Heft/ESLint configs, repository policy',
        'a backup of manifests and lockfiles, the journal, relock',
        '`--install`, `--verify`, `--shared` run npm',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when there are blockers (also with `--json`).',
      options: {
        '--stack': 'Framework families to migrate: `spfx`, `react`, `vite`, `angular` ...',
        '--to': 'Explicit target version or line (default: the newest existing project).',
        '--node': 'Explicit Node version or range (default: the shared installed Node).',
        '--json': 'Migration plan as JSON, read-only (an error together with `--apply`).',
        '--apply': 'Write the checked migration and the repository policy.',
        '--relock': 'Regenerate the lockfiles of every migrated project.',
        '--install': 'Install the migrated projects.',
        '--shared': 'Install once, delete local modules and link the migrated group to the store.',
        '--no-policy':
          'Migrate the projects only: leave packman.config.json alone (no targets, `packman-<stack>` profiles or groups written).',
        '--verify':
          'Install and run build/test for every migrated project; success records a verified set.',
      },
      samples: { '--stack': 'spfx', '--to': '1.21.1', '--node': '22.19.0' },
      noop: ['--no-security'],
      out: [
        { key: 'upgrade-p-to', need: ['@single', '--to'] },
        { key: 'upgrade', need: [] },
      ],
    },
    'sharepoint requirements': {
      summary: 'Which lists, fields, files and Graph data the SPFx components use.',
      reads: ['SPFx project sources', 'requests from the last `sp test` in `.packman/validation`'],
      writes: ['nothing; `--write` adds what is missing to packman.sharepoint.json'],
      confirm: 'no',
      exit: '0',
      options: {
        '--write':
          'Add what is missing to packman.sharepoint.json (fill in field types, choices and items by hand).',
        '--no-from-test': 'Ignore the requests recorded by the last `sharepoint test`.',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [{ key: 'sp-requirements', need: [] }],
    },
    'sharepoint seed': {
      summary:
        'Creates the lists, fields, items, files, content types, pages and subsites from packman.sharepoint.json on a dev site. Idempotent; a new page is checked out before its columns change, and HTTP 423 (page) or 500/503 (content type to library) is retried after 2, 5 and 10 s.',
      reads: ['packman.sharepoint.json, the site (after you sign in in the browser packman opens)'],
      writes: [
        'with `--apply`: the SharePoint site, `.packman/sharepoint/seeded.json`, the journal',
      ],
      confirm: 'with `--apply`, unless `-y`',
      exit: '1 when any action fails.',
      options: {
        '--site':
          'Dev site URL (default: `site` in the fixtures). Never production: components write to these lists.',
        '--port': 'Browser debugging port (default 9333).',
        '--apply': 'Write to the site. Without it, a plan (the sign-in browser still opens).',
      },
      samples: { '--site': 'https://contoso.sharepoint.com/sites/dev', '--port': '9333' },
      noop: ['--project', '--exclude', '--depth', '--no-security', '--no-usage', '--offline'],
      out: [],
      sample: [
        '  planned  list   Events generic',
        '  planned  field  Events.EventDate DateTime',
        '  planned  item   Events: [test] Kick-off',
        '  planned  contentType News Page -> Site Pages add to library',
        '  planned  page   test-news-1.aspx News Page',
        'Dry run: nothing written. Use --apply to create it.',
      ],
    },
    'sharepoint clean': {
      summary:
        'Deletes from the site exactly what `seed` created (from `.packman/sharepoint/seeded.json`): subsites, pages, content types, items, columns, lists, files and empty folders. Prints the full list first; without a terminal and without `-y` it only prints.',
      reads: ['seeded.json, the site'],
      writes: [
        'the SharePoint site, seeded.json (empty after a run without failures), the journal',
      ],
      confirm: 'yes, unless `-y`',
      exit: '1 when a deletion fails.',
      options: {
        '--site': 'Dev site URL (default: `site` in the fixtures).',
        '--port': 'Browser debugging port (default 9333).',
        '--yes':
          'Delete without asking. Without it and without a terminal, the list is only printed.',
      },
      samples: { '--site': 'https://contoso.sharepoint.com/sites/dev', '--port': '9333' },
      noop: ['--project', '--exclude', '--depth', '--no-security', '--no-usage', '--offline'],
      out: [],
      sample: [
        '  page Site Pages: item 12',
        '  contentType 0x0101009D1CB255DA76424F860D91F20E6C4118009A (and its copy on Site Pages)',
        '  list Events (with its items and columns)',
        '  file SiteAssets/footer/contacts.json',
        'Delete what packman created on https://contoso.sharepoint.com/sites/dev? [y/N]',
      ],
    },
    'sharepoint test': {
      summary:
        'Starts the dev server of every SPFx project with its Node (`heft start` for Heft, `gulp serve` for gulp; with both, the one named in the `start`/`serve` script) and loads each web part in the hosted workbench, or on the fixture `page`, and each extension on a page. Fixture `properties` and `page` change only what the browser receives, never the site. Exceptions from SharePoint bundles are `host` and never fail a component.',
      reads: ['SPFx projects, fixtures, the site'],
      writes: [
        '`.packman/validation/<time>-sharepoint/`: summary.json, server logs, screenshots',
        'the journal',
      ],
      confirm: 'no',
      exit: '1 when a component is `failed` or the property pane did not open.',
      options: {
        '--site': 'Dev site URL (default: `site` in the fixtures).',
        '--page':
          'Modern page for application customizers (default: the site home page). Web parts use `components.<alias>.page` in the fixtures instead.',
        '--port':
          'Browser debugging port (default 9333). A browser that does not answer for 120 s stops the run with BROWSER_STUCK advice.',
        '--properties':
          'Walk every property pane control of every web part and show what breaks it.',
        '--json': 'Results as JSON.',
      },
      samples: {
        '--site': 'https://contoso.sharepoint.com/sites/dev',
        '--page': 'https://contoso.sharepoint.com/sites/dev/SitePages/Home.aspx',
      },
      noop: ['--no-security', '--no-usage', '--offline'],
      out: [],
      sample: [
        '',
        '> apps/footer',
        '  ok         FooterApplicationCustomizer 3 bundles',
        '',
        '> apps/news-feed',
        '  ok         NewsFeedWebPart 4 bundles',
        '  needs-data NewsBannerWebPart 4 bundles, https://contoso.sharepoint.com/sites/dev/SitePages/test-news-1.aspx',
        "    data    404 https://contoso.sharepoint.com/sites/dev/_api/web/lists/getByTitle('News')/items",
        '',
        '.packman\\validation\\2026-11-09T10-00-00-000Z-sharepoint',
      ],
    },
    'hooks install': {
      summary:
        'post-merge and post-checkout git hooks that say linked projects need relinking after a pull or a branch switch.',
      reads: ['git (core.hooksPath)'],
      writes: [
        '.git/hooks/post-merge, post-checkout (does not replace foreign hooks), the journal',
      ],
      confirm: 'no',
      exit: '0',
      out: [],
    },
    'hooks uninstall': {
      summary: 'Removes only the hooks packman added (by marker).',
      reads: ['git'],
      writes: ['deletes the packman hooks'],
      confirm: 'no',
      exit: '0',
      out: [],
    },
  },
};
