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
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import { readLinks } from '../store/store.js';
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
