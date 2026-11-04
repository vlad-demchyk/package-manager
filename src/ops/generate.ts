import type { ProfileConfig } from '../core/config.js';
import type { Project } from '../core/types.js';
import { resolveVersion } from '../core/versions.js';
import { compareLoose } from './matrix.js';

export type VersionStrategy = 'highest' | 'common';

export interface GenerateOptions {
  strategy: VersionStrategy;
  projectsGlob: string[];
  /** engines.node to set, usually the Node range of the group's stack. */
  nodeRange?: string;
  /** Use resolved versions (installed/lockfile) instead of declared specs. */
  resolved: boolean;
  /** tsconfig.json the profile enforces, read with {@link tsconfigForProfile}. */
  tsconfig?: Record<string, unknown>;
}

/** Keys of a tsconfig that only make sense for the project they come from. */
const PROJECT_LOCAL_TSCONFIG_KEYS = ['files', 'references'];

/**
 * Picks the project whose tsconfig.json becomes the profile's: an explicit project id, or
 * `latest-ts` for the project with the highest TypeScript (2.x `findLatestTypeScriptComponent`).
 */
export function tsconfigSource(projects: Project[], from: string): Project | undefined {
  if (from !== 'latest-ts') return projects.find((project) => project.id === from);
  return projects
    .map((project) => ({ project, version: resolveVersion(project, 'typescript')?.version }))
    .filter((entry): entry is { project: Project; version: string } => entry.version !== undefined)
    .sort((a, b) => compareLoose(a.version, b.version))
    .at(-1)?.project;
}

function tsconfigForProfile(tsconfig: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(tsconfig).filter(([key]) => !PROJECT_LOCAL_TSCONFIG_KEYS.includes(key)),
  );
}

/**
 * Builds a dependency profile from existing projects (2.x `generateDependenciesConfig`):
 * runtime packages go to `dependencies`, dev packages present everywhere to `devDependencies`,
 * dev packages present in some projects to `conditionalDevDependencies`. A package declared in both
 * sections goes where it is declared more often.
 */
export function generateProfile(projects: Project[], options: GenerateOptions): ProfileConfig {
  const usage = new Map<string, { runtime: string[]; dev: string[] }>();
  for (const project of projects) {
    for (const dep of project.dependencies) {
      if (dep.section === 'peerDependencies' || dep.section === 'optionalDependencies') continue;
      const entry = usage.get(dep.name) ?? { runtime: [], dev: [] };
      const version = options.resolved
        ? (resolveVersion(project, dep.name)?.version ?? dep.spec)
        : dep.spec;
      (dep.section === 'dependencies' ? entry.runtime : entry.dev).push(version);
      usage.set(dep.name, entry);
    }
  }

  const pickVersion = (versions: string[]): string => {
    if (options.strategy === 'highest') return [...versions].sort(compareLoose).at(-1) ?? '';
    const counts = new Map<string, number>();
    for (const version of versions) counts.set(version, (counts.get(version) ?? 0) + 1);
    return (
      [...counts.entries()].sort(([va, ca], [vb, cb]) => cb - ca || compareLoose(vb, va))[0]?.[0] ??
      ''
    );
  };

  const profile: ProfileConfig = {
    projects: options.projectsGlob,
    dependencies: {},
    devDependencies: {},
    conditionalDevDependencies: {},
    deprecated: [],
    scripts: {},
    engines: {},
    overrides: {},
    tsconfig: {},
  };
  for (const [name, { runtime, dev }] of [...usage.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const version = pickVersion([...runtime, ...dev]);
    if (runtime.length >= dev.length && runtime.length > 0) {
      profile.dependencies[name] = version;
    } else if (dev.length === projects.length) {
      profile.devDependencies[name] = version;
    } else {
      profile.conditionalDevDependencies[name] = version;
    }
  }
  if (options.nodeRange) profile.engines.node = options.nodeRange;
  if (options.tsconfig) profile.tsconfig = tsconfigForProfile(options.tsconfig);
  return profile;
}
