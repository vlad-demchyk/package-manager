import { readFile } from 'node:fs/promises';
import semver from 'semver';
import type { ProjectReport } from '../analyze.js';
import { fix, msg, setDependency } from '../core/findings.js';
import { isTopLevel } from '../core/lockfile.js';
import type { ExposureContext, Fix, Message, Project, Risk } from '../core/types.js';
import { isExactSpec, resolveVersion, satisfies } from '../core/versions.js';
import { tm } from '../i18n/index.js';
import { fetchPackuments, type PackageVersionMetadata } from '../ops/outdated.js';
import { packageCompatibility } from '../policy/compat.js';
import { fetchAdvisories, type Advisory, type PackageVulnerability } from './advisories.js';

/**
 * How a vulnerable package can reach a patched version inside the project's stack:
 * - `relock`: every dependent's range already allows a patched version; an override pinned inside
 *   those ranges makes the relock pick it (a fresh install alone keeps the locked version).
 * - `direct`: bump the declared dependency.
 * - `parent`: bump the direct dependency that pulls it in, to a release that requires a patched one.
 * - `override`: npm `overrides` force a patched version outside a dependent's declared range.
 * - `blocked`: a patched version exists but the stack, a peer range or the lockfile kind forbids it.
 * - `no-fix`: no patched version is published.
 * - `unknown`: registry data unavailable (offline without cache).
 */
export type RemediationStatus =
  'relock' | 'direct' | 'parent' | 'override' | 'blocked' | 'no-fix' | 'unknown';

export interface RemediationChange {
  kind: 'dependency' | 'override';
  package: string;
  from: string;
  to: string;
  /** For overrides: the `overrides` key (`name@major`) the value is written under. */
  key?: string;
}

export interface Remediation {
  package: string;
  version: string;
  severity: Advisory['severity'];
  /** Where the vulnerable code runs: `build` for dev-only packages, else the project exposure. */
  context: ExposureContext;
  direct: boolean;
  /** Dependency chains from a declared dependency down to the package (root first, max 3). */
  chains: string[][];
  status: RemediationStatus;
  /** Lowest patched version that the plan reaches (or the first published one when blocked). */
  target?: string;
  changes: RemediationChange[];
  risk?: Risk;
  reason: Message;
  /** Ranges checked: dependents, stack constraints and peers (`source: range`). */
  constraints: string[];
  fixId?: string;
}

type Packument =
  Awaited<ReturnType<typeof fetchPackuments>> extends Map<string, infer P> ? P : never;

export interface RemediationData {
  packuments: Map<string, Packument>;
  /** Advisories of every published version of the vulnerable packages, when fetched. */
  advisories: Map<string, Advisory[]>;
}

interface GraphNode {
  location: string;
  name: string;
  version: string;
  dev: boolean;
  /** Dependency name -> declared range (undefined when the lockfile records names only). */
  deps: Map<string, string | undefined>;
}

interface Edge {
  from: string;
  range: string | undefined;
}

interface Graph {
  nodes: Map<string, GraphNode>;
  dependents: Map<string, Edge[]>;
}

const RISKS: Risk[] = ['safe', 'review', 'breaking'];
/** Scaffold packages the stack's build depends on exactly (a scaffold version elsewhere is advice). */
const STACK_TOOLS = /^(?:@microsoft\/|gulp$)/;
const SEVERITIES: Advisory['severity'][] = ['info', 'low', 'moderate', 'high', 'critical'];

/** Names of vulnerable packages and of the direct dependencies that pull them in. */
export async function remediationNames(
  entries: { entry: ProjectReport; vulns: PackageVulnerability[] }[],
): Promise<string[]> {
  const names = new Set<string>();
  for (const { entry, vulns } of entries) {
    if (vulns.length === 0) continue;
    const graph = await buildGraph(entry.project);
    for (const vuln of vulns) {
      names.add(vuln.name);
      for (const location of instancesOf(graph, vuln)) {
        for (const edge of graph.dependents.get(location) ?? []) {
          const node = graph.nodes.get(edge.from);
          if (node && isTopLevel(node)) names.add(node.name);
        }
      }
    }
  }
  return [...names].sort();
}

/**
 * Registry documents (versions with their dependencies) and the advisories of every newer version
 * of each vulnerable package, so "patched" means "no known advisory", not "outside one range".
 * Offline, only the caches are read; missing data leaves the packages `unknown`.
 */
