import path from 'node:path';
import semver from 'semver';
import { loadData } from '../core/data.js';
import { readJsonFile } from '../core/json.js';
import { implicitUsage } from '../scan/implicit.js';
import { finding, fix, msg, removeDependency, setDependency } from '../core/findings.js';
import { isTopLevel, packageNameFromLocation, requiredByOthers } from '../core/lockfile.js';
import type { Edit, Finding, LockedPackage, Project } from '../core/types.js';
import {
  hasPrerelease,
  isExactSpec,
  isRegistrySpec,
  majorOf,
  minVersionOf,
  resolveVersion,
  satisfies,
} from '../core/versions.js';
import type { ProjectContext, StackProvider } from './types.js';

interface Family {
  id: string;
  policy: 'same-version' | 'same-major';
  packages?: string[];
  prefix?: string;
  exclude?: string[];
  reason: string;
}

/** Packages that are legitimately present without being imported. */
const IMPLICIT = [
  /^@types\//,
  /^@microsoft\/rush-stack-compiler-/,
  /^@microsoft\/sp-build-web$/,
  /^tslib$/,
];

export const npmProvider: StackProvider = {
  id: 'npm',

  detect(ctx) {
    const { project } = ctx;
    const evidence = [`package.json (${project.dependencies.length} dependencies)`];
    if (project.lockfile)
      evidence.push(`${project.lockfile.kind} lockfile v${project.lockfile.version ?? '?'}`);
    return {
      provider: 'npm',
      confidence: 'high',
      evidence,
      details: {
        lockfile: project.lockfile?.kind,
        lockfileVersion: project.lockfile?.version?.toString(),
        nodeModules: project.nodeModules,
        packageManager: project.manifest.packageManager,
      },
    };
  },

  check(ctx) {
    const { project } = ctx;
    return [
      ...checkSpecs(ctx),
      ...checkLockfile(project),
      ...checkInstalled(project),
      ...checkFamilies(project),
      ...checkPeers(project),
      ...checkDeprecated(project),
      ...checkDuplicates(project),
    ];
  },
};

function checkSpecs(ctx: ProjectContext): Finding[] {
  const { project, config } = ctx;
  const findings: Finding[] = [];
  const ranged = project.dependencies.filter(
    (dep) =>
      dep.section !== 'peerDependencies' && isRegistrySpec(dep.spec) && !isExactSpec(dep.spec),
  );
  if (config.policy.exactVersions && ranged.length > 0) {
    const edits: Edit[] = [];
    for (const dep of ranged) {
      const resolved = resolveVersion(project, dep.name);
      if (resolved && resolved.source !== 'manifest')
        edits.push(setDependency(project, dep.name, resolved.version));
    }
    findings.push(
      finding(
        'npm/range-spec',
        'warning',
        project,
        msg('npm.rangeSpec', { count: ranged.length }),
        {
          evidence: ranged.map((dep) => `${dep.name}@${dep.spec}`),
          fixes:
            edits.length > 0
              ? [fix('npm/pin-installed', msg('fix.pinInstalled'), 'safe', edits)]
              : [],
          tags: ['alignment'],
        },
      ),
    );
  }
  const prerelease = project.dependencies.filter(
    (dep) =>
      isRegistrySpec(dep.spec) &&
      (hasPrerelease(dep.spec) || /nightly|canary|next/i.test(dep.spec)),
  );
  if (prerelease.length > 0) {
    findings.push(
      finding('npm/prerelease-spec', 'warning', project, msg('npm.prereleaseSpec'), {
        evidence: prerelease.map((dep) => `${dep.name}@${dep.spec}`),
        tags: ['stability'],
      }),
    );
  }
  const dynamic = project.dependencies.filter((dep) => /^(?:\*|latest|x)$/i.test(dep.spec.trim()));
  if (dynamic.length > 0) {
    findings.push(
      finding('npm/unbounded-spec', 'error', project, msg('npm.unboundedSpec'), {
        evidence: dynamic.map((dep) => `${dep.name}@${dep.spec}`),
        tags: ['stability'],
      }),
    );
  }
  return findings;
}

