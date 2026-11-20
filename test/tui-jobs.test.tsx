import { EventEmitter } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { render as inkRender } from 'ink';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { openSession } from '../src/cli/context.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import * as runner from '../src/exec/run.js';
import { setLanguage } from '../src/i18n/index.js';
import * as toolchain from '../src/node/toolchain.js';
import { App } from '../src/tui/App.js';
import {
  cancelOnKeys,
  executeJob,
  previewJob,
  type JobPreview,
  type JobResult,
} from '../src/tui/jobs.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

class FixedStdout extends EventEmitter {
  readonly columns = 100;
  readonly rows = 40;
  private last: string | undefined;
  write = (frame: string): void => {
    this.last = frame;
  };
  lastFrame = (): string | undefined => this.last;
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

function render(tree: ReactElement) {
  const stdout = new FixedStdout();
  const stdin = new FakeStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: new FixedStdout() as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { lastFrame: stdout.lastFrame, stdin, unmount: instance.unmount };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  setLanguage('en');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue(fakeNodes('22.19.0'));
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

/** One project with its own lockfile and no node_modules; `^7.0.0` is a safe pin fix for sync. */
const APP = {
  'app/package.json': {
    name: 'app',
    engines: { node: '22' },
    dependencies: { 'is-number': '^7.0.0' },
  },
  'app/package-lock.json': lockfile('app', { 'is-number': '^7.0.0' }, { 'is-number': '7.0.0' }),
};

async function session(files: Record<string, string | object>) {
  const workspace = await makeWorkspace(files);
  cleanup = workspace.cleanup;
  return openSession(workspace.root, { lang: 'en' });
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      out[path.relative(root, file)] = await readFile(file, 'utf8');
    }
  return out;
}

const OPTIONS = { offline: true, lang: 'en' as const };

describe('TUI managed jobs: preview writes nothing, run uses the CLI core', () => {
  it('add: previews scope, version choice and diff, then writes and installs on run', async () => {
    const s = await session(APP);
    const before = await snapshot(s.root);
    const preview = await previewJob(s, OPTIONS, {
      kind: 'add',
      projectId: 'app',
      packages: 'is-odd@3.0.1',
    });
    expect(preview.title).toBe('Add is-odd@3.0.1 to app');
    expect(preview.blocked).toBe(false);
    expect(preview.scope).toEqual(['1 files change', 'app: npm install with Node 22.19.0']);
    expect(preview.notes[0]?.text).toContain('is-odd');
    expect(preview.previews[0]?.after).toContain('"is-odd": "3.0.1"');
    expect(await snapshot(s.root)).toEqual(before);

    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    const result = await executeJob(s, OPTIONS, preview, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, cancelled: false, exitCode: 0 });
    expect(result.steps[0]).toMatchObject({ status: 'ok' });
    expect(result.remaining).toContain('Still left:');
    const manifest = JSON.parse(await readFile(path.join(s.root, 'app/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['is-odd']).toBe('3.0.1');
    expect(run.mock.calls.map((call) => call[2][0])).toEqual(['install']);
  });

  it('add: an error check blocks the run', async () => {
    const s = await session({
      'web/package.json': {
        name: 'web',
        dependencies: { '@microsoft/sp-core-library': '1.21.1' },
        devDependencies: { '@microsoft/sp-build-web': '1.21.1' },
      },
      'web/package-lock.json': lockfile(
        'web',
        {},
        { '@microsoft/sp-core-library': '1.21.1', '@microsoft/sp-build-web': '1.21.1' },
      ),
      'web/gulpfile.js': '',
    });
    const preview = await previewJob(s, OPTIONS, {
      kind: 'add',
      projectId: 'web',
      packages: '@microsoft/sp-webpart-base@1.18.0',
    });
    expect(preview.blocked).toBe(true);
    expect(
      preview.notes.some((note) => note.tone === 'error' && note.text.includes('lockstep')),
    ).toBe(true);
  });

  it('remove: previews the edit and keeps the files until run', async () => {
    const s = await session(APP);
    const before = await snapshot(s.root);
    const preview = await previewJob(s, OPTIONS, {
      kind: 'remove',
      projectId: 'app',
      packages: 'is-number nope',
    });
    expect(preview.notes.map((note) => note.text)).toContain(
      'app: nope is not declared, nothing to remove.',
    );
    expect(preview.previews[0]?.after).not.toContain('is-number');
    expect(preview.blocked).toBe(false);
    expect(await snapshot(s.root)).toEqual(before);
  });

  it('sync: previews the first pass and runs the cycle to a final check', async () => {
    const s = await session(APP);
    const before = await snapshot(s.root);
    const preview = await previewJob(s, OPTIONS, { kind: 'sync' });
    expect(preview.blocked).toBe(false);
    expect(preview.scope[0]).toMatch(/^1 fixes, 0 linked groups to rebuild/);
    expect(preview.previews.some((item) => item.after.includes('"is-number": "7.0.0"'))).toBe(true);
    expect(await snapshot(s.root)).toEqual(before);

    vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    const result = await executeJob(s, OPTIONS, preview, new AbortController().signal);
    expect(result.exitCode).toBe(0);
    expect(result.steps.map((step) => step.status)).not.toContain('failed');
    expect(result.steps.at(-1)?.step).toBe('final check');
    expect(await readFile(path.join(s.root, 'app/package.json'), 'utf8')).toContain(
      '"is-number": "7.0.0"',
    );
  });

  it('build: Esc cancels the running npm step and the result says cancelled with exit 130', async () => {
    const s = await session(APP);
    const preview = await previewJob(s, OPTIONS, { kind: 'build', projectId: 'app' });
    expect(preview.scope).toEqual(['app: npm run build with Node 22.19.0']);
    const controller = new AbortController();
    vi.spyOn(runner, 'runWithNode').mockImplementation(
      () =>
        new Promise((resolve) => {
          controller.signal.addEventListener('abort', () => {
            resolve({ code: runner.CANCEL_EXIT, cancelled: true });
          });
        }),
    );
    const keys = new EventEmitter() as unknown as NodeJS.ReadStream;
    Object.assign(keys, { isTTY: false, resume: () => keys, pause: () => keys });
    const exit = vi.fn();
    const stop = cancelOnKeys(keys, controller, exit);
    const running = executeJob(s, OPTIONS, preview, controller.signal);
    await tick();
    keys.emit('data', '\x1b');
    const result = await running;
    stop();
    expect(result).toMatchObject({ cancelled: true, exitCode: 130, ok: false });
    expect(result.steps[0]).toMatchObject({ status: 'cancelled' });
    expect(process.exitCode ?? 0).toBe(0);
    expect(exit).not.toHaveBeenCalled();
  });

  it('build: Esc kills a real npm run through the job signal', async () => {
    const node = {
      version: process.versions.node,
      executable: process.execPath,
      manager: 'nvm-windows' as const,
    };
    vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue([node]);
    const s = await session({
      'app/package.json': {
        name: 'app',
        engines: { node: process.versions.node },
        scripts: { build: 'node -e "setTimeout(() => {}, 60000)"' },
      },
    });
    const preview = await previewJob(s, OPTIONS, { kind: 'build', projectId: 'app' });
    expect(preview.blocked).toBe(false);
    const controller = new AbortController();
    const keys = new EventEmitter() as unknown as NodeJS.ReadStream;
    Object.assign(keys, { isTTY: false, resume: () => keys, pause: () => keys });
    const stop = cancelOnKeys(keys, controller, vi.fn());
    const started = Date.now();
    const running = executeJob(s, OPTIONS, preview, controller.signal);
    await tick(1500);
    keys.emit('data', '\x1b');
    const result = await running;
    stop();
    expect(result).toMatchObject({ cancelled: true, exitCode: runner.CANCEL_EXIT });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it('a second Ctrl+C after cancelling exits with 130, like the CLI', () => {
    const keys = new EventEmitter() as unknown as NodeJS.ReadStream;
    Object.assign(keys, { isTTY: false, resume: () => keys, pause: () => keys });
    const controller = new AbortController();
    const exit = vi.fn();
    const stop = cancelOnKeys(keys, controller, exit);
    keys.emit('data', '\x03');
    expect(controller.signal.aborted).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    keys.emit('data', '\x03');
    expect(exit).toHaveBeenCalledWith(130);
    stop();
  });
});

describe('TUI managed jobs: keys', () => {
  async function report(): Promise<Report> {
    const workspace = await makeWorkspace(APP);
    cleanup = workspace.cleanup;
    const config = configSchema.parse({});
    return analyze(await discoverWorkspace(workspace.root, { config }), {
      config,
      today: TODAY,
      security: false,
      usage: false,
      installedNodes: fakeNodes('22.19.0'),
    });
  }

  const PREVIEW: JobPreview = {
    kind: 'add',
    title: 'Add is-odd to app',
    scope: ['1 files change', 'app: npm install with Node 22.19.0'],
    notes: [{ tone: 'info', text: 'app: is-odd 3.0.1 (dependencies, registry)' }],
    previews: [
      {
        file: path.join('/ws', 'app', 'package.json'),
        before: '{\n  "a": 1\n}\n',
        after: '{\n  "a": 1,\n  "is-odd": "3.0.1"\n}\n',
      },
    ],
    blocked: false,
    data: {} as JobPreview['data'],
  };

  it('+ asks for packages, plans, shows scope and diff, and y hands the preview to run', async () => {
    const loaded = await report();
    const planJob = vi.fn(() => Promise.resolve(PREVIEW));
    const onRun = vi.fn();
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(loaded)} apply={vi.fn()} planJob={planJob} onRun={onRun} />,
    );
    await tick();
    stdin.write('+');
    await tick();
    expect(lastFrame()).toContain('Pick a project in the Projects tab first');
    stdin.write('2');
    await tick();
    stdin.write('+');
    await tick();
    expect(lastFrame()).toContain('Add to app');
    for (const char of 'is-odd') stdin.write(char);
    await tick();
    stdin.write('\r');
    await tick(60);
    expect(planJob).toHaveBeenCalledWith({ kind: 'add', projectId: 'app', packages: 'is-odd' });
    expect(lastFrame()).toContain('Add is-odd to app');
    expect(lastFrame()).toContain('app: npm install with Node 22.19.0');
    expect(lastFrame()).toMatch(/\+\s*"is-odd": "3\.0\.1"/);
    expect(lastFrame()).toContain('Run it? y runs');
    expect(onRun).not.toHaveBeenCalled();
    stdin.write('y');
    await tick();
    expect(onRun).toHaveBeenCalledWith(PREVIEW);
    unmount();
  });

  it('a blocked preview cannot run; Esc goes back; c plans sync and b a build', async () => {
    const loaded = await report();
    const planJob = vi.fn((request: { kind: string }) =>
      Promise.resolve({ ...PREVIEW, kind: request.kind, blocked: true } as JobPreview),
    );
    const onRun = vi.fn();
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(loaded)} apply={vi.fn()} planJob={planJob} onRun={onRun} />,
    );
    await tick();
    stdin.write('c');
    await tick(60);
    expect(planJob).toHaveBeenLastCalledWith({ kind: 'sync' });
    expect(lastFrame()).toContain('Cannot run');
    stdin.write('y');
    await tick();
    expect(onRun).not.toHaveBeenCalled();
    stdin.write('\x1b');
    await tick(60);
    expect(lastFrame()).not.toContain('Cannot run');
    stdin.write('2');
    await tick();
    stdin.write('b');
    await tick(60);
    expect(planJob).toHaveBeenLastCalledWith({ kind: 'build', projectId: 'app' });
    unmount();
  });

  it('shows the result of the last job with exit code and what is left, until a key', async () => {
    const loaded = await report();
    const result: JobResult = {
      title: 'Sync: safe fixes, store switches, builds, final check',
      ok: false,
      cancelled: true,
      exitCode: 130,
      steps: [
        { step: 'Node', status: 'ok' },
        { step: 'store app (pass 1)', status: 'failed', detail: 'rolled back after build' },
      ],
      remaining:
        'Still left: critical 0, error 1, warning 0, info 0; 1 safe fixes, 0 stale linked projects',
    };
    const { lastFrame, stdin, unmount } = render(
      <App
        load={() => Promise.resolve(loaded)}
        apply={vi.fn()}
        result={result}
        initialTab="projects"
      />,
    );
    await tick();
    expect(lastFrame()).toContain('exit 130: cancelled');
    expect(lastFrame()).toContain('rolled back after build');
    expect(lastFrame()).toContain('Still left: critical 0, error 1');
    stdin.write('x');
    await tick();
    expect(lastFrame()).not.toContain('exit 130');
    expect(lastFrame()).toContain('app');
    unmount();
  });
});