export async function loadRemediationData(
  names: string[],
  vulnerable: Map<string, string[]>,
  options: { offline: boolean; fetchImpl?: typeof fetch },
): Promise<RemediationData> {
  const fetchOptions = {
    offline: options.offline,
    metadata: true,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const packuments = await fetchPackuments(names, fetchOptions);
  const query = new Map<string, Set<string>>();
  for (const [name, current] of vulnerable) {
    const lowest = [...current].sort(semver.compare)[0];
    const versions = stableVersions(packuments.get(name)).filter(
      (version) => !lowest || semver.gte(version, lowest),
    );
    if (versions.length > 0) query.set(name, new Set(versions));
  }
  const { advisories } =
    query.size > 0
      ? await fetchAdvisories(query, {
          offline: options.offline,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        })
      : { advisories: new Map<string, Advisory[]>() };
  return { packuments, advisories };
}

/** One remediation per vulnerable `name@version` of the project. */
export async function planRemediations(
  entry: ProjectReport,
  vulns: PackageVulnerability[],
  data: RemediationData,
): Promise<Remediation[]> {
  if (vulns.length === 0) return [];
  const graph = await buildGraph(entry.project);
  const result = vulns.map((vuln) => planOne(entry, graph, vuln, data));
  // Overrides share one key per package and major: the highest target serves every copy.
  const byKey = new Map<string, RemediationChange[]>();
  for (const item of result)
    for (const change of item.changes)
      if (change.kind === 'override' && change.key && semver.valid(change.to))
        byKey.set(change.key, [...(byKey.get(change.key) ?? []), change]);
  for (const changes of byKey.values()) {
    const top = changes.map((change) => change.to).sort(semver.rcompare)[0];
    if (top) for (const change of changes) change.to = top;
  }
  for (const item of result) {
    const fixed = remediationFix(entry.project, item);
    if (fixed) item.fixId = fixed.id;
  }
  return result;
}

/** The fix that applies a remediation (none for blocked, unpatched or unknown packages). */
export function remediationFix(project: Project, item: Remediation): Fix | undefined {
  if (item.changes.length === 0 || !item.risk) return undefined;
  const edits = item.changes.map((change) =>
    change.kind === 'override'
      ? {
          kind: 'json-set' as const,
          file: project.manifestPath,
          path: ['overrides', change.key ?? change.package],
          value: change.to,
        }
      : setDependency(project, change.package, specLike(project, change.package, change.to)),
  );
  return fix(
    `security/${item.package}`,
    msg('fix.securityRemediation', {
      package: `${item.package}@${item.version}`,
      target: item.target ?? '-',
      status: item.status,
    }),
    item.risk,
    edits,
  );
}

/** Evidence line for a remediation: status, target, the change and why. */
export function describeRemediation(item: Remediation): string[] {
  const changes = item.changes
    .map((change) =>
      change.kind === 'override'
        ? `overrides["${change.key ?? change.package}"] = ${change.to}`
        : `${change.package} ${change.from} -> ${change.to}`,
    )
    .join(', ');
  const head = `  plan [${item.status}${item.risk ? `, ${item.risk}` : ''}]${item.target ? ` ${item.package}@${item.target}` : ''}${changes ? `: ${changes}` : ''}`;
  const lines = [head, `    ${tm(item.reason)}`];
  const chain = item.chains[0];
  if (chain && chain.length > 1) lines.push(`    via ${chain.join(' > ')}`);
  return lines;
}

function planOne(
  entry: ProjectReport,
  graph: Graph,
  vuln: PackageVulnerability,
  data: RemediationData,
): Remediation {
  const { project } = entry;
  const locations = instancesOf(graph, vuln);
  const edges = locations.flatMap((location) => graph.dependents.get(location) ?? []);
  const base: Remediation = {
    package: vuln.name,
    version: vuln.version,
    severity: worstSeverity(vuln.advisories),
    context: vuln.devOnly ? 'build' : entry.exposure,
    direct: vuln.direct,
    chains: chainsTo(graph, locations),
    status: 'unknown',
    changes: [],
    reason: msg('remediation.unknown'),
    constraints: [],
  };
  const packument = data.packuments.get(vuln.name);
  const versions = stableVersions(packument);
  if (versions.length === 0) return base;

  const known = mergeAdvisories(vuln.advisories, data.advisories.get(vuln.name) ?? []);
  const patched = versions.filter(
    (version) =>
      semver.gt(version, vuln.version) &&
      !known.some((advisory) => satisfies(version, advisory.vulnerable_versions)),
  );
  if (patched.length === 0)
    return {
      ...base,
      status: 'no-fix',
      reason: msg('remediation.noFix', { package: vuln.name, version: vuln.version }),
    };
  const sameMajor = patched.filter((version) => sameLine(version, vuln.version));
  const preferred = sameMajor[0] ?? patched[0];
  if (!preferred) return base;

  const rangeOf = (edge: Edge): string | undefined =>
    edge.range ??
    dependencyRange(data.packuments, graph.nodes.get(edge.from), vuln.name) ??
    undefined;
  const rootEdges = edges.filter((edge) => edge.from === '');
  const transitive = edges.filter((edge) => edge.from !== '');
  const constraints = transitive.map(
    (edge) => `${label(graph, edge.from)}: ${rangeOf(edge) ?? '?'}`,
  );

  // Packages whose peer ranges would reject the patched version (ERESOLVE on install).
  const peerBlock = (target: string): string[] =>
    (project.lockfile?.packages ?? [])
      .filter((pkg) => {
        const range = pkg.peerDependencies?.[vuln.name];
        return range && satisfies(vuln.version, range) && !satisfies(target, range);
      })
      .map((pkg) => `${pkg.name}@${pkg.version} peer ${pkg.peerDependencies?.[vuln.name] ?? ''}`);

  const changes: RemediationChange[] = [];
  let risk: Risk = 'safe';
  let status: RemediationStatus = 'relock';
  let target = preferred;
  const blocked = (reason: Message, extra: string[] = []): Remediation => ({
    ...base,
    status: 'blocked',
    target: preferred,
    reason,
    constraints: [...constraints, ...extra],
  });

  // 1. A declared dependency: bump it within what the stack allows.
  if (rootEdges.length > 0 || (vuln.direct && transitive.length === 0)) {
    const report = packageCompatibility(entry, vuln.name, preferred);
    const rejected = [...report.constraints, ...report.peers].filter(
      (item) => item.target === false,
    );
    const checked = [...report.constraints, ...report.peers].map(
      (item) => `${item.source}: ${item.range}`,
    );
    if (rejected.length > 0)
      return blocked(
        msg('remediation.blockedDirect', {
          target: preferred,
          sources: rejected.map((item) => `${item.source} ${item.range}`).join('; '),
        }),
        checked,
      );
    changes.push({ kind: 'dependency', package: vuln.name, from: vuln.version, to: preferred });
    constraints.push(...checked);
    risk = maxRisk(risk, versionRisk(vuln.version, preferred));
    status = 'direct';
  }

  // 2. Transitive dependents: in range (relock), via a parent bump, or an override.
  const failing: Edge[] = [];
  const inRange: string[] = [];
  for (const edge of transitive) {
    const range = rangeOf(edge);
    const allowed = range ? patched.filter((version) => satisfies(version, range)) : [];
    if (allowed.length > 0) inRange.push(...allowed.filter((v) => !inRange.includes(v)));
    else failing.push(edge);
  }
  const unresolved: Edge[] = [];
  for (const edge of failing) {
    const node = graph.nodes.get(edge.from);
    const parent = node && isTopLevel(node) ? declared(project, node.name) : false;
    if (!node || !parent) {
      unresolved.push(edge);
      continue;
    }
    const bump = parentBump(entry, node, vuln.name, patched, data.packuments);
    if (bump.kind === 'ok') {
      if (!changes.some((change) => change.package === node.name))
        changes.push({ kind: 'dependency', package: node.name, from: node.version, to: bump.to });
      constraints.push(...bump.checked);
      risk = maxRisk(risk, versionRisk(node.version, bump.to));
      if (status === 'relock') status = 'parent';
    } else {
      constraints.push(...bump.checked);
      if (bump.reason) base.reason = bump.reason;
      unresolved.push(edge);
    }
  }

  if (unresolved.length > 0) {
    // npm only: yarn resolutions and pnpm overrides are not written by packman.
    if (project.lockfile?.kind !== 'npm')
      return blocked(
        msg('remediation.notNpm', { kind: project.lockfile?.kind ?? 'none', package: vuln.name }),
      );
    const pinned = stackPinnedRoot(entry, graph, unresolved);
    const overrideTarget = sameMajor[0];
    if (!overrideTarget) {
      const major = patched[0] ?? preferred;
      if (pinned)
        return blocked(
          msg('remediation.majorBlockedByStack', {
            target: major,
            root: pinned.root,
            source: pinned.source,
          }),
        );
    }
    target = overrideTarget ?? preferred;
    const peers = peerBlock(target);
    if (peers.length > 0)
      return blocked(msg('remediation.peerBlocked', { target, peers: peers.join('; ') }), peers);
    changes.push(overrideChange(project, vuln, target, changes));
    risk = maxRisk(risk, overrideTarget ? 'review' : 'breaking');
    status = 'override';
    const dependents = unresolved.map((edge) => label(graph, edge.from)).join(', ');
    const reason = pinned
      ? msg('remediation.overrideUnderStack', { root: pinned.root, source: pinned.source })
      : msg(overrideTarget ? 'remediation.override' : 'remediation.overrideMajor', {
          dependents,
          target,
        });
    return finish(base, { status, target, changes, risk, reason, constraints });
  }

  if (status === 'relock' && transitive.length === 0)
    // Nothing in the lockfile requires this copy (extraneous): no range to plan against.
    return finish(base, { reason: msg('remediation.noChain', { package: vuln.name }) });
  if (status === 'relock') {
    // Every dependent already allows a patched version: pin it so the relock moves to it.
    const common = patched.filter((version) =>
      transitive.every((edge) => {
        const range = rangeOf(edge);
        return range !== undefined && satisfies(version, range);
      }),
    );
    target = common.at(-1) ?? inRange[0] ?? preferred;
    if (project.lockfile?.kind !== 'npm' || common.length === 0)
      return finish(base, {
        status,
        target,
        changes: [],
        reason: msg('remediation.relockManual', { package: vuln.name, target }),
        constraints,
      });
    const peers = peerBlock(target);
    if (peers.length > 0)
      return blocked(msg('remediation.peerBlocked', { target, peers: peers.join('; ') }), peers);
    changes.push(overrideChange(project, vuln, target, changes));
    return finish(base, {
      status,
      target,
      changes,
      risk: 'safe',
      reason: msg('remediation.relock', { package: vuln.name, target }),
      constraints,
    });
  }
  const reason =
    status === 'direct'
      ? msg('remediation.direct', { package: vuln.name, target })
      : msg('remediation.parent', {
          parents: changes
            .filter((change) => change.package !== vuln.name)
            .map((change) => `${change.package} ${change.to}`)
            .join(', '),
        });
  return finish(base, { status, target, changes, risk, reason, constraints });
}

/**
 * Override of one release line (`name@2`), so other majors of the package keep their versions.
 * When the line also matches the declared spec, npm requires the value `$name` (the declared spec,
 * bumped by the same fix when the declared copy is vulnerable too).
 */
function overrideChange(
  project: Project,
  vuln: PackageVulnerability,
  target: string,
  planned: RemediationChange[],
): RemediationChange {
  const key = `${vuln.name}@${lineOf(vuln.version)}`;
  const spec = project.dependencies.find(
    (dep) => dep.name === vuln.name && dep.section !== 'peerDependencies',
  )?.spec;
  let clash: boolean;
  try {
    clash = spec !== undefined && semver.intersects(spec, lineOf(vuln.version));
  } catch {
    clash = false;
  }
  if (!clash) return { kind: 'override', package: vuln.name, from: vuln.version, to: target, key };
  // The declared copy must itself be patched for `$name` to help: bump it only when it is older.
  const declaredVersion = resolveVersion(project, vuln.name)?.version;
  if (
    declaredVersion &&
    semver.valid(declaredVersion) &&
    semver.lt(declaredVersion, target) &&
    !planned.some((change) => change.kind === 'dependency' && change.package === vuln.name)
  )
    planned.push({ kind: 'dependency', package: vuln.name, from: declaredVersion, to: target });
  return { kind: 'override', package: vuln.name, from: vuln.version, to: '$' + vuln.name, key };
}

function finish(base: Remediation, patch: Partial<Remediation>): Remediation {
  const result = { ...base, ...patch };
  if (patch.risk === undefined) delete result.risk;
  result.constraints = [...new Set(result.constraints)];
  return result;
}

function parentBump(
  entry: ProjectReport,
  node: GraphNode,
  name: string,
  patched: string[],
  packuments: Map<string, Packument>,
):
  | { kind: 'ok'; to: string; checked: string[] }
  | { kind: 'none'; checked: string[]; reason?: Message } {
  const versions = stableVersions(packuments.get(node.name)).filter((version) =>
    semver.gt(version, node.version),
  );
  const fixes = (version: string): boolean => {
    const meta = packuments.get(node.name)?.versions?.[version];
    const range = rangeIn(meta, name);
    return range === undefined || patched.some((candidate) => satisfies(candidate, range));
  };
  const candidates = [
    ...versions.filter((version) => sameLine(version, node.version)),
    ...versions.filter((version) => !sameLine(version, node.version)),
  ].filter(fixes);
  const to = candidates[0];
  if (!to) return { kind: 'none', checked: [] };
  const report = packageCompatibility(entry, node.name, to);
  const all = [...report.constraints, ...report.peers];
  const checked = all.map((item) => `${item.source}: ${item.range}`);
  const rejected = all.filter((item) => item.target === false);
  if (rejected.length === 0) return { kind: 'ok', to, checked };
  return {
    kind: 'none',
    checked,
    reason: msg('remediation.parentBlocked', {
      parent: `${node.name}@${to}`,
      sources: rejected.map((item) => `${item.source} ${item.range}`).join('; '),
    }),
  };
}

/** The declared dependency at the root of a chain whose version the stack pins exactly. */
function stackPinnedRoot(
  entry: ProjectReport,
  graph: Graph,
  edges: Edge[],
): { root: string; source: string } | undefined {
  for (const edge of edges) {
    for (const chain of chainsTo(graph, [edge.from])) {
      const root = chain[0];
      if (!root) continue;
      const name = root.slice(0, root.lastIndexOf('@'));
      const pin = stackPin(entry, name);
      if (pin) return { root, source: pin };
    }
  }
  return undefined;
}

const pins = new WeakMap<ProjectReport, Map<string, string | undefined>>();

/** Exact version the stack pins a declared package to (`SPFx 1.21.1 build tools 1.21.1`), memoized. */
function stackPin(entry: ProjectReport, name: string): string | undefined {
  const known = pins.get(entry) ?? new Map<string, string | undefined>();
  pins.set(entry, known);
  if (known.has(name)) return known.get(name);
  const pin = packageCompatibility(entry, name).constraints.find(
    (item) =>
      semver.valid(item.range) !== null &&
      (!item.source.endsWith(' scaffold') || STACK_TOOLS.test(name)),
  );
  const value = pin ? `${pin.source} ${pin.range}` : undefined;
  known.set(name, value);
  return value;
}

async function buildGraph(project: Project): Promise<Graph> {
  const nodes = new Map<string, GraphNode>();
  const ranges = await lockRanges(project);
  for (const pkg of project.lockfile?.packages ?? []) {
    const recorded = ranges.get(pkg.location);
    const deps = new Map<string, string | undefined>();
    for (const name of pkg.requires ?? []) deps.set(name, recorded?.[name]);
    nodes.set(pkg.location, {
      location: pkg.location,
      name: pkg.name,
      version: pkg.version,
      dev: pkg.dev,
      deps,
    });
  }
  const root: GraphNode = {
    location: '',
    name: project.name,
    version: '',
    dev: false,
    deps: new Map(),
  };
  for (const dep of project.dependencies)
    if (dep.section !== 'peerDependencies') root.deps.set(dep.name, dep.spec);
  nodes.set('', root);
  const dependents = new Map<string, Edge[]>();
  for (const node of nodes.values()) {
    for (const [name, range] of node.deps) {
      const target = resolveFrom(nodes, node.location, name);
      if (!target) continue;
      dependents.set(target, [...(dependents.get(target) ?? []), { from: node.location, range }]);
    }
  }
  return { nodes, dependents };
}

/** Declared ranges per lockfile location (npm lockfile v2/v3 records them; others do not). */
async function lockRanges(project: Project): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (project.lockfile?.kind !== 'npm') return result;
  try {
    const raw = JSON.parse(await readFile(project.lockfile.path, 'utf8')) as {
      packages?: Record<
        string,
        {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
          peerDependencies?: Record<string, string>;
        }
      >;
    };
    for (const [location, entry] of Object.entries(raw.packages ?? {}))
      result.set(location, {
        ...entry.peerDependencies,
        ...entry.optionalDependencies,
        ...entry.dependencies,
      });
  } catch {
    // Without ranges the registry metadata of each parent version is used.
  }
  return result;
}

