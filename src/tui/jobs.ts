import path from 'node:path';
import pc from 'picocolors';
import type { ProjectReport, Report } from '../analyze.js';
import { applyAndInstall, scanTargets } from '../cli/add.js';
import { runAnalysis, type CommonOptions, type Session } from '../cli/context.js';
import { selectFixesBy, staleLinkedProjects, verifyProjects } from '../cli/shared.js';
import type { Fix, Severity } from '../core/types.js';
import { CANCEL_EXIT, withRunLimits } from '../exec/run.js';
import { collectEdits, previewEdits, type FilePreview } from '../fixes/apply.js';
import { t } from '../i18n/index.js';
import { parseRequest, planAdd, planRemove, removalUsage } from '../ops/add.js';
import { groupsToSwitch, runSync, type SyncStep } from '../ops/sync.js';
import { allFindings } from '../report/model.js';
import { planStore } from '../store/store.js';

/**
 * Managed operations of the TUI. Each one is previewed first (scope, checks, diff) without writing
 * anything, then runs on the same core as the CLI command (`add`, `remove`, `sync`, `store verify`)
 * after an explicit confirmation, with a signal that Esc or Ctrl+C aborts (npm runs are killed;
 * `sync` and store switches roll back as they do from the CLI).
 */
export type JobKind = 'add' | 'remove' | 'sync' | 'build';

export interface JobRequest {
  kind: JobKind;
  /** add, remove, build: the project the action is about. */
  projectId?: string;
  /** add: `name[@range]` list; remove: names. Space separated. */
  packages?: string;
}

export interface JobNote {
  tone: 'error' | 'warning' | 'info';
  text: string;
}

interface JobData {
  kind: JobKind;
  report: Report;
  targets: ProjectReport[];
  fixes: Fix[];
  ids: string[];
}

export interface JobPreview {
  kind: JobKind;
  title: string;
  /** What the run touches: projects, linked groups and their store, npm steps. */
  scope: string[];
  notes: JobNote[];
  previews: FilePreview[];
  /** An error check or nothing to do: the run cannot be confirmed. */
  blocked: boolean;
  data: JobData;
}

export interface JobResult {
  title: string;
  ok: boolean;
  cancelled: boolean;
  /** Process exit code the same CLI command would end with. */
  exitCode: number;
  steps: SyncStep[];
  /** Findings by severity and fixes still left after the run. */
  remaining: string;
}

export interface JobOptions extends CommonOptions {
  /** npm script of the build verification (default `build`). */
  script?: string;
}

const SEVERITIES: Severity[] = ['critical', 'error', 'warning', 'info'];

function linkedScope(report: Report, ids: string[]): string[] {
  const plan = planStore(report, { union: true });
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const entry of report.projects.filter((item) => ids.includes(item.project.id))) {
    if (entry.project.nodeModules !== 'link') {
      lines.push(
        t('tui.job.scopeInstall', {
          project: entry.project.id,
          node: entry.node.selected?.version ?? '?',
        }),
      );
      continue;
    }
    const group = plan.groups.find((item) => item.projectIds.includes(entry.project.id));
    if (!group) {
      lines.push(t('tui.job.scopeNoGroup', { project: entry.project.id }));
      continue;
    }
    if (seen.has(group.key)) continue;
    seen.add(group.key);
    lines.push(
      t('tui.job.scopeStore', {
        projects: group.projectIds.join(', '),
        key: group.key.slice(0, 12),
      }),
    );
  }
  return lines;
}

