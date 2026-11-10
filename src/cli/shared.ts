import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { InvalidArgumentError, Option, type Command } from 'commander';
import pc from 'picocolors';
import type { Report } from '../analyze.js';
import type { Fix, Project, Risk } from '../core/types.js';
import {
  lockVersions,
  recordProjectVerified,
  recordStoreVerified,
  versionChanges,
} from '../core/verified.js';
import { runWithNode } from '../exec/run.js';
import { applyPreviews, collectEdits, lineDiff, previewEdits } from '../fixes/apply.js';
import { fixCrossings } from '../fixes/breaks.js';
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import {
  linkGroup,
  readLinks,
  type LinkResult,
  type StoreGroup,
  type StorePlan,
} from '../store/store.js';
import { readStoreVerified } from '../core/verified.js';
import { runAnalysis, type Session } from './context.js';

export const RISK_ORDER: Record<Risk, number> = { safe: 0, review: 1, breaking: 2 };

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'overrides',
];

/** `--lang`; commands apply it through a preAction hook on the program. */
export function langOption(): Option {
  return new Option('--lang <language>', 'output language').choices(['auto', 'en', 'it', 'uk']);
}

/** Commander parser for counts such as `--depth` and `--limit`: rejects `abc`, `-1` and `2.5`. */
export function nonNegativeInt(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new InvalidArgumentError(t('cli.notANumber', { value }));
  }
  return Number.parseInt(value, 10);
}

export function commonOptions(command: Command): Command {
  return command
    .argument('[path]', 'workspace root', '.')
    .option('-p, --project <globs...>', 'only these project ids or globs')
    .option('-x, --exclude <globs...>', 'leave out these project ids or globs')
    .option('--depth <n>', 'how deep to search for projects', nonNegativeInt)
    .addOption(langOption())
    .option('--offline', 'do not use the network (advisories from cache only)')
    .option('--no-security', 'skip the npm advisories lookup')
    .option('--no-usage', 'skip the source scan (undeclared/unused imports, network usage)');
}

export function progressReporter(silent: boolean): {
  onProgress?: (done: number, total: number, id: string) => void;
} {
  if (silent || !process.stderr.isTTY) return {};
  return {
    onProgress: (done, total, id) => {
      process.stderr.write(`\r\x1b[2K${pc.dim(`[${done + 1}/${total}] ${id}`)}`);
      if (done + 1 === total) process.stderr.write('\r\x1b[2K');
    },
  };
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return ['y', 'yes', 's', 'si', 'т', 'так'].includes(answer);
  } finally {
    rl.close();
  }
}

export interface ApplyOptions {
  apply?: boolean;
  yes?: boolean;
  /**
   * `npm install --package-lock-only` after writing: true relocks every changed project, false
   * never, undefined relocks the changed projects with an npm lockfile when versions were edited.
   */
  relock?: boolean | undefined;
  /** False when the caller already explained the API breaks the edits cross (`add` prints its checks). */
  apiNotes?: boolean;
  command: string;
}

/**
 * Shared flow of every command that edits files: print the diff, stop unless `--apply`,
 * confirm, write with backups, record the operation, optionally relock with the project's Node.
 */