/** Node's module resolution over lockfile locations: nearest `node_modules/<name>` upwards. */
function resolveFrom(
  nodes: Map<string, GraphNode>,
  from: string,
  name: string,
): string | undefined {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (nodes.has(candidate)) return candidate;
    if (!base) return undefined;
    const index = base.lastIndexOf('/node_modules/');
    base = index === -1 ? '' : base.slice(0, index);
  }
}

function instancesOf(graph: Graph, vuln: PackageVulnerability): string[] {
  return (
    [...graph.nodes.values()]
      .filter(
        (node) => node.location !== '' && node.name === vuln.name && node.version === vuln.version,
      )
      // Runtime copies first: their chain explains the browser/server context.
      .sort((a, b) => Number(a.dev) - Number(b.dev))
      .map((node) => node.location)
  );
}

/** Shortest chains from the project root to the given locations (root dependency first). */
function chainsTo(graph: Graph, locations: string[]): string[][] {
  const chains: string[][] = [];
  for (const location of locations) {
    const previous = new Map<string, string>([[location, location]]);
    const queue = [location];
    let found: string | undefined;
    while (queue.length > 0 && found === undefined) {
      const current = queue.shift() ?? '';
      for (const edge of graph.dependents.get(current) ?? []) {
        if (previous.has(edge.from)) continue;
        previous.set(edge.from, current);
        if (edge.from === '') {
          found = current;
          break;
        }
        queue.push(edge.from);
      }
    }
    if (found === undefined) continue;
    const chain: string[] = [];
    for (let at: string = found; ;) {
      chain.push(label(graph, at));
      if (at === location) break;
      const next = previous.get(at);
      if (next === undefined || next === at) break;
      at = next;
    }
    if (!chains.some((known) => known.join('>') === chain.join('>'))) chains.push(chain);
    if (chains.length >= 3) break;
  }
  return chains;
}

