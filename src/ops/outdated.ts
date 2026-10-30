import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { mapLimit } from '../core/concurrency.js';
import type { Project } from '../core/types.js';
import { isRegistrySpec, resolveVersion } from '../core/versions.js';
import { cacheDir } from '../security/advisories.js';

const REGISTRY = 'https://registry.npmjs.org/';
const TTL_MS = 12 * 60 * 60 * 1000;

export interface PackageVersionMetadata {
  deprecated?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}
interface Packument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, PackageVersionMetadata>;
}

export interface OutdatedRow {
  projectId: string;
  name: string;
  spec: string;
  current?: string;
  /** Highest version allowed by the declared spec. */
  wanted?: string;
  latest?: string;
  /** Highest version on the same major as current. */
  latestInMajor?: string;
  deprecated?: string;
}

export async function fetchPackuments(
  names: string[],
  options: { offline: boolean; fetchImpl?: typeof fetch; metadata?: boolean },
): Promise<Map<string, Packument>> {
  const dir = path.join(cacheDir(), 'packuments');
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  const result = new Map<string, Packument>();
  const fetchImpl = options.fetchImpl ?? fetch;
  await mapLimit(names, 8, async (name) => {
    const file = path.join(dir, `${encodeURIComponent(name)}.json`);
    const cached = await readFile(file, 'utf8')
      .then((text) => JSON.parse(text) as { at: number; data: Packument; metadata?: boolean })
      .catch(() => undefined);
    if (
      cached &&
      (options.offline ||
        ((!options.metadata || cached.metadata) && Date.now() - cached.at < TTL_MS))
    ) {
      result.set(name, cached.data);
      return;
    }
    if (options.offline) return;
    try {
      const response = await fetchImpl(`${REGISTRY}${name.replace('/', '%2f')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return;
      const data = (await response.json()) as Packument;
      const slim: Packument = { 'dist-tags': data['dist-tags'] ?? {}, versions: {} };
      for (const [version, meta] of Object.entries(data.versions ?? {})) {
        (slim.versions ??= {})[version] = options.metadata
          ? meta
          : meta.deprecated
            ? { deprecated: meta.deprecated }
            : {};
      }
      result.set(name, slim);
      await writeFile(
        file,
        JSON.stringify({ at: Date.now(), data: slim, metadata: options.metadata === true }),
      ).catch(() => undefined);
    } catch {
      // Network errors leave the package without registry data.
    }
  });
  return result;
}

export async function outdated(
  projects: Project[],
  options: { offline: boolean; fetchImpl?: typeof fetch; includeCurrent?: boolean },
): Promise<OutdatedRow[]> {
  const names = [
    ...new Set(
      projects.flatMap((project) =>
        project.dependencies.filter((dep) => isRegistrySpec(dep.spec)).map((dep) => dep.name),
      ),
    ),
  ];
  const packuments = await fetchPackuments(names, options);
  const rows: OutdatedRow[] = [];
  for (const project of projects) {
    for (const dep of project.dependencies) {
      if (dep.section === 'peerDependencies' || !isRegistrySpec(dep.spec)) continue;
      const packument = packuments.get(dep.name);
      if (!packument) continue;
      const versions = Object.keys(packument.versions ?? {}).filter(
        (version) => !semver.prerelease(version),
      );
      const latest = packument['dist-tags']?.latest;
      const current = resolveVersion(project, dep.name)?.version;
      const wanted = safeMax(versions, dep.spec);
      const major = current ? semver.coerce(current)?.major : undefined;
      const latestInMajor =
        major !== undefined ? safeMax(versions, `^${major}.0.0 || ${major}.x`) : undefined;
      const row: OutdatedRow = { projectId: project.id, name: dep.name, spec: dep.spec };
      if (current) row.current = current;
      if (wanted) row.wanted = wanted;
      if (latest) row.latest = latest;
      if (latestInMajor) row.latestInMajor = latestInMajor;
      const deprecated = current ? packument.versions?.[current]?.deprecated : undefined;
      if (deprecated) row.deprecated = deprecated;
      const valid = current ? semver.valid(current) : null;
      const behind =
        valid !== null &&
        ((latest !== undefined && semver.valid(latest) !== null && semver.lt(valid, latest)) ||
          (wanted !== undefined && semver.lt(valid, wanted)));
      if (behind || options.includeCurrent || deprecated) rows.push(row);
    }
  }
  return rows;
}

function safeMax(versions: string[], range: string): string | undefined {
  try {
    return semver.maxSatisfying(versions, range) ?? undefined;
  } catch {
    return undefined;
  }
}
