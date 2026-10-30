import { existsSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { ALWAYS_IGNORED_DIRS, type PackmanConfig } from './config.js';
import { readJsonFile } from './json.js';
import { readLockfile } from './lockfile.js';
import { mapLimit } from './concurrency.js';
import {
  DEPENDENCY_SECTIONS,
  type DeclaredDependency,
  type PackageManifest,
  type Project,
  type Workspace,
} from './types.js';

const IGNORED = new Set(ALWAYS_IGNORED_DIRS);

/** Marker file written by `packman store link` inside a per-package linked node_modules. */
export const STORE_MARKER = '.packman-store';

export interface DiscoveryOptions {
  config: PackmanConfig;
  /** Restrict to these project ids or globs (CLI `--project`). */
  only?: string[];
  /** Leave out these project ids or globs (CLI `--exclude`). */
  skip?: string[];
  /** Overrides `projects.maxDepth` (CLI `--depth`). */
  depth?: number;
}

export async function discoverWorkspace(
  root: string,
  options: DiscoveryOptions,
): Promise<Workspace> {
  const absRoot = path.resolve(root);
  const { include, exclude, maxDepth, includeRoot, requiredFiles, match } = options.config.projects;
  const isIncluded = picomatch(include, { dot: false });
  const isExcluded = exclude.length > 0 ? picomatch(exclude) : () => false;
  const isSelected = options.only?.length ? picomatch(options.only) : () => true;
  const isSkipped = options.skip?.length ? picomatch(options.skip) : () => false;
  const pattern = match ? new RegExp(match) : undefined;
  const hasRequired = (dir: string): boolean =>
    requiredFiles.every((name) => existsSync(path.join(dir, name)));

  const dirs: string[] = [];
  await walk(absRoot, 0, options.depth ?? maxDepth, dirs);

  // The root of a multi-project repository is usually an orchestrator and is skipped unless
  // configured; a repository with a single project at the root is always analyzed.
  const hasSubprojects = dirs.some((dir) => toProjectId(absRoot, dir) !== '.');
  const selected = dirs.filter((dir) => {
    const id = toProjectId(absRoot, dir);
    if (id === '.') {
      return (includeRoot || !hasSubprojects) && isSelected(id);
    }
    return (
      isIncluded(id) &&
      !isExcluded(id) &&
      isSelected(id) &&
      !isSkipped(id) &&
      (pattern?.test(id) ?? true) &&
      hasRequired(dir)
    );
  });

  const loaded = await mapLimit(selected, 8, (dir) => loadProject(absRoot, dir));
  const projects = loaded
    .filter((project): project is Project => project !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { root: absRoot, projects };
}

async function walk(dir: string, depth: number, maxDepth: number, out: string[]): Promise<void> {
  if (existsSync(path.join(dir, 'package.json'))) {
    out.push(dir);
  }
  if (depth >= maxDepth) {
    return;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    await walk(path.join(dir, entry.name), depth + 1, maxDepth, out);
  }
}

export async function loadProject(root: string, dir: string): Promise<Project | undefined> {
  const manifestPath = path.join(dir, 'package.json');
  const manifestResult = await readJsonFile(manifestPath);
  if (
    !manifestResult.ok ||
    typeof manifestResult.value !== 'object' ||
    manifestResult.value === null
  ) {
    return undefined;
  }
  const manifest = manifestResult.value as PackageManifest;
  const id = toProjectId(root, dir);
  const dependencies = declaredDependencies(manifest);
  const nodeModules = await nodeModulesState(dir);
  const installed = nodeModules === 'absent' ? {} : await readInstalledVersions(dir, dependencies);

  const project: Project = {
    id,
    dir,
    relDir: id,
    name: manifest.name ?? path.basename(dir),
    manifestPath,
    manifest,
    dependencies,
    nodeModules,
    installed,
    isRoot: id === '.',
  };
  const lockfile = await readLockfile(dir);
  if (lockfile) {
    project.lockfile = lockfile;
  }
  return project;
}

export function declaredDependencies(manifest: PackageManifest): DeclaredDependency[] {
  const result: DeclaredDependency[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = manifest[section];
    if (!deps || typeof deps !== 'object') {
      continue;
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string') {
        result.push({ name, spec, section });
      }
    }
  }
  return result;
}

async function nodeModulesState(dir: string): Promise<Project['nodeModules']> {
  try {
    const stat = await lstat(path.join(dir, 'node_modules'));
    if (stat.isSymbolicLink()) return 'link';
    // A folder of per-package links created by `packman store link` counts as linked.
    return existsSync(path.join(dir, 'node_modules', STORE_MARKER)) ? 'link' : 'folder';
  } catch {
    return 'absent';
  }
}

async function readInstalledVersions(
  dir: string,
  dependencies: DeclaredDependency[],
): Promise<Record<string, string>> {
  const installed: Record<string, string> = {};
  const names = [...new Set(dependencies.map((dep) => dep.name))];
  await mapLimit(names, 16, async (name) => {
    const result = await readJsonFile<{ version?: string }>(
      path.join(dir, 'node_modules', name, 'package.json'),
    );
    if (result.ok && typeof result.value.version === 'string') {
      installed[name] = result.value.version;
    }
  });
  return installed;
}

export function toProjectId(root: string, dir: string): string {
  const rel = path.relative(root, dir);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}
