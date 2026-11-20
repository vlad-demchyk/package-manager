import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Report } from '../analyze.js';
import { readJsonFile } from '../core/json.js';
import { backupFiles } from '../fixes/apply.js';
import {
  linkGroup,
  readLinks,
  restoreLinks,
  type LinkOptions,
  type LinkRecord,
  type LinkResult,
} from './store.js';
import type { StoreGroup } from './store.js';

/** Files to restore when a step fails: which existed (copied into `dir`) and which did not. */
export interface Snapshot {
  root: string;
  dir: string;
  existed: string[];
  absent: string[];
}

/** Manifest and lockfile names a store switch can change in a project. */
const PROJECT_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.nvmrc'];

/** The files of these project directories that a switch can rewrite. */
export function projectFilesOf(dirs: string[]): string[] {
  return dirs.flatMap((dir) => PROJECT_FILES.map((name) => path.join(dir, name)));
}

/** Copies the files that exist and remembers the ones that do not, to restore both later. */
export async function takeSnapshot(root: string, files: string[], now?: Date): Promise<Snapshot> {
  const unique = [...new Set(files)];
  const existed = unique.filter((file) => existsSync(file));
  const absent = unique.filter((file) => !existsSync(file));
  const dir = await backupFiles(root, existed, now);
  return { root, dir, existed, absent };
}

/** Puts every snapshot file back and removes the files that did not exist when it was taken. */
export async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  for (const file of snapshot.existed) {
    const saved = path.join(snapshot.dir, path.relative(snapshot.root, file));
    if (existsSync(saved)) await copyFile(saved, file);
  }
  for (const file of snapshot.absent) await rm(file, { force: true });
}

export type SwitchPhase = 'prepare' | 'switch' | 'verify';

export interface SwitchOptions {
  install: LinkOptions['install'];
  seedLock?: Record<string, unknown>;
  /** Delete real node_modules folders of members that were not linked yet. */
  replaceExisting?: boolean;
  /** Builds the switched members; returns the ids whose build failed. */
  verify?: (projectIds: string[]) => Promise<string[]>;
  /** False keeps the switched state when the builds fail (default: roll back). */
  rollback?: boolean;
  /** Called when a phase starts, for progress output. */
  onPhase?: (phase: SwitchPhase | 'rollback') => void;
}

export interface SwitchResult {
  /**
   * `switched`: the members use the new store (and their builds passed when verified);
   * `rolled-back`: a phase failed and the previous links, manifests and locks are back;
   * `failed`: a phase failed and the state was kept (no previous links, or rollback disabled or
   * itself failed).
   */
  status: 'switched' | 'rolled-back' | 'failed';
  /** Phase that failed. */
  phase?: SwitchPhase;
  error?: string;
  link?: LinkResult;
  /** Members whose build failed in the verify phase. */
  failedBuilds?: string[];
  /** Why the rollback itself failed, when it did. */
  rollbackError?: string;
}

/**
 * Moves a group to the store its current manifests need, as one operation:
 * 1. prepare: install and check the new store; no project is touched, the old links keep working;
 * 2. switch: relink every member and write its lockfile from the store tree (no npm runs here);
 * 3. verify: run the members' build.
 * When a phase fails, the members that had links in `previous` get those links back (the old store
 * is never deleted, so no npm runs) and every file in `snapshot` (taken before the manifests were
 * edited) is restored: the group is in its previous working state again.
 */
export async function switchGroup(
  root: string,
  report: Report,
  group: StoreGroup,
  previous: LinkRecord[],
  snapshot: Snapshot,
  options: SwitchOptions,
): Promise<SwitchResult> {
  const linkOptions: LinkOptions = {
    install: options.install,
    replaceExisting: options.replaceExisting ?? false,
    syncLocks: group.mode === 'union',
    ...(options.seedLock ? { seedLock: options.seedLock } : {}),
  };
  const wasLinked = group.projectIds.filter((id) =>
    previous.some((record) => record.projectId === id),
  );
  const undo = async (
    phase: SwitchPhase,
    error: string,
    extra: Partial<SwitchResult> = {},
  ): Promise<SwitchResult> => {
    // Members that were not linked before had real folders, which a switch replaces: nothing to
    // go back to, the state is kept and reported.
    if (
      options.rollback === false ||
      (phase !== 'prepare' && wasLinked.length < group.projectIds.length)
    )
      return { status: 'failed', phase, error, ...extra };
    options.onPhase?.('rollback');
    try {
      if (phase !== 'prepare') await restoreLinks(root, previous, wasLinked);
      await restoreSnapshot(snapshot);
      return { status: 'rolled-back', phase, error, ...extra };
    } catch (rollbackError) {
      return {
        status: 'failed',
        phase,
        error,
        rollbackError:
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        ...extra,
      };
    }
  };

  options.onPhase?.('prepare');
  try {
    await linkGroup(root, report, group, { ...linkOptions, prepareOnly: true });
  } catch (error) {
    return undo('prepare', error instanceof Error ? error.message : String(error));
  }

  options.onPhase?.('switch');
  let link: LinkResult;
  try {
    link = await linkGroup(root, report, group, linkOptions);
  } catch (error) {
    return undo('switch', error instanceof Error ? error.message : String(error));
  }

  if (!options.verify) return kept(root, group, previous, wasLinked, snapshot, link);
  options.onPhase?.('verify');
  let failed: string[];
  try {
    failed = await options.verify(group.projectIds);
  } catch (error) {
    return undo('verify', error instanceof Error ? error.message : String(error), { link });
  }
  if (failed.length > 0)
    return undo('verify', `build failed: ${failed.join(', ')}`, { link, failedBuilds: failed });
  return kept(root, group, previous, wasLinked, snapshot, link);
}

