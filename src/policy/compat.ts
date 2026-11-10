import picomatch from 'picomatch';
import semver from 'semver';
import type { ProjectReport } from '../analyze.js';
import { t } from '../i18n/index.js';
import { isTopLevel, peerRangesOn } from '../core/lockfile.js';
import type { DependencySection } from '../core/types.js';
import { minVersionOf, resolveVersion, satisfies, type VersionSource } from '../core/versions.js';
import { corePackages } from '../providers/spfx/core.js';
import {
  expectedCompiler,
  findSpfxVersion,
  libraryRangeFor,
  spfxMatrix,
} from '../providers/spfx/matrix.js';
import { apiBreaks, crossings, locationsOf, type ApiBreak } from '../scan/api-breaks.js';

export interface CompatConstraint {
  range: string;
  source: string;
  /** Whether the current version satisfies it; undefined when there is no current version. */
  current?: boolean;
  /** Whether the `--to` version satisfies it. */
  target?: boolean;
}

export interface CompatBreak {
  id: string;
  since: string;
  title: string;
  guide: string;
  verified: boolean;
  direction: 'upgrade' | 'downgrade';
  /** `file:line` places that use the API of the side being left. */
  places: string[];
  steps: string[];
}

export interface CompatReport {
  project: string;
  package: string;
  current?: { version: string; source: VersionSource; spec: string; section: DependencySection };
  target?: string;
  node?: string;
  /** Stack ranges for the package: SPFx matrix, framework matrix, scaffold, compiler. */
  constraints: CompatConstraint[];
  /** Peer ranges that installed direct dependencies place on the package. */
  peers: CompatConstraint[];
  /** The package's own `engines.node` (lockfile) against the project's selected Node. */
  engines?: CompatConstraint;
  /** Breaks between current and target, or every later break when no target is given. */
  breaks: CompatBreak[];
  /** Versions to pass through: current, each `since` crossed, target. */
  path: string[];
}

/**
 * The one project `compat` reports on: the only project of the workspace, or the one `-p` glob
 * picks. Several matches are an error that lists them, because the report is one package in one
 * project (a single JSON object), not a table across projects.
 */
export function pickProject(projects: ProjectReport[], globs: string[] | undefined): ProjectReport {
  const matched = globs?.length
    ? projects.filter((entry) => picomatch(globs)(entry.project.id))
    : projects;
  const [only] = matched;
  if (only && matched.length === 1) return only;
  throw new Error(
    t('compat.needProject', {
      count: matched.length,
      projects: matched.map((entry) => entry.project.id).join(', ') || '-',
    }),
  );
}