function label(graph: Graph, location: string): string {
  const node = graph.nodes.get(location);
  return node ? `${node.name}@${node.version}` : location;
}

function dependencyRange(
  packuments: Map<string, Packument>,
  node: GraphNode | undefined,
  name: string,
): string | undefined {
  if (!node) return undefined;
  return rangeIn(packuments.get(node.name)?.versions?.[node.version], name);
}

function rangeIn(meta: PackageVersionMetadata | undefined, name: string): string | undefined {
  if (!meta) return undefined;
  const optional = (meta as { optionalDependencies?: Record<string, string> }).optionalDependencies;
  return meta.dependencies?.[name] ?? optional?.[name] ?? meta.peerDependencies?.[name];
}

function declared(project: Project, name: string): boolean {
  return project.dependencies.some(
    (dep) => dep.name === name && dep.section !== 'peerDependencies',
  );
}

function specLike(project: Project, name: string, version: string): string {
  const spec = project.dependencies.find((dep) => dep.name === name)?.spec ?? version;
  if (isExactSpec(spec)) return version;
  if (spec.startsWith('~')) return `~${version}`;
  return `^${version}`;
}

function stableVersions(packument: Packument | undefined): string[] {
  const stable = Object.keys(packument?.versions ?? {})
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .sort(semver.compare);
  // Deprecated releases are avoided, unless the whole package is deprecated (request).
  const current = stable.filter((version) => !packument?.versions?.[version]?.deprecated);
  return current.length > 0 ? current : stable;
}