async function kept(
  root: string,
  group: StoreGroup,
  previous: LinkRecord[],
  wasLinked: string[],
  snapshot: Snapshot,
  link: LinkResult,
): Promise<SwitchResult> {
  // Only a group that was linked before has links to go back to.
  if (wasLinked.length === group.projectIds.length)
    await recordSwitch(root, {
      at: new Date().toISOString(),
      projectIds: group.projectIds,
      storeDir: link.storeDir,
      previous: previous.filter((record) => wasLinked.includes(record.projectId)),
      snapshot,
      files: await fileHashes([...snapshot.existed, ...snapshot.absent]),
    });
  return { status: 'switched', link };
}

const SWITCHES_FILE = path.join('.packman', 'switches.json');
const KEEP_SWITCHES = 10;

/** A kept switch: what `store rollback` puts back (the links before it and the file snapshot). */
export interface SwitchRecord {
  at: string;
  projectIds: string[];
  /** Store the members were switched to. */
  storeDir: string;
  /** Link records of the members before the switch. */
  previous: LinkRecord[];
  snapshot: Snapshot;
  /** sha256 of every snapshot file right after the switch; absent files are ''. */
  files: Record<string, string>;
}

async function fileHashes(files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of [...new Set(files)])
    out[file] = existsSync(file)
      ? createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      : '';
  return out;
}

export async function readSwitches(root: string): Promise<SwitchRecord[]> {
  const result = await readJsonFile<SwitchRecord[]>(path.join(root, SWITCHES_FILE));
  return result.ok && Array.isArray(result.value) ? result.value : [];
}

async function writeSwitches(root: string, records: SwitchRecord[]): Promise<void> {
  await mkdir(path.join(root, '.packman'), { recursive: true });
  await writeFile(
    path.join(root, SWITCHES_FILE),
    `${JSON.stringify(records.slice(-KEEP_SWITCHES), null, 2)}
`,
    'utf8',
  );
}

async function recordSwitch(root: string, record: SwitchRecord): Promise<void> {
  await writeSwitches(root, [...(await readSwitches(root)), record]);
}

export interface RollbackPlan {
  record?: SwitchRecord;
  /** Why the last switch cannot be rolled back safely; empty when it can. */
  problems: string[];
}

/**
 * The last kept switch and whether it can be undone: the previous store still exists, every member
 * is still linked to the store it was switched to, and no snapshot file changed since the switch
 * (a later edit would be lost). Read-only.
 */
export async function planRollback(root: string): Promise<RollbackPlan> {
  const record = (await readSwitches(root)).at(-1);
  if (!record) return { problems: ['no store switch recorded'] };
  const problems: string[] = [];
  for (const target of new Set(record.previous.map((link) => link.target)))
    if (!existsSync(target))
      problems.push(`previous store is gone: ${path.relative(root, target)}`);
  const links = await readLinks(root);
  const switched = path.resolve(record.storeDir, 'node_modules');
  for (const id of record.projectIds) {
    const link = links.find((item) => item.projectId === id);
    if (!link || path.resolve(link.target) !== switched)
      problems.push(`${id} is no longer linked to ${path.relative(root, record.storeDir)}`);
  }
  const now = await fileHashes(Object.keys(record.files));
  for (const [file, hash] of Object.entries(record.files))
    if (now[file] !== hash) problems.push(`changed since the switch: ${path.relative(root, file)}`);
  return { record, problems };
}

/** Undoes the last kept switch when {@link planRollback} finds no problem; returns the plan. */
export async function rollbackLastSwitch(root: string): Promise<RollbackPlan> {
  const plan = await planRollback(root);
  if (!plan.record || plan.problems.length > 0) return plan;
  await restoreLinks(root, plan.record.previous, plan.record.projectIds);
  await restoreSnapshot(plan.record.snapshot);
  await writeSwitches(root, (await readSwitches(root)).slice(0, -1));
  return plan;
}
