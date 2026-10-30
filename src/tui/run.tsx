import { render } from 'ink';
import type { AnalyzeOptions } from '../analyze.js';
import { runAnalysis, type CommonOptions, type Session } from '../cli/context.js';
import { applyPreviews, type FilePreview } from '../fixes/apply.js';
import { App } from './App.js';

export async function runTui(session: Session, options: CommonOptions): Promise<void> {
  const load = (onProgress: NonNullable<AnalyzeOptions['onProgress']>) =>
    runAnalysis(session, options, { onProgress });
  const apply = (previews: FilePreview[]) => applyPreviews(session.root, previews);
  const instance = render(<App load={load} apply={apply} />, { alternateScreen: true });
  await instance.waitUntilExit();
}