function mergeAdvisories(a: Advisory[], b: Advisory[]): Advisory[] {
  const seen = new Set<number>();
  return [...a, ...b].filter((advisory) => {
    if (seen.has(advisory.id)) return false;
    seen.add(advisory.id);
    return true;
  });
}

/** Same compatibility line: same major, or same minor below 1.0.0. */
function sameLine(a: string, b: string): boolean {
  return (
    semver.major(a) === semver.major(b) &&
    (semver.major(a) > 0 || semver.minor(a) === semver.minor(b))
  );
}

/** `overrides` key range for the line of a version: `2` or `0.4`. */
function lineOf(version: string): string {
  return semver.major(version) > 0 ? String(semver.major(version)) : `0.${semver.minor(version)}`;
}

function versionRisk(from: string, to: string): Risk {
  if (!sameLine(from, to)) return 'breaking';
  return semver.minor(from) === semver.minor(to) ? 'safe' : 'review';
}

function maxRisk(a: Risk, b: Risk): Risk {
  return RISKS.indexOf(a) >= RISKS.indexOf(b) ? a : b;
}

function worstSeverity(advisories: Advisory[]): Advisory['severity'] {
  return advisories.reduce<Advisory['severity']>(
    (acc, advisory) =>
      SEVERITIES.indexOf(advisory.severity) > SEVERITIES.indexOf(acc) ? advisory.severity : acc,
    'info',
  );
}
