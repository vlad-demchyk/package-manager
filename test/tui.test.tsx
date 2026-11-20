import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import type { ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { setLanguage } from '../src/i18n/index.js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as outdatedOps from '../src/ops/outdated.js';
import { outdatedWithBumps, planInMajorBump, type PlannedOutdatedRow } from '../src/policy/bump.js';
import { readLinks } from '../src/store/store.js';
import { App } from '../src/tui/App.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

/**
 * A virtual terminal of fixed size. ink-testing-library's stdout has `columns` but no `rows`, so
 * Ink fell back to the size of the terminal running the tests and the list height (rows - 9) hid
 * findings in a small or non-TTY shell.
 */
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

function render(tree: ReactElement): {
  lastFrame: () => string | undefined;
  stdin: FakeStdin;
  unmount: () => void;
} {
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

const FILES = {
  'webpart/package.json': {
    name: 'webpart',
    dependencies: {
      '@microsoft/sp-core-library': '1.21.1',
      react: '17.0.1',
      'react-dom': '17.0.1',
    },
    devDependencies: {
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '5.3.3',
    },
  },
  'webpart/package-lock.json': lockfile(
    'webpart',
    {},
    {
      '@microsoft/sp-core-library': '1.21.1',
      react: '17.0.1',
      'react-dom': '17.0.1',
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '5.3.3',
    },
  ),
  'webpart/gulpfile.js': '',
};

let report: Report;
let cleanup: () => Promise<void>;

const tick = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  setLanguage('en');
  const workspace = await makeWorkspace(FILES);
  cleanup = workspace.cleanup;
  const config = configSchema.parse({});
  report = await analyze(await discoverWorkspace(workspace.root, { config }), {
    config,
    today: TODAY,
    security: false,
    installedNodes: fakeNodes('22.19.0'),
  });
});

afterAll(async () => {
  await cleanup();
});

describe('TUI', () => {
  it('shows diverging package versions in the Versions tab', async () => {
    const divergent = structuredClone(report);
    const other = structuredClone(divergent.projects[0]);
    if (!other) throw new Error('project expected');
    other.project.id = 'other';
    for (const pkg of other.project.lockfile?.packages ?? [])
      if (pkg.name === 'react') pkg.version = '18.3.1';
    divergent.projects.push(other);
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(divergent)} apply={vi.fn()} />,
    );
    await tick();
    stdin.write('3');
    await tick();
    expect(lastFrame()).toContain('react');
    expect(lastFrame()).toContain('17.0.1');
    expect(lastFrame()).toContain('18.3.1');
    unmount();
  });

  it('selects aligning a diverging package from the Versions tab', async () => {
    const divergent = structuredClone(report);
    const other = structuredClone(divergent.projects[0]);
    if (!other) throw new Error('project expected');
    other.project.id = 'other';
    for (const pkg of other.project.lockfile?.packages ?? [])
      if (pkg.name === 'react') pkg.version = '18.3.1';
    divergent.projects.push(other);
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(divergent)} apply={vi.fn()} />,
    );
    await tick();
    stdin.write('3');
    await tick();
    stdin.write(' ');
    await tick();
    expect(lastFrame()).toContain('[x] react');
    expect(lastFrame()).toContain('Fixes (1)');
    stdin.write('7');
    await tick(80);
    expect(lastFrame()).toMatch(/\+\s*"react": "18\.3\.1"/);
    unmount();
  });

  it('selects every profile fix with u and explains when there is none', async () => {
    const workspace = await makeWorkspace(FILES);
    try {
      const config = configSchema.parse({
        profiles: { base: { projects: ['webpart'], dependencies: { react: '17.0.2' } } },
      });
      const profiled = await analyze(await discoverWorkspace(workspace.root, { config }), {
        config,
        today: TODAY,
        security: false,
        installedNodes: fakeNodes('22.19.0'),
      });
      const withProfile = render(<App load={() => Promise.resolve(profiled)} apply={vi.fn()} />);
      await tick();
      withProfile.stdin.write('u');
      await tick();
      expect(withProfile.lastFrame()).toContain('profile fixes selected');
      expect(withProfile.lastFrame()).not.toContain('Fixes (0)');
      withProfile.unmount();
    } finally {
      await workspace.cleanup();
    }
    const without = render(<App load={() => Promise.resolve(report)} apply={vi.fn()} />);
    await tick();
    without.stdin.write('u');
    await tick();
    expect(without.lastFrame()).toContain('No profile differences');
    without.stdin.write('6');
    await tick();
    expect(without.lastFrame()).toContain('Store');
    without.unmount();
  });

  it('shows an apply failure without an unhandled rejection or a reload', async () => {
    const finding = report.projects[0]?.findings.find((item) => item.fixes.length > 0);
    if (!finding) throw new Error('fix expected');
    const load = vi.fn(() => Promise.resolve({ ...report, workspaceFindings: [finding] }));
    const apply = vi.fn(() => Promise.reject(new Error('write denied')));
    const { lastFrame, stdin, unmount } = render(<App load={load} apply={apply} />);
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write('7');
    await tick(80);
    stdin.write('a');
    await tick();
    stdin.write('y');
    await tick();
    expect(lastFrame()).toContain('write denied');
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('navigates tabs, opens a project, selects a fix and applies it after confirmation', async () => {
    const apply = vi.fn(() =>
      Promise.resolve({ files: ['package.json'], backupDir: '.packman/backups/x' }),
    );
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(report)} apply={apply} />,
    );
    await tick();
    expect(lastFrame()).toContain('packman report');
    expect(lastFrame()).toContain('Overview');

    stdin.write('2');
    await tick();
    expect(lastFrame()).toContain('webpart');

    stdin.write('\r');
    await tick();
    expect(lastFrame()).toContain('SPFx 1.21.1 expects rush-stack-compiler-5.3');

    // Move to the compiler finding and select its fix.
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n').filter((line) => /^\s*[›\s] (!!|x |! |i )/.test(line));
    const index = lines.findIndex((line) => line.includes('rush-stack-compiler-5.3'));
    for (let i = 0; i < index; i++) {
      stdin.write('j');
      await tick(5);
    }
    stdin.write(' ');
    await tick();
    expect(lastFrame()).toContain('[x]');

    stdin.write('7');
    await tick(80);
    expect(lastFrame()).toContain('webpart');
    expect(lastFrame()).toContain('rush-stack-compiler-5.3');

    stdin.write('a');
    await tick();
    expect(lastFrame()).toContain('[y/N]');
    stdin.write('y');
    await tick();
    expect(apply).toHaveBeenCalledTimes(1);
    unmount();
  });
});

