import semver from 'semver';
import { fix, msg, setDependency } from '../core/findings.js';
import type { DependencySection, Edit, Fix, Project } from '../core/types.js';
import { minVersionOf, resolveVersion } from '../core/versions.js';
import { compareLoose } from './matrix.js';

export type DiffStatus = 'different' | 'onlyBase' | 'onlyTarget' | 'same';

export interface DiffRow {
  name: string;
  status: DiffStatus;
  baseSpec?: string;
  baseSection?: DependencySection;
  targetSpec?: string;
  targetSection?: DependencySection;
}

function declared(
  project: Project,
  name: string,
): { spec: string; section: DependencySection } | undefined {
  const dep = project.dependencies.find(
    (item) => item.name === name && item.section !== 'peerDependencies',
  );
  return dep ? { spec: dep.spec, section: dep.section } : undefined;
}

/** Package-by-package comparison of two projects (2.x `computeVersionDiff`). */
export function diffProjects(base: Project, target: Project): DiffRow[] {
  const names = new Set(
    [...base.dependencies, ...target.dependencies]
      .filter((dep) => dep.section !== 'peerDependencies')
      .map((dep) => dep.name),
  );
  const order: Record<DiffStatus, number> = { different: 0, onlyBase: 1, onlyTarget: 1, same: 2 };
  const rows: DiffRow[] = [];
  for (const name of names) {
    const a = declared(base, name);
    const b = declared(target, name);
    const status: DiffStatus = !a
      ? 'onlyTarget'
      : !b
        ? 'onlyBase'
        : a.spec === b.spec
          ? 'same'
          : 'different';
    const row: DiffRow = { name, status };
    if (a) {
      row.baseSpec = a.spec;
      row.baseSection = a.section;
    }
    if (b) {
      row.targetSpec = b.spec;
      row.targetSection = b.section;
    }
    rows.push(row);
  }
  return rows.sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));
}

/** Projects sharing the most packages at the same declared version with `base` (2.x alignment step 2). */
export function closestProjects(
  base: Project,
  projects: Project[],
): { project: Project; matches: number }[] {
  return projects
    .filter((project) => project.id !== base.id)
    .map((project) => ({
      project,
      matches: diffProjects(base, project).filter((row) => row.status === 'same').length,
    }))
    .filter((item) => item.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.project.id.localeCompare(b.project.id));
}

/** Copies the target's versions of differing packages into the base; `pin` drops range prefixes. */
export function alignToProject(
  base: Project,
  target: Project,
  options: { packages?: string[]; pin: boolean; includeMissing: boolean },
): Fix | undefined {
  const rows = diffProjects(base, target).filter(
    (row) =>
      (row.status === 'different' || (options.includeMissing && row.status === 'onlyTarget')) &&
      (!options.packages || options.packages.includes(row.name)),
  );
  const edits: Edit[] = rows.map((row) => {
    const spec = row.targetSpec ?? '';
    const value = options.pin ? (minVersionOf(spec) ?? spec) : spec;
    return setDependency(base, row.name, value, row.targetSection ?? 'dependencies');
  });
  if (edits.length === 0) return undefined;
  return fix(
    'align/project',
    msg('fix.alignToProject', { base: base.id, target: target.id }),
    'review',
    edits,
  );
}

/**
 * Sets one package to one version everywhere it is declared. Without `version`, uses the most common
 * resolved version, ties broken by the highest (2.x "align duplicate versions").
 */
export function alignPackage(
  projects: Project[],
  name: string,
  version?: string,
): { version: string; fix: Fix } | undefined {
  const users = projects.filter((project) => declared(project, name));
  if (users.length === 0) return undefined;
  let target = version;
  if (!target) {
    const counts = new Map<string, number>();
    for (const project of users) {
      const resolved =
        resolveVersion(project, name)?.version ?? declared(project, name)?.spec ?? '';
      counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
    }
    target = [...counts.entries()].sort(
      ([va, ca], [vb, cb]) => cb - ca || compareLoose(vb, va),
    )[0]?.[0];
  }
  if (!target) return undefined;
  const wanted = target;
  const edits = users
    .filter((project) => declared(project, name)?.spec !== wanted)
    .map((project) => setDependency(project, name, wanted));
  return {
    version: wanted,
    fix: fix(
      'align/package',
      msg('fix.alignGroup', { name, version: wanted }),
      majorChange(users, name, wanted) ? 'breaking' : 'review',
      edits,
    ),
  };
}

function majorChange(projects: Project[], name: string, version: string): boolean {
  const targetMajor = semver.coerce(version)?.major;
  return projects.some((project) => {
    const spec = declared(project, name)?.spec;
    const major = spec ? semver.coerce(spec)?.major : undefined;
    return major !== undefined && targetMajor !== undefined && major !== targetMajor;
  });
}
