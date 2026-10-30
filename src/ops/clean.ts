import { existsSync } from 'node:fs';
import { lstat, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../core/types.js';
import { unlinkProjects } from '../store/store.js';

export type CleanKind = 'node_modules' | 'linked' | 'lockfile';

export interface CleanTarget {
  projectId: string;
  kind: CleanKind;
  path: string;
}

/** What `packman clean` would remove (2.x clean: lock only, or lock and node_modules). */
export function planClean(
  projects: Project[],
  options: { modules: boolean; lockfile: boolean },
): CleanTarget[] {
  const targets: CleanTarget[] = [];
  for (const project of projects) {
    if (options.modules && project.nodeModules !== 'absent') {
      targets.push({
        projectId: project.id,
        kind: project.nodeModules === 'link' ? 'linked' : 'node_modules',
        path: path.join(project.dir, 'node_modules'),
      });
    }
    if (options.lockfile && project.lockfile && existsSync(project.lockfile.path)) {
      targets.push({ projectId: project.id, kind: 'lockfile', path: project.lockfile.path });
    }
  }
  return targets;
}

/**
 * Removes the planned targets. Linked node_modules are only unlinked (the shared store stays);
 * real folders are deleted. Returns the removed paths.
 */
export async function executeClean(root: string, targets: CleanTarget[]): Promise<string[]> {
  const removed: string[] = [];
  const linked = targets
    .filter((target) => target.kind === 'linked')
    .map((target) => target.projectId);
  if (linked.length > 0) {
    const result = await unlinkProjects(root, linked, { restore: false });
    for (const id of result.unlinked) removed.push(path.join(root, id, 'node_modules'));
    for (const target of targets.filter((item) => item.kind === 'linked')) {
      const stat = await lstat(target.path).catch(() => undefined);
      if (stat?.isSymbolicLink()) {
        await unlink(target.path);
        removed.push(target.path);
      }
    }
  }
  for (const target of targets) {
    if (target.kind === 'linked') continue;
    await rm(target.path, {
      recursive: target.kind === 'node_modules',
      force: true,
      maxRetries: 3,
    });
    removed.push(target.path);
  }
  return removed;
}
