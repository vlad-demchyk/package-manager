import picomatch from 'picomatch';
import semver from 'semver';
import type { ProjectReport, Report } from '../analyze.js';
import type { PackmanConfig } from '../core/config.js';
import { loadData } from '../core/data.js';
import { fix, msg, removeDependency } from '../core/findings.js';
import { fixCrossings } from '../fixes/breaks.js';
import { isTopLevel, peerRangesOn } from '../core/lockfile.js';
import type { DependencySection, Edit, Fix, Project } from '../core/types.js';
import { isRegistrySpec, majorOf, resolveVersion, satisfies } from '../core/versions.js';
import { findSpfxVersion, libraryRangeFor, spfxMatrix } from '../providers/spfx/matrix.js';
import { implicitUsage } from '../scan/implicit.js';
import type { SourceScan } from '../scan/sources.js';
import { fetchPackuments, type PackageVersionMetadata } from './outdated.js';

/** `name`, `name@range`, `@scope/name`, `@scope/name@range`. */
export interface AddRequest {
  name: string;
  range?: string;
}

export function parseRequest(text: string): AddRequest {
  const at = text.indexOf('@', text.startsWith('@') ? 1 : 0);
  if (at < 0) return { name: text };
  const range = text.slice(at + 1);
  return range ? { name: text.slice(0, at), range } : { name: text.slice(0, at) };
}

/** Where the chosen spec comes from, most trusted first. */
export type VersionSource =
  'request' | 'pin' | 'group' | 'profile' | 'workspace' | 'spfx-matrix' | 'lockfile' | 'registry';

export interface VersionChoice {
  spec: string;
  /** Exact version the spec resolves to, when known (for the checks). */
  version?: string;
  source: VersionSource;
  /** Who else uses it, which matrix row, which registry rule. */
  detail: string;
}

export type CheckKind =
  'api' | 'engines' | 'peer' | 'family' | 'singleton' | 'lockstep' | 'group' | 'major';

export interface AddCheck {
  kind: CheckKind;
  severity: 'error' | 'warning';
  message: string;
  /** What to do instead, one line. */
  suggestion?: string;
  /** Evidence and steps, one per line (API breaks: the places that use the API, then the steps). */
  lines?: string[];
}

export interface AddPlan {
  project: Project;
  name: string;
  section: DependencySection;
  choice: VersionChoice;
  checks: AddCheck[];
  /** Absent when the manifest already declares exactly this. */
  fix?: Fix;
}

export interface AddOptions {
  dev?: boolean;
  /** Pin registry picks to the exact version even when `policy.exactVersions` is false. */
  exact?: boolean;
  offline: boolean;
  fetchImpl?: typeof fetch;
  config: PackmanConfig;
}

interface Family {
  id: string;
  policy: 'same-version' | 'same-major';
  packages?: string[];
  prefix?: string;
  exclude?: string[];
  reason: string;
}

function declaredSpec(
  project: Project,
  name: string,
): { spec: string; section: DependencySection } | undefined {
  const dep = project.dependencies.find(
    (item) => item.name === name && item.section !== 'peerDependencies',
  );
  return dep ? { spec: dep.spec, section: dep.section } : undefined;
}

/** Most common value, ties broken by the highest minimum version, with the ids that use it. */
function mostCommon(
  entries: { id: string; spec: string }[],
): { spec: string; ids: string[] } | undefined {
  const byKey = new Map<string, string[]>();
  for (const entry of entries) byKey.set(entry.spec, [...(byKey.get(entry.spec) ?? []), entry.id]);
  const [best] = [...byKey.entries()].sort(
    ([a, idsA], [b, idsB]) =>
      idsB.length - idsA.length ||
      semver.rcompare(semver.coerce(b) ?? '0.0.0', semver.coerce(a) ?? '0.0.0'),
  );
  return best ? { spec: best[0], ids: best[1] } : undefined;
}

function exactOrCaret(version: string, options: AddOptions, forceExact: boolean): string {
  return forceExact || options.exact || options.config.policy.exactVersions
    ? version
    : `^${version}`;
}

function versionOfSpec(spec: string): string | undefined {
  return semver.valid(spec) ?? undefined;
}

