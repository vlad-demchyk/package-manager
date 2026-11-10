import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { buildProgram } from '../src/cli/main.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import * as runner from '../src/exec/run.js';
import * as toolchain from '../src/node/toolchain.js';
import { peerRangesOn } from '../src/core/lockfile.js';
import { parseRequest, planAdd, planRemove, removalUsage } from '../src/ops/add.js';
import { scanSources } from '../src/scan/sources.js';
import { readLinks } from '../src/store/store.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue(fakeNodes('24.9.0', '22.19.0'));
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

const cli = (args: string[]) => buildProgram().parseAsync(args, { from: 'user' });

async function setup(
  files: Record<string, string | object>,
  config: object = {},
): Promise<{ root: string; report: Report; config: ReturnType<typeof configSchema.parse> }> {
  const workspace = await makeWorkspace(files);
  cleanup = workspace.cleanup;
  const parsed = configSchema.parse(config);
  const report = await analyze(await discoverWorkspace(workspace.root, { config: parsed }), {
    config: parsed,
    today: TODAY,
    security: false,
    usage: false,
    installedNodes: fakeNodes('24.9.0'),
  });
  return { root: workspace.root, report, config: parsed };
}

const PAIR = {
  'app-a/package.json': {
    name: 'app-a',
    dependencies: { react: '18.3.1', 'react-dom': '18.3.1', lodash: '4.17.21' },
  },
  'app-a/package-lock.json': lockfile(
    'app-a',
    { react: '18.3.1', 'react-dom': '18.3.1', lodash: '4.17.21' },
    { react: '18.3.1', 'react-dom': '18.3.1', lodash: '4.17.21' },
  ),
  'app-b/package.json': { name: 'app-b', dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } },
  'app-b/package-lock.json': lockfile(
    'app-b',
    { react: '18.3.1', 'react-dom': '18.3.1' },
    { react: '18.3.1', 'react-dom': '18.3.1' },
  ),
};

/** Registry stand-in: one packument per name, served from memory. */
function fakeRegistry(packuments: Record<string, object>): typeof fetch {
  return (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', ''));
    const body = packuments[name];
    return Promise.resolve(
      body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
  };
}

describe('add: version choice', () => {
  it('parses name@range requests, scoped or not', () => {
    expect(parseRequest('lodash')).toEqual({ name: 'lodash' });
    expect(parseRequest('lodash@^4')).toEqual({ name: 'lodash', range: '^4' });
    expect(parseRequest('@pnp/sp@3.20.1')).toEqual({ name: '@pnp/sp', range: '3.20.1' });
    expect(parseRequest('@pnp/sp')).toEqual({ name: '@pnp/sp' });
  });

  it('reuses the spec the group already declares, verbatim, before asking the registry', async () => {
    const { report, config } = await setup(PAIR);
    const target = report.projects.find((entry) => entry.project.id === 'app-b');
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: 'lodash' }], {
      offline: true,
      config,
    });
    expect(plan?.choice).toMatchObject({ spec: '4.17.21', source: 'group' });
    expect(plan?.choice.detail).toContain('app-a');
    expect(plan?.checks).toEqual([]);
    expect(plan?.fix?.edits).toEqual([
      {
        kind: 'json-set',
        file: target.project.manifestPath,
        path: ['dependencies', 'lodash'],
        value: '4.17.21',
      },
    ]);
  });

  it('takes a group pin first, and an explicit request over everything', async () => {
    const { report, config } = await setup(PAIR, {
      policy: { groups: [{ name: 'web', projects: ['app-*'], pins: { lodash: '4.17.20' } }] },
    });
    const target = report.projects.find((entry) => entry.project.id === 'app-b');
    if (!target) throw new Error('project expected');
    const [pinned] = await planAdd(report, [target], [{ name: 'lodash' }], {
      offline: true,
      config,
    });
    expect(pinned?.choice).toMatchObject({ spec: '4.17.20', source: 'pin' });
    const [requested] = await planAdd(report, [target], [{ name: 'lodash', range: '^4.17.0' }], {
      offline: true,
      config,
    });
    expect(requested?.choice).toMatchObject({ spec: '^4.17.0', source: 'request' });
  });

  it('pins SPFx lockstep packages to the project SPFx version and flags other versions', async () => {
    const { report, config } = await setup({
      'wp/package.json': {
        name: 'wp',
        dependencies: { '@microsoft/sp-core-library': '1.18.2', react: '17.0.1' },
      },
    });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: '@microsoft/sp-http' }], {
      offline: true,
      config,
    });
    expect(plan?.choice).toMatchObject({ spec: '1.18.2', source: 'spfx-matrix' });
    const [wrong] = await planAdd(
      report,
      [target],
      [{ name: '@microsoft/sp-http', range: '1.21.1' }],
      {
        offline: true,
        config,
      },
    );
    expect(wrong?.checks.map((check) => check.kind)).toContain('lockstep');
  });

  it('picks from the registry the highest version compatible with the project Node and peers', async () => {
    const { report, config } = await setup({
      'app/package.json': { name: 'app', dependencies: { react: '18.3.1' } },
      'app/package-lock.json': lockfile('app', { react: '18.3.1' }, { react: '18.3.1' }),
    });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const name = `packman-test-${Date.now()}`;
    const fetchImpl = fakeRegistry({
      [name]: {
        'dist-tags': { latest: '3.0.0' },
        versions: {
          '1.0.0': {},
          '2.0.0': { peerDependencies: { react: '^18.0.0' } },
          '2.5.0': { peerDependencies: { react: '^19.0.0' } },
          '3.0.0': { engines: { node: '>=26' } },
          '4.0.0-beta.1': {},
        },
      },
    });
    const [plan] = await planAdd(report, [target], [{ name }], {
      offline: false,
      fetchImpl,
      config,
    });
    expect(plan?.choice).toMatchObject({ spec: '2.0.0', version: '2.0.0', source: 'registry' });
    expect(plan?.choice.detail).toContain('compatible');
    const [ranged] = await planAdd(report, [target], [{ name }], {
      offline: false,
      fetchImpl,
      config: configSchema.parse({ policy: { exactVersions: false } }),
    });
    expect(ranged?.choice.spec).toBe('^2.0.0');
    const [requested] = await planAdd(report, [target], [{ name, range: '2.5.0' }], {
      offline: false,
      fetchImpl,
      config,
    });
    expect(requested?.checks).toContainEqual(
      expect.objectContaining({ kind: 'peer', severity: 'error' }),
    );
  });

  it('fails offline without a known version instead of guessing', async () => {
    const { report, config } = await setup({ 'app/package.json': { name: 'app' } });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: `packman-test-none-${Date.now()}` }], {
      offline: true,
      config,
    });
    expect(plan?.fix).toBeUndefined();
    expect(plan?.checks[0]).toMatchObject({ severity: 'error' });
    expect(plan?.checks[0]?.suggestion).toContain('@<version>');
  });
});

