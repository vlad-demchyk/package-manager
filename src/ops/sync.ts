import path from 'node:path';
import pc from 'picocolors';
import type { Report } from '../analyze.js';
import type { Fix, Risk, Severity } from '../core/types.js';
import { readStoreVerified } from '../core/verified.js';
import { allFindings } from '../report/model.js';
import { describeRun, runCommand, runWithNode, withRunLimits } from '../exec/run.js';
import { collectEdits } from '../fixes/apply.js';
import { t } from '../i18n/index.js';
import { describeCycle, editSteps, findCycles, withoutCycles, type EditStep } from './converge.js';
import { journal } from './journal.js';
import { nodeSetup } from './node-setup.js';
import { listInstalledNodes } from '../node/toolchain.js';
import { planStore, readLinks, type LinkRecord, type StoreGroup } from '../store/store.js';
import {
  projectFilesOf,
  switchGroup,
  takeSnapshot,
  type Snapshot,
  type SwitchResult,
} from '../store/switch.js';
import { openSession, runAnalysis, type CommonOptions, type Session } from '../cli/context.js';
import {
  printLinkResult,
  recordVerifiedBuilds,
  reviewAndApply,
  selectFixesBy,
  staleLinkedProjects,
  verifyProjects,
  type BuildResult,
} from '../cli/shared.js';

/** One line of the final summary: a step and how it ended. */
export interface SyncStep {
  step: string;
  status: 'ok' | 'failed' | 'skipped' | 'held' | 'cancelled';
  detail?: string;
}

export interface SyncOptions extends CommonOptions {
  risk?: Risk;
  rule?: string[];
  fix?: string[];
  apply?: boolean;
  yes?: boolean;
  /** npm script built in every changed project; false skips the builds. */
  script?: string | false;
  maxPasses?: number;
  /** Minutes each npm step may take before its process tree is killed; 0 for no limit. */
  timeout?: number;
  installNode?: boolean;
  refresh?: boolean;
}

export const DEFAULT_PASSES = 3;
export const DEFAULT_TIMEOUT_MINUTES = 30;

/**
 * The full cycle as one command: Node preflight, then passes of fix -> store switch (prepare, relink,
 * build, rollback on failure) -> check, until no allowed fix is left, a fix would undo an earlier
 * pass, or the pass limit is reached. Prints one summary; returns whether the cycle completed.
 *
 * Without `control.signal` the run owns Ctrl+C (SIGINT); a caller that reads the keys itself (the
 * TUI) passes its own signal. `control.steps` receives the summary lines.
 */
export async function runSync(
  session: Session,
  options: SyncOptions,
  control: { signal?: AbortSignal; steps?: SyncStep[] } = {},
): Promise<boolean> {
  const controller = new AbortController();
  let interrupts = 0;
  const onInterrupt = (): void => {
    interrupts++;
    if (interrupts > 1) process.exit(130);
    console.error(pc.yellow(t('sync.cancelling')));
    controller.abort();
  };
  const signal = control.signal ?? controller.signal;
  if (!control.signal) process.on('SIGINT', onInterrupt);
  const minutes = options.timeout ?? DEFAULT_TIMEOUT_MINUTES;
  const steps: SyncStep[] = control.steps ?? [];
  try {
    return await withRunLimits(
      { ...(minutes > 0 ? { timeoutMs: minutes * 60_000 } : {}), signal },
      () => cycle(session, options, steps, signal),
    );
  } finally {
    if (!control.signal) process.off('SIGINT', onInterrupt);
    printSummary(steps);
    await journal(session.root, {
      command: 'sync',
      projects: [],
      result: steps.some((step) => step.status === 'failed' || step.status === 'cancelled')
        ? 'failed'
        : 'ok',
      detail: steps.map((step) => `${step.step}: ${step.status}`).join('; '),
    });
  }
}

const phase = (text: string): void => {
  console.log(pc.bold(pc.cyan(`\n== ${text}`)));
};

