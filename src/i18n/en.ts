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
  'spfx.upgradeAvailable': 'SPFx {version} can be upgraded (latest {latest})',

  // Frameworks
  'react.typesMajor': '@types/react {types} does not match react {react}',
  'typescript.v7Api':
    'TypeScript {version} has no programmatic API; these tools still need TypeScript 6',
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
  'security.packageVulns':
    '{count} vulnerable packages ({direct} direct, {network} in network code)',
  'security.nodeVuln': 'Node {version}: {count} known vulnerabilities ({context})',

  // Policy
  'policy.pinViolation': 'Group "{group}": {name} must be {version} ({count} projects differ)',
  'policy.groupDivergence': 'Group "{group}": {name} has {count} versions, align to {target}',
  'policy.nodeFragmentation': 'Projects need {count} different Node lines',

  'constraint.package': '{name} {version} does not satisfy {range} required by {source}',

  // Fixes
  'fix.syncYoRc': 'Update .yo-rc.json to {version}',
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
  'tui.storeLinked': '{count}/{total} linked',
  'tui.storeHint':
    'Link with: packman store link -g {key} --union (installs, then replaces node_modules)',
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
  'store.none': 'No group of identical projects can share an install yet.',
  'store.groupNotFound': 'Group {group} not found; run `packman store plan`.',
  'store.linkPlan': '{count} projects will share one install built with Node {node}:',
  'store.confirmLink': 'Install the store and link these projects?',
  'store.linked': '{count} projects linked to {dir}',
  'store.unlinked':
    '{count} links removed, {restored} manifest/lock backups restored; run install to recreate local modules',
  'store.noLinks': 'No projects are linked.',
  'store.alignFirst': 'align first: {packages}',
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
  'install.linkedSkipped': 'linked to the store, skipped',
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
} as const;

export type MessageKey = keyof typeof en;
export type Catalogue = Record<MessageKey, string>;