function checkLockfile(project: Project): Finding[] {
  const lock = project.lockfile;
  if (!lock) {
    if (project.dependencies.length === 0) return [];
    return [
      finding('npm/lockfile-missing', 'warning', project, msg('npm.lockfileMissing'), {
        tags: ['reproducibility'],
      }),
    ];
  }
  if (lock.kind !== 'npm') return [];
  const findings: Finding[] = [];
  if (lock.version !== undefined && lock.version < 2) {
    findings.push(
      finding('npm/lockfile-v1', 'info', project, msg('npm.lockfileV1'), {
        tags: ['reproducibility'],
      }),
    );
  }
  const drift: string[] = [];
  for (const dep of project.dependencies) {
    if (dep.section === 'peerDependencies') continue;
    const recorded = lock.rootSpecs[dep.name];
    if (
      lock.version !== undefined &&
      lock.version >= 2 &&
      recorded !== undefined &&
      recorded !== dep.spec
    ) {
      drift.push(`${dep.name}: package.json ${dep.spec}, lockfile ${recorded}`);
      continue;
    }
    const locked = lock.packages.find((pkg) => pkg.name === dep.name && isTopLevel(pkg));
    if (!locked) {
      if (lock.packages.length > 0) drift.push(`${dep.name}: missing from lockfile`);
    } else if (isRegistrySpec(dep.spec) && !satisfies(locked.version, dep.spec)) {
      drift.push(`${dep.name}: lockfile ${locked.version} does not satisfy ${dep.spec}`);
    }
  }
  if (drift.length > 0) {
    const unique = [...new Set(drift)];
    drift.length = 0;
    drift.push(...unique);
    findings.push(
      finding(
        'npm/lockfile-drift',
        'error',
        project,
        msg('npm.lockfileDrift', { count: drift.length }),
        {
          evidence: drift,
          tags: ['reproducibility'],
        },
      ),
    );
  }
  return findings;
}

function checkInstalled(project: Project): Finding[] {
  if (project.nodeModules === 'absent') {
    return project.dependencies.length > 0
      ? [finding('npm/not-installed', 'info', project, msg('npm.notInstalled'))]
      : [];
  }
  const drift: string[] = [];
  for (const dep of project.dependencies) {
    if (dep.section === 'peerDependencies' || !isRegistrySpec(dep.spec)) continue;
    const installed = project.installed[dep.name];
    if (!installed) {
      if (dep.section !== 'optionalDependencies') drift.push(`${dep.name}: not installed`);
    } else if (!satisfies(installed, dep.spec)) {
      drift.push(`${dep.name}: installed ${installed}, declared ${dep.spec}`);
    }
  }
  if (drift.length === 0) return [];
  return [
    finding(
      'npm/installed-drift',
      'warning',
      project,
      msg('npm.installedDrift', { count: drift.length }),
      {
        evidence: drift,
        tags: ['reproducibility'],
      },
    ),
  ];
}

function familyMembers(family: Family, names: string[]): string[] {
  return names.filter(
    (name) =>
      (family.packages?.includes(name) ?? false) ||
      (family.prefix !== undefined &&
        name.startsWith(family.prefix) &&
        !(family.exclude ?? []).includes(name)),
  );
}

