import { spawn } from 'node:child_process';
import path from 'node:path';
import { npmCliFor, type InstalledNode } from '../node/toolchain.js';

export interface RunResult {
  code: number;
}

/**
 * Runs `npm <args>` (or any tool when `tool` is set) with a specific Node binary, without a shell.
 * The Node directory is prepended to PATH so lifecycle scripts resolve the same `node`.
 */
export function runWithNode(
  node: InstalledNode,
  cwd: string,
  args: string[],
  options: { tool?: string; stdio?: 'inherit' | 'pipe' } = {},
): Promise<RunResult> {
  const nodeDir = path.dirname(node.executable);
  const env = { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}` };
  let command: string;
  let argv: string[];
  if (options.tool) {
    command = options.tool;
    argv = args;
  } else {
    const npmCli = npmCliFor(node);
    if (!npmCli) {
      return Promise.reject(new Error(`npm not found next to ${node.executable}`));
    }
    command = node.executable;
    argv = [npmCli, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd,
      env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1 });
    });
  });
}
