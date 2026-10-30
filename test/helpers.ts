import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { InstalledNode } from '../src/node/toolchain.js';

export type FileTree = Record<string, string | object>;

/** Creates a temporary workspace from a `{ 'relative/path': content }` map. */
export async function makeWorkspace(
  files: FileTree,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'packman-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
      'utf8',
    );
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Minimal npm v3 lockfile for top-level packages. */
export function lockfile(
  name: string,
  specs: Record<string, string>,
  versions: Record<
    string,
    | string
    | {
        version: string;
        dev?: boolean;
        peerDependencies?: Record<string, string>;
        deprecated?: string;
      }
  >,
): object {
  const packages: Record<string, object> = { '': { name, version: '1.0.0', dependencies: specs } };
  for (const [location, value] of Object.entries(versions)) {
    const key = location.startsWith('node_modules/') ? location : `node_modules/${location}`;
    packages[key] = typeof value === 'string' ? { version: value } : value;
  }
  return { name, version: '1.0.0', lockfileVersion: 3, requires: true, packages };
}

export function fakeNodes(...versions: string[]): InstalledNode[] {
  return versions.map((version) => ({
    version,
    executable: `/fake/node-${version}/node`,
    manager: 'nvm-windows' as const,
  }));
}

export const TODAY = new Date('2026-10-30T12:00:00Z');
