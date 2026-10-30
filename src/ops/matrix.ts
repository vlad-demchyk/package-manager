import picomatch from 'picomatch';
import semver from 'semver';
import type { DependencySection, Project } from '../core/types.js';
import { resolveVersion } from '../core/versions.js';

export interface MatrixCell {
  spec: string;
  section: DependencySection;
  /** Version actually used (installed, then lockfile, then lowest of the spec). */
  version?: string;
}

export interface MatrixRow {
  name: string;
  cells: Record<string, MatrixCell>;
  /** Distinct resolved versions (spec when unresolved). */
  versions: string[];
  diverging: boolean;
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
      };
      if (row.cells[project.id]) continue;
      const cell: MatrixCell = { spec: dep.spec, section: dep.section };
      const resolved = resolveVersion(project, dep.name)?.version;
      if (resolved) cell.version = resolved;
      row.cells[project.id] = cell;
      rows.set(dep.name, row);
    }
  }
  const result: MatrixRow[] = [];
  for (const row of rows.values()) {
    row.versions = [
      ...new Set(Object.values(row.cells).map((cell) => cell.version ?? cell.spec)),
    ].sort(compareLoose);
    row.diverging = row.versions.length > 1;
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

export function compareLoose(a: string, b: string): number {
  const va = semver.coerce(a, { includePrerelease: true });
  const vb = semver.coerce(b, { includePrerelease: true });
  if (va && vb) return semver.compare(va, vb);
  return a.localeCompare(b);
}
