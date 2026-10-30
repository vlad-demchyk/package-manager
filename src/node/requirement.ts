import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import type { Project } from '../core/types.js';

export type NodePinSource =
  'devEngines' | '.nvmrc' | '.node-version' | '.tool-versions' | 'volta' | 'engines';

export interface NodeRequirement {
  /** Semver range the project accepts (intersection is evaluated by callers). */
  range: string;
  source: NodePinSource;
  file: string;
  /** True for explicit pins (.nvmrc, volta...), false for compatibility ranges (engines). */
  pinned: boolean;
}

/**
 * Collects every Node requirement declared for a project, closest first.
 * Pin files are searched from the project directory up to the workspace root, like nvm does.
 */
export async function readNodeRequirements(
  project: Project,
  workspaceRoot: string,
): Promise<NodeRequirement[]> {
  const result: NodeRequirement[] = [];
  const devEngines = devEnginesRange(project.manifest.devEngines);
  if (devEngines) {
    result.push({
      range: devEngines,
      source: 'devEngines',
      file: project.manifestPath,
      pinned: true,
    });
  }

  for (const dir of ancestors(project.dir, workspaceRoot)) {
    const nvmrc = await readPinFile(path.join(dir, '.nvmrc'));
    if (nvmrc) {
      result.push({ range: nvmrc, source: '.nvmrc', file: path.join(dir, '.nvmrc'), pinned: true });
      break;
    }
    const nodeVersion = await readPinFile(path.join(dir, '.node-version'));
    if (nodeVersion) {
      const file = path.join(dir, '.node-version');
      result.push({ range: nodeVersion, source: '.node-version', file, pinned: true });
      break;
    }
    const toolVersions = await readToolVersions(path.join(dir, '.tool-versions'));
    if (toolVersions) {
      const file = path.join(dir, '.tool-versions');
      result.push({ range: toolVersions, source: '.tool-versions', file, pinned: true });
      break;
    }
  }

  const volta = project.manifest.volta?.node;
  if (volta && semver.validRange(volta)) {
    result.push({ range: volta, source: 'volta', file: project.manifestPath, pinned: true });
  }
  const engines = project.manifest.engines?.node;
  if (engines && semver.validRange(engines)) {
    result.push({ range: engines, source: 'engines', file: project.manifestPath, pinned: false });
  }
  return result;
}

function devEnginesRange(devEngines: unknown): string | undefined {
  const entries = Array.isArray(devEngines)
    ? devEngines
    : devEngines && typeof devEngines === 'object' && 'runtime' in devEngines
      ? [devEngines.runtime].flat()
      : [];
  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const { name, version } = entry as { name?: unknown; version?: unknown };
      if (name === 'node' && typeof version === 'string' && semver.validRange(version)) {
        return version;
      }
    }
  }
  return undefined;
}

async function readPinFile(file: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const text = await readFile(file, 'utf8').catch(() => '');
  const line = text
    .split(/\r?\n/)
    .map((value) => value.replace(/#.*/, '').trim())
    .find(Boolean);
  if (!line) return undefined;
  const cleaned = line.replace(/^v/, '');
  // Aliases like `lts/*` or `node` cannot be evaluated offline; they are ignored.
  return semver.validRange(cleaned) ? cleaned : undefined;
}

async function readToolVersions(file: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const raw of text.split(/\r?\n/)) {
    const [tool, version] = raw.replace(/#.*/, '').trim().split(/\s+/);
    if ((tool === 'nodejs' || tool === 'node') && version && semver.validRange(version)) {
      return version;
    }
  }
  return undefined;
}

function* ancestors(dir: string, root: string): Generator<string> {
  let current = path.resolve(dir);
  const stop = path.resolve(root);
  for (;;) {
    yield current;
    if (current === stop) return;
    const parent = path.dirname(current);
    if (parent === current || !parent.startsWith(stop)) return;
    current = parent;
  }
}
