import { readFileSync } from 'node:fs';

/** Bundled data files live in `<package>/data`, two levels above `src/core` and `dist/core`. */
const DATA_DIR = new URL('../../data/', import.meta.url);

const cache = new Map<string, unknown>();

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed loader for bundled JSON files
export function loadData<T>(name: string): T {
  const cached = cache.get(name);
  if (cached !== undefined) {
    return cached as T;
  }
  const value = JSON.parse(readFileSync(new URL(name, DATA_DIR), 'utf8')) as T;
  cache.set(name, value);
  return value;
}

/** Test hook: replace a data file with an in-memory value. */
export function overrideData(name: string, value: unknown): void {
  cache.set(name, value);
}