async function cycle(
  session: Session,
  options: SyncOptions,
  steps: SyncStep[],
  signal: AbortSignal,
): Promise<boolean> {
  const apply = options.apply === true;
  const script = options.script === false ? undefined : (options.script ?? 'build');
  const analysis = options;

  phase(t('sync.phasePreflight'));
  if (!(await preflight(session, options, steps))) return false;

  const maxPasses = Math.max(1, options.maxPasses ?? DEFAULT_PASSES);
  const history: EditStep[] = [];
  for (let pass = 1; pass <= maxPasses; pass++) {
    if (signal.aborted) {
      steps.push({ step: t('sync.stepPass', { pass }), status: 'cancelled' });
      return false;
    }
    phase(t('sync.phaseFix', { pass, max: maxPasses }));
    const report = await runAnalysis(session, analysis, { targetVersions: true });
    const all = selectFixesBy(report, options);
    const planned = editSteps(all, pass);
    const cycles = findCycles(history, planned);
    for (const item of cycles)
      steps.push({
        step: t('sync.stepCycle', { pass }),
        status: 'held',
        detail: describeCycle(item, (file) => path.relative(session.root, file)),
      });
    const fixes = withoutCycles(all, cycles);
    const stale = staleLinkedProjects(report);
    const edits = collectEdits(fixes);
    if (edits.length === 0 && stale.size === 0) {
      steps.push({ step: t('sync.stepPass', { pass }), status: 'ok', detail: t('sync.stable') });
      return finalCheck(session, options, steps, cycles.length === 0);
    }

    if (!apply) {
      await reviewAndApply(session, report, fixes, { apply: false, command: 'sync' });
      const groups = groupsToSwitch(report, fixes, stale);
      for (const id of groups) console.log(pc.yellow(t('sync.wouldSwitch', { projects: id })));
      console.log(pc.dim(t('sync.previewNext')));
      steps.push({
        step: t('sync.stepPass', { pass }),
        status: 'skipped',
        detail: t('sync.preview', { fixes: fixes.length, groups: groups.length }),
      });
      return true;
    }

    // Everything a pass can change, taken before it changes anything: the state to go back to.
    // A store is shared by projects -p/-x may leave out: plan, snapshot and switch it over the workspace.
    const whole = await wholeWorkspace(session, options);
    const dirs = whole.workspace.projects.map((project) => project.dir);
    const snapshot = await takeSnapshot(session.root, [
      ...projectFilesOf(dirs),
      ...edits.map((edit) => edit.file),
    ]);
    const previous = await readLinks(session.root);
    if (edits.length > 0) {
      const written = await reviewAndApply(session, report, fixes, {
        apply: true,
        ...(options.yes ? { yes: true } : {}),
        command: `sync:fix:${pass}`,
      });
      if (!written) {
        steps.push({
          step: t('sync.stepFix', { pass }),
          status: 'failed',
          detail: t('sync.notWritten'),
        });
        return false;
      }
      history.push(...planned.filter((item) => fixes.some((fix) => fix.id === item.fixId)));
      steps.push({
        step: t('sync.stepFix', { pass }),
        status: 'ok',
        detail: t('sync.fixesApplied', {
          count: fixes.length,
          files: new Set(edits.map((edit) => edit.file)).size,
        }),
      });
    }

    const fresh = await runAnalysis(
      whole,
      { ...options, security: false },
      { targetVersions: true },
    );
    const switched = await switchStale(whole, fresh, previous, snapshot, {
      ...(script ? { script } : {}),
      ...(options.refresh ? { refresh: true } : {}),
      command: `sync:store:${pass}`,
      steps,
      pass,
    });
    if (!switched) return false;
    if (script && !(await buildUnlinked(session, report, fixes, script, steps, pass))) return false;
  }
  // The last pass still changed something: check whether more would follow.
  return finalCheck(session, options, steps, false, maxPasses);
}

