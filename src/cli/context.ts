import path from 'node:path';
import { analyze, type AnalyzeOptions, type Report } from '../analyze.js';
import { loadConfig, type LoadedConfig } from '../core/config.js';
import { discoverWorkspace, type DiscoveryOptions } from '../core/discovery.js';
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
  selection: Omit<DiscoveryOptions, 'config'>;
}

export async function openSession(
  root: string | undefined,
  options: CommonOptions,
): Promise<Session> {
  const absRoot = path.resolve(root ?? process.cwd());
  const loaded = await loadConfig(absRoot);
  setLanguage(options.lang ?? loaded.config.language);
  const selection = {
    ...(options.project ? { only: options.project } : {}),
    ...(options.exclude ? { skip: options.exclude } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
  };
  const workspace = await discoverWorkspace(absRoot, { config: loaded.config, ...selection });
  return { root: absRoot, loaded, workspace, selection };
}

export async function runAnalysis(
  session: Session,
  options: CommonOptions,
  extra: Partial<AnalyzeOptions> = {},
): Promise<Report> {
  // A session survives writes (update/install, reinstall and TUI reloads).
  // Reload both configuration and projects instead of analyzing the pre-write snapshot.
  session.loaded = await loadConfig(session.root);
  session.workspace = await discoverWorkspace(session.root, {
    config: session.loaded.config,
    ...session.selection,
  });
  return analyze(session.workspace, {
    config: session.loaded.config,
    offline: options.offline ?? false,
    security: options.security ?? true,
    usage: options.usage ?? true,
    ...extra,
  });
}