function checkFamilies(project: Project): Finding[] {
  const families = loadData<{ families: Family[] }>('families.json').families;
  const names = project.dependencies
    .filter((dep) => dep.section !== 'peerDependencies')
    .map((dep) => dep.name);
  const findings: Finding[] = [];
  for (const family of families) {
    const members = [...new Set(familyMembers(family, names))];
    if (members.length < 2) continue;
    const versions = members
      .map((name) => ({ name, resolved: resolveVersion(project, name) }))
      .filter(
        (item): item is { name: string; resolved: NonNullable<typeof item.resolved> } =>
          item.resolved !== undefined,
      );
    const key = (version: string): string =>
      family.policy === 'same-major'
        ? String(majorOf(version))
        : (semver.coerce(version, { includePrerelease: true })?.version ?? version);
    const distinct = new Set(versions.map((item) => key(item.resolved.version)));
    if (distinct.size <= 1) continue;
    const highest = versions
      .map((item) => item.resolved.version)
      .sort((a, b) => semver.rcompare(semver.coerce(a) ?? '0.0.0', semver.coerce(b) ?? '0.0.0'))[0];
    const fixes =
      family.policy === 'same-version' && highest
        ? [
            fix(
              `npm/align-family-${family.id}`,
              msg('fix.alignFamily', { family: family.id, version: highest }),
              'review',
              versions
                .filter((item) => item.resolved.version !== highest)
                .map((item) => setDependency(project, item.name, highest)),
            ),
          ]
        : [];
    findings.push(
      finding(
        'npm/family-mismatch',
        'error',
        project,
        msg('npm.familyMismatch', { family: family.id, policy: family.policy }),
        {
          evidence: [
            ...versions.map((item) => `${item.name}: ${item.resolved.version}`),
            family.reason,
          ],
          fixes,
          tags: ['alignment'],
        },
      ),
    );
  }
  return findings;
}

function topLevelMap(project: Project): Map<string, LockedPackage> {
  const map = new Map<string, LockedPackage>();
  for (const pkg of project.lockfile?.packages ?? []) {
    if (isTopLevel(pkg)) map.set(pkg.name, pkg);
  }
  return map;
}

/** Peer requirements of direct dependencies, checked offline against what is resolved. */
function checkPeers(project: Project): Finding[] {
  const top = topLevelMap(project);
  const problems: string[] = [];
  for (const dep of project.dependencies) {
    const pkg = top.get(dep.name);
    if (!pkg?.peerDependencies) continue;
    for (const [peer, range] of Object.entries(pkg.peerDependencies)) {
      const peerVersion = project.installed[peer] ?? top.get(peer)?.version;
      if (peerVersion && !satisfies(peerVersion, range)) {
        problems.push(`${pkg.name}@${pkg.version} requires ${peer}@${range}, found ${peerVersion}`);
      }
    }
  }
  if (problems.length === 0) return [];
  return [
    finding(
      'npm/peer-unsatisfied',
      'error',
      project,
      msg('npm.peerUnsatisfied', { count: problems.length }),
      {
        evidence: problems,
        tags: ['compatibility'],
      },
    ),
  ];
}

function checkDeprecated(project: Project): Finding[] {
  const top = topLevelMap(project);
  const deprecated = project.dependencies
    .map((dep) => top.get(dep.name))
    .filter((pkg): pkg is LockedPackage => pkg?.deprecated !== undefined);
  if (deprecated.length === 0) return [];
  return [
    finding(
      'npm/deprecated',
      'warning',
      project,
      msg('npm.deprecated', { count: deprecated.length }),
      {
        evidence: deprecated.map((pkg) => `${pkg.name}@${pkg.version}: ${pkg.deprecated ?? ''}`),
        tags: ['maintenance'],
      },
    ),
  ];
}

/**
 * Several copies of a package that must be a singleton at runtime (two Reacts break hooks,
 * two SPFx runtimes break the page). Nested helpers such as tslib are expected and ignored.
 */
