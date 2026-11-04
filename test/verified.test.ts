import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../src/analyze.js';
import { openSession, runAnalysis } from '../src/cli/context.js';
import { buildProgram } from '../src/cli/main.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import {
  readProjectVerified,
  readStoreVerified,
  recordProjectVerified,
  versionChanges,
} from '../src/core/verified.js';
import * as runner from '../src/exec/run.js';
import * as toolchain from '../src/node/toolchain.js';
import { linkGroup, planStore } from '../src/store/store.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
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

async function workspace(files: Record<string, object | string>): Promise<string> {
  const result = await makeWorkspace(files);
  cleanup = result.cleanup;
  return result.root;
}

const cli = (args: string[]) => buildProgram().parseAsync(args, { from: 'user' });

async function report(root: string) {
  const config = configSchema.parse({});
  return analyze(await discoverWorkspace(root, { config }), {
    config,
    offline: true,
    security: false,
    today: TODAY,
    installedNodes: fakeNodes('22.19.0'),
  });
}

describe('verified version sets', () => {
  it('lists versions added, removed and moved since the verified set', () => {
    expect(
      versionChanges(
        { 'node_modules/a': '1.0.0', 'node_modules/b': '2.0.0' },
        { 'node_modules/a': '1.1.0', 'node_modules/c': '3.0.0' },
      ),
    ).toEqual(['node_modules/a: 1.0.0 -> 1.1.0', '-node_modules/b 2.0.0', '+node_modules/c 3.0.0']);
  });

  it('reports locked versions a build has not verified and pins ranges to the verified version', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', dependencies: { 'is-number': '^7.0.0' } },
      'app/package-lock.json': lockfile('app', { 'is-number': '^7.0.0' }, { 'is-number': '7.0.0' }),
    });
    await recordProjectVerified(root, 'app', path.join(root, 'app/package-lock.json'), {
      node: '22.19.0',
      script: 'build',
    });
    expect((await readProjectVerified(root, 'app'))?.versions).toEqual({
      'node_modules/is-number': '7.0.0',
    });
    // npm moved is-number inside ^7 after the build passed.
    await writeFile(
      path.join(root, 'app/package-lock.json'),
      JSON.stringify(lockfile('app', { 'is-number': '^7.0.0' }, { 'is-number': '7.0.1' })),
    );
    const findings = (await report(root)).projects[0]?.findings ?? [];
    expect(findings.find((item) => item.ruleId === 'npm/unverified-versions')?.evidence).toEqual([
      'node_modules/is-number: 7.0.0 -> 7.0.1',
    ]);
    const pin = findings.find((item) => item.ruleId === 'npm/range-spec')?.fixes[0]?.edits[0];
    expect(pin).toMatchObject({ path: ['dependencies', 'is-number'], value: '7.0.0' });
  });

  it('install stops on a lockfile out of sync instead of letting npm pick versions', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', dependencies: { 'is-number': '7.0.1' } },
      'app/package-lock.json': lockfile('app', { 'is-number': '7.0.0' }, { 'is-number': '7.0.0' }),
      'ok/package.json': { name: 'ok', dependencies: { 'is-number': '7.0.0' } },
      'ok/package-lock.json': lockfile('ok', { 'is-number': '7.0.0' }, { 'is-number': '7.0.0' }),
    });
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await cli(['install', root, '-y', '--offline']);
    expect(process.exitCode).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toBe(path.join(root, 'ok'));
    expect(run.mock.calls[0]?.[2]).toContain('ci');
  });

  it('store verify keeps the sets, and the next store is resolved from the verified lockfile', async () => {
    const files = {
      'app-a/package.json': { name: 'app-a', dependencies: { 'is-number': '7.0.0' } },
      'app-a/package-lock.json': lockfile(
        'app-a',
        { 'is-number': '7.0.0' },
        { 'is-number': '7.0.0' },
      ),
      'app-b/package.json': { name: 'app-b', dependencies: { 'is-number': '7.0.0' } },
      'app-b/package-lock.json': lockfile(
        'app-b',
        { 'is-number': '7.0.0' },
        { 'is-number': '7.0.0' },
      ),
    };
    const root = await workspace(files);
    const npmLock = (version: string) => ({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/is-number': { version } },
    });
    const install = (version: string) => async (dir: string) => {
      await mkdir(path.join(dir, 'node_modules', 'is-number'), { recursive: true });
      await writeFile(
        path.join(dir, 'node_modules', 'is-number', 'package.json'),
        JSON.stringify({ name: 'is-number', version }),
      );
      await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify(npmLock(version)));
      return 0;
    };
    const first = await report(root);
    const group = planStore(first, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    await linkGroup(root, first, group, { replaceExisting: true, install: install('7.0.0') });

    vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await cli(['store', 'verify', root, '--offline']);
    const verified = await readStoreVerified(root, ['app-a', 'app-b']);
    expect(verified?.lock.packages).toMatchObject({
      'node_modules/is-number': { version: '7.0.0' },
    });
    expect(existsSync(path.join(root, '.packman/verified/projects/app-a.json'))).toBe(true);

    // The next store starts from the verified lockfile; what npm then moves is reported.
    await writeFile(
      path.join(root, 'app-b/package.json'),
      JSON.stringify({ name: 'app-b', dependencies: { 'is-number': '7.0.0', 'is-odd': '3.0.1' } }),
    );
    const second = await runAnalysis(await openSession(root, {}), {
      security: false,
      usage: false,
    });
    const next = planStore(second, { union: true }).groups[0];
    if (!next || !verified) throw new Error('group and verified set expected');
    let seeded: unknown;
    const result = await linkGroup(root, second, next, {
      replaceExisting: true,
      seedLock: verified.lock,
      install: async (dir) => {
        seeded = JSON.parse(await readFile(path.join(dir, 'package-lock.json'), 'utf8'));
        return install('7.0.1')(dir);
      },
    });
    expect(seeded).toMatchObject({ packages: { 'node_modules/is-number': { version: '7.0.0' } } });
    expect(result.unverified).toEqual(['node_modules/is-number: 7.0.0 -> 7.0.1']);
  });
});