/** The session itself, or one over every project when -p/-x narrowed it. */
async function wholeWorkspace(session: Session, options: SyncOptions): Promise<Session> {
  if (!session.selection.only && !session.selection.skip) return session;
  return openSession(session.root, {
    ...(options.lang ? { lang: options.lang } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
  });
}

/** Linked groups a pass would rebuild: groups of stale members or of members the fixes edit. */
export function groupsToSwitch(report: Report, fixes: Fix[], stale: Set<string>): string[] {
  const touched = new Set(stale);
  const files = collectEdits(fixes).map((edit) => edit.file);
  for (const entry of report.projects)
    if (
      entry.project.nodeModules === 'link' &&
      files.some((file) => file.startsWith(entry.project.dir + path.sep))
    )
      touched.add(entry.project.id);
  const byStore = new Map<string, string[]>();
  for (const link of report.links ?? [])
    if (touched.has(link.projectId))
      byStore.set(link.target, [...(byStore.get(link.target) ?? []), link.projectId]);
  return [...byStore.values()].map((ids) => ids.join(', '));
}

/**
 * Switches every group with a stale linked member to the store its manifests now need
 * ({@link switchGroup}): prepare, relink, build; on failure the previous links and files are back.
 * Returns false when a group could not be switched.
 */
export async function switchStale(
  session: Session,
  report: Report,
  previous: LinkRecord[],
  snapshot: Snapshot,
  options: {
    script?: string;
    refresh?: boolean;
    replaceExisting?: boolean;
    command: string;
    steps: SyncStep[];
    pass?: number;
    /** Members to switch; defaults to the stale linked projects of `report`. */
    projectIds?: string[];
  },
): Promise<boolean> {
  const wanted = options.projectIds ?? [...staleLinkedProjects(report)];
  if (wanted.length === 0) return true;
  const plan = planStore(report, { union: true });
  const done = new Set<string>();
  for (const id of wanted) {
    if (done.has(id)) continue;
    const group = plan.groups.find((item) => item.projectIds.includes(id));
    const label = t('sync.stepStore', { project: id, pass: options.pass ?? 1 });
    if (!group) {
      const candidate = plan.candidates.find((item) => item.projectIds.includes(id));
      options.steps.push({
        step: label,
        status: 'failed',
        detail: t('sync.noGroup', {
          project: id,
          reason: candidate
            ? `${candidate.reason}${candidate.packages ? `: ${candidate.packages.join(', ')}` : ''}`
            : (plan.excluded.find((item) => item.projectId === id)?.reason ?? '-'),
        }),
      });
      return false;
    }
    for (const member of group.projectIds) done.add(member);
    const result = await switchOne(session, report, group, previous, snapshot, options);
    options.steps.push({
      step: t('sync.stepStore', { project: group.projectIds.join(', '), pass: options.pass ?? 1 }),
      status: result.status === 'switched' ? 'ok' : 'failed',
      detail: switchDetail(session, result, group),
    });
    if (result.status !== 'switched') {
      process.exitCode = 1;
      return false;
    }
  }
  return true;
}

async function switchOne(
  session: Session,
  report: Report,
  group: StoreGroup,
  previous: LinkRecord[],
  snapshot: Snapshot,
  options: { script?: string; refresh?: boolean; replaceExisting?: boolean; command: string },
): Promise<SwitchResult> {
  const verified =
    group.mode === 'union' && !options.refresh
      ? await readStoreVerified(session.root, group.projectIds)
      : undefined;
  if (verified)
    console.log(pc.dim(t('store.seeded', { date: verified.at.slice(0, 10), node: verified.node })));
  for (const warning of group.warnings) console.log(pc.yellow(`  ! ${warning}`));
  const script = options.script;
  let builds: BuildResult[] = [];
  const result = await switchGroup(session.root, report, group, previous, snapshot, {
    ...(verified ? { seedLock: verified.lock } : {}),
    ...(options.replaceExisting ? { replaceExisting: true } : {}),
    install: async (dir, node, mode) => {
      const run = await runWithNode(
        node,
        dir,
        mode === 'exact' ? ['ci'] : ['install', '--no-audit', '--no-fund'],
      );
      if (run.code !== 0) console.error(pc.red(`npm: ${describeRun(run)}`));
      return run.code;
    },
    ...(script
      ? {
          verify: async (ids: string[]) => {
            const after = await runAnalysis(session, { security: false, usage: false });
            // Verified sets are recorded only once the switch is kept (below).
            builds = await verifyProjects(
              session,
              after,
              ids,
              script,
              `${options.command}:verify`,
              false,
            );
            const results = builds;
            return ids.filter((id) => !results.some((item) => item.project.id === id && item.ok));
          },
        }
      : {}),
    onPhase: (name) => {
      console.log(
        pc.bold(t(`sync.switch.${name}`, { count: group.projectIds.length, key: group.key })),
      );
    },
  });
  if (result.link) await printLinkResult(session, result.link, options.command);
  if (result.status === 'switched') await recordVerifiedBuilds(session.root, builds);
  if (result.status !== 'switched') {
    console.error(pc.red(switchDetail(session, result, group)));
    await journal(session.root, {
      command: options.command,
      projects: group.projectIds,
      result: 'failed',
      detail: `${result.phase ?? '?'}: ${result.error ?? ''} (${result.status})`,
    });
  }
  return result;
}

function switchDetail(session: Session, result: SwitchResult, group: StoreGroup): string {
  if (result.status === 'switched')
    return t('sync.switched', {
      count: group.projectIds.length,
      dir: result.link ? path.relative(session.root, result.link.storeDir) : group.key,
    });
  const error = (result.error ?? '').split('\n')[0] ?? '';
  if (result.status === 'rolled-back')
    return t('sync.rolledBack', { phase: result.phase ?? '?', error });
  return t('sync.switchFailed', {
    phase: result.phase ?? '?',
    error: result.rollbackError ? `${error}; rollback: ${result.rollbackError}` : error,
  });
}

/**
 * Projects with their own node_modules whose manifests this pass changed: `reviewAndApply` relocked
 * them; npm install brings node_modules to that lock and the script builds them. No rollback here:
 * an installed node_modules folder cannot be put back without npm.
 */
async function buildUnlinked(
  session: Session,
  report: Report,
  fixes: Fix[],
  script: string,
  steps: SyncStep[],
  pass: number,
): Promise<boolean> {
  const files = collectEdits(fixes).map((edit) => edit.file);
  const changed = report.projects.filter(
    (entry) =>
      entry.project.nodeModules === 'folder' &&
      files.some((file) => file.startsWith(entry.project.dir + path.sep)),
  );
  let ok = true;
  for (const entry of changed) {
    const node = entry.node.selected;
    const label = t('sync.stepProject', { project: entry.project.id, pass });
    if (!node) {
      steps.push({
        step: label,
        status: 'failed',
        detail: t('sync.noNode', { project: entry.project.id }),
      });
      ok = false;
      continue;
    }
    console.log(pc.bold(`\n> ${entry.project.id}: npm install (node ${node.version})`));
    const install = await runWithNode(node, entry.project.dir, [
      'install',
      '--no-audit',
      '--no-fund',
    ]);
    if (install.code !== 0) {
      steps.push({ step: label, status: 'failed', detail: `npm install ${describeRun(install)}` });
      ok = false;
      continue;
    }
    const after = await runAnalysis(session, { security: false, usage: false });
    const [result] = await verifyProjects(
      session,
      after,
      [entry.project.id],
      script,
      'sync:verify',
    );
    steps.push({
      step: label,
      status: result?.ok ? 'ok' : 'failed',
      detail: `npm run ${script}`,
    });
    if (!result?.ok) ok = false;
  }
  return ok;
}

/**
 * Node every project of the run needs is installed, or the exact command to install it is printed
 * (and run with --install-node --apply). The active Node of the shell is never changed.
 */
async function preflight(
  session: Session,
  options: SyncOptions,
  steps: SyncStep[],
): Promise<boolean> {
  const report = await runAnalysis(session, { ...options, security: false, usage: false });
  const missing = new Map<string, string[]>();
  for (const entry of report.projects)
    if (!entry.node.selected) {
      const version = entry.node.recommended ?? entry.node.effective.join(' & ');
      missing.set(version, [...(missing.get(version) ?? []), entry.project.id]);
    }
  if (missing.size === 0) {
    steps.push({ step: t('sync.stepNode'), status: 'ok' });
    return true;
  }
  return prepareNodes(missing, report, options, steps);
}

/** Prints (and, with --install-node and --apply, runs) the install command of each missing Node. */
export async function prepareNodes(
  missing: Map<string, string[]>,
  report: Report,
  options: { apply?: boolean; installNode?: boolean },
  steps: SyncStep[],
): Promise<boolean> {
  let ok = true;
  for (const [version, projects] of missing) {
    const setup = nodeSetup(version, report.installedNodes);
    console.log(
      pc.yellow(
        t('sync.nodeMissing', { version, projects: projects.join(', '), command: setup.display }),
      ),
    );
    console.log(pc.dim(`  ${setup.note}`));
    if (!options.installNode || !options.apply || !setup.command) {
      steps.push({
        step: t('sync.stepNode'),
        status: options.apply ? 'failed' : 'skipped',
        detail: t('sync.nodePrepare', { command: setup.display }),
      });
      if (options.apply) ok = false;
      continue;
    }
    console.log(pc.bold(`> ${setup.display}`));
    const run = await runCommand(setup.command.file, setup.command.args, report.root).catch(
      (error: unknown) => ({
        code: 1,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const installed = (await listInstalledNodes()).some((node) => node.version === version);
    steps.push({
      step: t('sync.stepNode'),
      status: run.code === 0 && installed ? 'ok' : 'failed',
      detail: `${setup.display}: ${'error' in run ? run.error : describeRun(run)}${installed ? '' : `, ${t('sync.nodeStillMissing', { version })}`}`,
    });
    if (run.code !== 0 || !installed) ok = false;
  }
  return ok;
}

const SEVERITIES: Severity[] = ['critical', 'error', 'warning', 'info'];

/** The check after the last pass: findings by severity and the fixes that are still left. */
async function finalCheck(
  session: Session,
  options: SyncOptions,
  steps: SyncStep[],
  stable: boolean,
  passes?: number,
): Promise<boolean> {
  phase(t('sync.phaseCheck'));
  const report = await runAnalysis(session, options, { targetVersions: true });
  const findings = allFindings(report);
  const counts = SEVERITIES.map(
    (severity) => `${severity} ${findings.filter((item) => item.severity === severity).length}`,
  ).join(', ');
  const left = selectFixesBy(report, options);
  const stale = staleLinkedProjects(report);
  const complete = left.length === 0 && stale.size === 0;
  steps.push({
    step: t('sync.stepCheck'),
    status: complete || stable ? 'ok' : 'failed',
    detail:
      `${counts}; ` +
      (complete
        ? t('sync.noFixesLeft')
        : passes
          ? t('sync.notStable', { passes, count: left.length, stale: stale.size })
          : t('sync.fixesLeft', { count: left.length })),
  });
  return complete || stable;
}

function printSummary(steps: SyncStep[]): void {
  if (steps.length === 0) return;
  console.log(pc.bold(`\n${t('sync.summary')}`));
  const color = (status: SyncStep['status']): ((text: string) => string) =>
    status === 'ok' ? pc.green : status === 'skipped' ? pc.dim : pc.red;
  for (const step of steps)
    console.log(
      `  ${color(step.status)(step.status.padEnd(9))} ${step.step}${step.detail ? pc.dim(`  ${step.detail}`) : ''}`,
    );
  const incomplete = steps.some((step) => ['failed', 'cancelled'].includes(step.status));
  console.log(incomplete ? pc.red(t('sync.incomplete')) : pc.green(t('sync.complete')));
}