function checkDuplicates(project: Project): Finding[] {
  const lock = project.lockfile;
  if (!lock || lock.packages.length === 0) return [];
  const { singletons } = loadData<{ singletons: string[] }>('families.json');
  const isSingleton = (name: string): boolean =>
    singletons.some((pattern) =>
      pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
    );
  const byName = new Map<string, LockedPackage[]>();
  for (const pkg of lock.packages) {
    if (pkg.dev || !isSingleton(pkg.name)) continue;
    byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
  }
  const duplicated = [...byName.entries()].filter(
    ([, copies]) => new Set(copies.map((pkg) => pkg.version)).size > 1,
  );
  if (duplicated.length === 0) return [];
  return [
    finding(
      'npm/duplicate-singletons',
      'warning',
      project,
      msg('npm.duplicateMajors', { count: duplicated.length }),
      {
        evidence: duplicated.map(([name, copies]) => {
          const versions = new Map<string, number>();
          for (const pkg of copies) versions.set(pkg.version, (versions.get(pkg.version) ?? 0) + 1);
          const owners = new Set(
            copies
              .filter((pkg) => !isTopLevel(pkg))
              .map(
                (pkg) =>
                  packageNameFromLocation(
                    pkg.location.slice(0, pkg.location.lastIndexOf('/node_modules/')),
                  ) ?? '?',
              ),
          );
          const summary = [...versions.entries()]
            .map(([version, count]) => `${version} x${count}`)
            .join(', ');
          return `${name}: ${summary}${owners.size > 0 ? `; nested under ${[...owners].slice(0, 4).join(', ')}` : ''}`;
        }),
        tags: ['compatibility'],
      },
    ),
  ];
}

/** The same package declared in several sections (e.g. dependencies and devDependencies). */
export function checkDuplicateDeclarations(
  project: Project,
  imports: ReadonlyMap<string, string>,
): Finding[] {
  const sections = new Map<string, string[]>();
  for (const dep of project.dependencies) {
    if (dep.section === 'peerDependencies') continue;
    sections.set(dep.name, [...(sections.get(dep.name) ?? []), `${dep.section} ${dep.spec}`]);
  }
  const duplicated = [...sections.entries()].filter(([, list]) => list.length > 1);
  if (duplicated.length === 0) return [];
  return [
    finding(
      'npm/duplicate-declaration',
      'error',
      project,
      msg('npm.duplicateDeclaration', { count: duplicated.length }),
      {
        evidence: duplicated.map(([name, list]) => `${name}: ${list.join(', ')}`),
        fixes: [
          fix(
            'npm/merge-duplicates',
            msg('fix.mergeDuplicates'),
            'review',
            duplicated.flatMap(([name]) => mergeDuplicate(project, name, imports.has(name))),
          ),
        ],
        tags: ['correctness'],
      },
    ),
  ];
}

/**
 * Keeps one declaration: in `dependencies` when source code imports the package, otherwise in
 * `devDependencies`, with the highest of the declared versions (2.x "remove duplicates, keep the highest version").
 */
function mergeDuplicate(project: Project, name: string, imported: boolean): Edit[] {
  const declarations = project.dependencies.filter(
    (dep) => dep.name === name && dep.section !== 'peerDependencies',
  );
  // Imported by source code: runtime dependency. Otherwise a tool: dev dependency.
  const keep = imported ? 'dependencies' : 'devDependencies';
  const highest = declarations
    .map((dep) => dep.spec)
    .sort((a, b) => semver.rcompare(minVersionOf(a) ?? '0.0.0', minVersionOf(b) ?? '0.0.0'))[0];
  const edits: Edit[] = declarations
    .filter((dep) => dep.section !== keep)
    .map((dep) => ({
      kind: 'json-remove' as const,
      file: project.manifestPath,
      path: [dep.section, name],
    }));
  if (highest) {
    edits.push({
      kind: 'json-set',
      file: project.manifestPath,
      path: [keep, name],
      value: highest,
    });
  }
  return edits;
}