describe('add: checks', () => {
  it('rejects a family member at another version and a version outside installed peer ranges', async () => {
    const { report, config } = await setup({
      'app/package.json': {
        name: 'app',
        dependencies: { react: '18.3.1', 'some-ui': '1.0.0' },
      },
      'app/package-lock.json': lockfile(
        'app',
        { react: '18.3.1', 'some-ui': '1.0.0' },
        {
          react: '18.3.1',
          'some-ui': { version: '1.0.0', peerDependencies: { 'react-dom': '^18.0.0' } },
        },
      ),
    });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: 'react-dom', range: '19.0.0' }], {
      offline: true,
      config,
    });
    const kinds = plan?.checks.map((check) => `${check.kind}:${check.severity}`) ?? [];
    expect(kinds).toContain('family:error');
    expect(kinds).toContain('peer:error');
    expect(plan?.checks.find((check) => check.kind === 'family')?.suggestion).toContain(
      'react-dom@18.3.1',
    );
  });

  it('blocks a linked project from leaving its group and offers the alternatives', async () => {
    const { report, config } = await setup(PAIR);
    const target = report.projects.find((entry) => entry.project.id === 'app-b');
    if (!target) throw new Error('project expected');
    target.project.nodeModules = 'link';
    const [plan] = await planAdd(report, [target], [{ name: 'lodash', range: '3.10.1' }], {
      offline: true,
      config,
    });
    const group = plan?.checks.find((check) => check.kind === 'group');
    expect(group?.severity).toBe('error');
    expect(group?.message).toContain('app-a (4.17.21)');
    expect(group?.suggestion).toContain('packman add lodash@4.17.21 -p app-b');
    expect(group?.suggestion).toContain('align --package lodash');
    expect(group?.suggestion).toContain('store unlink -p app-b');
    expect(plan?.checks.map((check) => check.kind)).toContain('major');
    expect(plan?.fix?.risk).toBe('breaking');
    // The same divergence in a project with its own node_modules is a warning, not a stop.
    target.project.nodeModules = 'folder';
    const [loose] = await planAdd(report, [target], [{ name: 'lodash', range: '3.10.1' }], {
      offline: true,
      config,
    });
    expect(loose?.checks.find((check) => check.kind === 'group')?.severity).toBe('warning');
  });

  it('marks a version edit that crosses a documented API break as breaking, with the guide', async () => {
    const { report, config } = await setup({
      'app/package.json': { name: 'app', dependencies: { '@pnp/sp': '2.15.0' } },
      'app/package-lock.json': lockfile('app', { '@pnp/sp': '2.15.0' }, { '@pnp/sp': '2.15.0' }),
    });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: '@pnp/sp', range: '3.20.1' }], {
      offline: true,
      config,
    });
    const api = plan?.checks.find((check) => check.kind === 'api');
    expect(api?.severity).toBe('warning');
    expect(api?.message).toContain('@pnp/sp 2.15.0 -> 3.20.1');
    // Places and migration steps come one per line, never glued into one string.
    const steps = api?.lines?.filter((line) => line.startsWith('-> ')) ?? [];
    expect(steps.length).toBeGreaterThan(1);
    expect(api?.lines?.some((line) => line.includes('; -> '))).toBe(false);
    expect(api?.suggestion).toBeUndefined();
    expect(plan?.fix?.risk).toBe('breaking');
  });

  it('reads the peer ranges of the installed packages through one shared helper', () => {
    const project = {
      dependencies: [
        { name: 'react', spec: '18.3.1', section: 'dependencies' },
        { name: 'some-ui', spec: '1.0.0', section: 'dependencies' },
        { name: 'react-dom', spec: '*', section: 'peerDependencies' },
      ],
      lockfile: {
        packages: [
          { name: 'react', version: '18.3.1', location: 'node_modules/react' },
          {
            name: 'some-ui',
            version: '1.0.0',
            location: 'node_modules/some-ui',
            peerDependencies: { 'react-dom': '^18.0.0', react: '^18.0.0' },
          },
          {
            name: 'some-ui',
            version: '0.9.0',
            location: 'node_modules/nested/node_modules/some-ui',
            peerDependencies: { 'react-dom': '^17.0.0' },
          },
        ],
      },
    } as unknown as Parameters<typeof peerRangesOn>[0];
    // Only top-level copies count, and the package itself is never its own peer source.
    expect(
      peerRangesOn(project, 'react-dom').map(
        (item) => `${item.locked.name}@${item.locked.version} ${item.range}`,
      ),
    ).toEqual(['some-ui@1.0.0 ^18.0.0']);
    expect(peerRangesOn(project, 'some-ui')).toEqual([]);
  });

  it('remove warns where a package is still imported or needed by the tooling', async () => {
    const { report } = await setup({
      'app/package.json': {
        name: 'app',
        dependencies: { lodash: '4.17.21', react: '18.3.1' },
        devDependencies: { eslint: '8.57.1', 'eslint-plugin-react': '7.37.0' },
        scripts: { lint: 'eslint src' },
      },
      'app/src/index.ts': 'import { chunk } from "lodash";\nexport const x = chunk([1], 1);\n',
      'app/.eslintrc.js': 'module.exports = { plugins: ["eslint-plugin-react"] };\n',
    });
    const target = report.projects[0];
    if (!target) throw new Error('project expected');
    const scan = await scanSources(target.project.dir);
    const uses = await removalUsage(
      target.project,
      ['lodash', 'react', 'eslint', 'eslint-plugin-react'],
      scan,
    );
    const byName = Object.fromEntries(uses.map((use) => [use.name, use.places.join('; ')]));
    expect(byName['lodash']).toContain('imported in src/index.ts');
    expect(byName['eslint']).toMatch(/config \.eslintrc\.js|script uses eslint/);
    expect(byName['eslint-plugin-react']).toMatch(/referenced in \.eslintrc\.js|eslint plugin/);
    expect(byName['react']).toBeUndefined();
  });

  it('moves a package to devDependencies with --dev and removes declared packages only', async () => {
    const { report, config } = await setup(PAIR);
    const target = report.projects.find((entry) => entry.project.id === 'app-a');
    if (!target) throw new Error('project expected');
    const [plan] = await planAdd(report, [target], [{ name: 'lodash' }], {
      dev: true,
      offline: true,
      config,
    });
    expect(plan?.section).toBe('devDependencies');
    expect(plan?.fix?.edits.map((edit) => edit.kind)).toEqual(['json-remove', 'json-set']);
    const removal = planRemove(target.project, ['lodash', 'nothing']);
    expect(removal.missing).toEqual(['nothing']);
    expect(removal.fix?.edits).toEqual([
      { kind: 'json-remove', file: target.project.manifestPath, path: ['dependencies', 'lodash'] },
    ]);
  });
});

