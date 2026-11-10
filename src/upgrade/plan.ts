import path from 'node:path';
import { createHash } from 'node:crypto';
import picomatch from 'picomatch';
import semver from 'semver';
import type { ProjectReport, Report } from '../analyze.js';
import type { PackmanConfig } from '../core/config.js';
import { fix, msg } from '../core/findings.js';
import { declaredDependencies } from '../core/discovery.js';
import { editJsonText } from '../core/json.js';
import type { Edit, PackageManifest, Project } from '../core/types.js';
import { resolveVersion, satisfies } from '../core/versions.js';
import { collectEdits } from '../fixes/apply.js';
import { fixCrossings } from '../fixes/breaks.js';
import { locationsOf } from '../scan/api-breaks.js';
import { recommendNode } from '../node/plan.js';
import { pickNode } from '../node/toolchain.js';
import { generateProfile } from '../ops/generate.js';
import { fetchPackuments } from '../ops/outdated.js';
import { corePackages } from '../providers/spfx/core.js';
import { findSpfxVersion, spfxMatrix } from '../providers/spfx/matrix.js';
import { nodeEdits, setPackage } from './edits.js';
import { spfxMigration, spfxOwned } from './spfx.js';
import { migrationStack, newestProject, STACK_ANCHORS, stackVersion } from './targets.js';
import type { MigrationIssue, ProjectMigration, UpgradePlan, UpgradeTarget } from './types.js';
import { lintRequirements } from './lint.js';

export interface UpgradeOptions {
  config: PackmanConfig;
  stack?: string[];
  to?: string;
  node?: string;
  offline?: boolean;
  fetchImpl?: typeof fetch;
  persistTarget?: boolean;
  shared?: boolean;
  /** `false` leaves `packman.config.json` alone: no `upgrade/policy` fix (`upgrade --no-policy`). */
  policy?: boolean;
}