/** Everything packman knows about one package inside one project: ranges, peers, API breaks. */
export function packageCompatibility(
  entry: ProjectReport,
  name: string,
  to?: string,
): CompatReport {
  const { project } = entry;
  const resolved = resolveVersion(project, name);
  const declared = project.dependencies.find((dep) => dep.name === name);
  const target = to ? (semver.valid(to) ?? minVersionOf(to)) : undefined;
  const report: CompatReport = {
    project: project.id,
    package: name,
    constraints: [],
    peers: [],
    breaks: [],
    path: [],
  };
  if (resolved && declared)
    report.current = {
      version: resolved.version,
      source: resolved.source,
      spec: declared.spec,
      section: declared.section,
    };
  if (target) report.target = target;
  if (entry.node.selected) report.node = entry.node.selected.version;

  const judge = (range: string, source: string): CompatConstraint => {
    const item: CompatConstraint = { range, source };
    if (resolved) item.current = satisfies(resolved.version, range);
    if (target) item.target = satisfies(target, range);
    return item;
  };

  for (const constraint of entry.constraints)
    if (constraint.kind === 'package' && constraint.name === name)
      report.constraints.push(judge(constraint.range, constraint.source));
  report.constraints.push(...spfxConstraints(entry, name, judge));

  for (const { locked, range } of peerRangesOn(project, name))
    report.peers.push(judge(range, `${locked.name}@${locked.version}`));

  const own = project.lockfile?.packages.find((pkg) => pkg.name === name && isTopLevel(pkg));
  const engines = own?.engines?.node;
  if (engines && semver.validRange(engines)) {
    const item: CompatConstraint = {
      range: engines,
      source: `${name}@${own.version} engines.node`,
    };
    if (entry.node.selected) item.current = satisfies(entry.node.selected.version, engines);
    report.engines = item;
  }

  const describe = (item: ApiBreak, direction: CompatBreak['direction']): CompatBreak => ({
    id: item.id,
    since: item.since,
    title: item.title,
    guide: item.guide,
    verified: item.verified,
    direction,
    places: locationsOf(entry.apiUsage, direction === 'upgrade' ? item.old : item.new),
    steps: item.steps,
  });
  if (target) {
    const crossed = crossings(project, name, target, resolved?.version);
    report.breaks = crossed
      .sort((a, b) => semver.compare(a.break.since, b.break.since))
      .map((item) => describe(item.break, item.direction));
  } else if (resolved) {
    report.breaks = apiBreaks()
      .filter((item) => item.packages.includes(name) && semver.gt(item.since, resolved.version))
      .sort((a, b) => semver.compare(a.since, b.since))
      .map((item) => describe(item, 'upgrade'));
  }
  const steps = report.breaks.map((item) => item.since);
  report.path = [
    ...(resolved ? [resolved.version] : []),
    ...(report.breaks[0]?.direction === 'downgrade' ? steps.reverse() : steps),
    ...(target ? [target] : []),
  ].filter((version, index, all) => all.indexOf(version) === index);
  return report;
}

/** Ranges the SPFx matrix gives for the package: lockstep, scaffold, PnP libraries, PnPjs, TypeScript. */
function spfxConstraints(
  entry: ProjectReport,
  name: string,
  judge: (range: string, source: string) => CompatConstraint,
): CompatConstraint[] {
  const stack = entry.stacks.find((item) => item.provider === 'spfx');
  const spfx = stack?.version ? findSpfxVersion(stack.version) : undefined;
  if (!stack || !spfx) return [];
  const source = `SPFx ${spfx.version}`;
  const out: CompatConstraint[] = [];
  const { exact, buildTools } = spfxMatrix().lockstep;
  if (exact.includes(name)) out.push(judge(spfx.version, `${source} lockstep`));
  else if (buildTools.includes(name))
    out.push(judge(spfx.buildToolsVersion ?? spfx.version, `${source} build tools`));
  const library = libraryRangeFor(name, spfx.version);
  if (library) out.push(judge(library, `${source} (${name} line built for it)`));
  if (name === '@pnp/sp') {
    const row = spfxMatrix().pnpjs.find((item) => satisfies(spfx.version, item.spfx));
    if (row) out.push(judge(`^${row.major}.0.0`, `${source} recommended PnPjs major`));
  }
  const toolchain = stack.details.toolchain === 'heft' ? 'heft' : 'gulp';
  if (name === 'typescript') {
    const compiler = expectedCompiler(spfx, toolchain);
    const ts = compiler.compiler.startsWith('rush-stack-compiler-')
      ? spfxMatrix().compilers[compiler.compiler]?.typescript
      : compiler.typescript;
    if (ts)
      out.push(judge(/^\d+\.\d+$/.test(ts) ? `~${ts}.0` : ts, `${source} ${compiler.compiler}`));
  }
  if (!exact.includes(name) && !buildTools.includes(name)) {
    const scaffold = corePackages(
      spfx.version,
      toolchain,
      ['webpart', 'extension', 'applicationCustomizer'],
      true,
      true,
    ).find((pkg) => pkg.name === name);
    if (scaffold && scaffold.version !== spfx.version)
      out.push(judge(scaffold.version, `${source} scaffold`));
  }
  return out;
}