/** SPFx 1.21.1 project with packages the in-major update must judge differently. */
const SPFX_BUMP = {
  'webpart/package.json': {
    name: 'webpart',
    dependencies: {
      '@microsoft/sp-core-library': '1.21.1',
      '@pnp/spfx-controls-react': '3.23.0',
      'peer-lib': '~1.0.0',
      'range-lib': '>=1 <2',
      react: '17.0.1',
      'react-dom': '17.0.1',
    },
    devDependencies: {
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      ajv: '^6.12.6',
      typescript: '5.3.3',
    },
  },
  'webpart/package-lock.json': lockfile(
    'webpart',
    {},
    {
      '@microsoft/sp-core-library': '1.21.1',
      '@pnp/spfx-controls-react': '3.23.0',
      'peer-lib': '1.0.0',
      'range-lib': '1.0.0',
      react: '17.0.1',
      'react-dom': '17.0.1',
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      ajv: '6.12.6',
      typescript: '5.3.3',
    },
  ),
  'webpart/gulpfile.js': '',
};

/** Two projects of one version group (same React), both on lodash 4.17.20. */
const GROUP_PAIR = {
  'app-a/package.json': { name: 'app-a', dependencies: { react: '18.3.1', lodash: '4.17.20' } },
  'app-a/package-lock.json': lockfile(
    'app-a',
    { react: '18.3.1', lodash: '4.17.20' },
    { react: '18.3.1', lodash: '4.17.20' },
  ),
  'app-b/package.json': { name: 'app-b', dependencies: { react: '18.3.1', lodash: '4.17.20' } },
  'app-b/package-lock.json': lockfile(
    'app-b',
    { react: '18.3.1', lodash: '4.17.20' },
    { react: '18.3.1', lodash: '4.17.20' },
  ),
};

const REGISTRY: Record<string, Record<string, outdatedOps.PackageVersionMetadata>> = {
  ajv: { '6.12.6': {}, '6.15.0': {}, '8.17.1': {} },
  '@pnp/spfx-controls-react': { '3.22.0': {}, '3.23.0': {}, '3.23.1': {}, '3.25.0': {} },
  'peer-lib': {
    '1.0.0': {},
    '1.0.1': { peerDependencies: { react: '>=16.8.0' } },
    '1.1.0': { peerDependencies: { react: '^18.0.0' } },
  },
  'range-lib': { '1.0.0': {}, '1.2.0': {} },
  lodash: { '4.17.20': {}, '4.17.21': {} },
};