export async function planUpgrade(report: Report, options: UpgradeOptions): Promise<UpgradePlan> {
  const plan: UpgradePlan = {
    root: report.root,
    targets: [],
    projects: [],
    order: [],
    fixes: [],
    issues: [],
  };
  const selected = report.projects.filter(
    (entry) => !options.stack || options.stack.includes(migrationStack(entry)),
  );
  const families = [...new Set(selected.map(migrationStack))].sort();
  if (options.stack?.some((stack) => ![...Object.keys(STACK_ANCHORS), 'node'].includes(stack)))
    throw new Error('unknown upgrade stack');
  if (options.to && families.length > 1)
    throw new Error('--to requires one framework family; select it with --stack');
  const baselines = new Map<string, ProjectReport>();
  const ranges: string[] = [];
  for (const stack of families) {
    const baseline = newestProject(selected, stack);
    if (!baseline) {
      plan.issues.push(issue('unknown-version', 'blocker', 'upgrade.unknownVersion', { stack }));
      continue;
    }
    baselines.set(stack, baseline);
    let version = stackVersion(baseline, stack) ?? '';
    if (options.to) {
      const candidates =
        stack === 'spfx'
          ? spfxMatrix()
              .versions.filter((entry) => !entry.withdrawn)
              .map((entry) => entry.version)
          : selected
              .filter((entry) => migrationStack(entry) === stack)
              .map((entry) => stackVersion(entry, stack))
              .filter((value): value is string => value !== undefined);
      version = semver.maxSatisfying(candidates, options.to) ?? '';
      if (!version) throw new Error(`no supported ${stack} target matches ${options.to}`);
    }
    const target: UpgradeTarget = {
      stack,
      version,
      baseline: baseline.project.id,
      origin: options.to ? 'explicit' : 'repository',
      currentVersions: [
        ...new Set(
          selected
            .filter((entry) => migrationStack(entry) === stack)
            .map((entry) => stackVersion(entry, stack) ?? '?'),
        ),
      ],
    };
    if (stack === 'spfx') {
      const data = findSpfxVersion(version);
      if (data) {
        const actualChain = baseline.stacks.find((entry) => entry.provider === 'spfx')?.details
          .toolchain;
        target.toolchain =
          data.toolchain === 'gulp' ||
          (actualChain === 'gulp' && data.gulpVariant && !data.gulpUnsupported)
            ? 'gulp'
            : 'heft';
        ranges.push(data.node);
      } else plan.issues.push(issue('unknown-spfx', 'blocker', 'upgrade.unknownSpfx', { version }));
    } else if (stack === 'node') {
      ranges.push(version);
    } else {
      ranges.push(...baseline.node.stackRanges.map((range) => range.range));
      const engines = baseline.project.manifest.engines?.node;
      if (engines && semver.validRange(engines)) ranges.push(engines);
    }
    plan.targets.push(target);
  }
  const requestedNode = options.node ?? options.config.target.node;
  if (requestedNode && !semver.validRange(requestedNode))
    throw new Error('invalid target Node version');
  const effective = [...ranges, ...(requestedNode ? [requestedNode] : [])];
  const baselineNodes = [...baselines.values()]
    .flatMap((entry) => (entry.node.selected ? [entry.node.selected] : []))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  const installed =
    pickNode(baselineNodes, effective) ?? pickNode(report.installedNodes, effective);
  const nodeVersion =
    installed?.version ??
    (requestedNode && semver.valid(requestedNode) ? requestedNode : recommendNode(effective));
  if (!nodeVersion || !ranges.every((range) => satisfies(nodeVersion, range)))
    plan.issues.push(
      issue('node-incompatible', 'blocker', 'upgrade.nodeIncompatible', {
        ranges: effective.join(' & '),
      }),
    );
  if (nodeVersion) plan.nodeVersion = nodeVersion;
  if (
    nodeVersion &&
    options.config.target.node &&
    nodeVersion !== options.config.target.node &&
    (options.persistTarget === false || selected.length !== report.projects.length)
  )
    plan.issues.push(
      issue('node-policy-scope', 'blocker', 'upgrade.nodeIncompatible', {
        ranges: `target.node ${options.config.target.node} & scoped Node ${nodeVersion}`,
      }),
    );
  if (installed) plan.node = installed;
  else
    plan.issues.push(
      issue('node-missing', 'review', 'upgrade.nodeMissing', { version: nodeVersion ?? '?' }),
    );

  const simulated: Project[] = [];
  for (const target of plan.targets) {
    const baseline = baselines.get(target.stack);
    if (!baseline) continue;
    const entries = selected.filter((entry) => migrationStack(entry) === target.stack);
    const pins = libraryPins(entries, baseline);
    await resolveScaffoldPins(target, baseline, entries, pins, options, plan.issues);
    for (const entry of entries) {
      const project = entry.project;
      const migration: ProjectMigration = {
        id: project.id,
        stack: target.stack,
        current: stackVersion(entry, target.stack) ?? '?',
        target: target.version,
        baseline: baseline.project.id,
        edits: [],
        issues: [],
        codeChanges: [],
        verifyScript: project.manifest.scripts?.build
          ? 'build'
          : project.manifest.scripts?.test
            ? 'test'
            : 'build',
      };
      if (semver.valid(migration.current) && semver.gt(migration.current, target.version))
        migration.issues.push(
          issue('downgrade', 'blocker', 'upgrade.downgrade', {
            from: migration.current,
            to: target.version,
          }),
        );
      if (project.nodeModules === 'link' && !options.shared)
        migration.issues.push(
          issue('linked', 'blocker', 'upgrade.linked', { project: project.id }),
        );
      for (const dependency of project.dependencies) {
        if (dependency.section === 'peerDependencies') continue;
        if (target.stack === 'spfx' && spfxOwned(dependency.name)) continue;
        const wanted = pins[dependency.name];
        if (wanted)
          migration.edits.push(
            ...setPackage(
              project,
              dependency.name,
              wanted,
              dependency.section === 'devDependencies' ? 'devDependencies' : 'dependencies',
            ),
          );
      }
      if (target.stack === 'spfx' && nodeVersion) {
        const spfx = await spfxMigration(entry, baseline, target.version, nodeVersion, pins);
        migration.edits.push(...spfx.edits);
        migration.issues.push(...spfx.issues);
      } else if (nodeVersion) {
        const anchor = STACK_ANCHORS[target.stack];
        if (anchor)
          migration.edits.push(
            ...setPackage(
              project,
              anchor,
              target.version,
              project.manifest.devDependencies?.[anchor] ? 'devDependencies' : 'dependencies',
            ),
          );
        if (
          target.stack === 'react' &&
          project.dependencies.some((dependency) => dependency.name === 'react-dom')
        )
          migration.edits.push(...setPackage(project, 'react-dom', target.version, 'dependencies'));
        migration.edits.push(...(await nodeEdits(project, nodeVersion)));
        if (target.stack === 'angular')
          for (const dep of project.dependencies) {
            if (
              /^@angular\/(?:animations|common|compiler|compiler-cli|core|elements|forms|localize|platform-browser|platform-browser-dynamic|platform-server|router|service-worker|upgrade)$/.test(
                dep.name,
              )
            )
              migration.edits.push(
                ...setPackage(
                  project,
                  dep.name,
                  target.version,
                  dep.section === 'devDependencies' ? 'devDependencies' : 'dependencies',
                ),
              );
          }
        if (migration.current !== target.version)
          migration.issues.push(
            issue('framework-review', 'review', 'upgrade.frameworkReview', {
              stack: target.stack,
              from: migration.current,
              to: target.version,
            }),
          );
      }
      migration.edits = collectEdits([
        fix(
          'upgrade/project',
          msg('upgrade.fixProject', { version: target.version }),
          'review',
          migration.edits,
        ),
      ]);
      // Version edits that cross a documented API break: the code changes are listed per project
      // and reviewed; removed APIs the source still uses are blockers above (pnp-api, react-api).
      for (const crossed of fixCrossings(
        fix(
          'upgrade/project',
          msg('upgrade.fixProject', { version: target.version }),
          'review',
          migration.edits,
        ),
        [entry],
      )) {
        const { break: item } = crossed.crossing;
        const places = locationsOf(
          entry.apiUsage,
          crossed.crossing.direction === 'upgrade' ? item.old : item.new,
        );
        migration.codeChanges.push({
          package: crossed.crossing.package,
          from: crossed.crossing.from,
          to: crossed.crossing.to,
          title: item.title,
          guide: item.guide,
          verified: item.verified,
          places,
          steps: item.steps,
        });
        if (places.length > 0)
          migration.issues.push({
            code: 'api-migration',
            level: 'review',
            message: msg('upgrade.apiMigration', {
              package: crossed.crossing.package,
              from: crossed.crossing.from,
              to: crossed.crossing.to,
              count: places.length,
            }),
            files: [...new Set(places.map((place) => place.replace(/:\d+$/, '')))],
          });
      }
      plan.projects.push(migration);
      const manifest = editedManifest(project, migration.edits);
      simulated.push({
        ...project,
        manifest,
        dependencies: declaredDependencies(manifest),
        installed: {},
      });
      plan.fixes.push(
        fix(
          `upgrade/${project.id}`,
          msg('upgrade.fixProject', { version: target.version }),
          'review',
          migration.edits,
        ),
      );
    }
  }
  plan.order = migrationOrder(selected, plan.issues);
  const configEdits: Edit[] = [];
  const configFile = path.join(report.root, 'packman.config.json');
  const groups = [];
  for (const target of plan.targets) {
    const projects = simulated.filter((project) =>
      plan.projects.some(
        (migration) => migration.id === project.id && migration.stack === target.stack,
      ),
    );
    const ids = projects.map((project) => project.id);
    const patterns = options.persistTarget !== false ? ['**', '.'] : ids;
    const generatedName =
      options.persistTarget !== false
        ? `packman-${target.stack}`
        : `packman-${target.stack}-scope-${createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 8)}`;
    const profile = generateProfile(projects, {
      strategy: 'common',
      projectsGlob: patterns,
      resolved: false,
      ...(nodeVersion ? { nodeRange: nodeVersion } : {}),
    });
    for (const [name, command] of Object.entries(projects[0]?.manifest.scripts ?? {}))
      if (projects.every((project) => project.manifest.scripts?.[name] === command))
        profile.scripts[name] = command;
    configEdits.push({
      kind: 'json-set',
      file: configFile,
      path: ['profiles', generatedName],
      value: { ...profile, stack: target.stack },
    });
    if (options.persistTarget !== false)
      configEdits.push({
        kind: 'json-set',
        file: configFile,
        path: ['target', target.stack],
        value: target.version,
      });
    groups.push({
      name: generatedName,
      projects: patterns,
      stack: target.stack,
      ...(nodeVersion ? { node: nodeVersion } : {}),
      pins: {},
    });
  }
  if (nodeVersion && options.persistTarget !== false && selected.length === report.projects.length)
    configEdits.push({
      kind: 'json-set',
      file: configFile,
      path: ['target', 'node'],
      value: nodeVersion,
    });
  const replaced = new Set(groups.map((group) => group.name));
  const wholeFamilies =
    options.persistTarget !== false
      ? new Set(plan.targets.map((target) => target.stack))
      : new Set<string>();
  for (const [name, profile] of Object.entries(options.config.profiles))
    if (
      name.startsWith('packman-') &&
      profile.stack &&
      wholeFamilies.has(profile.stack) &&
      !replaced.has(name)
    )
      configEdits.push({ kind: 'json-remove', file: configFile, path: ['profiles', name] });
  configEdits.push({
    kind: 'json-set',
    file: configFile,
    path: ['policy', 'groups'],
    value: [
      ...groups,
      ...options.config.policy.groups.filter(
        (group) =>
          !replaced.has(group.name) &&
          !(group.name.startsWith('packman-') && group.stack && wholeFamilies.has(group.stack)),
      ),
    ],
  });
  if (plan.projects.length > 0 && options.policy !== false)
    plan.fixes.push(fix('upgrade/policy', msg('upgrade.fixPolicy'), 'review', configEdits));
  // A profile that would put an old version back is a concrete conflict, not a second authority.
  for (const migration of plan.projects)
    for (const [name, profile] of Object.entries(options.config.profiles)) {
      if (
        name.startsWith('packman-') ||
        !picomatch(profile.projects)(migration.id) ||
        (profile.stack && profile.stack !== migration.stack)
      )
        continue;
      const current = simulated.find((project) => project.id === migration.id);
      for (const [dependency, spec] of Object.entries({
        ...profile.dependencies,
        ...profile.devDependencies,
        ...profile.conditionalDevDependencies,
      })) {
        const wanted = current?.dependencies.find((dep) => dep.name === dependency)?.spec;
        if (wanted && wanted !== spec)
          migration.issues.push(
            issue('profile-conflict', 'blocker', 'upgrade.profileConflict', {
              name,
              dependency,
              spec,
              wanted,
            }),
          );
      }
      for (const dependency of profile.deprecated) {
        const wanted = current?.dependencies.find((dep) => dep.name === dependency)?.spec;
        if (wanted)
          migration.issues.push(
            issue('profile-conflict', 'blocker', 'upgrade.profileConflict', {
              name,
              dependency,
              spec: 'deprecated',
              wanted,
            }),
          );
      }
      for (const [script, command] of Object.entries(profile.scripts)) {
        const wanted = current?.manifest.scripts?.[script];
        if (wanted && wanted !== command)
          migration.issues.push(
            issue('profile-conflict', 'blocker', 'upgrade.profileConflict', {
              name,
              dependency: `scripts.${script}`,
              spec: command,
              wanted,
            }),
          );
      }
    }
  return plan;
}

