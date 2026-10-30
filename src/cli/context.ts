import path from 'node:path';
import { analyze, type AnalyzeOptions, type Report } from '../analyze.js';
import { loadConfig, type LoadedConfig } from '../core/config.js';
import { discoverWorkspace } from '../core/discovery.js';
import type { Workspace } from '../core/types.js';
import { setLanguage, type Language } from '../i18n/index.js';

export interface CommonOptions {
  project?: string[];
  exclude?: string[];
  depth?: number;
  lang?: Language | 'auto';
  offline?: boolean;
  security?: boolean;
  usage?: boolean;
}

export interface Session {
  root: string;
  loaded: LoadedConfig;
  workspace: Workspace;
}

export async function openSession(
  root: string | undefined,
  options: CommonOptions,
): Promise<Session> {
  const absRoot = path.resolve(root ?? process.cwd());
  const loaded = await loadConfig(absRoot);
  setLanguage(options.lang ?? loaded.config.language);
  const workspace = await discoverWorkspace(absRoot, {
    config: loaded.config,
    ...(options.project ? { only: options.project } : {}),
    ...(options.exclude ? { skip: options.exclude } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
  });
  return { root: absRoot, loaded, workspace };
}

export async function runAnalysis(
  session: Session,
  options: CommonOptions,
  extra: Partial<AnalyzeOptions> = {},
): Promise<Report> {
  return analyze(session.workspace, {
    config: session.loaded.config,
    offline: options.offline ?? false,
    security: options.security ?? true,
    usage: options.usage ?? true,
    ...extra,
  });
}