/** SPFx matrix spec for packages the stack fixes: lockstep packages, compiler, PnP libraries. */
function spfxChoice(entry: ProjectReport, name: string): VersionChoice | undefined {
  const spfx = entry.stacks.find((stack) => stack.provider === 'spfx');
  if (!spfx?.version) return undefined;
  const row = findSpfxVersion(spfx.version);
  if (!row) return undefined;
  const { exact, buildTools } = spfxMatrix().lockstep;
  if (exact.includes(name))
    return {
      spec: row.version,
      version: row.version,
      source: 'spfx-matrix',
      detail: `SPFx ${row.version} runtime package (exact)`,
    };
  if (buildTools.includes(name)) {
    const version = row.buildToolsVersion ?? row.version;
    return {
      spec: version,
      version,
      source: 'spfx-matrix',
      detail: `SPFx ${row.version} build tools (exact)`,
    };
  }
  const library = libraryRangeFor(name, row.version);
  if (library)
    return {
      spec: library,
      source: 'spfx-matrix',
      detail: `PnP library line built for SPFx ${row.version}`,
    };
  return undefined;
}

/**
 * Highest non-prerelease version whose `engines.node` accepts the project's Node and whose peer
 * ranges are met by what the project already resolves; falls back to the highest in the range.
 */
