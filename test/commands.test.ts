import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSession, runAnalysis } from '../src/cli/context.js';
import { buildProgram } from '../src/cli/main.js';
import * as runner from '../src/exec/run.js';
import { applyPreviews } from '../src/fixes/apply.js';
import * as toolchain from '../src/node/toolchain.js';
import { readLinks } from '../src/store/store.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue(
    fakeNodes('24.9.0', '22.19.0', '18.20.8'),
  );
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
});

async function workspace(files: Record<string, object | string>) {
  const result = await makeWorkspace(files);
  cleanup = result.cleanup;
  return result.root;
}

const cli = (args: string[]) => buildProgram().parseAsync(args, { from: 'user' });

describe('command sequences', () => {
  it('init pins a usable installed Node rather than an unavailable recommended patch', async () => {
    const root = await workspace({ 'app/package.json': { name: 'app', engines: { node: '22' } } });
    await cli(['init', root, '--with-groups', '--offline']);
    const session = await openSession(root, {});
    expect(session.loaded.config.policy.groups[0]?.node).toBe('22.19.0');
    expect(
      (await runAnalysis(session, { security: false, usage: false })).projects[0]?.node.selected
        ?.version,
    ).toBe('22.19.0');
  });
  it('refuses stale previews before writing any file and gives repeated backups distinct directories', async () => {
    const root = await workspace({ 'one.txt': 'one', 'two.txt': 'external edit' });
    await expect(
      applyPreviews(
        root,
        [
          { file: path.join(root, 'one.txt'), before: 'one', after: 'new one' },
          { file: path.join(root, 'two.txt'), before: 'two', after: 'new two' },
        ],
        TODAY,
      ),
    ).rejects.toThrow('file changed since preview');
    expect(await readFile(path.join(root, 'one.txt'), 'utf8')).toBe('one');
    const first = await applyPreviews(
      root,
      [{ file: path.join(root, 'one.txt'), before: 'one', after: 'first' }],
      TODAY,
    );
    const second = await applyPreviews(
      root,
      [{ file: path.join(root, 'one.txt'), before: 'first', after: 'second' }],
      TODAY,
    );
    expect(first.backupDir).not.toBe(second.backupDir);
    expect(await readFile(path.join(first.backupDir, 'one.txt'), 'utf8')).toBe('one');
    expect(await readFile(path.join(second.backupDir, 'one.txt'), 'utf8')).toBe('first');
  });
  it('relocks an SPFx upgrade with the target Node while check still reports what is installed', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', dependencies: { '@microsoft/sp-core-library': '1.18.2' } },
      'app/package-lock.json': lockfile(
        'app',
        { '@microsoft/sp-core-library': '1.18.2' },
        { '@microsoft/sp-core-library': '1.18.2' },
      ),
      'app/node_modules/@microsoft/sp-core-library/package.json': {
        name: '@microsoft/sp-core-library',
        version: '1.18.2',
      },
      'packman.config.json': {
        profiles: {
          upgrade: { projects: ['app'], dependencies: { '@microsoft/sp-core-library': '1.21.1' } },
        },
      },
    });
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await cli(['update', root, '--apply', '--relock', '-y', '--offline']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].version).toBe('22.19.0');
    const session = await openSession(root, {});
    const actual = await runAnalysis(session, { security: false, usage: false });
    expect(actual.projects[0]?.stacks.find((stack) => stack.provider === 'spfx')?.version).toBe(
      '1.18.2',
    );
  });
  it('clean unlinks an unrecorded node_modules junction without deleting its target', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app' },
      'backing/keep.txt': 'keep',
    });
    await symlink(path.join(root, 'backing'), path.join(root, 'app/node_modules'), 'junction');
    await cli(['clean', root, '--modules', '-y', '--offline']);
    expect(existsSync(path.join(root, 'app/node_modules'))).toBe(false);
    expect(await readFile(path.join(root, 'backing/keep.txt'), 'utf8')).toBe('keep');
  });
  it('honours a group Node pin, reports stale project pins, and refuses stack-incompatible groups', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', dependencies: { '@microsoft/sp-core-library': '1.21.1' } },
      'app/.nvmrc': '18.20.8',
      'packman.config.json': {
        policy: { groups: [{ name: 'spfx', projects: ['app'], node: '22.19.0' }] },
      },
    });
    const session = await openSession(root, {});
    const compatible = await runAnalysis(session, { security: false, usage: false });
    expect(compatible.projects[0]?.node.selected?.version).toBe('22.19.0');
    expect(
      compatible.projects[0]?.findings.some((finding) => finding.ruleId === 'node/pin-conflict'),
    ).toBe(true);
    await writeFile(
      path.join(root, 'packman.config.json'),
      JSON.stringify({ policy: { groups: [{ name: 'spfx', projects: ['app'], node: '18' }] } }),
    );
    const incompatible = await runAnalysis(session, { security: false, usage: false });
    expect(incompatible.projects[0]?.node.selected).toBeUndefined();
    expect(
      incompatible.projects[0]?.findings.some((finding) => finding.ruleId === 'node/pin-conflict'),
    ).toBe(true);
  });

  it('does not clean modules or lockfiles when reinstall has no compatible Node', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', engines: { node: '8' } },
      'app/package-lock.json': lockfile('app', {}, {}),
      'app/node_modules/own.txt': 'keep',
    });
    await cli(['reinstall', root, '-y', '--offline']);
    expect(process.exitCode).toBe(1);
    expect(existsSync(path.join(root, 'app/package-lock.json'))).toBe(true);
    expect(await readFile(path.join(root, 'app/node_modules/own.txt'), 'utf8')).toBe('keep');
  });

  it('reloads configuration, manifests, lockfiles and modules while preserving the session filters', async () => {
    const root = await workspace({
      'one/app/package.json': { name: 'one', dependencies: { 'is-number': '6.0.0' } },
      'other/package.json': { name: 'other' },
    });
    const session = await openSession(root, { project: ['one/**'], exclude: ['other'], depth: 2 });
    const before = await runAnalysis(session, { security: false, usage: false });
    expect(before.projects.map((entry) => entry.project.id)).toEqual(['one/app']);
    await writeFile(
      path.join(root, 'one/app/package.json'),
      JSON.stringify({ name: 'one', dependencies: { 'is-number': '7.0.0' } }),
    );
    await writeFile(
      path.join(root, 'one/app/package-lock.json'),
      JSON.stringify(lockfile('one', { 'is-number': '7.0.0' }, { 'is-number': '7.0.0' })),
    );
    await mkdir(path.join(root, 'one/app/node_modules/is-number'), { recursive: true });
    await writeFile(
      path.join(root, 'one/app/node_modules/is-number/package.json'),
      '{"version":"7.0.0"}',
    );
    await writeFile(
      path.join(root, 'packman.config.json'),
      JSON.stringify({
        policy: { groups: [{ name: 'node18', projects: ['one/**'], node: '18' }] },
      }),
    );
    const after = await runAnalysis(session, { security: false, usage: false }, { today: TODAY });
    expect(after.projects).toHaveLength(1);
    expect(after.projects[0]?.project).toMatchObject({
      dependencies: [{ name: 'is-number', spec: '7.0.0' }],
      nodeModules: 'folder',
      installed: { 'is-number': '7.0.0' },
      lockfile: { rootSpecs: { 'is-number': '7.0.0' } },
    });
    expect(after.projects[0]?.node.selected?.version).toBe('18.20.8');
  });

  it('uses the updated Node for relock, then installs only projects changed by update', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', engines: { node: '18' } },
      'unaffected/package.json': { name: 'unaffected' },
      'packman.config.json': {
        profiles: { current: { projects: ['app'], engines: { node: '22' } } },
      },
    });
    const run = vi.spyOn(runner, 'runWithNode').mockImplementation(async (_node, dir, args) => {
      expect(JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))).toMatchObject({
        engines: { node: '22' },
      });
      if (args.includes('--package-lock-only'))
        await writeFile(
          path.join(dir, 'package-lock.json'),
          JSON.stringify(lockfile('app', {}, {})),
        );
      return { code: 0 };
    });
    await cli(['update', root, '--apply', '--relock', '--install', '-y', '--offline']);
    expect(run).toHaveBeenCalledTimes(2);
    expect(
      run.mock.calls.every(
        ([node, dir]) => node.version === '22.19.0' && dir === path.join(root, 'app'),
      ),
    ).toBe(true);
    expect(run.mock.calls[1]?.[2][0]).toBe('ci');
  });

  it('does not install after update is declined or relock fails', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', engines: { node: '18' } },
      'packman.config.json': {
        profiles: { current: { projects: ['app'], engines: { node: '22' } } },
      },
    });
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 7 });
    await cli(['update', root, '--apply', '--install', '--offline']);
    expect(run).not.toHaveBeenCalled();
    await cli(['update', root, '--apply', '--install', '--relock', '-y', '--offline']);
    expect(run).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it('reinstall uses install after removing the old lockfile, rather than ci', async () => {
    const root = await workspace({
      'app/package.json': { name: 'app', dependencies: { 'is-number': '7.0.0' } },
      'app/package-lock.json': lockfile('app', { 'is-number': '7.0.0' }, { 'is-number': '7.0.0' }),
      'app/node_modules/original.txt': 'original',
    });
    const run = vi.spyOn(runner, 'runWithNode').mockImplementation((_node, dir) => {
      expect(existsSync(path.join(dir, 'package-lock.json'))).toBe(false);
      expect(existsSync(path.join(dir, 'node_modules'))).toBe(false);
      return Promise.resolve({ code: 0 });
    });
    await cli(['reinstall', root, '-y', '--offline']);
    expect(run.mock.calls[0]?.[2][0]).toBe('install');
  });

  it.each(['install', 'relock'])(
    '%s fails when no compatible Node is installed',
    async (command) => {
      const root = await workspace({ 'app/package.json': { name: 'app', engines: { node: '8' } } });
      const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
      await cli([command, root, ...(command === 'install' ? ['-y'] : []), '--offline']);
      expect(process.exitCode).toBe(1);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('store link scans undeclared imports before choosing package links', async () => {
    const root = await workspace({
      'app-a/package.json': { name: 'app-a', dependencies: { 'is-number': '7.0.0' } },
      'app-b/package.json': { name: 'app-b', dependencies: { 'is-number': '7.0.0' } },
      'app-a/package-lock.json': lockfile(
        'app-a',
        { 'is-number': '7.0.0' },
        { 'is-number': '7.0.0', 'is-odd': '3.0.1' },
      ),
      'app-b/package-lock.json': lockfile(
        'app-b',
        { 'is-number': '7.0.0' },
        { 'is-number': '7.0.0', 'is-odd': '3.0.1' },
      ),
      'app-a/src/index.js': "import isOdd from 'is-odd'; console.log(isOdd(3));",
    });
    const session = await openSession(root, {});
    const { planStore } = await import('../src/store/store.js');
    const report = await runAnalysis(session, { security: false });
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    vi.spyOn(runner, 'runWithNode').mockImplementation(async (_node, dir) => {
      for (const name of ['is-number', 'is-odd']) {
        await mkdir(path.join(dir, 'node_modules', name), { recursive: true });
        await writeFile(
          path.join(dir, 'node_modules', name, 'package.json'),
          JSON.stringify({ name, version: '7.0.0' }),
        );
      }
      return { code: 0 };
    });
    await cli(['store', 'link', root, '--group', group.key, '--union', '-y', '--offline']);
    expect((await readLinks(root)).find((link) => link.projectId === 'app-a')?.packages).toContain(
      'is-odd',
    );
    expect(
      (await readLinks(root)).find((link) => link.projectId === 'app-b')?.packages,
    ).not.toContain('is-odd');
  });
});
