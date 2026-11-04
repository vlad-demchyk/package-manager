import { render } from 'ink';
import type { AnalyzeOptions } from '../analyze.js';
import { runAnalysis, type CommonOptions, type Session } from '../cli/context.js';
import type { Project } from '../core/types.js';
import { applyPreviews, type FilePreview } from '../fixes/apply.js';
import { outdated } from '../ops/outdated.js';
import { App } from './App.js';

export async function runTui(session: Session, options: CommonOptions): Promise<void> {
  const load = (onProgress: NonNullable<AnalyzeOptions['onProgress']>) =>
    runAnalysis(session, options, { onProgress });
  const apply = (previews: FilePreview[]) => applyPreviews(session.root, previews);
  const loadOutdated = (projects: Project[]) =>
    outdated(projects, { offline: options.offline ?? false });
  const instance = render(<App load={load} apply={apply} loadOutdated={loadOutdated} />, {
    alternateScreen: true,
  });
  await instance.waitUntilExit();
}
