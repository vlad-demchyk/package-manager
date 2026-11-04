import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Bundled data files live in `<package>/data`, two levels above `src/core` and `dist/core`. */
const DATA_DIR = new URL('../../data/', import.meta.url);

/** Data files `packman data update` can refresh from machine-readable sources. */
export const UPDATABLE_DATA = ['node.json', 'node-vulns.json', 'frameworks.json'] as const;

const cache = new Map<string, unknown>();

/** Per-user packman folder: `%LOCALAPPDATA%\packman` on Windows, `~/.cache/packman` elsewhere. */
export function packmanHome(): string {
  const base =
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(os.homedir(), '.cache');
  return path.join(base, 'packman');
}

/** Where updated data files go; `PACKMAN_DATA_DIR=''` disables them (tests use bundled data). */
export function userDataDir(): string | undefined {
  const override = process.env.PACKMAN_DATA_DIR;
  if (override !== undefined) return override === '' ? undefined : override;
  return path.join(packmanHome(), 'data');
}

export function bundledDataPath(name: string): string {
  return fileURLToPath(new URL(name, DATA_DIR));
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed loader for bundled JSON files
export function loadData<T>(name: string): T {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached as T;
  }
  const bundled = JSON.parse(readFileSync(new URL(name, DATA_DIR), 'utf8')) as T;
  const value = newerUserData(name, bundled) ?? bundled;
  cache.set(name, value);
  return value;
}

/** An updated copy wins only when it is at least as recent as the bundled file. */
function newerUserData<T>(name: string, bundled: T): T | undefined {
  const dir = userDataDir();
  if (!dir || !(UPDATABLE_DATA as readonly string[]).includes(name)) return undefined;
  const file = path.join(dir, name);
  if (!existsSync(file)) return undefined;
  try {
    const user = JSON.parse(readFileSync(file, 'utf8')) as T;
    return fetchedAt(user) >= fetchedAt(bundled) ? user : undefined;
  } catch {
    return undefined;
  }
}

export function fetchedAt(value: unknown): string {
  const date = (value as { fetchedAt?: unknown } | null)?.fetchedAt;
  return typeof date === 'string' ? date : '';
}

/** Drops loaded data so the next {@link loadData} reads the files again. */
export function resetData(): void {
  cache.clear();
}
