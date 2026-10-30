import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type { Report } from '../analyze.js';
import type { Fix, Risk } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { applyPreviews, collectEdits, lineDiff, previewEdits } from '../fixes/apply.js';
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import type { Session } from './context.js';

export const RISK_ORDER: Record<Risk, number> = { safe: 0, review: 1, breaking: 2 };

/** `--lang`; commands apply it through a preAction hook on the program. */
export function langOption(): Option {
  return new Option('--lang <language>', 'output language').choices(['auto', 'en', 'it', 'uk']);
}

export function commonOptions(command: Command): Command {
  return command
    .argument('[path]', 'workspace root', '.')
    .option('-p, --project <globs...>', 'only these project ids or globs')
    .option('-x, --exclude <globs...>', 'leave out these project ids or globs')
    .option('--depth <n>', 'how deep to search for projects', (value) => Number.parseInt(value, 10))
    .addOption(
      new Option('--lang <language>', 'output language').choices(['auto', 'en', 'it', 'uk']),
    )
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
  /** Regenerate the lockfile of every changed project (`npm install --package-lock-only`). */
  relock?: boolean;
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
): Promise<void> {
  const previews = await previewEdits(collectEdits(fixes));
  if (previews.length === 0) {
    console.log(t('cli.noFixes'));
    return;
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
    return;
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
    return;
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
  if (options.relock) {
    const changed = report.projects.filter((entry) =>
      result.files.includes(entry.project.manifestPath),
    );
    await relock(
      session,
      changed.map((entry) => entry.project.id),
      report,
    );
  }
}

/** `npm install --package-lock-only` with each project's Node (2.x "verifica rapida"). */
export async function relock(
  session: Session,
  projectIds: string[],
  report: Report,
): Promise<number> {
  let failures = 0;
  for (const entry of report.projects.filter((item) => projectIds.includes(item.project.id))) {
    if (!entry.node.selected || entry.project.nodeModules === 'link') continue;
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
