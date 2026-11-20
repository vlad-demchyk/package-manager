import { render } from 'ink';
import pc from 'picocolors';
import type { AnalyzeOptions, Report } from '../analyze.js';
import { runAnalysis, type CommonOptions, type Session } from '../cli/context.js';
import { applyPreviews, type FilePreview } from '../fixes/apply.js';
import { t } from '../i18n/index.js';
import { outdatedWithBumps } from '../policy/bump.js';
import { App, type Tab } from './App.js';
import {
  cancelOnKeys,
  executeJob,
  previewJob,
  printJobResult,
  waitForKey,
  type JobPreview,
  type JobRequest,
  type JobResult,
} from './jobs.js';

/** Where a managed job leaves the TUI: the tab it came from. */
const JOB_TAB: Record<JobPreview['kind'], Tab> = {
  add: 'projects',
  remove: 'projects',
  build: 'projects',
  sync: 'overview',
};

/**
 * The TUI loop. A confirmed managed job (add, remove, sync, build) closes the frame and runs in the
 * terminal with the CLI's output, npm included, and Esc or Ctrl+C as cancel; then the TUI opens
 * again, reloaded, with the job's result.
 */
export async function runTui(session: Session, options: CommonOptions): Promise<void> {
  const load = (onProgress: NonNullable<AnalyzeOptions['onProgress']>) =>
    runAnalysis(session, options, { onProgress });
  const apply = (previews: FilePreview[]) => applyPreviews(session.root, previews);
  const loadOutdated = (report: Report) =>
    outdatedWithBumps(report, { offline: options.offline ?? false });
  const planJob = (request: JobRequest) => previewJob(session, options, request);
  let result: JobResult | undefined;
  let tab: Tab | undefined;
  for (;;) {
    let pending: JobPreview | undefined;
    const instance = render(
      <App
        load={load}
        apply={apply}
        loadOutdated={loadOutdated}
        planJob={planJob}
        onRun={(preview) => {
          pending = preview;
        }}
        {...(result ? { result } : {})}
        {...(tab ? { initialTab: tab } : {})}
      />,
      { alternateScreen: true },
    );
    await instance.waitUntilExit();
    // Set by the onRun callback while the frame was open.
    const job = pending;
    if (!job) return;
    console.log(pc.bold(`\n${job.title}`));
    console.log(pc.dim(t('tui.job.running')));
    const controller = new AbortController();
    const stop = cancelOnKeys(process.stdin, controller);
    try {
      result = await executeJob(session, options, job, controller.signal);
    } finally {
      stop();
    }
    tab = JOB_TAB[job.kind];
    printJobResult(result);
    console.log(pc.dim(t('tui.job.anyKey')));
    await waitForKey(process.stdin);
  }
}
