import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from './json.js';

/**
 * Version sets a build has proven to work. A project's set is the locked versions its build or
 * test script passed with; a store's set is the whole union lockfile all its members built with.
 * Later resolutions start from these sets, and anything that moves away from them is reported
 * as not verified until a build passes again.
 */
const VERIFIED_DIR = path.join('.packman', 'verified');

export interface VerifiedSet {
  /** ISO time of the passing build. */
  at: string;
  node: string;
  script: string;
  /** Lockfile location -> version, e.g. `node_modules/react` -> `17.0.1`. */
  versions: Record<string, string>;
}

interface StoreVerified {
  at: string;
  node: string;
  projectIds: string[];
  lock: { packages?: Record<string, unknown> } & Record<string, unknown>;
}

const projectFile = (root: string, projectId: string): string =>
  path.join(
    root,
    VERIFIED_DIR,
    'projects',
    `${projectId === '.' ? '_root' : projectId.replaceAll('/', '__')}.json`,
  );

const storeFile = (root: string, projectIds: string[]): string =>
  path.join(
    root,
    VERIFIED_DIR,
    'stores',
    `${createHash('sha256')
      .update([...projectIds].sort().join('\n'))
      .digest('hex')
      .slice(0, 16)}.json`,
  );

/** Location -> version of every package in an npm v2/v3 lockfile (the root entry excluded). */
export async function lockVersions(lockPath: string): Promise<Record<string, string> | undefined> {
  const lock = await readJsonFile<{
    packages?: Record<string, { version?: string; link?: boolean }>;
  }>(lockPath);
  if (!lock.ok || !lock.value.packages) return undefined;
  const versions: Record<string, string> = {};
  for (const [location, entry] of Object.entries(lock.value.packages))
    if (location && entry.version && !entry.link) versions[location] = entry.version;
  return versions;
}

export async function recordProjectVerified(
  root: string,
  projectId: string,
  lockPath: string,
  run: { node: string; script: string },
  now = new Date(),
): Promise<boolean> {
  const versions = await lockVersions(lockPath);
  if (!versions) return false;
  const set: VerifiedSet = { at: now.toISOString(), node: run.node, script: run.script, versions };
  await writeAtomic(projectFile(root, projectId), set);
  return true;
}

export async function readProjectVerified(
  root: string,
  projectId: string,
): Promise<VerifiedSet | undefined> {
  const set = await readJsonFile<VerifiedSet>(projectFile(root, projectId));
  return set.ok ? set.value : undefined;
}

/** Keeps the store lockfile all `projectIds` built with, to seed the next store of that group. */
export async function recordStoreVerified(
  root: string,
  projectIds: string[],
  storeLockPath: string,
  node: string,
  now = new Date(),
): Promise<boolean> {
  const lock = await readJsonFile<StoreVerified['lock']>(storeLockPath);
  if (!lock.ok) return false;
  const record: StoreVerified = {
    at: now.toISOString(),
    node,
    projectIds: [...projectIds].sort(),
    lock: lock.value,
  };
  await writeAtomic(storeFile(root, projectIds), record);
  return true;
}

export async function readStoreVerified(
  root: string,
  projectIds: string[],
): Promise<StoreVerified | undefined> {
  const record = await readJsonFile<StoreVerified>(storeFile(root, projectIds));
  return record.ok ? record.value : undefined;
}

/** `location: verified -> current`, `+location version` and `-location version` lines. */
export function versionChanges(
  verified: Record<string, string>,
  current: Record<string, string>,
): string[] {
  const changes: string[] = [];
  for (const [location, version] of Object.entries(current)) {
    const before = verified[location];
    if (before === undefined) changes.push(`+${location} ${version}`);
    else if (before !== version) changes.push(`${location}: ${before} -> ${version}`);
  }
  for (const [location, version] of Object.entries(verified))
    if (!(location in current)) changes.push(`-${location} ${version}`);
  return changes.sort((a, b) => a.replace(/^[+-]/, '').localeCompare(b.replace(/^[+-]/, '')));
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}
