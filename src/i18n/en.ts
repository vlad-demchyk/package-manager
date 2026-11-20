export const en = {
  // Report
  'report.title': 'packman report',
  'report.workspace': 'Workspace',
  'report.projects': 'Projects',
  'report.groups': 'Version groups',
  'report.baseline': 'baseline',
  'report.findings': 'Findings',
  'report.workspaceFindings': 'Workspace findings',
  'report.noFindings': 'No findings.',
  'report.node': 'Node',
  'report.nodeSelected': 'installed {version} ({manager})',
  'report.nodeNone': 'no installed version fits',
  'report.nodeRecommended': 'recommended {version}',
  'report.stacks': 'Stacks',
  'report.exposure': 'Runs in',
  'report.network': 'Network calls',
  'report.fixes': 'Fixes',
  'report.summary': '{critical} critical, {error} errors, {warning} warnings, {info} info',
  'report.dataStale': '(data {days} days old: packman data update)',
  'report.data':
    'Data: SPFx matrix {spfx}, Node schedule {node}, Node CVEs {nodeVulns}, npm advisories {advisories}',
  'report.advisoriesSkipped': 'not checked ({reason})',
  'report.installedNodes': 'Installed Node versions',
  'exposure.browser': 'browser',
  'exposure.server': 'server',
  'exposure.build': 'build machine only',
  'exposure.unknown': 'unknown',
  'severity.critical': 'critical',
  'severity.error': 'error',
  'severity.warning': 'warning',
  'severity.info': 'info',

  // npm provider
  'npm.rangeSpec': '{count} dependencies use version ranges instead of exact versions',
  'npm.prereleaseSpec': 'Pre-release, nightly or canary versions in dependencies',
  'npm.unboundedSpec': 'Unbounded versions (*, latest) make installs unpredictable',
  'npm.lockfileMissing': 'No lockfile: installs are not reproducible',
  'npm.lockfileV1': 'Lockfile v1 (npm 5-6): regenerate with npm 7+ for complete metadata',
  'npm.treeBroken':
    '{count} locked packages resolve a dependency outside its range: they load the wrong copy at runtime',
  'npm.treePeer': '{count} peer requirements of nested packages are not met by the locked tree',
  'verified.recorded':
    'Verified sets saved: {projects} projects, {stores} shared stores (.packman/verified).',
  'npm.unverifiedVersions':
    '{count} locked versions differ from the set {script} last passed with ({date}): not verified by a build',
  'npm.lockfileDrift': 'Lockfile out of sync with package.json ({count} packages)',
  'npm.notInstalled': 'Dependencies are not installed',
  'npm.installedDrift': 'Installed packages differ from package.json ({count})',
  'npm.familyMismatch': 'Packages of the "{family}" family are not aligned ({policy})',
  'npm.peerUnsatisfied': '{count} peer dependency requirements are not satisfied',
  'npm.deprecated': '{count} direct dependencies are deprecated',
  'npm.duplicateMajors': '{count} runtime singletons are installed in several versions',
  'npm.duplicateDeclaration': '{count} packages are declared in several sections',
  'npm.undeclaredImport': '{count} packages are imported but not declared in package.json',
  'npm.unusedDependency': '{count} dependencies are declared but never imported',

  // SPFx provider
  'spfx.versionUnknown': 'SPFx detected but its version could not be determined',
  'spfx.yoRcMismatch': '.yo-rc.json says generator {generator}, packages say SPFx {version}',
  'spfx.notInMatrix': 'SPFx {version} is not in the compatibility matrix',
  'spfx.withdrawn': 'SPFx {version} was withdrawn by Microsoft',
  'spfx.prerelease': 'Pre-release SPFx packages must not reach production: {packages}',
  'spfx.lockstepMismatch':
    '{count} SPFx packages are not on SPFx {version} (runtime and build tools must match)',
  'spfx.lockstepRange': '{count} SPFx packages use ranges; SPFx {version} packages must be exact',
  'spfx.toolchainMixed': 'Both gulp and Heft toolchains are configured',
  'spfx.gulpUnsupported': 'SPFx {version} does not support the gulp toolchain',
  'spfx.heftTooEarly': 'Heft toolchain detected on SPFx {version}; Heft is supported from 1.22.0',
  'spfx.compilerMismatch': 'SPFx {version} expects {expected}, found {actual}',
  'spfx.typescriptCompilerMismatch':
    'typescript {typescript} is declared but the compiler builds with TypeScript {compilerTs}',
  'spfx.compilerWithHeft': 'rush-stack-compiler is not used by the Heft toolchain',
  'spfx.typescriptMismatch': 'typescript {actual} does not match the expected {expected}',
  'spfx.reactMismatch': 'SPFx {version} requires React exactly {react}',
  'spfx.typesReactMismatch': '@types/react does not match the React major of SPFx {version}',
  'spfx.libraryNewer':
    '{library} {version} is built for SPFx {target}, newer than the project SPFx {spfx} (use {suggested})',
  'spfx.libraryOlder':
    '{library} {version} is built for SPFx {target}, the project uses SPFx {spfx} (consider {suggested})',
  'spfx.pnpjsMajor':
    'PnPjs v{major} is not the recommended major for SPFx {spfx} (recommended v{recommended})',
  'spfx.upgradeAvailable': 'SPFx {version} can be upgraded (latest verified {latest})',
  'spfx.upgradeAvailableUnverified':
    'SPFx {version} can be upgraded (npm latest {npm}, not yet verified; latest verified {latest})',
  'spfx.unverifiedPatch':
    'SPFx {version} is newer than the verified matrix ({verifiedAt}): constraints of {base} are assumed, not yet verified',

  // Frameworks
  'react.typesMajor': '@types/react {types} does not match react {react}',
  'typescript.v7Api':
    'TypeScript {version} has no programmatic API; these tools still need TypeScript 6',
  'eslint.unknownRule':
    '{file} sets {count} rules @typescript-eslint/eslint-plugin {version} does not have: every file reports them and --ship builds fail',
  'eslint.unknownRuleSuppressed':
    '{file} sets {count} rules @typescript-eslint/eslint-plugin {version} does not have: every file reports them (the gulpfile suppresses warnings, so builds still pass)',
  'eslint.caughtErrors':
    '{file}: @typescript-eslint/no-unused-vars without caughtErrors checks catch bindings on plugin {version} (default moved from none to all)',
  'fix.migrateRules': 'Move the removed rules in {file} to the rules that replaced them',
  'fix.keepCaughtErrors': 'Keep catch bindings unchecked in {file} (caughtErrors: none)',
  'eslint.legacyIgnored': 'ESLint {version} ignores {file}; migrate to eslint.config.js',

  // Node
  'node.pinConflict': 'Node pin {pin} ({file}) conflicts with {range} required by {source}',
  'node.enginesMissing': 'engines.node is missing; the stack requires {range}',
  'node.enginesConflict': 'engines.node {engines} excludes {range} required by {source}',
  'node.enginesTooWide':
    'engines.node {engines} allows versions outside {range} required by {source}',
  'node.notInstalled': 'No installed Node satisfies {ranges} (recommended {recommended})',
  'node.eol': 'Node {version} reached end of life on {end} (recommended {recommended})',
  'node.patchedAvailable':
    'Node {version} has known vulnerabilities; {recommended} is patched and compatible',
  'node.eolNotAssessed': 'EOL: {count} known CVE, later ones not assessed or patched',

  // Security
  'remediation.unknown': 'no registry data for this package (offline without cache): plan unknown',
  'remediation.noFix':
    'no patched version of {package} is published after {version}: not fixable by an update; remove or replace the package that pulls it in',
  'remediation.blockedDirect':
    'patched {target} is outside what the stack allows ({sources}): fixable only by changing the stack target',
  'remediation.parentBlocked':
    'the parent release that pulls a patched version ({parent}) is blocked by {sources}',
  'remediation.majorBlockedByStack':
    'patched only in {target}, a new major; {root} is pinned by {source}: not fixable inside this stack',
  'remediation.peerBlocked': 'patched {target} is rejected by peer ranges ({peers})',
  'remediation.notNpm':
    '{package} needs an override, which packman writes for npm lockfiles only (lockfile: {kind})',
  'remediation.override':
    'the dependents ({dependents}) declare ranges without a patched version: npm overrides force one inside the same major',
  'remediation.overrideMajor':
    'the dependents ({dependents}) declare ranges without a patched version and {target} is a new major: the override may break them',
  'remediation.overrideUnderStack':
    'forced under {root} ({source}): the stack keeps the parent, so the override changes code the stack ships; review the build',
  'remediation.relock':
    'every dependent already allows {package}@{target}; the lockfile keeps the vulnerable version until it is pinned and relocked',
  'remediation.relockManual':
    'every dependent already allows {package}@{target}: update the lockfile (npm update {package})',
  'remediation.noChain':
    'no package of the lockfile requires {package} (extraneous copy): reinstall or relock to drop it',
  'remediation.direct': 'declared dependency: update to {package}@{target}',
  'remediation.parent':
    'update the declared parent ({parents}) to a release that requires a patched version',
  'audit.planTitle': 'Remediation plan ({count} vulnerable packages)',
  'audit.planSummary':
    'plan: {fixable} with a fix, {relock} of them by relock, {blocked} blocked by the stack or peers, {noFix} without a patched version, {unknown} unknown',
  'audit.buildNote':
    'A passing build does not clear these: the vulnerable code is still installed or shipped.',
  'security.packageVulns':
    '{count} vulnerable packages ({direct} direct, {network} in network code)',
  'security.nodeVuln': 'Node {version}: {count} known vulnerabilities ({context})',

  // Policy
  'policy.pinViolation': 'Group "{group}": {name} must be {version} ({count} projects differ)',
  'policy.groupDivergence': 'Group "{group}": {name} has {count} versions, align to {target}',
  'policy.nodeFragmentation': 'Projects need {count} different Node lines',

  'constraint.package': '{name} {version} does not satisfy {range} required by {source}',

  // API breaks
  'api.oldUsage':
    '{package} resolves to {version} but {count} places still use the API of versions before {since} ({title})',
  'api.newUsage':
    '{package} resolves to {version} but {count} places use the API introduced in {since} ({title})',
  'api.split':
    '{package}: {old} projects below {since} and {new} at or above it; {work} still use the old API and need code changes to converge',
  'api.fixBreaks':
    '{count} version changes cross a documented API break; the code below must change with them:',
  'upgrade.apiMigration':
    '{package} {from} -> {to}: {count} places use the API of the version being left; see the code changes below.',
  'upgrade.codeChanges': 'Code changes required:',
  'compat.title': '{package} in {project}',
  'compat.current': 'current: {evidence}; in {section}',
  'compat.notDeclared': 'current: not declared in this project',
  'versions.source.declared': 'declared',
  'versions.source.locked': 'locked',
  'versions.source.installed': 'installed',
  'versions.summary': 'latest {latest}, most common {version} ({count}/{total})',
  'versions.none': 'none',
  'versions.unknown': 'unknown in {count}/{total} ({reason})',
  'versions.noLockfile': 'no lockfile',
  'versions.noModules': 'no node_modules',
  'versions.drift': 'declared and locked versions disagree',
  'compat.target': 'target: {version}',
  'compat.constraints': 'Stack ranges',
  'compat.peers': 'Peer ranges of locked packages',
  'compat.engines': 'Node:',
  'compat.breaks': 'API breaks between current and target',
  'compat.breaksAhead': 'API breaks ahead of the current version',
  'compat.none': 'none',
  'compat.path': 'Path: {path}',
  'compat.needProject':
    'compat looks at one project; -p matched {count}: {projects}. Pass -p <project id or glob> that picks exactly one.',
  'upgrade.noOldApi': 'no known old-API usage found in scanned sources',

  // Fixes
  'fix.syncYoRc': 'Update .yo-rc.json to {version}',
  'fix.securityRemediation': 'Remediate {package}: patched {target} ({status})',
  'fix.alignSpfxPackages': 'Set all SPFx packages to {version}',
  'fix.replaceCompiler': 'Use {compiler}',
  'fix.removeCompiler': 'Remove rush-stack-compiler',
  'fix.setVersion': 'Set {name} to {version}',
  'fix.pinReact': 'Pin react and react-dom to {react}',
  'fix.alignTypesReact': 'Align @types/react and @types/react-dom',
  'fix.pinInstalled': 'Pin ranges to the installed versions',
  'fix.alignFamily': 'Align the {family} family to {version}',
  'fix.declareImports': 'Declare imported packages with the locked version',
  'fix.removeUnused': 'Remove unused dependencies',
  'fix.setEngines': 'Set engines.node to {range}',
  'fix.updatePin': 'Write {version} to {file}',
  'fix.alignGroup': 'Align {name} to {version}',

  // CLI
  'tui.tab.overview': 'Overview',
  'tui.tab.projects': 'Projects',
  'tui.tab.versions': 'Versions',
  'tui.tab.node': 'Node',
  'tui.tab.fixes': 'Fixes',
  'tui.tab.outdated': 'Outdated',
  'tui.tab.store': 'Store',
  'tui.key.profiles': 'profiles',
  'tui.nothingToChange': 'Nothing to change for this row.',
  'tui.noProfileFixes': 'No profile differences to fix (profiles in packman.config.json).',
  'tui.profilesSelected': '{count} profile fixes selected: review them in Fixes.',
  'tui.profilesCleared': '{count} profile fixes deselected.',
  'tui.outdatedLoading': 'Asking the npm registry…',
  'tui.outdatedUnavailable': 'Registry lookup is not available here: run packman outdated.',
  'tui.inMajor': 'newest in major',
  'tui.bumpBlocked': '{version} not allowed: {reason}',
  'tui.key.addRemove': 'add/remove package',
  'tui.key.build': 'build',
  'tui.key.sync': 'sync',
  'tui.job.pickProject': 'Pick a project in the Projects tab first (+ add, - remove, b build).',
  'tui.job.unavailable': 'Managed operations are not available here: use the CLI commands.',
  'tui.job.planning': 'Planning… nothing is written yet.',
  'tui.job.back': 'Esc: back',
  'tui.job.blocked': 'Cannot run: see the lines above. Esc: back',
  'tui.job.nothing': 'Nothing to change.',
  'tui.job.confirm':
    'Run it? y runs (Esc or Ctrl+C stops the running step; nothing is rolled back), Esc goes back',
  'tui.job.confirmSync':
    'Run it? y runs (Esc or Ctrl+C stops it and rolls back the store switch in progress), Esc goes back',
  'tui.job.anyKey': 'Press any key to return to the TUI.',
  'tui.job.running': 'Running outside the TUI; Esc or Ctrl+C cancels the running step.',
  'tui.job.exit': 'exit {code}: {state}',
  'tui.job.cancelled': 'cancelled',
  'tui.job.done': 'done',
  'tui.job.failed': 'failed',
  'tui.job.remaining': 'Still left: {counts}; {fixes} safe fixes, {stale} stale linked projects',
  'tui.job.needInput': 'Name at least one package and a project.',
  'tui.job.scopeInstall': '{project}: npm install with Node {node}',
  'tui.job.scopeNoGroup': '{project}: linked, but no store group fits; the store is not rebuilt',
  'tui.job.scopeStore': 'store {key} rebuilt and relinked for {projects}',
  'tui.job.scopeFiles': '{count} files change',
  'tui.job.scopeBuild': '{project}: npm run {script} with Node {node}',
  'tui.job.scopeProjects': 'projects changed: {projects}',
  'tui.job.scopeSyncPasses':
    'then store switches, builds and further passes until stable, and a final check',
  'tui.job.prompt.add':
    'Add to {project} (name or name@range, space separated; Enter plans, Esc cancels):',
  'tui.job.prompt.remove': 'Remove from {project} (names; Enter plans, Esc cancels):',
  'tui.job.title.add': 'Add {packages} to {project}',
  'tui.job.title.remove': 'Remove {packages} from {project}',
  'tui.job.title.build': 'Build {project} (npm run {script})',
  'tui.job.title.sync': 'Sync: safe fixes, store switches, builds, final check',
  'tui.storeLinked': '{count}/{total} linked',
  'tui.storeHint':
    'Link with: packman store link -g {key} --union (installs, then replaces node_modules); change a linked project with packman add <pkg> -p <project>',
  'tui.storeOthers':
    '{candidates} groups need alignment first, {excluded} projects excluded: packman store plan',
  'fix.bumpInMajor': 'Update {name} to {version}',
  'tui.minSeverity': 'showing {severity} and worse',
  'tui.key.move': 'move',
  'tui.key.tabs': 'tabs',
  'tui.key.open': 'open',
  'tui.key.back': 'back',
  'tui.key.select': 'select fix',
  'tui.key.severity': 'severity',
  'tui.key.apply': 'apply',
  'tui.key.reload': 'reload',
  'tui.key.quit': 'quit',
  'tui.nodeUsers': '{count} projects',
  'tui.noSelection': 'No fixes selected: press space on a finding with a fix.',
  'sp.fromTest': 'Including the requests recorded by {run}.',
  'sp.propertySteps':
    'properties: {steps} changes on {controls} controls, {failed} broke the web part',
  'sp.propertySkipped': 'not driven: {controls}',
  'sp.propertyPaneClosed': 'properties: the property pane did not open, nothing was checked',
  'sp.noSite': 'No SharePoint site: pass --site or set "site" in {file}.',
  'sp.signIn': 'Sign in to {site} in the browser packman opened; waiting...',
  'sp.written': '{file} updated: add column types, choices and items by hand.',
  'sp.upToDate': 'The site already has everything in the fixtures.',
  'sp.dryRun': 'Dry run: nothing written. Use --apply to create it.',
  'sp.confirmSeed': 'Create {count} lists, columns, items and files on {site}?',
  'sp.confirmClean': 'Delete what packman created on {site}?',
  'sp.noGulp': 'neither gulp nor heft is installed in the project',
  'store.linkStale':
    'package.json changed since the project was linked; the shared store does not have the new versions yet',
  'store.linkDrift':
    'node_modules no longer matches the shared store: npm was run inside a linked project',
  'store.driftMissing': 'missing: {packages}',
  'store.driftReplaced': 'real copies instead of links: {packages}',
  'store.driftExtra': 'not from the store: {packages}',
  'store.driftHint':
    'Do not run npm in linked projects. Declare packages in package.json, then packman store plan --union and packman store link; relinking moves npm copies to .packman/trash.',
  'store.trashed': '{project}: npm copies moved to .packman/trash before relinking: {packages}',
  'store.needGroup': 'Pass --group <key> or --of <project>.',
  'hooks.installed': 'hook added: {file}',
  'hooks.foreign':
    'left as is, not written by packman: {file}. Add packman store status --check to it by hand.',
  'hooks.removed': 'hook removed: {file}',
  'spfx.tsconfigCompiler':
    'tsconfig.json extends {extends}, but the project builds with {expected}',
  'fix.tsconfigExtends': 'Point tsconfig.json extends to {compiler}',
  'store.none': 'No group of identical projects can share an install yet.',
  'store.groupNotFound': 'Group {group} not found; run `packman store plan`.',
  'store.linkPlan': '{count} projects will share one install built with Node {node}:',
  'store.confirmLink': 'Install the store and link these projects?',
  'store.linked': '{count} projects linked to {dir}',
  'store.unlinked':
    '{count} links removed, {restored} manifest/lock backups restored; run install to recreate local modules',
  'store.noLinks': 'No projects are linked.',
  'store.alignFirst': 'align first: {packages}',
  'store.alignOrder':
    'order: `packman check`, then `packman fix --apply`, then `packman align --package <name>`: fix moves the packages whose peer ranges would reject the most common version',
  'init.exists': '{file} already exists; use --force to overwrite it.',
  'init.created': 'Created {file}',
  'profile.versions': '{count} dependencies differ from profile {profile}',
  'profile.misplaced': '{count} dependencies are in the wrong section for profile {profile}',
  'profile.missing': '{count} dependencies required by profile {profile} are missing',
  'profile.deprecated':
    '{count} deprecated dependencies listed by profile {profile} are still declared',
  'profile.scripts': '{count} scripts differ from profile {profile}',
  'profile.engines': '{count} engines differ from profile {profile}',
  'profile.overrides': '{count} overrides differ from profile {profile}',
  'profile.tsconfig': '{count} tsconfig.json settings differ from profile {profile}',
  'profile.tsconfigInvalid': 'tsconfig.json cannot be parsed',
  'fix.applyProfile': 'Apply profile {profile}',
  'npm.unusedDevDependency':
    '{count} devDependencies are not used by source, config files or scripts',
  'spfx.unusedRuntime':
    '{count} SPFx runtime packages are declared but not imported (scaffold leftovers)',
  'fix.mergeDuplicates': 'Keep one declaration with the highest version',
  'spfx.tslintLeftover': 'tslint.json is left over: SPFx {version} lints with ESLint',
  'fix.deleteFile': 'Delete {file}',
  'spfx.coreMissing':
    '{count} packages required by SPFx {version} are not declared (build or runtime depends on them)',
  'fix.addCore': 'Add the SPFx {version} core packages',
  'spfx.coreTransitive':
    '{count} packages required by SPFx {version} are only present as dependencies of other packages; declare them',
  'spfx.coreUnverified':
    'No lockfile or node_modules: {count} packages required by SPFx {version} are not declared and cannot be verified',
  'install.confirm': 'Run npm in {count} projects?',
  'clean.nothing': 'Nothing to clean.',
  'clean.confirm': 'Remove {count} items?',
  'clean.done': '{count} items removed',
  'reinstall.confirm': 'Clean and reinstall {count} projects?',
  'update.noProfiles':
    'No profiles in packman.config.json: create one with `packman profile generate --name <name> --write`.',
  'profile.notWritten': 'Not written: add --write to save it in packman.config.json.',
  'store.seeded':
    'Resolving from the verified set of {date} (Node {node}); --refresh resolves fresh.',
  'store.unverified':
    '{count} versions differ from the verified set and are not verified by a build yet:',
  'install.drift':
    '{project}: package-lock.json does not match package.json; run packman relock and review the changes (npm would pick versions on its own).',
  'store.peers':
    '{count} peer requirements are not met by the group versions; fix them in the projects:',
  'cli.notANumber': '{value} is not a whole number of 0 or more.',
  'data.usingUpdated': 'using the updated copy',
  'data.usingBundled': 'using the bundled copy',
  'data.spfxStatus':
    'SPFx: latest verified {verified} (matrix {verifiedAt}), npm latest {npm} ({source}); published, not yet verified: {unverified}',
  'data.dir': 'Updated data folder: {dir}',
  'data.file': '{name}: {before} -> {after}',
  'data.noChanges': 'no changes',
  'data.notWritten': 'Not written: run without --dry-run to save the updated data.',
  'data.written': 'Saved to {dir}; bundled files are unchanged.',
  'profile.tsconfigSource': 'tsconfig.json taken from {project}',
  'profile.tsconfigSourceMissing':
    'No readable tsconfig.json for {project} (a project id or latest-ts) {reason}',
  'profile.written': 'Profile {name} written to {file}',
  'align.package': 'Aligning {name} to {version}',
  'align.peers':
    '{count} peer ranges exclude {name}@{version}; run `packman fix --apply` first, it moves the packages that declare them:',
  'align.unknownProject': 'Unknown project {project}',
  'align.closest': 'Projects sharing the most versions with {project}:',
  'align.usage': 'Use --base <project> [--to <project>] or --package <name> [--version <version>].',
  'outdated.none': 'Everything is up to date.',
  'list.total': '{count} projects',
  'ignore.empty': '(empty)',
  'log.pruned': '{count} entries removed',
  'log.empty': 'No operations recorded.',
  'fix.alignToProject': 'Align {base} to {target}',
  'cli.description':
    'Detect stacks, check compatibility and vulnerabilities, align versions across many projects.',
  'cli.noProjects': 'No projects found under {root}',
  'cli.dryRun': 'Dry run: nothing was written. Re-run with --apply to write the changes.',
  'cli.applied': '{count} files changed. Backups in {dir}',
  'cli.noFixes': 'Nothing to fix.',
  'cli.confirm': 'Apply {count} changes to {files} files?',
  'cli.aborted': 'Aborted.',
  'target.node': 'Node {version} differs from repository target {target}',
  'target.stack': '{stack} {version} differs from repository target {target}',
  'target.repository':
    'Newest {stack} already in this repository: {version} ({project}); run upgrade to converge',
  'upgrade.title': 'Repository migration plan (default: newest existing project)',
  'upgrade.fixProject': 'Migrate to {version} and align the project stack',
  'upgrade.fixPolicy': 'Save repository targets, profiles and unified groups',
  'upgrade.order': 'Build order: {projects}',
  'upgrade.blocked': '{count} blockers require changes before this migration can be applied.',
  'upgrade.noProjects': 'No matching projects to migrate.',
  'upgrade.jsonReadOnly':
    '--json prints a read-only migration plan; use --apply without --json to write it.',
  'upgrade.nodeMissing':
    'Node {version} is not installed; install it before running npm or verifying builds.',
  'upgrade.nodeIncompatible': 'No common Node satisfies all target stacks: {ranges}',
  'upgrade.unknownVersion': 'Cannot determine the existing {stack} version.',
  'upgrade.unknownSpfx': 'SPFx {version} has no verified migration data.',
  'upgrade.spfxUnverified':
    'SPFx {version} is published on npm but not yet verified in the matrix ({verifiedAt}): the plan assumes the constraints of {base}; read the release notes before applying.',
  'upgrade.spfxNoTarget':
    'No published SPFx release known to packman matches {to} (verified matrix {verifiedAt}). Nearest verified version: {nearest}.',
  'upgrade.spfxUnconfirmed':
    'SPFx {to} is not in the verified matrix ({verifiedAt}) and the npm registry could not confirm it (offline?). Nearest verified version: {nearest}; retry online to plan {to} as a not yet verified patch.',
  'upgrade.downgrade':
    'This would downgrade {from} to {to}; choose the newest existing project instead.',
  'upgrade.linked': '{project} is already linked; unlink it before changing its dependency set.',
  'upgrade.controls':
    '{name}@{version} targets SPFx {built}; no verified matching release selected for {target}.',
  'upgrade.platform': 'SharePoint environment {environment} does not support SPFx {version}.',
  'upgrade.reactApi':
    'React {version} needs migration of ReactDom.render/unmount to the root API in source code.',
  'upgrade.pnpMajor': 'PnPjs {from} -> {to}: review API changes and verify the build.',
  'upgrade.pnpAsyncTarget':
    'tsconfig target {target} cannot compile `for await` over PnPjs queries (TS2495): raise target to ES2018+ or set downlevelIteration (adding lib es2018.asynciterable if Symbol.asyncIterator is unknown).',
  'upgrade.pnpApi':
    'Source uses removed PnPjs APIs/imports; migrate getAll/getPaged/Graph paged to async iterators and replace common/odata imports.',
  'upgrade.customGulp': '{file} has custom Gulp tasks; port them to Heft before applying.',
  'upgrade.customScript': 'Script {name} needs a manual Heft equivalent: {command}',
  'upgrade.customEslint':
    '{file} has custom legacy ESLint settings; port them to the target flat config before applying.',
  'upgrade.customSass': 'Custom config/sass.json options need mapping to the Heft Sass schema.',
  'upgrade.packageVersion':
    'No verified version of {name} matching {range} is available in project locks or registry cache; retry online.',
  'upgrade.frameworkReview':
    '{stack} {from} -> {to}: review source/config migration and run the build.',
  'upgrade.profileConflict':
    'Profile {name} declares {dependency}@{spec}; the generated profile will enforce {wanted}. Review the old profile.',
  'upgrade.cycle':
    'Local project dependency cycle includes {project}; resolve the build order manually.',
  'upgrade.noBuild': '{project} has no build/test script for verification.',
  'upgrade.sharedNotice':
    'One shared installation; local node_modules will be deleted after success. Only manifests and locks are backed up.',
  'upgrade.sharedBlocked':
    'The selected projects cannot form one shared group; inspect dependency conflicts, scripts and local paths, or select one framework family.',
  'upgrade.sharedNpm':
    'Shared migration requires npm lockfiles; convert yarn/pnpm locks before applying.',
  'fix.addPackage': 'Add {name}@{version} to {project}',
  'fix.removePackages': 'Remove {count} packages from {project}',
  'add.plan': '{project}: {name}@{version} -> {section} ({source}: {detail})',
  'add.blocked':
    '{count} checks failed; nothing was written. Fix them or pass an explicit version.',
  'add.unknownProject': 'No project matches {project}; pass -p <project id or glob>.',
  'add.notDeclared': '{project}: {name} is not declared, nothing to remove.',
  'add.linkedRebuild':
    '{project} is linked to the shared store: npm does not run in the project; the store of group {group} is rebuilt and all {count} members are relinked.',
  'add.linkedNoGroup':
    '{project} no longer fits a shared group ({reason}); the store was not rebuilt. Options: use the group spec, align the package in the whole group (packman align --package <name>), or packman store unlink -p {project} --restore and packman install.',
  'add.installing': '{project}: npm install (node {node})',
  'add.noInstall':
    'Manifests written; run packman install (or packman store link --of <project> --union for linked projects).',
  'add.stillUsed':
    '{project}: {name} is still used ({places}); removing it breaks the build or the tooling.',
  'add.verifyUnlinked':
    '{project} has its own node_modules: --verify {script} applies to linked projects only, nothing was run.',
  'install.refreshIgnored': '--refresh has no effect without --sync-store.',
  'install.linkedStale':
    'linked to the store, package.json changed: run packman add/remove, or packman store link --of {project} --union',
  'install.linkedOk':
    'linked to the store, up to date (use packman add <pkg> -p {project} to change it)',
  'install.syncStore': 'rebuilding the store of {count} changed linked projects',
  'sync.linkedHint':
    'linked to the store, package.json changed: packman sync --apply rebuilds the store, relinks, builds and checks again',
  'sync.cancelling':
    'Cancelling: stopping the running npm step, then restoring the previous state…',
  'sync.phasePreflight': 'Preflight: Node versions',
  'sync.phaseFix': 'Pass {pass}/{max}: fixes',
  'sync.phaseCheck': 'Final check',
  'sync.stepNode': 'Node preflight',
  'sync.stepPass': 'pass {pass}',
  'sync.stepCycle': 'pass {pass}: fix held back (cycle)',
  'sync.stepFix': 'pass {pass}: fixes written',
  'sync.stepStore': 'pass {pass}: store of {project}',
  'sync.stepProject': 'pass {pass}: {project} install and build',
  'sync.stepCheck': 'final check',
  'sync.stable': 'no allowed fix left and no linked project is stale',
  'sync.preview': '{fixes} fixes, {groups} linked groups to rebuild (dry run)',
  'sync.previewNext':
    'Dry run: nothing written. With --apply each pass writes the fixes, switches the linked stores (prepare, relink, build; rollback on failure) and checks again until stable.',
  'sync.wouldSwitch': 'store rebuilt and switched for: {projects}',
  'sync.notWritten': 'fixes not written (declined or failed)',
  'sync.fixesApplied': '{count} fixes in {files} files',
  'sync.noGroup': '{project} has no shared group with these manifests ({reason})',
  'sync.switch.prepare':
    'Preparing store {key} for {count} projects (the current links keep working)',
  'sync.switch.switch': 'Switching {count} projects to store {key}',
  'sync.switch.verify': 'Building {count} projects on store {key}',
  'sync.switch.rollback': 'Restoring the previous links, manifests and lockfiles',
  'sync.switched': '{count} projects on {dir}',
  'sync.rolledBack': '{phase} failed, previous state restored: {error}',
  'sync.switchFailed': '{phase} failed, state kept for inspection: {error}',
  'sync.noNode': 'no installed Node for {project}',
  'sync.nodeMissing':
    'Node {version} is not installed (needed by {projects}). Prepare it with: {command}',
  'sync.nodePrepare': 'run {command}, or pass --install-node',
  'sync.nodeStillMissing': 'Node {version} still not found',
  'sync.noFixesLeft': 'no allowed fix left',
  'sync.fixesLeft': '{count} allowed fixes left',
  'sync.notStable':
    'not stable after {passes} passes: {count} allowed fixes left, {stale} stale linked projects',
  'sync.summary': 'Summary',
  'sync.complete': 'Complete.',
  'sync.incomplete': 'Incomplete: a step failed, was cancelled or left work; see above.',
  'upgrade.linkedSwitch':
    'Linked group: the migration prepares a new store, switches all {count} projects and restores the previous store links if a step fails (no unlink, no npm in the projects).',
  'upgrade.linkedPartial':
    'The store of the selected linked projects is also used by {projects}; include them (a store is switched as a whole).',
  'upgrade.linkedMixed':
    '{projects} have their own node_modules while the others are linked; pass --shared to link them too, or select only the linked group with -p.',
  'upgrade.majorDowngradeKept':
    '{name} stays at {current}: the planned {wanted} ({reason}) would lower its major and the target stack does not require it. Align by hand if needed.',
  'upgrade.majorDowngradeRequired':
    '{name} {current} -> {wanted} lowers the major because {target} requires it; review the API changes (breaking).',
  'rollback.plan':
    'Last store switch ({at}): {count} projects from {from} back to {to}; {files} manifest/lock/edited files restored from its snapshot.',
  'rollback.refused': 'Not rolled back: the state changed since that switch (see above).',
  'rollback.confirm': 'Restore the previous links and files?',
  'rollback.done': '{count} projects are back on their previous store links.',
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
