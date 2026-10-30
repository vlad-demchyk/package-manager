import type { Project } from '../core/types.js';
import { readJsonFile } from '../core/json.js';
import { fetchPackuments, type PackageVersionMetadata } from '../ops/outdated.js';
import { packageNameFromLocation } from '../core/lockfile.js';
import semver from 'semver';

/** Follow the target config's actual dependency metadata, rather than stale generator dev pins. */
export async function lintRequirements(
  project: Project,
  configVersion: string,
  options: { offline: boolean; fetchImpl?: typeof fetch },
): Promise<Map<string, string> | undefined> {
  const raw =
    project.lockfile?.kind === 'npm'
      ? await readJsonFile<{
          packages?: Record<string, PackageVersionMetadata & { version?: string }>;
        }>(project.lockfile.path)
      : undefined;
  const locked = raw?.ok ? Object.entries(raw.value.packages ?? {}) : [];
  const metadata = async (
    name: string,
    range: string,
  ): Promise<{ version: string; meta: PackageVersionMetadata } | undefined> => {
    const existing = locked
      .filter(
        ([location, entry]) =>
          packageNameFromLocation(location) === name &&
          entry.version &&
          semver.satisfies(entry.version, range) &&
          entry.dependencies,
      )
      .sort(([, a], [, b]) => semver.rcompare(a.version ?? '0.0.0', b.version ?? '0.0.0'))[0];
    if (existing?.[1].version) return { version: existing[1].version, meta: existing[1] };
    const registry = await fetchPackuments([name], { ...options, metadata: true });
    const versions = registry.get(name)?.versions ?? {};
    const version = semver.maxSatisfying(
      Object.keys(versions).filter((value) => !versions[value]?.deprecated),
      range,
    );
    const meta = version ? versions[version] : undefined;
    return version && meta?.dependencies ? { version, meta } : undefined;
  };
  const config = await metadata('@microsoft/eslint-config-spfx', configVersion);
  if (!config) return undefined;
  const requirements = new Map<string, string>();
  const rushSpec = config.meta.dependencies?.['@rushstack/eslint-config'];
  if (rushSpec) {
    const rush = await metadata('@rushstack/eslint-config', rushSpec);
    if (!rush) return undefined;
    requirements.set('@rushstack/eslint-config', rush.version);
    for (const name of [
      '@typescript-eslint/parser',
      '@typescript-eslint/eslint-plugin',
      '@typescript-eslint/utils',
    ]) {
      const range = rush.meta.dependencies?.[name];
      if (range) requirements.set(name, range);
    }
  }
  const utils = config.meta.dependencies?.['@typescript-eslint/utils'];
  if (utils) requirements.set('@typescript-eslint/utils', utils);
  for (const [name, range] of requirements) {
    const candidates = locked
      .filter(
        ([location, entry]) =>
          packageNameFromLocation(location) === name &&
          entry.version &&
          semver.satisfies(entry.version, range),
      )
      .map(([, entry]) => entry.version as string);
    const version = semver.maxSatisfying(candidates, range);
    if (version) requirements.set(name, version);
  }
  return requirements;
}
