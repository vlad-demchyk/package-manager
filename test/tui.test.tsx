import { render } from 'ink-testing-library';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { setLanguage } from '../src/i18n/index.js';
import { App } from '../src/tui/App.js';
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

    stdin.write('5');
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