/** Plans one managed operation without writing anything. */
export async function previewJob(
  session: Session,
  options: JobOptions,
  request: JobRequest,
): Promise<JobPreview> {
  const report = await runAnalysis(
    session,
    { ...options, security: false, usage: false },
    { targetVersions: true },
  );
  const target = report.projects.filter((entry) => entry.project.id === request.projectId);
  const names = (request.packages ?? '').split(/\s+/).filter(Boolean);
  const notes: JobNote[] = [];
  const base = { report, targets: target, ids: target.map((entry) => entry.project.id) };

  if (request.kind === 'add' || request.kind === 'remove') {
    if (target.length === 0 || names.length === 0)
      return blockedPreview(request.kind, t('tui.job.needInput'), { ...base, fixes: [] });
    const scans = await scanTargets(session, target);
    const fixes: Fix[] = [];
    if (request.kind === 'add') {
      const plans = await planAdd(report, target, names.map(parseRequest), {
        offline: options.offline ?? false,
        config: session.loaded.config,
      });
      for (const plan of plans) {
        notes.push({
          tone: 'info',
          text: t('add.plan', {
            project: plan.project.id,
            name: plan.name,
            version: plan.choice.spec,
            section: plan.section,
            source: plan.choice.source,
            detail: plan.choice.detail,
          }),
        });
        for (const check of plan.checks)
          notes.push({
            tone: check.severity,
            text: `${check.kind}: ${check.message}${check.suggestion ? ` -> ${check.suggestion}` : ''}`,
          });
        if (plan.fix) fixes.push(plan.fix);
      }
    } else {
      for (const entry of target) {
        const removal = planRemove(entry.project, names);
        for (const name of removal.missing)
          notes.push({
            tone: 'warning',
            text: t('add.notDeclared', { project: entry.project.id, name }),
          });
        if (removal.fix) fixes.push(removal.fix);
        const declared = names.filter((name) => !removal.missing.includes(name));
        for (const use of await removalUsage(entry.project, declared, scans.get(entry.project.id)))
          notes.push({
            tone: 'warning',
            text: t('add.stillUsed', {
              project: entry.project.id,
              name: use.name,
              places: use.places.join('; '),
            }),
          });
      }
    }
    const previews = await previewEdits(collectEdits(fixes));
    const errors = notes.some((note) => note.tone === 'error');
    return {
      kind: request.kind,
      title: t(`tui.job.title.${request.kind}`, {
        packages: names.join(' '),
        project: request.projectId ?? '?',
      }),
      scope: [
        t('tui.job.scopeFiles', { count: previews.length }),
        ...linkedScope(report, base.ids),
      ],
      notes,
      previews,
      blocked: errors || previews.length === 0,
      data: { kind: request.kind, ...base, fixes },
    };
  }

  if (request.kind === 'build') {
    const entry = target[0];
    if (!entry) return blockedPreview('build', t('tui.job.needInput'), { ...base, fixes: [] });
    const plan = planStore(report, { union: true });
    const group =
      entry.project.nodeModules === 'link'
        ? plan.groups.find((item) => item.projectIds.includes(entry.project.id))
        : undefined;
    const ids = group ? group.projectIds : [entry.project.id];
    const script = options.script ?? 'build';
    const missing = report.projects.filter(
      (item) => ids.includes(item.project.id) && !item.node.selected,
    );
    for (const item of missing)
      notes.push({
        tone: 'error',
        text: `${item.project.id}: ${t('node.notInstalled', { ranges: item.node.effective.join(' & '), recommended: item.node.recommended ?? '-' })}`,
      });
    return {
      kind: 'build',
      title: t('tui.job.title.build', { project: entry.project.id, script }),
      scope: report.projects
        .filter((item) => ids.includes(item.project.id))
        .map((item) =>
          t('tui.job.scopeBuild', {
            project: item.project.id,
            script,
            node: item.node.selected?.version ?? '?',
          }),
        ),
      notes,
      previews: [],
      blocked: missing.length > 0,
      data: { kind: 'build', ...base, ids, fixes: [] },
    };
  }

  // sync: the first pass of `packman sync --apply` (later passes follow from what this one changes).
  const fixes = selectFixesBy(report, { risk: 'safe' });
  const stale = staleLinkedProjects(report);
  const previews = await previewEdits(collectEdits(fixes));
  const groups = groupsToSwitch(report, fixes, stale);
  const changed = report.projects
    .filter((entry) =>
      previews.some((preview) => preview.file.startsWith(entry.project.dir + path.sep)),
    )
    .map((entry) => entry.project.id);
  return {
    kind: 'sync',
    title: t('tui.job.title.sync'),
    scope: [
      t('sync.preview', { fixes: fixes.length, groups: groups.length }),
      ...(changed.length > 0 ? [t('tui.job.scopeProjects', { projects: changed.join(', ') })] : []),
      ...groups.map((ids) => t('sync.wouldSwitch', { projects: ids })),
      t('tui.job.scopeSyncPasses'),
    ],
    notes,
    previews,
    blocked: fixes.length === 0 && stale.size === 0,
    data: { kind: 'sync', report, targets: [], fixes, ids: changed },
  };
}

function blockedPreview(kind: JobKind, reason: string, data: Omit<JobData, 'kind'>): JobPreview {
  return {
    kind,
    title: t(`tui.job.title.${kind}`, { packages: '', project: '', script: '' }),
    scope: [],
    notes: [{ tone: 'error', text: reason }],
    previews: [],
    blocked: true,
    data: { kind, ...data },
  };
}

/**
 * Runs a confirmed preview with the CLI core. Output goes to the terminal like the CLI command;
 * the returned result is what the TUI shows when it comes back.
 */