export async function reviewAndApply(
  session: Session,
  report: Report,
  fixes: Fix[],
  options: ApplyOptions,
): Promise<boolean> {
  const previews = await previewEdits(collectEdits(fixes));
  if (previews.length === 0) {
    console.log(t('cli.noFixes'));
    return true;
  }
  for (const preview of previews) {
    console.log(
      pc.bold(path.relative(session.root, preview.file)) +
        (preview.deleted ? pc.red(' (delete)') : ''),
    );
    for (const line of lineDiff(preview.before, preview.after)) {
      console.log(
        line.startsWith('+') ? pc.green(line) : line.startsWith('-') ? pc.red(line) : pc.dim(line),
      );
    }
  }
  // Version edits crossing a documented API break: say which code must change before the build passes.
  const crossed =
    options.apiNotes === false ? [] : fixes.flatMap((item) => fixCrossings(item, report.projects));
  if (crossed.length > 0) {
    console.log(pc.yellow(t('api.fixBreaks', { count: crossed.length })));
    for (const entry of crossed)
      for (const line of entry.lines)
        console.log(
          pc.yellow(line.startsWith('  ') ? `    ${line}` : `  ${entry.projectId}: ${line}`),
        );
  }
  const projectsOf = (files: string[]): string[] =>
    report.projects
      .filter((entry) =>
        files.some(
          (file) =>
            path.dirname(file) === entry.project.dir ||
            file.startsWith(entry.project.dir + path.sep),
        ),
      )
      .map((entry) => entry.project.id);
  if (!options.apply) {
    console.log(pc.yellow(t('cli.dryRun')));
    return false;
  }
  const edits = collectEdits(fixes).length;
  if (
    !options.yes &&
    !(await confirm(t('cli.confirm', { count: edits, files: previews.length })))
  ) {
    console.log(t('cli.aborted'));
    await journal(session.root, {
      command: options.command,
      projects: projectsOf(previews.map((p) => p.file)),
      result: 'aborted',
    });
    return false;
  }
  const result = await applyPreviews(session.root, previews);
  console.log(
    pc.green(
      t('cli.applied', {
        count: result.files.length,
        dir: path.relative(session.root, result.backupDir),
      }),
    ),
  );
  await journal(session.root, {
    command: options.command,
    projects: projectsOf(result.files),
    files: result.files.map((file) => path.relative(session.root, file)),
    result: 'ok',
    detail: `backup ${path.relative(session.root, result.backupDir)}`,
  });
  // A linked project gets no relock and no npm: its store has to be rebuilt. Commands that do that
  // themselves (add, upgrade --shared) pass `relock: false`.
  if (options.relock !== false)
    for (const entry of report.projects)
      if (
        entry.project.nodeModules === 'link' &&
        result.files.some((file) => file.startsWith(entry.project.dir + path.sep))
      )
        console.log(
          pc.yellow(
            `${entry.project.id}: ${t('install.linkedStale', { project: entry.project.id })}`,
          ),
        );
  // A lockfile must follow the versions it locks: version edits relock by default (`--no-relock` opts
  // out); `--relock` also relocks projects whose other files changed or that had no lockfile yet.
  const versionEdits = collectEdits(fixes).some(
    (edit) =>
      'path' in edit &&
      path.basename(edit.file) === 'package.json' &&
      DEPENDENCY_FIELDS.includes(String(edit.path[0])),
  );
  if (options.relock ?? versionEdits) {
    // Pins, engines and stack versions may themselves have changed in these edits.
    const fresh = await runAnalysis(
      session,
      { security: false, usage: false },
      { targetVersions: true },
    );
    const changed = fresh.projects.filter(
      (entry) =>
        (options.relock === true || entry.project.lockfile?.kind === 'npm') &&
        (result.files.some((file) => file.startsWith(entry.project.dir + path.sep)) ||
          entry.node.requirements.some((requirement) => result.files.includes(requirement.file))),
    );
    const failures = await relock(
      session,
      changed.map((entry) => entry.project.id),
      fresh,
    );
    return failures === 0;
  }
  return true;
}

export interface BuildResult {
  project: Project;
  node: string;
  script: string;
  ok: boolean;
}

/**
 * After builds: every project that passed keeps its locked versions as its verified set, and a
 * shared store whose linked members all passed keeps its lockfile to seed the next store of the group.
 */
export async function recordVerifiedBuilds(root: string, results: BuildResult[]): Promise<void> {
  let projects = 0;
  for (const result of results) {
    const lock = result.project.lockfile;
    if (!result.ok || lock?.kind !== 'npm') continue;
    if (
      await recordProjectVerified(root, result.project.id, lock.path, {
        node: result.node,
        script: result.script,
      })
    )
      projects++;
  }
  const passed = new Set(results.filter((result) => result.ok).map((result) => result.project.id));
  const byStore = new Map<string, string[]>();
  for (const link of await readLinks(root))
    byStore.set(link.target, [...(byStore.get(link.target) ?? []), link.projectId]);
  let stores = 0;
  for (const [target, ids] of byStore) {
    const node = results.find((result) => ids.includes(result.project.id))?.node;
    if (!node || !ids.every((id) => passed.has(id))) continue;
    if (
      await recordStoreVerified(
        root,
        ids,
        path.join(path.dirname(target), 'package-lock.json'),
        node,
      )
    )
      stores++;
  }
  if (projects > 0) console.log(pc.green(t('verified.recorded', { projects, stores })));
}

