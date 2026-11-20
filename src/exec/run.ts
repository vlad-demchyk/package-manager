import { spawn } from 'node:child_process';
import path from 'node:path';
import { npmCliFor, type InstalledNode } from '../node/toolchain.js';

export interface RunResult {
  code: number;
  /** The time limit passed and the process tree was killed; `code` is then 124. */
  timedOut?: boolean;
  /** The abort signal fired and the process tree was killed; `code` is then 130. */
  cancelled?: boolean;
}

/** Exit code of a run killed by its time limit (as `timeout(1)`). */
export const TIMEOUT_EXIT = 124;
/** Exit code of a run killed by cancellation (as a shell after Ctrl+C). */
export const CANCEL_EXIT = 130;

export interface RunLimits {
  /** Kill the whole process tree after this many milliseconds. Undefined or 0: no limit. */
  timeoutMs?: number;
  /** Kill the whole process tree when the signal aborts (Ctrl+C in a command that owns it). */
  signal?: AbortSignal;
}

export interface RunOptions extends RunLimits {
  /** Executable to run instead of `npm` (no shell is used). */
  tool?: string;
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

/** How long to wait for a killed process to report `close` before settling anyway. */
const SETTLE_AFTER_KILL_MS = 3000;

/**
 * Limits applied to every run that does not pass its own: a command that orchestrates many npm
 * steps (`packman sync`) sets them once instead of threading them through every helper.
 */
let defaults: RunLimits = {};

/** Runs `task` with `limits` as the default time limit and cancellation of every child process. */
export async function withRunLimits<T>(limits: RunLimits, task: () => Promise<T>): Promise<T> {
  const saved = defaults;
  defaults = { ...saved, ...limits };
  try {
    return await task();
  } finally {
    defaults = saved;
  }
}

/**
 * Kills a process and its children. Windows has no process groups for `spawn`, so `taskkill /T`
 * walks the tree; POSIX children are started in their own group (see `runCommand`).
 */
export function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      killer.on('error', () => {
        resolve();
      });
      killer.on('close', () => {
        resolve();
      });
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  return Promise.resolve();
}

/**
 * Runs an executable with arguments, without a shell, with an optional time limit and cancellation.
 * A timed-out or cancelled run kills its whole process tree (npm starts lifecycle scripts, which
 * start their own children) and resolves with {@link TIMEOUT_EXIT} or {@link CANCEL_EXIT} instead of
 * waiting for `close` forever.
 */
export function runCommand(
  command: string,
  argv: string[],
  cwd: string,
  options: RunOptions & { env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
  const signal = options.signal ?? defaults.signal;
  return new Promise((resolve, reject) => {
    const limited = (timeoutMs !== undefined && timeoutMs > 0) || signal !== undefined;
    const child = spawn(command, argv, {
      cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
      windowsHide: true,
      // A POSIX process group lets one kill reach the children of npm's lifecycle scripts.
      detached: process.platform !== 'win32' && limited,
    });
    let settled = false;
    let reason: 'timeout' | 'cancel' | undefined;
    let timer: NodeJS.Timeout | undefined;
    let fallback: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      if (fallback) clearTimeout(fallback);
      signal?.removeEventListener('abort', onAbort);
    };
    const killed = (): RunResult =>
      reason === 'timeout'
        ? { code: TIMEOUT_EXIT, timedOut: true }
        : { code: CANCEL_EXIT, cancelled: true };
    const finish = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const stop = (why: 'timeout' | 'cancel'): void => {
      if (settled || reason) return;
      reason = why;
      if (child.pid !== undefined) void killProcessTree(child.pid);
      // Grandchildren may keep the inherited stdio open after the kill; do not wait for them.
      fallback = setTimeout(() => {
        finish(killed());
      }, SETTLE_AFTER_KILL_MS);
    };
    function onAbort(): void {
      stop('cancel');
    }
    if (timeoutMs !== undefined && timeoutMs > 0)
      timer = setTimeout(() => {
        stop('timeout');
      }, timeoutMs);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      finish(reason ? killed() : { code: code ?? 1 });
    });
  });
}

/**
 * Runs `npm <args>` (or any tool when `tool` is set) with a specific Node binary, without a shell.
 * The Node directory is prepended to PATH so lifecycle scripts resolve the same `node`.
 */
export function runWithNode(
  node: InstalledNode,
  cwd: string,
  args: string[],
  options: RunOptions = {},
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
  return runCommand(command, argv, cwd, {
    env,
    ...(options.stdio ? { stdio: options.stdio } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/** One line for logs and journals: `exit 1`, `timed out (exit 124)`, `cancelled (exit 130)`. */
export function describeRun(result: RunResult): string {
  if (result.timedOut) return `timed out (exit ${result.code})`;
  if (result.cancelled) return `cancelled (exit ${result.code})`;
  return `exit ${result.code}`;
}