function issue(
  code: string,
  level: MigrationIssue['level'],
  key: string,
  params?: Record<string, string>,
): MigrationIssue {
  return { code, level, message: msg(key, params) };
}

function libraryPins(entries: ProjectReport[], baseline: ProjectReport): Record<string, string> {
  const names = new Set(
    entries.flatMap((entry) =>
      entry.project.dependencies
        .filter((dep) => dep.section !== 'peerDependencies')
        .map((dep) => dep.name),
    ),
  );
  const result: Record<string, string> = {};
  for (const name of names) {
    const base = resolveVersion(baseline.project, name)?.version;
    const versions = entries
      .flatMap((entry) => {
        const version = resolveVersion(entry.project, name)?.version;
        return version && semver.valid(version) ? [version] : [];
      })
      .sort(semver.rcompare);
    const declared = baseline.project.dependencies.find((dep) => dep.name === name)?.spec;
    const selected = base ?? versions[0] ?? declared;
    if (selected) result[name] = selected;
  }
  const pnp = result['@pnp/sp'];
  if (pnp)
    for (const name of names)
      if (/^@pnp\/(?:sp|graph|logging|core|queryable)$/.test(name)) result[name] = pnp;
  return result;
}

async function resolveScaffoldPins(
  target: UpgradeTarget,
  baseline: ProjectReport,
  entries: ProjectReport[],
  pins: Record<string, string>,
  options: UpgradeOptions,
  issues: MigrationIssue[],
): Promise<void> {
  if (target.stack !== 'spfx') return;
  const requirements = new Map<string, string>();
  for (const pkg of corePackages(
    target.version,
    target.toolchain ?? 'gulp',
    ['webpart', 'extension', 'applicationCustomizer'],
    true,
    true,
  )) {
    if (
      !pkg.required &&
      !entries.some((entry) => entry.project.dependencies.some((dep) => dep.name === pkg.name))
    )
      continue;
    const current = resolveVersion(baseline.project, pkg.name)?.version;
    if (current && satisfies(current, pkg.version)) {
      pins[pkg.name] = current;
      continue;
    }
    if (semver.valid(pkg.version)) {
      pins[pkg.name] = pkg.version;
      continue;
    }
    requirements.set(pkg.name, pkg.version);
  }
  for (const library of spfxMatrix().libraries) {
    if (
      !entries.some((entry) =>
        entry.project.dependencies.some((dep) => dep.name === library.package),
      )
    )
      continue;
    const line = library.map.find(
      (row) =>
        semver.major(row.spfx) === semver.major(target.version) &&
        semver.minor(row.spfx) === semver.minor(target.version),
    );
    if (line && (!pins[library.package] || !satisfies(pins[library.package] ?? '', line.range)))
      requirements.set(library.package, line.range);
  }
  const targetConfig = corePackages(
    target.version,
    target.toolchain ?? 'gulp',
    ['webpart'],
    false,
    true,
  ).find((pkg) => pkg.name === '@microsoft/eslint-config-spfx');
  if (targetConfig) {
    const lint = await lintRequirements(baseline.project, targetConfig.version, {
      offline: options.offline ?? false,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    if (lint)
      for (const [name, range] of lint) {
        if (semver.valid(range)) pins[name] = range;
        else if (!pins[name] || !satisfies(pins[name], range)) requirements.set(name, range);
      }
    else
      issues.push(
        issue('lint-metadata', 'blocker', 'upgrade.packageVersion', {
          name: '@microsoft/eslint-config-spfx',
          range: `metadata ${targetConfig.version}`,
        }),
      );
  }
  if (requirements.size === 0) return;
  const registry = await fetchPackuments([...requirements.keys()], {
    offline: options.offline ?? false,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  for (const [name, range] of requirements) {
    const available = Object.entries(registry.get(name)?.versions ?? {})
      .filter(([, metadata]) => !metadata.deprecated)
      .map(([version]) => version)
      .filter((version) => semver.valid(version) && !semver.prerelease(version));
    const version = semver.maxSatisfying(available, range);
    if (version) pins[name] = version;
    else {
      const fallback = entries
        .flatMap((entry) => [
          resolveVersion(entry.project, name)?.version,
          ...(entry.project.lockfile?.packages
            .filter((pkg) => pkg.name === name)
            .map((pkg) => pkg.version) ?? []),
        ])
        .find((value) => value && satisfies(value, range));
      if (fallback) pins[name] = fallback;
      else
        issues.push(issue('package-version', 'blocker', 'upgrade.packageVersion', { name, range }));
    }
  }
}

export function editedManifest(project: Project, edits: Edit[]): PackageManifest {
  const operations = edits
    .filter((edit) => edit.file === project.manifestPath)
    .flatMap((edit) =>
      edit.kind === 'json-set'
        ? [{ path: edit.path, value: edit.value }]
        : edit.kind === 'json-remove'
          ? [{ path: edit.path, value: undefined }]
          : [],
    );
  return JSON.parse(
    editJsonText(JSON.stringify(project.manifest, null, 2), operations),
  ) as PackageManifest;
}

function migrationOrder(entries: ProjectReport[], issues: MigrationIssue[]): string[] {
  const byName = new Map<string, ProjectReport[]>();
  for (const entry of entries)
    byName.set(entry.project.name, [...(byName.get(entry.project.name) ?? []), entry]);
  const done = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (entry: ProjectReport): void => {
    const id = entry.project.id;
    if (done.has(id)) return;
    if (visiting.has(id)) {
      issues.push(issue('cycle', 'blocker', 'upgrade.cycle', { project: id }));
      return;
    }
    visiting.add(id);
    for (const dep of entry.project.dependencies) {
      const dependencies = byName.get(dep.name);
      if (dependencies?.length === 1 && dependencies[0]?.project.id !== id)
        visit(dependencies[0] as ProjectReport);
    }
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const entry of entries) visit(entry);
  return order;
}