export async function executeJob(
  session: Session,
  options: JobOptions,
  preview: JobPreview,
  signal: AbortSignal,
): Promise<JobResult> {
  const steps: SyncStep[] = [];
  const saved = process.exitCode;
  process.exitCode = 0;
  let ok = true;
  try {
    const { data } = preview;
    if (data.kind === 'sync') {
      ok = await runSync(
        session,
        { ...options, apply: true, yes: true, risk: 'safe', script: options.script ?? 'build' },
        { signal, steps },
      );
    } else {
      await withRunLimits({ signal }, async () => {
        if (data.kind === 'build') {
          const results = await verifyProjects(
            session,
            data.report,
            data.ids,
            options.script ?? 'build',
            'tui:verify',
          );
          for (const result of results)
            steps.push({
              step: `${result.project.id}: npm run ${result.script}`,
              status: result.ok ? 'ok' : signal.aborted ? 'cancelled' : 'failed',
            });
        } else {
          await applyAndInstall(
            session,
            data.report,
            data.targets,
            data.fixes,
            {
              project: data.ids,
              cwd: session.root,
              apply: true,
              yes: true,
              install: true,
              ...(options.offline ? { offline: true } : {}),
            },
            `tui:${data.kind}`,
          );
          steps.push({
            step: preview.title,
            status: signal.aborted ? 'cancelled' : process.exitCode ? 'failed' : 'ok',
            ...(process.exitCode ? { detail: `exit ${process.exitCode}` } : {}),
          });
        }
      });
    }
  } catch (error) {
    steps.push({
      step: preview.title,
      status: signal.aborted ? 'cancelled' : 'failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const cancelled = signal.aborted;
  const code =
    typeof process.exitCode === 'number' && process.exitCode !== 0 ? process.exitCode : 0;
  const exitCode = cancelled ? CANCEL_EXIT : code !== 0 ? code : ok ? 0 : 1;
  process.exitCode = saved;
  const failed = steps.some((step) => step.status === 'failed' || step.status === 'cancelled');
  return {
    title: preview.title,
    ok: exitCode === 0 && !failed,
    cancelled,
    exitCode,
    steps,
    remaining: await remaining(session, options),
  };
}

/** One line: findings by severity, safe fixes left and stale linked projects. */
async function remaining(session: Session, options: JobOptions): Promise<string> {
  try {
    const report = await runAnalysis(
      session,
      { ...options, security: false, usage: false },
      { targetVersions: true },
    );
    const findings = allFindings(report);
    const counts = SEVERITIES.map(
      (severity) => `${severity} ${findings.filter((item) => item.severity === severity).length}`,
    ).join(', ');
    return t('tui.job.remaining', {
      counts,
      fixes: selectFixesBy(report, { risk: 'safe' }).length,
      stale: staleLinkedProjects(report).size,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * While a job runs outside the TUI frame: Esc or Ctrl+C aborts it (once; a second Ctrl+C exits
 * like the CLI). Returns the function that stops listening.
 */
export function cancelOnKeys(
  stdin: NodeJS.ReadStream,
  controller: AbortController,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  const raw = stdin.isTTY && typeof stdin.setRawMode === 'function';
  if (raw) stdin.setRawMode(true);
  stdin.resume();
  const onData = (chunk: Buffer | string): void => {
    const text = chunk.toString();
    if (text !== '\x1b' && text !== '\x03') return;
    if (controller.signal.aborted) {
      if (text === '\x03') exit(CANCEL_EXIT);
      return;
    }
    console.error(pc.yellow(t('sync.cancelling')));
    controller.abort();
  };
  stdin.on('data', onData);
  return () => {
    stdin.off('data', onData);
    if (raw) stdin.setRawMode(false);
    stdin.pause();
  };
}

/** Waits for one key (the "press a key to return" after a job). */
export function waitForKey(stdin: NodeJS.ReadStream): Promise<void> {
  return new Promise((resolve) => {
    const raw = stdin.isTTY && typeof stdin.setRawMode === 'function';
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', () => {
      if (raw) stdin.setRawMode(false);
      stdin.pause();
      resolve();
    });
  });
}

/** The summary the terminal shows after a job, before going back to the TUI. */
export function printJobResult(result: JobResult): void {
  console.log(pc.bold(`\n${result.title}`));
  for (const step of result.steps)
    console.log(
      `  ${(step.status === 'ok' ? pc.green : step.status === 'skipped' ? pc.dim : pc.red)(step.status.padEnd(9))} ${step.step}${step.detail ? pc.dim(`  ${step.detail}`) : ''}`,
    );
  console.log(
    (result.ok ? pc.green : pc.red)(
      t('tui.job.exit', {
        code: result.exitCode,
        state: result.cancelled
          ? t('tui.job.cancelled')
          : result.ok
            ? t('tui.job.done')
            : t('tui.job.failed'),
      }),
    ),
  );
  console.log(pc.dim(result.remaining));
}
