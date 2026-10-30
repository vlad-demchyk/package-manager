import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { readJsonFile } from './json.js';
import type { LockedPackage, LockfileSummary } from './types.js';

interface NpmLockV2Entry {
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  deprecated?: string;
  engines?: Record<string, string> | string[];
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface NpmLockV1Entry {
  version?: string;
  dev?: boolean;
  requires?: Record<string, string>;
  dependencies?: Record<string, NpmLockV1Entry>;
}

interface NpmLock {
  lockfileVersion?: number;
  packages?: Record<string, NpmLockV2Entry>;
  dependencies?: Record<string, NpmLockV1Entry>;
}

/** Finds and summarizes the lockfile of a project directory. Returns undefined when none. */
export async function readLockfile(dir: string): Promise<LockfileSummary | undefined> {
  for (const name of ['npm-shrinkwrap.json', 'package-lock.json']) {
    const file = path.join(dir, name);
    if (existsSync(file)) {
      return readNpmLockfile(file);
    }
  }
  const yarn = path.join(dir, 'yarn.lock');
  if (existsSync(yarn)) {
    return { kind: 'yarn', path: yarn, rootSpecs: {}, packages: [] };
  }
  const pnpm = path.join(dir, 'pnpm-lock.yaml');
  if (existsSync(pnpm)) {
    return { kind: 'pnpm', path: pnpm, rootSpecs: {}, packages: [] };
  }
  return undefined;
}

export async function readNpmLockfile(file: string): Promise<LockfileSummary> {
  const raw = await readJsonFile<NpmLock>(file);
  if (!raw.ok) {
    return { kind: 'npm', path: file, rootSpecs: {}, packages: [] };
  }
  const lock = raw.value;
  const summary: LockfileSummary = { kind: 'npm', path: file, rootSpecs: {}, packages: [] };
  if (lock.lockfileVersion !== undefined) {
    summary.version = lock.lockfileVersion;
  }

  if (lock.packages) {
    summary.contentHash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.entries(lock.packages)
            .filter(([location]) => location !== '')
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      )
      .digest('hex');
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (location === '') {
        summary.rootSpecs = {
          ...entry.optionalDependencies,
          ...entry.devDependencies,
          ...entry.dependencies,
        };
        continue;
      }
      const name = packageNameFromLocation(location);
      if (!name || !entry.version || entry.link) {
        continue;
      }
      const pkg: LockedPackage = {
        name,
        version: entry.version,
        location,
        dev: Boolean(entry.dev ?? entry.devOptional),
      };
      if (entry.deprecated) pkg.deprecated = entry.deprecated;
      if (entry.engines && !Array.isArray(entry.engines)) pkg.engines = entry.engines;
      if (entry.peerDependencies) pkg.peerDependencies = entry.peerDependencies;
      const requires = [
        ...Object.keys(entry.dependencies ?? {}),
        ...Object.keys(entry.optionalDependencies ?? {}),
        ...Object.keys(entry.peerDependencies ?? {}),
      ];
      if (requires.length > 0) pkg.requires = requires;
      summary.packages.push(pkg);
    }
    return summary;
  }

  if (lock.dependencies) {
    walkV1(lock.dependencies, 'node_modules', summary.packages);
  }
  return summary;
}

function walkV1(deps: Record<string, NpmLockV1Entry>, base: string, out: LockedPackage[]): void {
  for (const [name, entry] of Object.entries(deps)) {
    const location = `${base}/${name}`;
    if (entry.version && !entry.version.startsWith('file:')) {
      const pkg: LockedPackage = {
        name,
        version: entry.version,
        location,
        dev: Boolean(entry.dev),
      };
      if (entry.requires) pkg.requires = Object.keys(entry.requires);
      out.push(pkg);
    }
    if (entry.dependencies) {
      walkV1(entry.dependencies, `${location}/node_modules`, out);
    }
  }
}

/** `node_modules/a/node_modules/@s/b` -> `@s/b`. */
export function packageNameFromLocation(location: string): string | undefined {
  const index = location.lastIndexOf('node_modules/');
  if (index === -1) {
    return undefined;
  }
  const rest = location.slice(index + 'node_modules/'.length);
  const parts = rest.split('/');
  if (parts[0]?.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  }
  return parts[0] || undefined;
}

/** Names required by any package of the lockfile: declaring one of them pins a transitive version. */
export function requiredByOthers(summary: LockfileSummary | undefined): Set<string> {
  const result = new Set<string>();
  for (const pkg of summary?.packages ?? [])
    for (const name of pkg.requires ?? []) result.add(name);
  return result;
}

/** True when the package sits directly in the project's node_modules (not nested). */
export function isTopLevel(pkg: LockedPackage): boolean {
  return pkg.location === `node_modules/${pkg.name}`;
}