/** Undeclared imports and unused runtime dependencies, from the source scan. */
export async function checkUsage(
  ctx: ProjectContext,
  implicit: string[],
  virtual: string[],
): Promise<Finding[]> {
  const { project, config } = ctx;
  const scan = await ctx.sources();
  const findings: Finding[] = [...checkDuplicateDeclarations(project, scan.imports)];
  if (scan.filesScanned === 0) return findings;
  const declared = new Set(project.dependencies.map((dep) => dep.name));
  const aliases = [...virtual, ...(await tsconfigAliases(project.dir))];
  const isAlias = (name: string): boolean =>
    aliases.some((alias) => name === alias || (alias.endsWith('/') && name.startsWith(alias)));
  const undeclared = [...scan.imports.entries()].filter(
    ([name]) =>
      !declared.has(name) &&
      name !== project.manifest.name &&
      !declared.has(`@types/${name}`) &&
      !isAlias(name),
  );
  if (undeclared.length > 0) {
    const edits = undeclared
      .map(([name]) => ({
        name,
        version: project.lockfile?.packages.find((pkg) => pkg.name === name && isTopLevel(pkg))
          ?.version,
      }))
      .filter((item): item is { name: string; version: string } => item.version !== undefined)
      .map((item) => setDependency(project, item.name, item.version));
    findings.push(
      finding(
        'npm/undeclared-import',
        'error',
        project,
        msg('npm.undeclaredImport', { count: undeclared.length }),
        {
          evidence: undeclared.map(([name, file]) => `${name} (${file})`),
          fixes:
            edits.length > 0
              ? [fix('npm/declare-imports', msg('fix.declareImports'), 'safe', edits)]
              : [],
          tags: ['correctness'],
        },
      ),
    );
  }
  const ignore = new Set([...config.checks.ignoreUnused, ...implicit]);
  const tooling = await implicitUsage(project);
  // A declared package that other packages require pins the version of a transitive dependency.
  const pins = requiredByOthers(project.lockfile);
  const isUnused = (name: string): boolean =>
    !scan.imports.has(name) &&
    !ignore.has(name) &&
    !tooling.packages.has(name) &&
    !pins.has(name) &&
    !IMPLICIT.some((pattern) => pattern.test(name));
  // SPFx runtime packages are provided by SharePoint; unused ones are scaffold leftovers, not bugs.
  const isSpfxRuntime = (name: string): boolean => name.startsWith('@microsoft/sp-');
  const unused = project.dependencies.filter(
    (dep) => dep.section === 'dependencies' && isUnused(dep.name) && !isSpfxRuntime(dep.name),
  );
  const unusedSpfx = project.dependencies.filter(
    (dep) => dep.section === 'dependencies' && isUnused(dep.name) && isSpfxRuntime(dep.name),
  );
  const unusedDev = project.dependencies.filter(
    (dep) => dep.section === 'devDependencies' && isUnused(dep.name),
  );
  const truncated = scan.truncated ? ['scan truncated: results may be incomplete'] : [];
  const report = (
    ruleId: string,
    severity: Finding['severity'],
    key: string,
    deps: typeof unused,
  ): void => {
    if (deps.length === 0) return;
    findings.push(
      finding(ruleId, severity, project, msg(key, { count: deps.length }), {
        evidence: [...deps.map((dep) => `${dep.name}@${dep.spec}`), ...truncated],
        fixes: [
          fix(
            ruleId,
            msg('fix.removeUnused'),
            'review',
            deps.flatMap((dep) => removeDependency(project, dep.name)),
          ),
        ],
        tags: ['maintenance'],
      }),
    );
  };
  report('npm/unused-dependency', 'warning', 'npm.unusedDependency', unused);
  report('npm/unused-dev-dependency', 'info', 'npm.unusedDevDependency', unusedDev);
  report('spfx/unused-runtime-package', 'info', 'spfx.unusedRuntime', unusedSpfx);
  return findings;
}

/** `compilerOptions.paths` keys (`@app/*` -> `@app/`), which resolve to local code, not packages. */
async function tsconfigAliases(dir: string): Promise<string[]> {
  const tsconfig = await readJsonFile<{ compilerOptions?: { paths?: Record<string, unknown> } }>(
    path.join(dir, 'tsconfig.json'),
  );
  if (!tsconfig.ok) return [];
  return Object.keys(tsconfig.value.compilerOptions?.paths ?? {}).map((key) =>
    key.replace(/\*$/, ''),
  );
}