async function analyzed(files: Record<string, string | object>): Promise<{
  root: string;
  report: Report;
  cleanup: () => Promise<void>;
}> {
  const workspace = await makeWorkspace(files);
  const config = configSchema.parse({});
  const result = await analyze(await discoverWorkspace(workspace.root, { config }), {
    config,
    today: TODAY,
    security: false,
    usage: false,
    installedNodes: fakeNodes('22.19.0'),
  });
  return { root: workspace.root, report: result, cleanup: workspace.cleanup };
}

function row(
  projectId: string,
  name: string,
  spec: string,
  current: string,
  latestInMajor: string,
  latest = latestInMajor,
): outdatedOps.OutdatedRow {
  return { projectId, name, spec, current, wanted: current, latestInMajor, latest };
}

function planned(
  target: Report,
  rows: outdatedOps.OutdatedRow[],
  registry = REGISTRY,
): PlannedOutdatedRow[] {
  return rows.map((item) => ({
    ...item,
    bump: planInMajorBump(target, item, registry[item.name] ?? {}),
  }));
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

describe('Outdated: in-major updates follow the compatibility checks', () => {
  let spfx: Awaited<ReturnType<typeof analyzed>>;
  beforeAll(async () => {
    spfx = await analyzed(SPFX_BUMP);
  });
  afterAll(async () => {
    await spfx.cleanup();
  });

  it('takes an allowed patch and keeps the spec operator', () => {
    const [ajv] = planned(spfx.report, [
      row('webpart', 'ajv', '^6.12.6', '6.12.6', '6.15.0', '8.17.1'),
    ]);
    expect(ajv?.bump.target).toBe('6.15.0');
    expect(ajv?.bump.blocked).toBeUndefined();
    expect(ajv?.bump.fix?.edits).toEqual([
      expect.objectContaining({ path: ['devDependencies', 'ajv'], value: '^6.15.0' }),
    ]);
  });

  it('refuses a minor of an SPFx library outside the line built for the SPFx version', () => {
    const [controls] = planned(spfx.report, [
      row('webpart', '@pnp/spfx-controls-react', '3.23.0', '3.23.0', '3.25.0'),
    ]);
    // 3.25.0 is the newest of major 3, but SPFx 1.21.1 allows >=3.22.0 <3.24.0.
    expect(controls?.bump.blockedVersion).toBe('3.25.0');
    expect(controls?.bump.blocked?.[0]).toContain('>=3.22.0 <3.24.0');
    expect(controls?.bump.blocked?.[0]).toContain('SPFx 1.21.1');
    expect(controls?.bump.target).toBe('3.23.1');
    expect(controls?.bump.fix?.edits[0]).toMatchObject({ value: '3.23.1' });

    const only = { ...REGISTRY, '@pnp/spfx-controls-react': { '3.23.0': {}, '3.25.0': {} } };
    const [none] = planned(
      spfx.report,
      [row('webpart', '@pnp/spfx-controls-react', '3.23.0', '3.23.0', '3.25.0')],
      only,
    );
    expect(none?.bump.target).toBeUndefined();
    expect(none?.bump.fix).toBeUndefined();
    expect(none?.bump.blocked?.[0]).toContain('>=3.22.0 <3.24.0');
  });

  it('refuses a version whose peer range the project does not meet', () => {
    const [peer] = planned(spfx.report, [row('webpart', 'peer-lib', '~1.0.0', '1.0.0', '1.1.0')]);
    expect(peer?.bump.blockedVersion).toBe('1.1.0');
    expect(peer?.bump.blocked?.join('\n')).toContain('wants react@^18.0.0');
    expect(peer?.bump.target).toBe('1.0.1');
    expect(peer?.bump.fix?.edits[0]).toMatchObject({ value: '~1.0.1' });
  });

  it('leaves ranges other than exact, ^ and ~ to the user', () => {
    const [range] = planned(spfx.report, [row('webpart', 'range-lib', '>=1 <2', '1.0.0', '1.2.0')]);
    expect(range?.bump).toEqual({});
  });

  it('shows the reason in the menu and never selects a refused target', async () => {
    const loadOutdated = vi.fn((target: Report) =>
      Promise.resolve(
        planned(
          target,
          [
            row('webpart', '@pnp/spfx-controls-react', '3.23.0', '3.23.0', '3.25.0'),
            row('webpart', 'ajv', '^6.12.6', '6.12.6', '6.15.0', '8.17.1'),
          ],
          { ...REGISTRY, '@pnp/spfx-controls-react': { '3.23.0': {}, '3.25.0': {} } },
        ),
      ),
    );
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(spfx.report)} apply={vi.fn()} loadOutdated={loadOutdated} />,
    );
    await tick();
    stdin.write('4');
    await tick(60);
    expect(lastFrame()).toContain('@pnp/spfx-controls-react  webpart  3.23.0 → - ✗ 3.25.0');
    expect(lastFrame()).toContain('3.25.0 not allowed: SPFx 1.21.1');
    stdin.write(' ');
    await tick();
    expect(lastFrame()).toContain('Fixes (0)');
    expect(lastFrame()).toContain('3.25.0 not allowed');
    stdin.write('j');
    await tick();
    stdin.write(' ');
    await tick();
    expect(lastFrame()).toContain('Fixes (1)');
    stdin.write('1');
    await tick();
    stdin.write('4');
    await tick();
    expect(loadOutdated).toHaveBeenCalledTimes(1);
    stdin.write('7');
    await tick(80);
    expect(lastFrame()).toMatch(/\+\s*"ajv": "\^6\.15\.0"/);
    expect(lastFrame()).not.toMatch(/\+\s*"@pnp\/spfx-controls-react"/);
    expect(lastFrame()).toContain('Fixes (1)');
    unmount();
  });

  it('blocks a shared-store group member from leaving the group spec, writing nothing', async () => {
    const pair = await analyzed(GROUP_PAIR);
    try {
      const member = pair.report.projects.find((entry) => entry.project.id === 'app-b');
      if (!member) throw new Error('project expected');
      member.project.nodeModules = 'link';
      const before = await snapshot(pair.root);
      const links = await readLinks(pair.root);
      const rows = planned(pair.report, [row('app-b', 'lodash', '4.17.20', '4.17.20', '4.17.21')]);
      expect(rows[0]?.bump.fix).toBeUndefined();
      expect(rows[0]?.bump.blocked?.[0]).toContain('shared store');
      const apply = vi.fn(() => Promise.resolve({ files: [], backupDir: '' }));
      const { lastFrame, stdin, unmount } = render(
        <App
          load={() => Promise.resolve(pair.report)}
          apply={apply}
          loadOutdated={() => Promise.resolve(rows)}
        />,
      );
      await tick();
      stdin.write('4');
      await tick(60);
      stdin.write(' ');
      await tick();
      expect(lastFrame()).toContain('4.17.21 not allowed');
      stdin.write('7');
      await tick(80);
      stdin.write('a');
      await tick();
      stdin.write('y');
      await tick();
      expect(apply).not.toHaveBeenCalled();
      unmount();
      expect(await snapshot(pair.root)).toEqual(before);
      expect(await readLinks(pair.root)).toEqual(links);

      // With its own node_modules the same member may diverge from the group (a warning only).
      member.project.nodeModules = 'folder';
      const [loose] = planned(pair.report, [
        row('app-b', 'lodash', '4.17.20', '4.17.20', '4.17.21'),
      ]);
      expect(loose?.bump.target).toBe('4.17.21');
    } finally {
      await pair.cleanup();
    }
  });

  it('fetches registry metadata before the outdated lookup and plans every row', async () => {
    const fetchSpy = vi
      .spyOn(outdatedOps, 'fetchPackuments')
      .mockResolvedValue(
        new Map(Object.entries(REGISTRY).map(([name, versions]) => [name, { versions }])),
      );
    const outdatedSpy = vi
      .spyOn(outdatedOps, 'outdated')
      .mockResolvedValue([row('webpart', 'ajv', '^6.12.6', '6.12.6', '6.15.0', '8.17.1')]);
    try {
      const rows = await outdatedWithBumps(spfx.report, { offline: true });
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ offline: true, metadata: true });
      expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(
        outdatedSpy.mock.invocationCallOrder[0] ?? 0,
      );
      expect(rows[0]?.bump.target).toBe('6.15.0');
    } finally {
      fetchSpy.mockRestore();
      outdatedSpy.mockRestore();
    }
  });
});
