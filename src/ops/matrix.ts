import picomatch from 'picomatch';
import semver from 'semver';
import type { DependencySection, Project } from '../core/types.js';
import { isTopLevel } from '../core/lockfile.js';
import { resolveVersion, satisfies, type VersionSource } from '../core/versions.js';

export interface MatrixCell {
  spec: string;
  section: DependencySection;
  /** Version actually used (installed, then lockfile, then lowest of the spec). */
  version?: string;
  /** Where `version` comes from. */
  versionSource?: VersionSource;
  /** Top-level lockfile version; absent without a lockfile or entry. */
  locked?: string;
  /** Version in node_modules; absent when not installed or when node_modules is missing. */
  installed?: string;
}

export type SummarySource = 'declared' | 'locked' | 'installed';

/** Latest and most common value of one source across the projects that declare the package. */
export interface SourceSummary {
  /** Projects that declare the package. */
  total: number;
  /** Projects where this source has a value. */
  count: number;
  /** Projects where the source cannot be read: no lockfile (locked), no node_modules (installed). */
  unknown: number;
  latest?: string;
  /** Ties go to the highest. */
  mostCommon?: { version: string; count: number };
}

export interface MatrixRow {
  name: string;
  cells: Record<string, MatrixCell>;
  /** Distinct resolved versions (spec when unresolved). */
  versions: string[];
  diverging: boolean;
  /** Declared specs, lockfile versions and installed versions summarized separately. */
  summary: Record<SummarySource, SourceSummary>;
  /** The most common declared spec and the most common locked version name different versions. */
  drift: boolean;
}

export interface VersionMatrix {
  projects: string[];
  rows: MatrixRow[];
}

/** Version of every declared package in every project (2.x "compare versions between all projects"). */
export function versionMatrix(
  projects: Project[],
  filter?: { packages?: string[]; divergingOnly?: boolean },
): VersionMatrix {
  const isWanted = filter?.packages?.length ? picomatch(filter.packages) : () => true;
  const rows = new Map<string, MatrixRow>();
  for (const project of projects) {
    for (const dep of project.dependencies) {
      if (dep.section === 'peerDependencies' || !isWanted(dep.name)) continue;
      const row = rows.get(dep.name) ?? {
        name: dep.name,
        cells: {},
        versions: [],
        diverging: false,
        summary: { declared: emptySummary(), locked: emptySummary(), installed: emptySummary() },
        drift: false,
      };
      if (row.cells[project.id]) continue;
      const cell: MatrixCell = { spec: dep.spec, section: dep.section };
      const resolved = resolveVersion(project, dep.name);
      if (resolved) {
        cell.version = resolved.version;
        cell.versionSource = resolved.source;
      }
      const locked = project.lockfile?.packages.find(
        (pkg) => pkg.name === dep.name && isTopLevel(pkg),
      )?.version;
      if (locked) cell.locked = locked;
      const installed = project.installed[dep.name];
      if (installed) cell.installed = installed;
      row.cells[project.id] = cell;
      const { summary } = row;
      for (const item of Object.values(summary)) item.total += 1;
      if (!project.lockfile) summary.locked.unknown += 1;
      // Without node_modules nothing is installed or not installed: the state is unknown.
      if (project.nodeModules === 'absent') summary.installed.unknown += 1;
      rows.set(dep.name, row);
    }
  }
  const result: MatrixRow[] = [];
  for (const row of rows.values()) {
    row.versions = [
      ...new Set(Object.values(row.cells).map((cell) => cell.version ?? cell.spec)),
    ].sort(compareLoose);
    row.diverging = row.versions.length > 1;
    const cells = Object.values(row.cells);
    summarize(
      row.summary.declared,
      cells.map((cell) => cell.spec),
    );
    summarize(
      row.summary.locked,
      cells.flatMap((cell) => (cell.locked ? [cell.locked] : [])),
    );
    summarize(
      row.summary.installed,
      cells.flatMap((cell) => (cell.installed ? [cell.installed] : [])),
    );
    const declared = row.summary.declared.mostCommon?.version;
    const locked = row.summary.locked.mostCommon?.version;
    // `^1.22.0` with 1.22.5 locked agrees; 1.22.0 declared with 1.7.0 locked does not.
    row.drift =
      declared !== undefined &&
      locked !== undefined &&
      (semver.validRange(declared)
        ? !satisfies(locked, declared)
        : semver.coerce(declared)?.version !== semver.coerce(locked)?.version);
    if (!filter?.divergingOnly || row.diverging) result.push(row);
  }
  result.sort(
    (a, b) =>
      Number(b.diverging) - Number(a.diverging) ||
      Object.keys(b.cells).length - Object.keys(a.cells).length ||
      a.name.localeCompare(b.name),
  );
  return { projects: projects.map((project) => project.id), rows: result };
}

function emptySummary(): SourceSummary {
  return { total: 0, count: 0, unknown: 0 };
}

function summarize(target: SourceSummary, values: string[]): void {
  target.count = values.length;
  if (values.length === 0) return;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.keys()].sort(compareLoose);
  const latest = sorted.at(-1);
  if (latest) target.latest = latest;
  const [best] = [...counts.entries()].sort(
    ([a, countA], [b, countB]) => countB - countA || compareLoose(b, a),
  );
  if (best) target.mostCommon = { version: best[0], count: best[1] };
}

export function compareLoose(a: string, b: string): number {
  const va = semver.coerce(a, { includePrerelease: true });
  const vb = semver.coerce(b, { includePrerelease: true });
  if (va && vb) return semver.compare(va, vb);
  return a.localeCompare(b);
}