/** `npm install --package-lock-only` with each project's Node (2.x "verifica rapida"). */
export async function relock(
  session: Session,
  projectIds: string[],
  report: Report,
): Promise<number> {
  let failures = 0;
  for (const entry of report.projects.filter((item) => projectIds.includes(item.project.id))) {
    if (entry.project.nodeModules === 'link') continue;
    if (!entry.node.selected) {
      console.error(
        `${entry.project.id}: ${t('node.notInstalled', { ranges: entry.node.effective.join(' & '), recommended: entry.node.recommended ?? '-' })}`,
      );
      failures++;
      await journal(session.root, {
        command: 'relock',
        projects: [entry.project.id],
        result: 'failed',
        detail: 'no compatible installed Node',
      });
      continue;
    }
    console.log(
      pc.bold(
        `\n> ${entry.project.id}: npm install --package-lock-only (node ${entry.node.selected.version})`,
      ),
    );
    const run = await runWithNode(entry.node.selected, entry.project.dir, [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    if (run.code !== 0) failures++;
    else await reportUnverified(entry.project);
    await journal(session.root, {
      command: 'relock',
      projects: [entry.project.id],
      result: run.code === 0 ? 'ok' : 'failed',
      detail: `exit ${run.code}`,
    });
  }
  if (failures > 0) process.exitCode = 1;
  return failures;
}

/**
 * The union group a linked project belongs to in `plan`; when it has none, prints why (a candidate
 * whose versions differ, an excluded project) with the options and sets the exit code to 1.
 */
export function linkedGroupOrExplain(plan: StorePlan, projectId: string): StoreGroup | undefined {
  const group = plan.groups.find((item) => item.projectIds.includes(projectId));
  if (group) return group;
  const candidate = plan.candidates.find((item) => item.projectIds.includes(projectId));
  const excluded = plan.excluded.find((item) => item.projectId === projectId);
  const reason = candidate
    ? `${candidate.reason}${candidate.packages ? `: ${candidate.packages.join(', ')}` : ''}`
    : (excluded?.reason ?? 'no other member shares its versions');
  console.error(pc.red(t('add.linkedNoGroup', { project: projectId, reason })));
  process.exitCode = 1;
  return undefined;
}

/**
 * Rebuilds a union group's store from its verified set (unless `refresh`), relinks every member and
 * writes their lockfiles from the store tree. npm runs only in the store directory, never in a
 * project. Prints major changes, peer gaps and unverified versions like `store link` does.
 */
export async function relinkGroup(
  session: Session,
  report: Report,
  group: StoreGroup,
  options: { refresh?: boolean; replaceExisting?: boolean; command: string },
): Promise<LinkResult> {
  const verified =
    group.mode === 'union' && !options.refresh
      ? await readStoreVerified(session.root, group.projectIds)
      : undefined;
  if (verified)
    console.log(pc.dim(t('store.seeded', { date: verified.at.slice(0, 10), node: verified.node })));
  const result = await linkGroup(session.root, report, group, {
    ...(verified ? { seedLock: verified.lock } : {}),
    replaceExisting: options.replaceExisting ?? false,
    syncLocks: group.mode === 'union',
    install: async (dir, node, mode) =>
      (
        await runWithNode(
          node,
          dir,
          mode === 'exact' ? ['ci'] : ['install', '--no-audit', '--no-fund'],
        )
      ).code,
  });
  for (const conflict of result.conflicts ?? []) console.log(pc.yellow(`  ~ ${conflict}`));
  if (result.peers?.length)
    console.log(pc.yellow(t('store.peers', { count: result.peers.length })));
  for (const peer of result.peers ?? []) console.log(pc.yellow(`    ${peer}`));
  for (const warning of result.lockWarnings ?? []) console.log(pc.yellow(`  ! ${warning}`));
  if (result.unverified?.length)
    console.log(pc.yellow(t('store.unverified', { count: result.unverified.length })));
  for (const line of result.unverified ?? []) console.log(pc.yellow(`    ${line}`));
  await journal(session.root, {
    command: options.command,
    projects: result.linked,
    result: 'ok',
    detail: `${path.relative(session.root, result.storeDir)}${result.conflicts?.length ? `, ${result.conflicts.length} major changes` : ''}${result.peers?.length ? `, ${result.peers.length} peer gaps` : ''}`,
  });
  console.log(
    pc.green(
      t('store.linked', {
        count: result.linked.length,
        dir: path.relative(session.root, result.storeDir),
      }),
    ),
  );
  for (const entry of result.trashed)
    console.log(
      pc.yellow(
        t('store.trashed', { project: entry.projectId, packages: entry.packages.join(', ') }),
      ),
    );
  return result;
}

/** `npm run <script>` in each project with its selected Node; passing projects get verified sets. */
export async function verifyProjects(
  session: Session,
  report: Report,
  projectIds: string[],
  script: string,
  command = 'store verify',
): Promise<BuildResult[]> {
  const results: BuildResult[] = [];
  for (const entry of report.projects.filter((item) => projectIds.includes(item.project.id))) {
    if (!entry.node.selected) {
      console.error(
        `${entry.project.id}: ${t('node.notInstalled', { ranges: entry.node.effective.join(' & '), recommended: entry.node.recommended ?? '-' })}`,
      );
      process.exitCode = 1;
      continue;
    }
    console.log(pc.bold(`\n> ${entry.project.id}: npm run ${script}`));
    const result = await runWithNode(entry.node.selected, entry.project.dir, ['run', script]);
    console.log(result.code === 0 ? pc.green('ok') : pc.red(`exit ${result.code}`));
    if (result.code !== 0) process.exitCode = result.code;
    await journal(session.root, {
      command,
      projects: [entry.project.id],
      result: result.code === 0 ? 'ok' : 'failed',
      detail: `npm run ${script} (node ${entry.node.selected.version}) exit ${result.code}`,
    });
    results.push({
      project: entry.project,
      node: entry.node.selected.version,
      script,
      ok: result.code === 0,
    });
  }
  await recordVerifiedBuilds(session.root, results);
  return results;
}

/** Prints the locked versions of a project that moved away from its verified set, if it has one. */
export async function reportUnverified(project: Project): Promise<void> {
  if (!project.verified || project.lockfile?.kind !== 'npm') return;
  const current = await lockVersions(project.lockfile.path);
  if (!current) return;
  const changes = versionChanges(project.verified.versions, current);
  if (changes.length === 0) return;
  console.log(pc.yellow(`${project.id}: ${t('store.unverified', { count: changes.length })}`));
  for (const line of changes.slice(0, 40)) console.log(pc.yellow(`    ${line}`));
  if (changes.length > 40) console.log(pc.dim(`    … +${changes.length - 40}`));
}
