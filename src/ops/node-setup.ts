import { existsSync } from 'node:fs';
import path from 'node:path';
import type { InstalledNode, NodeManager } from '../node/toolchain.js';

/**
 * How to install a missing Node version with the manager this machine already uses. Only install
 * commands are listed: none of them switches the active (global) Node, and packman never runs
 * `nvm use`, `fnm default` or `volta install`, which would.
 */
export interface NodeSetup {
  version: string;
  manager: Exclude<NodeManager, 'current'> | undefined;
  /** Executable and arguments, run without a shell; undefined when no manager was found. */
  command?: { file: string; args: string[] };
  /** The same command as a user would type it. */
  display: string;
  /** What the command leaves alone, or what to do without a manager. */
  note: string;
}

/**
 * The manager to install with: the one that installed the most of the Node versions packman found,
 * else the first one whose environment is present (NVM_HOME, NVM_DIR, FNM_DIR, VOLTA_HOME).
 */
export function detectNodeManager(
  installed: InstalledNode[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeSetup['manager'] {
  const counts = new Map<string, number>();
  for (const node of installed)
    if (node.manager !== 'current') counts.set(node.manager, (counts.get(node.manager) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best as NodeSetup['manager'];
  if (platform === 'win32' && env.NVM_HOME) return 'nvm-windows';
  if (env.NVM_DIR) return 'nvm';
  if (env.FNM_DIR || env.FNM_MULTISHELL_PATH) return 'fnm';
  if (env.VOLTA_HOME) return 'volta';
  return undefined;
}

export function nodeSetup(
  version: string,
  installed: InstalledNode[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeSetup {
  const manager = detectNodeManager(installed, env, platform);
  switch (manager) {
    case 'nvm-windows': {
      const exe = env.NVM_HOME ? path.join(env.NVM_HOME, 'nvm.exe') : undefined;
      return {
        version,
        manager,
        command: { file: exe && existsSync(exe) ? exe : 'nvm', args: ['install', version] },
        display: `nvm install ${version}`,
        note: 'nvm-windows installs next to the other versions; the active Node changes only with `nvm use`, which packman never runs',
      };
    }
    case 'nvm': {
      const script = path.join(env.NVM_DIR ?? '~/.nvm', 'nvm.sh');
      return {
        version,
        manager,
        // nvm is a shell function: source it in a child shell, whose `nvm use` ends with it.
        command: { file: 'bash', args: ['-c', `. "${script}" && nvm install ${version}`] },
        display: `nvm install ${version}`,
        note: 'runs in a child shell: your shell keeps its Node (nvm only sets the default alias when there was none)',
      };
    }
    case 'fnm':
      return {
        version,
        manager,
        command: { file: 'fnm', args: ['install', version] },
        display: `fnm install ${version}`,
        note: 'fnm install does not change the Node of your shells (`fnm use`/`fnm default` would)',
      };
    case 'volta':
      return {
        version,
        manager,
        command: { file: 'volta', args: ['fetch', `node@${version}`] },
        display: `volta fetch node@${version}`,
        note: 'volta fetch only downloads; `volta install` would change the default Node and is not used',
      };
    default:
      return {
        version,
        manager: undefined,
        display: `nvm install ${version}`,
        note: `no Node manager found (nvm-windows, nvm, fnm, Volta): install one, or Node ${version} from nodejs.org, then run packman again`,
      };
  }
}
