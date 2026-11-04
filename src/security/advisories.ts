import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import semver from 'semver';
import { packmanHome } from '../core/data.js';
import type { Project } from '../core/types.js';

const BULK_ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const CHUNK = 400;
const TTL_MS = 12 * 60 * 60 * 1000;

export interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  vulnerable_versions: string;
  cwe?: string[];
  cvss?: { score?: number; vectorString?: string };
}

export interface PackageVulnerability {
  name: string;
  version: string;
  advisories: Advisory[];
  /** True when the package is only installed for development/build. */
  devOnly: boolean;
  direct: boolean;
}

export interface AdvisoryStatus {
  checked: boolean;
  source: 'network' | 'cache' | 'none';
  error?: string;
  fetchedAt?: string;
}

interface CacheFile {
  fetchedAt: number;
  /** name -> advisories (all versions), as returned by the bulk endpoint. */
  advisories: Record<string, Advisory[]>;
  /** name@version keys that were included in the request. */
  keys: string[];
}

export function cacheDir(): string {
  return path.join(packmanHome(), 'cache');
}

/** name -> versions used anywhere in the workspace (lockfile, or installed when no lockfile). */
export function collectPackageVersions(projects: Project[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (name: string, version: string): void => {
    if (!semver.valid(version)) return;
    const set = result.get(name) ?? new Set<string>();
    set.add(version);
    result.set(name, set);
  };
  for (const project of projects) {
    if (project.lockfile && project.lockfile.packages.length > 0) {
      for (const pkg of project.lockfile.packages) add(pkg.name, pkg.version);
    } else {
      for (const [name, version] of Object.entries(project.installed)) add(name, version);
    }
  }
  return result;
}

export async function fetchAdvisories(
  packages: Map<string, Set<string>>,
  options: { offline: boolean; fetchImpl?: typeof fetch; cacheRoot?: string },
): Promise<{ advisories: Map<string, Advisory[]>; status: AdvisoryStatus }> {
  const keys = [...packages.entries()]
    .flatMap(([name, versions]) => [...versions].map((v) => `${name}@${v}`))
    .sort();
  // Switching workspaces must not replace the only offline snapshot of another package set.
  const key = createHash('sha256').update(JSON.stringify(keys)).digest('hex');
  const cacheFile = path.join(options.cacheRoot ?? cacheDir(), `advisories-${key}.json`);
  const cached = await readCache(cacheFile);
  const cacheCovers = cached !== undefined && keys.every((key) => cached.keys.includes(key));
  if (cached && cacheCovers && (options.offline || Date.now() - cached.fetchedAt < TTL_MS)) {
    return {
      advisories: new Map(Object.entries(cached.advisories)),
      status: {
        checked: true,
        source: 'cache',
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
      },
    };
  }
  if (options.offline) {
    return { advisories: new Map(), status: { checked: false, source: 'none', error: 'offline' } };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const merged: Record<string, Advisory[]> = {};
  const entries = [...packages.entries()];
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const body = Object.fromEntries(
        entries.slice(i, i + CHUNK).map(([name, versions]) => [name, [...versions]]),
      );
      const response = await fetchImpl(BULK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      Object.assign(merged, (await response.json()) as Record<string, Advisory[]>);
    }
  } catch (error) {
    return {
      advisories: new Map(),
      status: { checked: false, source: 'none', error: (error as Error).message },
    };
  }
  const now = Date.now();
  await writeCache(cacheFile, { fetchedAt: now, advisories: merged, keys });
  return {
    advisories: new Map(Object.entries(merged)),
    status: { checked: true, source: 'network', fetchedAt: new Date(now).toISOString() },
  };
}

/** Vulnerable packages of one project, using its own resolved versions. */
export function projectVulnerabilities(
  project: Project,
  advisories: Map<string, Advisory[]>,
): PackageVulnerability[] {
  const declared = new Set(project.dependencies.map((dep) => dep.name));
  const seen = new Map<string, PackageVulnerability>();
  const result: PackageVulnerability[] = [];
  const consider = (name: string, version: string, dev: boolean): void => {
    const key = `${name}@${version}`;
    const previous = seen.get(key);
    if (previous) {
      previous.devOnly = previous.devOnly && dev;
      return;
    }
    const matching = (advisories.get(name) ?? []).filter((advisory) => {
      try {
        return semver.satisfies(version, advisory.vulnerable_versions);
      } catch {
        return false;
      }
    });
    if (matching.length > 0) {
      const vulnerability = {
        name,
        version,
        advisories: matching,
        devOnly: dev,
        direct: declared.has(name),
      };
      seen.set(key, vulnerability);
      result.push(vulnerability);
    }
  };
  if (project.lockfile && project.lockfile.packages.length > 0) {
    for (const pkg of project.lockfile.packages) consider(pkg.name, pkg.version, pkg.dev);
  } else {
    for (const [name, version] of Object.entries(project.installed)) {
      const section = project.dependencies.find((dep) => dep.name === name)?.section;
      consider(name, version, section === 'devDependencies');
    }
  }
  return result;
}

async function readCache(file: string): Promise<CacheFile | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as CacheFile;
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, data: CacheFile): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  } catch {
    // Cache is an optimization; failures are not fatal.
  }
}