function registryChoice(
  entry: ProjectReport,
  name: string,
  range: string | undefined,
  versions: Record<string, PackageVersionMetadata>,
  latest: string | undefined,
): { version: string; rule: string } | undefined {
  const node = entry.node.selected?.version;
  const candidates = Object.keys(versions)
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .filter((version) => !range || satisfies(version, range))
    .sort(semver.rcompare);
  const fits = (version: string): boolean => {
    const meta = versions[version] ?? {};
    if (node && meta.engines?.node && !satisfies(node, meta.engines.node)) return false;
    for (const [peer, peerRange] of Object.entries(meta.peerDependencies ?? {})) {
      const have = resolveVersion(entry.project, peer)?.version;
      if (have && !satisfies(have, peerRange)) return false;
    }
    return true;
  };
  if (!range && latest && candidates.includes(latest) && fits(latest))
    return { version: latest, rule: 'latest' };
  const compatible = candidates.find(fits);
  if (compatible)
    return { version: compatible, rule: 'highest compatible with Node and installed peers' };
  const highest = candidates[0];
  return highest
    ? { version: highest, rule: 'highest in range (compatibility unknown)' }
    : undefined;
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

function isSingleton(name: string): boolean {
  const { singletons } = loadData<{ singletons: string[] }>('families.json');
  return singletons.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

/** Plans one package for one project: the spec, where it came from and what speaks against it. */
export async function planAdd(
  report: Report,
  entries: ProjectReport[],
  requests: AddRequest[],
  options: AddOptions,
): Promise<AddPlan[]> {
  const names = [...new Set(requests.map((request) => request.name))];
  const packuments = await fetchPackuments(names, {
    offline: options.offline,
    metadata: true,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const plans: AddPlan[] = [];
  for (const entry of entries) {
    for (const request of requests) {
      const packument = packuments.get(request.name);
      const versions = packument?.versions ?? {};
      const choice = chooseVersion(
        report,
        entry,
        request,
        options,
        versions,
        packument?.['dist-tags']?.latest,
      );
      if (!choice) {
        plans.push({
          project: entry.project,
          name: request.name,
          section: options.dev ? 'devDependencies' : 'dependencies',
          choice: { spec: '?', source: 'registry', detail: 'no version found' },
          checks: [
            {
              kind: 'engines',
              severity: 'error',
              message: `no version of ${request.name} could be chosen${options.offline ? ' offline' : ''}`,
              suggestion: `pass an explicit version: packman add ${request.name}@<version>`,
            },
          ],
        });
        continue;
      }
      const declared = declaredSpec(entry.project, request.name);
      const section: DependencySection = options.dev
        ? 'devDependencies'
        : (declared?.section ?? 'dependencies');
      const meta = choice.version ? versions[choice.version] : undefined;
      const checks = checkChoice(report, entry, request.name, choice, meta);
      const plan: AddPlan = { project: entry.project, name: request.name, section, choice, checks };
      const edits: Edit[] = [];
      if (declared && declared.section !== section)
        edits.push(...removeDependency(entry.project, request.name));
      if (!declared || declared.section !== section || declared.spec !== choice.spec)
        edits.push({
          kind: 'json-set',
          file: entry.project.manifestPath,
          path: [section, request.name],
          value: choice.spec,
        });
      if (edits.length > 0)
        plan.fix = fix(
          `add/${request.name}`,
          msg('fix.addPackage', {
            name: request.name,
            version: choice.spec,
            project: entry.project.id,
          }),
          checks.some((check) => check.kind === 'major') ? 'breaking' : 'review',
          edits,
        );
      // A version edit across a documented API break (data/api-breaks.json) needs code changes.
      // `entry.apiUsage` holds the places only when the sources were scanned (the CLI scans the
      // selected projects); otherwise the evidence says so instead of claiming there are none.
      if (plan.fix)
        for (const crossed of fixCrossings(plan.fix, [entry])) {
          plan.fix.risk = 'breaking';
          const [head, ...places] = crossed.lines;
          checks.push({
            kind: 'api',
            severity: 'warning',
            message: head ?? crossed.crossing.break.title,
            lines: [
              ...places.map((place) => place.trim()),
              ...crossed.crossing.break.steps.map((step) => `-> ${step}`),
            ],
          });
        }
      plans.push(plan);
    }
  }
  return plans;
}

function chooseVersion(
  report: Report,
  entry: ProjectReport,
  request: AddRequest,
  options: AddOptions,
  versions: Record<string, PackageVersionMetadata>,
  latest: string | undefined,
): VersionChoice | undefined {
  const { name } = request;
  const { project } = entry;
  const resolveExact = (spec: string): string | undefined =>
    versionOfSpec(spec) ??
    (Object.keys(versions).length > 0 && isRegistrySpec(spec)
      ? (safeMax(Object.keys(versions), spec) ?? undefined)
      : undefined);
  if (request.range) {
    const choice: VersionChoice = {
      spec: request.range,
      source: 'request',
      detail: 'as requested',
    };
    const version = resolveExact(request.range);
    if (version) choice.version = version;
    return choice;
  }
  const group = report.groups.find((item) => item.projectIds.includes(project.id));
  const pinned = group?.pins[name];
  if (group && pinned)
    return { spec: pinned, version: pinned, source: 'pin', detail: `pin of group ${group.name}` };

  const others = (ids: string[]): { id: string; spec: string }[] =>
    report.projects
      .filter((item) => item.project.id !== project.id && ids.includes(item.project.id))
      .flatMap((item) => {
        const spec = declaredSpec(item.project, name)?.spec;
        return spec ? [{ id: item.project.id, spec }] : [];
      });
  const inGroup = group ? mostCommon(others(group.projectIds)) : undefined;
  if (inGroup) {
    const choice: VersionChoice = {
      spec: inGroup.spec,
      source: 'group',
      detail: `same as ${inGroup.ids.slice(0, 4).join(', ')}${inGroup.ids.length > 4 ? ', ...' : ''} (group ${group?.name ?? '?'})`,
    };
    const version = resolveExact(inGroup.spec);
    if (version) choice.version = version;
    return choice;
  }

  for (const [profileName, profile] of Object.entries(options.config.profiles)) {
    if (!picomatch(profile.projects)(project.id)) continue;
    const spec =
      profile.dependencies[name] ??
      profile.devDependencies[name] ??
      profile.conditionalDevDependencies[name];
    if (!spec) continue;
    const choice: VersionChoice = { spec, source: 'profile', detail: `profile ${profileName}` };
    const version = resolveExact(spec);
    if (version) choice.version = version;
    return choice;
  }

  const spfx = spfxChoice(entry, name);
  if (spfx) return spfx;

  const elsewhere = mostCommon(others(report.projects.map((item) => item.project.id)));
  if (elsewhere) {
    const choice: VersionChoice = {
      spec: elsewhere.spec,
      source: 'workspace',
      detail: `same as ${elsewhere.ids.slice(0, 4).join(', ')}${elsewhere.ids.length > 4 ? ', ...' : ''} (other groups)`,
    };
    const version = resolveExact(elsewhere.spec);
    if (version) choice.version = version;
    return choice;
  }

  const locked = project.lockfile?.packages.find((pkg) => pkg.name === name && isTopLevel(pkg));
  if (locked)
    return {
      spec: exactOrCaret(locked.version, options, false),
      version: locked.version,
      source: 'lockfile',
      detail: `already resolved as a dependency of other packages (${locked.version})`,
    };

  const picked = registryChoice(entry, name, undefined, versions, latest);
  if (picked)
    return {
      spec: exactOrCaret(picked.version, options, false),
      version: picked.version,
      source: 'registry',
      detail: `npm registry, ${picked.rule}`,
    };
  return undefined;
}

function safeMax(versions: string[], range: string): string | undefined {
  try {
    return semver.maxSatisfying(versions, range) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What speaks against adding `name` at `choice` to this project. Errors stop the write. */
export function checkChoice(
  report: Report,
  entry: ProjectReport,
  name: string,
  choice: VersionChoice,
  meta: PackageVersionMetadata | undefined,
): AddCheck[] {
  const { project } = entry;
  const checks: AddCheck[] = [];
  const version = choice.version;
  const node = entry.node.selected?.version;

  if (version && node && meta?.engines?.node && !satisfies(node, meta.engines.node))
    checks.push({
      kind: 'engines',
      severity: 'error',
      message: `${name}@${version} needs Node ${meta.engines.node}; the project runs on Node ${node}`,
      suggestion: 'pick an older version, or move the project to a group with a newer Node',
    });

  for (const [peer, range] of Object.entries(meta?.peerDependencies ?? {})) {
    const have = resolveVersion(project, peer)?.version;
    if (have && !satisfies(have, range))
      checks.push({
        kind: 'peer',
        severity: 'error',
        message: `${name}@${version ?? choice.spec} wants ${peer}@${range}, the project has ${peer} ${have}`,
        suggestion: `choose a version of ${name} built for ${peer} ${have}, or upgrade ${peer} in the whole group first (packman align --package ${peer})`,
      });
  }
  if (version) {
    for (const { locked, range } of peerRangesOn(project, name)) {
      if (!satisfies(version, range))
        checks.push({
          kind: 'peer',
          severity: 'error',
          message: `${locked.name}@${locked.version} wants ${name}@${range}; ${version} is outside`,
          suggestion: `use a version inside ${range}, or upgrade ${locked.name} first`,
        });
    }
  }

  const spfx = entry.stacks.find((stack) => stack.provider === 'spfx');
  const row = spfx?.version ? findSpfxVersion(spfx.version) : undefined;
  if (row && version) {
    const { exact, buildTools } = spfxMatrix().lockstep;
    const expected = exact.includes(name)
      ? row.version
      : buildTools.includes(name)
        ? (row.buildToolsVersion ?? row.version)
        : undefined;
    if (expected && (version !== expected || choice.spec !== expected))
      checks.push({
        kind: 'lockstep',
        severity: 'error',
        message: `${name} is an SPFx ${row.version} package and must be exactly ${expected}, not ${choice.spec}`,
        suggestion: `packman add ${name}@${expected}`,
      });
  }

  const families = loadData<{ families: Family[] }>('families.json').families;
  const declaredNames = project.dependencies
    .filter((dep) => dep.section !== 'peerDependencies' && dep.name !== name)
    .map((dep) => dep.name);
  if (version)
    for (const family of families) {
      if (familyMembers(family, [name]).length === 0) continue;
      for (const member of familyMembers(family, declaredNames)) {
        const have = resolveVersion(project, member)?.version;
        if (!have) continue;
        const same =
          family.policy === 'same-major'
            ? majorOf(have) === majorOf(version)
            : semver.eq(semver.coerce(have) ?? '0.0.0', semver.coerce(version) ?? '0.0.0');
        if (!same)
          checks.push({
            kind: 'family',
            severity: 'error',
            message: `${name}@${version} and ${member}@${have} must share the ${family.policy === 'same-major' ? 'same major' : 'same version'} (${family.reason})`,
            suggestion: `packman add ${name}@${family.policy === 'same-major' ? `^${majorOf(have) ?? '?'}` : have}`,
          });
      }
    }

  if (version && isSingleton(name)) {
    const copies = new Set(
      (project.lockfile?.packages ?? [])
        .filter((pkg) => pkg.name === name && !pkg.dev && pkg.version !== version)
        .map((pkg) => pkg.version),
    );
    if (copies.size > 0)
      checks.push({
        kind: 'singleton',
        severity: 'warning',
        message: `${name} must be a runtime singleton; the lockfile already has ${[...copies].join(', ')} (two copies break at runtime)`,
        suggestion: `use ${[...copies][0] ?? '?'} or upgrade the packages that bring the other copy`,
      });
  }

  const group = report.groups.find((item) => item.projectIds.includes(project.id));
  if (group && choice.source !== 'group') {
    const others = report.projects
      .filter(
        (item) => item.project.id !== project.id && group.projectIds.includes(item.project.id),
      )
      .flatMap((item) => {
        const spec = declaredSpec(item.project, name)?.spec;
        return spec && spec !== choice.spec ? [{ id: item.project.id, spec }] : [];
      });
    if (others.length > 0) {
      const linked = project.nodeModules === 'link';
      const list = others
        .slice(0, 4)
        .map((item) => `${item.id} (${item.spec})`)
        .join(', ');
      checks.push({
        kind: 'group',
        severity: linked ? 'error' : 'warning',
        message: linked
          ? `${name}@${choice.spec} differs from the group's ${list}: the shared store needs one spec per package, so the project would leave group ${group.name}`
          : `${name}@${choice.spec} differs from ${list} in group ${group.name}`,
        suggestion: linked
          ? `use the group's spec (packman add ${name}@${others[0]?.spec ?? '?'} -p ${project.id}), align the group (packman align --package ${name} --version ${choice.version ?? choice.spec}; then packman store link --of ${project.id} --union), or take the project out of the store (packman store unlink -p ${project.id} --restore)`
          : `packman align --package ${name} after adding, or use ${others[0]?.spec ?? '?'}`,
      });
      const majors = new Set(others.map((item) => majorOf(item.spec)));
      const major = majorOf(choice.version ?? choice.spec);
      if (
        major !== undefined &&
        [...majors].some((other) => other !== undefined && other !== major)
      )
        checks.push({
          kind: 'major',
          severity: 'warning',
          message: `${name} major ${major} differs from the group's major ${[...majors].filter((m) => m !== undefined).join('/')}`,
        });
    }
  }
  return checks;
}

export interface RemovalUse {
  name: string;
  /** `file` or `file: reason` places that still need the package. */
  places: string[];
}

/**
 * Where the project still uses each package it is about to drop: imports in sources (from the scan
 * when one was made), references in config files (`.eslintrc.js`, `tsconfig.json`) and tools implied
 * by config files or npm scripts. Removing such a package breaks the build or the tooling.
 */
export async function removalUsage(
  project: Project,
  names: string[],
  scan?: SourceScan,
): Promise<RemovalUse[]> {
  // Declared-by-section reasons do not show use; `implicitUsage` lists them for the unused check.
  const trivial = new Set(['type definitions', 'peerDependencies', 'optionalDependencies']);
  const implicit = await implicitUsage(project);
  const out: RemovalUse[] = [];
  for (const name of names) {
    const places: string[] = [];
    const imported = scan?.imports.get(name);
    if (imported) places.push(`imported in ${imported}`);
    const reason = implicit.reasons.get(name);
    if (reason && !trivial.has(reason)) places.push(reason);
    if (places.length > 0) out.push({ name, places });
  }
  return out;
}

/** Removes `names` from every section of the project; unknown names are reported. */
export function planRemove(project: Project, names: string[]): { fix?: Fix; missing: string[] } {
  const missing: string[] = [];
  const edits: Edit[] = [];
  for (const name of names) {
    const own = removeDependency(project, name).filter(
      (edit) => edit.kind === 'json-remove' && edit.path[0] !== 'peerDependencies',
    );
    if (own.length === 0) missing.push(name);
    edits.push(...own);
  }
  return {
    ...(edits.length > 0
      ? {
          fix: fix(
            'remove/packages',
            msg('fix.removePackages', {
              count: names.length - missing.length,
              project: project.id,
            }),
            'review',
            edits,
          ),
        }
      : {}),
    missing,
  };
}
