import semver from 'semver';
import { isTopLevel } from './lockfile.js';
import type { Project } from './types.js';

export type VersionSource = 'installed' | 'lockfile' | 'manifest';

export interface ResolvedVersion {
  version: string;
  source: VersionSource;
  spec?: string;
}

/** Specs that do not point to a registry version. */
const NON_REGISTRY = /^(?:file:|link:|git\+|git:|github:|https?:|workspace:|npm:|portal:|patch:)/;

export function isRegistrySpec(spec: string): boolean {
  return !NON_REGISTRY.test(spec.trim());
}

/** `1.2.3` is exact; `^1.2.3`, `~1.2.3`, `>=1`, `*`, `latest` are not. */
export function isExactSpec(spec: string): boolean {
  return semver.valid(spec.trim()) !== null;
}

export function hasPrerelease(spec: string): boolean {
  const min = minVersionOf(spec);
  return min !== undefined && semver.prerelease(min) !== null;
}

/** Lowest version a spec allows, or undefined for non-semver specs. */
export function minVersionOf(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (!isRegistrySpec(trimmed)) {
    return undefined;
  }
  if (semver.valid(trimmed)) {
    return semver.clean(trimmed) ?? trimmed;
  }
  try {
    return semver.minVersion(trimmed)?.version;
  } catch {
    return undefined;
  }
}

export function majorOf(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const parsed = semver.coerce(version);
  return parsed ? parsed.major : undefined;
}

/**
 * Version of a declared dependency, preferring what is actually on disk.
 * Undeclared (transitive) packages are not resolved: they do not define the project's stack.
 */
export function resolveVersion(project: Project, name: string): ResolvedVersion | undefined {
  const declared = project.dependencies.find((dep) => dep.name === name);
  if (!declared) return undefined;
  const installed = project.installed[name];
  if (installed) {
    return { version: installed, source: 'installed', spec: declared.spec };
  }
  const locked = project.lockfile?.packages.find((pkg) => pkg.name === name && isTopLevel(pkg));
  if (locked) {
    return { version: locked.version, source: 'lockfile', spec: declared.spec };
  }
  const min = minVersionOf(declared.spec);
  return min ? { version: min, source: 'manifest', spec: declared.spec } : undefined;
}

export function satisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

/** Compares two versions; non-semver values sort first. */
export function compareVersions(a: string, b: string): number {
  const va = semver.coerce(a, { includePrerelease: true });
  const vb = semver.coerce(b, { includePrerelease: true });
  if (!va || !vb) return va ? 1 : vb ? -1 : 0;
  return semver.compare(va, vb);
}
