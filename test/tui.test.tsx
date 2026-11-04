import { render } from 'ink-testing-library';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { setLanguage } from '../src/i18n/index.js';
import { App, bumpInMajor } from '../src/tui/App.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

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

  it('loads Outdated once and bumps a package inside its major', async () => {
    const loadOutdated = vi.fn(() =>
      Promise.resolve([
        {
          projectId: 'webpart',
          name: 'react',
          spec: '17.0.1',
          current: '17.0.1',
          wanted: '17.0.1',
          latestInMajor: '17.0.2',
          latest: '19.1.0',
        },
      ]),
    );
    const { lastFrame, stdin, unmount } = render(
      <App load={() => Promise.resolve(report)} apply={vi.fn()} loadOutdated={loadOutdated} />,
    );
    await tick();
    stdin.write('4');
    await tick(60);
    expect(lastFrame()).toContain('react');
    expect(lastFrame()).toContain('latest 19.1.0');
    stdin.write(' ');
    await tick();
    stdin.write('1');
    await tick();
    stdin.write('4');
    await tick();
    expect(loadOutdated).toHaveBeenCalledTimes(1);
    stdin.write('7');
    await tick(80);
    expect(lastFrame()).toMatch(/\+\s*"react": "17\.0\.2"/);
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

  it('bumps only exact, ^ and ~ specs, keeping the operator', () => {
    const project = report.projects[0]?.project;
    const row = { projectId: 'webpart', name: 'react', current: '17.0.1', latestInMajor: '17.0.2' };
    expect(bumpInMajor(project, { ...row, spec: '^17.0.1' })?.edits[0]).toMatchObject({
      value: '^17.0.2',
    });
    expect(bumpInMajor(project, { ...row, spec: '~17.0.1' })?.edits[0]).toMatchObject({
      value: '~17.0.2',
    });
    expect(bumpInMajor(project, { ...row, spec: '>=17 <18' })).toBeUndefined();
    expect(bumpInMajor(project, { ...row, spec: '17.0.2', current: '17.0.2' })).toBeUndefined();
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