/** Stands in for npm in the store: installs whatever the store manifest declares. */
async function fakeStoreInstall(dir: string): Promise<{ code: number }> {
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const packages: Record<string, object> = { '': {} };
  for (const [name, spec] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    const version = semver.coerce(spec)?.version ?? '0.0.0';
    await mkdir(path.join(dir, 'node_modules', name), { recursive: true });
    await writeFile(
      path.join(dir, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
    packages[`node_modules/${name}`] = { version };
  }
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ packages }));
  return { code: 0 };
}

describe('add and remove commands', () => {
  it('writes the manifest and runs npm install in a project with its own node_modules', async () => {
    const { root } = await setup(PAIR);
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await cli(['add', 'lodash', '-p', 'app-b', '-C', root, '--offline']);
    expect(run).not.toHaveBeenCalled();
    let manifest = JSON.parse(await readFile(path.join(root, 'app-b/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies.lodash).toBeUndefined();
    await cli(['add', 'lodash', '-p', 'app-b', '-C', root, '--offline', '--apply', '-y']);
    manifest = JSON.parse(await readFile(path.join(root, 'app-b/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies.lodash).toBe('4.17.21');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toBe(path.join(root, 'app-b'));
    expect(run.mock.calls[0]?.[2]).toEqual(['install', '--no-audit', '--no-fund']);
    expect(existsSync(path.join(root, '.packman/backups'))).toBe(true);
  });

  it('scans the selected project for API usage and prints each break once, per line', async () => {
    const { root } = await setup({
      'app/package.json': { name: 'app', dependencies: { '@pnp/sp': '2.15.0' } },
      'app/package-lock.json': lockfile('app', { '@pnp/sp': '2.15.0' }, { '@pnp/sp': '2.15.0' }),
      'app/src/data.ts': 'import { sp } from "@pnp/sp";\nexport const items = sp.web.lists;\n',
    });
    const log = vi.mocked(console.log);
    log.mockClear();
    await cli(['add', '@pnp/sp@3.20.1', '-p', 'app', '-C', root, '--offline']);
    const lines = log.mock.calls.map((call) => String(call[0]));
    // The sources were scanned: the place that uses the old API is named.
    expect(lines.some((line) => /src[\\/]data\.ts:1/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes('no known old-API usage'))).toBe(false);
    // The break is explained with the check, not again by the shared apply flow.
    expect(lines.filter((line) => line.includes('2.15.0 -> 3.20.1')).length).toBe(1);
    expect(lines.some((line) => line.includes('cross a documented API break'))).toBe(false);
    // Steps are separate lines.
    expect(lines.filter((line) => line.includes('    -> ')).length).toBeGreaterThan(1);
  });

  it('remove warns about a package the sources still import, and --verify about unlinked projects', async () => {
    const { root } = await setup({
      ...PAIR,
      'app-a/src/index.ts': 'import { chunk } from "lodash";\nexport const x = chunk([1], 1);\n',
    });
    vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    const log = vi.mocked(console.log);
    log.mockClear();
    await cli(['remove', 'lodash', '-p', 'app-a', '-C', root, '--offline']);
    expect(
      log.mock.calls.some(
        (call) =>
          String(call[0]).includes('lodash is still used') &&
          String(call[0]).includes('imported in src/index.ts'),
      ),
    ).toBe(true);
    log.mockClear();
    await cli([
      'add',
      'lodash',
      '-p',
      'app-b',
      '-C',
      root,
      '--offline',
      '--apply',
      '-y',
      '--verify',
    ]);
    expect(
      log.mock.calls.some((call) => String(call[0]).includes('--verify build applies to linked')),
    ).toBe(true);
  });

  it('install says --refresh does nothing without --sync-store', async () => {
    const { root } = await setup(PAIR);
    vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    const log = vi.mocked(console.log);
    log.mockClear();
    await cli(['install', root, '-y', '--offline', '--refresh']);
    expect(log.mock.calls.some((call) => String(call[0]).includes('--refresh has no effect'))).toBe(
      true,
    );
  });

  it('refuses a blocked add without writing and exits 1', async () => {
    const { root } = await setup(PAIR);
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await cli(['add', 'react-dom@19.0.0', '-p', 'app-a', '-C', root, '--offline', '--apply', '-y']);
    expect(process.exitCode).toBe(1);
    expect(run).not.toHaveBeenCalled();
    const manifest = JSON.parse(await readFile(path.join(root, 'app-a/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['react-dom']).toBe('18.3.1');
  });

  it('linked project: no npm in the project, store rebuilt, every member relinked, locks synced', async () => {
    const { root } = await setup(PAIR);
    const run = vi
      .spyOn(runner, 'runWithNode')
      .mockImplementation(async (_node, dir) => fakeStoreInstall(dir));
    await cli(['store', 'link', root, '--of', 'app-a', '--union', '-y', '--offline']);
    const before = await readLinks(root);
    expect(before.map((link) => link.projectId).sort()).toEqual(['app-a', 'app-b']);
    const oldKey = before[0]?.key;
    run.mockClear();

    await cli(['add', 'is-odd@3.0.1', '-p', 'app-b', '-C', root, '--offline', '--apply', '-y']);
    expect(process.exitCode).toBe(0);
    // npm ran exactly once, in the new store, never in a project directory.
    expect(run).toHaveBeenCalledTimes(1);
    const cwd = run.mock.calls[0]?.[1] ?? '';
    expect(cwd.startsWith(path.join(root, '.packman', 'store'))).toBe(true);
    expect(cwd).not.toContain(path.join(root, 'app-'));
    expect(run.mock.calls[0]?.[2]).toEqual(['install', '--no-audit', '--no-fund']);

    const manifest = JSON.parse(await readFile(path.join(root, 'app-b/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['is-odd']).toBe('3.0.1');
    const links = await readLinks(root);
    expect(links.map((link) => link.projectId).sort()).toEqual(['app-a', 'app-b']);
    for (const link of links) expect(link.key).not.toBe(oldKey);
    expect(new Set(links.map((link) => link.key)).size).toBe(1);
    expect(links.find((link) => link.projectId === 'app-b')?.packages).toContain('is-odd');
    expect(links.find((link) => link.projectId === 'app-a')?.packages).not.toContain('is-odd');
    expect(existsSync(path.join(root, 'app-b/node_modules/is-odd'))).toBe(true);
    const lock = JSON.parse(await readFile(path.join(root, 'app-b/package-lock.json'), 'utf8')) as {
      lockfileVersion: number;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages['node_modules/is-odd']?.version).toBe('3.0.1');

    // remove brings the group back to the previous manifests and store key.
    run.mockClear();
    await cli(['remove', 'is-odd', '-p', 'app-b', '-C', root, '--offline', '--apply', '-y']);
    expect(run).toHaveBeenCalledTimes(1);
    expect((run.mock.calls[0]?.[1] ?? '').startsWith(path.join(root, '.packman', 'store'))).toBe(
      true,
    );
    // Keys include the members' lock fingerprints, which lock sync rewrote; one group, one key.
    const restored = await readLinks(root);
    expect(new Set(restored.map((link) => link.key)).size).toBe(1);
    expect(restored.find((link) => link.projectId === 'app-b')?.packages).not.toContain('is-odd');
    const back = JSON.parse(await readFile(path.join(root, 'app-b/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(back.dependencies['is-odd']).toBeUndefined();
    expect(existsSync(path.join(root, 'app-b/node_modules/is-odd'))).toBe(false);
  });

  it('install tells a linked project what to do instead of running npm', async () => {
    const { root } = await setup(PAIR);
    const run = vi
      .spyOn(runner, 'runWithNode')
      .mockImplementation(async (_node, dir) => fakeStoreInstall(dir));
    await cli(['store', 'link', root, '--of', 'app-a', '--union', '-y', '--offline']);
    run.mockClear();
    const log = vi.mocked(console.log);
    log.mockClear();
    await cli(['install', root, '-y', '--offline']);
    expect(run).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('app-a') && line.includes('up to date'))).toBe(true);

    // A manifest change makes the link stale: install says so and --sync-store rebuilds the store.
    const file = path.join(root, 'app-b/package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies['is-odd'] = '3.0.1';
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    log.mockClear();
    await cli(['install', root, '-y', '--offline']);
    expect(run).not.toHaveBeenCalled();
    expect(
      log.mock.calls.some(
        (call) =>
          String(call[0]).includes('app-b') && String(call[0]).includes('package.json changed'),
      ),
    ).toBe(true);
    await cli(['install', root, '-y', '--offline', '--sync-store']);
    expect(run).toHaveBeenCalledTimes(1);
    expect((run.mock.calls[0]?.[1] ?? '').startsWith(path.join(root, '.packman', 'store'))).toBe(
      true,
    );
    expect(existsSync(path.join(root, 'app-b/node_modules/is-odd'))).toBe(true);
  });
});
