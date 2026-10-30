import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';

export type NodeManager = 'nvm-windows' | 'nvm' | 'fnm' | 'volta' | 'current';

export interface InstalledNode {
  version: string;
  /** Absolute path to the node executable. */
  executable: string;
  manager: NodeManager;
}

const isWindows = process.platform === 'win32';
const nodeExe = isWindows ? 'node.exe' : 'node';

/**
 * Lists Node versions installed by known managers, without invoking them
 * (`nvm use` changes global state and may require elevation on Windows).
 */
export async function listInstalledNodes(env = process.env): Promise<InstalledNode[]> {
  const found: InstalledNode[] = [];
  const add = (version: string, executable: string, manager: NodeManager): void => {
    const clean = semver.clean(version);
    if (clean && existsSync(executable)) {
      found.push({ version: clean, executable, manager });
    }
  };

  if (env.NVM_HOME) {
    for (const name of await listDirs(env.NVM_HOME)) {
      add(name, path.join(env.NVM_HOME, name, nodeExe), 'nvm-windows');
    }
  }
  const nvmDir = env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  for (const name of await listDirs(path.join(nvmDir, 'versions', 'node'))) {
    add(name, path.join(nvmDir, 'versions', 'node', name, 'bin', 'node'), 'nvm');
  }
  for (const fnmDir of fnmDirs(env)) {
    const base = path.join(fnmDir, 'node-versions');
    for (const name of await listDirs(base)) {
      const install = path.join(base, name, 'installation');
      add(name, isWindows ? path.join(install, nodeExe) : path.join(install, 'bin', 'node'), 'fnm');
    }
  }
  const voltaHome =
    env.VOLTA_HOME ??
    (isWindows && env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'Volta')
      : path.join(os.homedir(), '.volta'));
  const voltaBase = path.join(voltaHome, 'tools', 'image', 'node');
  for (const name of await listDirs(voltaBase)) {
    add(
      name,
      isWindows ? path.join(voltaBase, name, nodeExe) : path.join(voltaBase, name, 'bin', 'node'),
      'volta',
    );
  }
  add(process.version, process.execPath, 'current');

  const unique = new Map<string, InstalledNode>();
  for (const node of found) {
    const key = path.resolve(node.executable).toLowerCase();
    if (!unique.has(key)) unique.set(key, node);
  }
  return [...unique.values()].sort((a, b) => semver.rcompare(a.version, b.version));
}

/** Highest installed Node satisfying every range. */
export function pickNode(installed: InstalledNode[], ranges: string[]): InstalledNode | undefined {
  return installed.find((node) =>
    ranges.every((range) => semver.satisfies(node.version, range, { includePrerelease: false })),
  );
}

/** Path of npm-cli.js shipped next to a Node executable, when present. */
export function npmCliFor(node: InstalledNode): string | undefined {
  const dir = path.dirname(node.executable);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function fnmDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = [env.FNM_DIR];
  if (isWindows && env.APPDATA) dirs.push(path.join(env.APPDATA, 'fnm'));
  dirs.push(path.join(os.homedir(), '.local', 'share', 'fnm'), path.join(os.homedir(), '.fnm'));
  return dirs.filter((dir): dir is string => Boolean(dir));
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
