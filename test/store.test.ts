import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import {
  linkGroup,
  hoistLockTree,
  lockChanges,
  planStore,
  pruneTargets,
  readLinks,
  storeClosure,
  unlinkProjects,
} from '../src/store/store.js';
import { treeViolations } from '../src/core/tree.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

const manifest = (name: string, react = '18.3.1'): object => ({
  name,
  dependencies: { react, 'react-dom': react },
});
const lock = (name: string, react = '18.3.1'): object =>
  lockfile(name, { react, 'react-dom': react }, { react, 'react-dom': react });

const FILES = {
  'app-a/package.json': manifest('app-a'),
  'app-a/package-lock.json': lock('app-a'),
  'app-b/package.json': manifest('app-b'),
  'app-b/package-lock.json': lock('app-b'),
  'app-c/package.json': manifest('app-c', '19.3.1'),
  'app-c/package-lock.json': lock('app-c', '19.3.1'),
  'app-d/package.json': { ...manifest('app-d'), scripts: { prepare: 'husky install' } },
  'app-d/package-lock.json': lock('app-d'),
};

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(
  extra: Record<string, string | object> = {},
): Promise<{ root: string; report: Report }> {
  const workspace = await makeWorkspace({ ...FILES, ...extra });
  cleanup = workspace.cleanup;
  const config = configSchema.parse({});
  const report = await analyze(await discoverWorkspace(workspace.root, { config }), {
    config,
    today: TODAY,
    security: false,
    usage: false,
    installedNodes: fakeNodes('24.9.0'),
  });
  return { root: workspace.root, report };
}

/** Stands in for `npm ci`: creates node_modules/react in the store. */
async function fakeInstall(dir: string): Promise<number> {
  await mkdir(path.join(dir, 'node_modules', 'react'), { recursive: true });
  await writeFile(
    path.join(dir, 'node_modules', 'react', 'package.json'),
    '{"name":"react","version":"18.3.1"}',
  );
  await writeFile(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({ packages: { '': {}, 'node_modules/react': { version: '18.3.1' } } }),
  );
  return 0;
}

describe('store plan', () => {
  it('does not relocate project-relative dependencies into exact or union stores', async () => {
    const { report } = await setup();
    for (const entry of report.projects)
      entry.project.dependencies.push({
        name: 'local',
        spec: 'file:../local',
        section: 'dependencies',
      });
    for (const union of [false, true]) {
      const plan = planStore(report, { union });
      expect(plan.groups).toEqual([]);
      expect(plan.excluded).toContainEqual({
        projectId: 'app-a',
        reason: 'local dependencies cannot be relocated into the store',
      });
    }
  });

  it('keeps lockfiles with different origins or integrity out of the same exact store', async () => {
    const { report } = await setup({
      'app-a/package-lock.json': {
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/react': { version: '18.3.1', resolved: 'https://one.invalid/react.tgz' },
        },
      },
      'app-b/package-lock.json': {
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/react': { version: '18.3.1', resolved: 'https://two.invalid/react.tgz' },
        },
      },
    });
    expect(planStore(report).groups).toEqual([]);
    expect(planStore(report).candidates).toContainEqual({
      projectIds: ['app-a', 'app-b'],
      reason: 'lockfile-differs',
    });
  });
  it('keeps Node versions and union lockfile changes in separate stores', async () => {
    const { report } = await setup();
    const exact = planStore(report).groups[0]?.key;
    const union = planStore(report, { union: true }).groups[0]?.key;
    const replacement = fakeNodes('22.19.0')[0];
    if (!replacement) throw new Error('Node expected');
    for (const entry of report.projects) if (entry.node.selected) entry.node.selected = replacement;
    expect(planStore(report).groups[0]?.key).not.toBe(exact);
    expect(planStore(report, { union: true }).groups[0]?.key).not.toBe(union);
    const before = planStore(report, { union: true }).groups[0]?.key;
    const locked = report.projects[0]?.project.lockfile?.packages[0];
    if (!locked) throw new Error('locked package expected');
    locked.version = '18.3.2';
    expect(planStore(report, { union: true }).groups[0]?.key).not.toBe(before);
  });

  it('keeps an existing union key only for links made with the current merge', async () => {
    const { root, report } = await setup();
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    await linkGroup(root, report, group, { replaceExisting: true, install: fakeInstall });
    const links = (await readLinks(root)).map((link) => ({ ...link, key: 'u-older-store' }));
    report.links = links;
    expect(planStore(report, { union: true }).groups[0]?.key).toBe('u-older-store');
    report.links = links.map((link) => {
      const copy = { ...link };
      delete copy.storeVersion;
      return copy;
    });
    expect(planStore(report, { union: true }).groups[0]?.key).toBe(group.key);
  });

  it('excludes exact members with no installed Node', async () => {
    const { report } = await setup();
    for (const entry of report.projects) delete entry.node.selected;
    const plan = planStore(report);
    expect(plan.groups).toEqual([]);
    expect(plan.excluded).toContainEqual({
      projectId: 'app-a',
      reason: 'no compatible installed Node',
    });
  });

  it('groups only projects with identical manifests and lockfiles, excluding unsafe install scripts', async () => {
    const { report } = await setup();
    const plan = planStore(report);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.projectIds).toEqual(['app-a', 'app-b']);
    expect(plan.excluded).toContainEqual({
      projectId: 'app-d',
      reason: 'install scripts write into the project directory',
    });
  });
});

describe('store plan --union', () => {
  it('requires one full Node version across members, including the patch', async () => {
    const { report } = await setup();
    const second = report.projects.find((entry) => entry.project.id === 'app-b');
    const alternate = fakeNodes('24.8.0')[0];
    if (!second || !alternate) throw new Error('member expected');
    second.node.selected = alternate;
    const plan = planStore(report, { union: true });
    expect(plan.groups).toEqual([]);
    expect(plan.candidates).toContainEqual({
      projectIds: ['app-a', 'app-b'],
      reason: 'node-differs',
    });
  });
  const unionFiles = {
    'wp-a/package.json': { name: 'wp-a', dependencies: { react: '17.0.1', '@pnp/sp': '4.12.0' } },
    'wp-b/package.json': { name: 'wp-b', dependencies: { react: '17.0.1', axios: '1.13.2' } },
    'wp-c/package.json': {
      name: 'wp-c',
      dependencies: { react: '17.0.1' },
      devDependencies: { '@pnp/sp': '4.12.0' },
    },
  };

  it('merges aligned dependencies of a version group into one manifest', async () => {
    const workspace = await makeWorkspace(unionFiles);
    cleanup = workspace.cleanup;
    const config = configSchema.parse({});
    const report = await analyze(await discoverWorkspace(workspace.root, { config }), {
      config,
      today: TODAY,
      security: false,
      usage: false,
      installedNodes: fakeNodes('24.9.0'),
    });
    const plan = planStore(report, { union: true });
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.mode).toBe('union');
    expect(plan.groups[0]?.manifest).toEqual({
      dependencies: { react: '17.0.1', '@pnp/sp': '4.12.0', axios: '1.13.2' },
    });
  });

  it('blocks the group and names the packages to align when versions differ', async () => {
    const workspace = await makeWorkspace({
      ...unionFiles,
      'wp-c/package.json': {
        name: 'wp-c',
        dependencies: { react: '17.0.1' },
        devDependencies: { '@pnp/sp': '4.13.0' },
      },
    });
    cleanup = workspace.cleanup;
    const config = configSchema.parse({});
    const report = await analyze(await discoverWorkspace(workspace.root, { config }), {
      config,
      today: TODAY,
      security: false,
      usage: false,
      installedNodes: fakeNodes('24.9.0'),
    });
    const plan = planStore(report, { union: true });
    expect(plan.groups).toHaveLength(0);
    expect(plan.candidates).toContainEqual(
      expect.objectContaining({ reason: 'versions-differ', packages: ['@pnp/sp'] }),
    );
  });
});

describe('store link and unlink', () => {
  it('reuses a completed store without reinstalling and preserves exact-mode backups on re-link', async () => {
    const { root, report } = await setup({ 'app-a/node_modules/own.txt': 'original' });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    const install = vi.fn(fakeInstall);
    await linkGroup(root, report, group, { replaceExisting: true, install });
    await linkGroup(root, report, group, { replaceExisting: false, install });
    expect(install).toHaveBeenCalledTimes(1);
    expect(
      (await readLinks(root)).find((link) => link.projectId === 'app-a')?.backupDir,
    ).toBeDefined();
    await unlinkProjects(root, undefined, { restore: true });
    expect(existsSync(path.join(root, 'app-a/node_modules'))).toBe(false);
    expect(existsSync(path.join(root, '.packman/trash'))).toBe(false);
  });

  it('retains recovery records when unlink encounters a real folder', async () => {
    const { root, report } = await setup({ 'app-a/node_modules/own.txt': 'original' });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    await linkGroup(root, report, group, { replaceExisting: true, install: fakeInstall });
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(root, 'app-a/node_modules'));
    await mkdir(path.join(root, 'app-a/node_modules'));
    const result = await unlinkProjects(root, undefined, { restore: true });
    expect(result.skipped.map((item) => item.projectId)).toEqual(['app-a']);
    const record = (await readLinks(root))[0];
    expect(record?.backupDir).toBeDefined();
    expect(
      (await pruneTargets(root, { trash: true })).some((target) =>
        record?.backupDir?.startsWith(target + path.sep),
      ),
    ).toBe(false);
  });

  it('tracks earlier members and file backups when linking a later member fails', async () => {
    const { root, report } = await setup({ 'app-b/node_modules/own.txt': 'original' });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    // Inject an operation failure after the second member's modules have been deleted.
    group.mode = 'union';
    const second = report.projects.find((entry) => entry.project.id === 'app-b');
    if (!second) throw new Error('member expected');
    Object.defineProperty(second.project, 'dependencies', {
      get() {
        throw new Error('simulated link failure');
      },
    });
    await expect(
      linkGroup(root, report, group, { replaceExisting: true, install: fakeInstall }),
    ).rejects.toThrow('simulated link failure');
    expect((await readLinks(root)).map((link) => link.projectId)).toEqual(['app-a', 'app-b']);
    const restored = await unlinkProjects(root, undefined, { restore: true });
    expect(restored.restored).toContain('app-b');
  });

  it('refuses to replace a real node_modules folder without --replace-existing', async () => {
    const { root, report } = await setup({ 'app-a/node_modules/.keep': '' });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    await expect(
      linkGroup(root, report, group, { replaceExisting: false, install: fakeInstall }),
    ).rejects.toThrow(/real node_modules folders found \(app-a\)/);
    expect(existsSync(path.join(root, '.packman', 'store'))).toBe(false);
  });

  it('clears the half-written tree of an interrupted store install before installing again', async () => {
    const { root, report } = await setup();
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    const leftover = path.join(root, '.packman/store', group.key, 'node_modules/half/package.json');
    await mkdir(path.dirname(leftover), { recursive: true });
    await writeFile(leftover, '{}');
    const install = vi.fn(async (dir: string) => {
      // npm would fail with ENOTEMPTY on its own leftovers; packman removes them first.
      expect(existsSync(path.join(dir, 'node_modules'))).toBe(false);
      return fakeInstall(dir);
    });
    await linkGroup(root, report, group, { replaceExisting: true, install });
    expect(install).toHaveBeenCalledTimes(1);
    expect(existsSync(leftover)).toBe(false);
    expect(existsSync(path.join(root, '.packman/store', group.key, 'node_modules/react'))).toBe(
      true,
    );
  });

  it('never deletes a store tree that a recorded link still points to', async () => {
    const { root, report } = await setup();
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    const target = path.join(root, '.packman/store', group.key, 'node_modules');
    const kept = path.join(target, 'react/package.json');
    await mkdir(path.dirname(kept), { recursive: true });
    await writeFile(kept, '{}');
    // No ready marker (interrupted), but another project's link record points at this tree.
    await mkdir(path.join(root, '.packman'), { recursive: true });
    await writeFile(
      path.join(root, '.packman/links.json'),
      JSON.stringify([
        { projectId: 'app-z', key: group.key, target, createdAt: new Date().toISOString() },
      ]),
    );
    const install = vi.fn((dir: string) => fakeInstall(dir));
    await expect(
      linkGroup(root, report, group, { replaceExisting: true, install }),
    ).rejects.toThrow(/linked but has no completed installation/);
    expect(install).not.toHaveBeenCalled();
    expect(existsSync(kept)).toBe(true);
  });

  it('does not link anything when the store install fails', async () => {
    const { root, report } = await setup({
      'app-a/node_modules/own.txt': 'keep after failed install',
    });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    await expect(
      linkGroup(root, report, group, { replaceExisting: true, install: () => Promise.resolve(1) }),
    ).rejects.toThrow(/nothing was linked/);
    expect(await readFile(path.join(root, 'app-a/node_modules/own.txt'), 'utf8')).toBe(
      'keep after failed install',
    );
  });

  it('deletes local modules, backs up only manifests/locks and restores those files on unlink', async () => {
    const { root, report } = await setup({ 'app-a/node_modules/own.txt': 'original' });
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');

    const result = await linkGroup(root, report, group, {
      replaceExisting: true,
      install: fakeInstall,
      now: TODAY,
    });
    expect(result.linked).toEqual(['app-a', 'app-b']);
    for (const id of ['app-a', 'app-b']) {
      expect((await lstat(path.join(root, id, 'node_modules'))).isSymbolicLink()).toBe(true);
      expect(existsSync(path.join(root, id, 'node_modules', 'react', 'package.json'))).toBe(true);
    }
    const storeManifest = JSON.parse(
      await readFile(path.join(result.storeDir, 'package.json'), 'utf8'),
    ) as {
      private: boolean;
      dependencies: Record<string, string>;
    };
    expect(storeManifest).toMatchObject({ private: true, dependencies: { react: '18.3.1' } });
    const links = await readLinks(root);
    expect(links.find((link) => link.projectId === 'app-a')?.backupDir).toContain(
      path.join('.packman', 'backups'),
    );

    const unlinked = await unlinkProjects(root, undefined, { restore: true });
    expect(unlinked.unlinked).toEqual(['app-a', 'app-b']);
    expect(unlinked.restored).toEqual(['app-a', 'app-b']);
    expect(existsSync(path.join(root, 'app-a', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, '.packman', 'trash'))).toBe(false);
    const backupDir = links.find((link) => link.projectId === 'app-a')?.backupDir;
    if (!backupDir) throw new Error('backup expected');
    expect(existsSync(path.join(backupDir, 'app-a', 'package.json'))).toBe(true);
    expect(existsSync(path.join(backupDir, 'app-a', 'package-lock.json'))).toBe(true);
    expect(existsSync(path.join(backupDir, 'app-a', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'app-b', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(result.storeDir, 'node_modules', 'react', 'package.json'))).toBe(
      true,
    );
    expect(await readLinks(root)).toEqual([]);
  });
});

describe('store dependency closure', () => {
  it('finds hoisted dependencies reached through nested packages without linking unrelated names', async () => {
    const workspace = await makeWorkspace({
      'store/package-lock.json': {
        lockfileVersion: 3,
        packages: {
          '': {},
          'node_modules/root': { version: '1.0.0', dependencies: { nested: '1' } },
          'node_modules/root/node_modules/nested': {
            version: '1.0.0',
            dependencies: { hoisted: '1' },
          },
          'node_modules/hoisted': { version: '1.0.0' },
          'node_modules/unrelated': { version: '1.0.0' },
        },
      },
      'store/node_modules/root/package.json': { name: 'root' },
      'store/node_modules/hoisted/package.json': { name: 'hoisted' },
      'store/node_modules/unrelated/package.json': { name: 'unrelated' },
    });
    cleanup = workspace.cleanup;
    expect(await storeClosure(path.join(workspace.root, 'store/node_modules'), ['root'])).toEqual([
      'hoisted',
      'root',
    ]);
  });
});

describe('store tree check', () => {
  it('finds the mixed-lockfile breakage: schema-utils@2 resolving ajv-keywords@5 nested under it', () => {
    const { broken, peers } = treeViolations({
      '': { dependencies: { 'copy-webpack-plugin': '6.0.4' } },
      'node_modules/copy-webpack-plugin': {
        version: '6.0.4',
        dependencies: { 'schema-utils': '^2.7.0' },
      },
      'node_modules/schema-utils': {
        version: '2.7.1',
        dependencies: { ajv: '^6.12.4', 'ajv-keywords': '^3.5.2' },
      },
      'node_modules/schema-utils/node_modules/ajv-keywords': {
        version: '5.1.0',
        peerDependencies: { ajv: '^8.8.2' },
      },
      'node_modules/schema-utils/node_modules/ajv': { version: '8.18.0' },
      'node_modules/ajv': { version: '6.12.6' },
      'node_modules/ajv-keywords': { version: '3.5.2', peerDependencies: { ajv: '^6.9.1' } },
    });
    expect(broken).toEqual([
      'node_modules/schema-utils -> ajv@^6.12.4: 8.18.0',
      'node_modules/schema-utils -> ajv-keywords@^3.5.2: 5.1.0',
    ]);
    expect(peers).toEqual([]);
  });

  it('accepts own nested copies, reports peers and ignores optional or non-registry edges', () => {
    const { broken, peers } = treeViolations({
      '': { dependencies: { a: '^1.0.0', alias: 'npm:b@^1.0.0' } },
      'node_modules/a': {
        version: '1.2.0',
        dependencies: { b: '^2.0.0' },
        peerDependencies: { react: '^18.0.0', vue: '^3.0.0' },
        peerDependenciesMeta: { vue: { optional: true } },
      },
      'node_modules/a/node_modules/b': { version: '2.1.0' },
      'node_modules/b': { version: '1.0.0' },
      'node_modules/react': { version: '17.0.2' },
      'node_modules/fsevents': { version: '2.3.3', optional: true, dependencies: { gone: '^1' } },
    });
    expect(broken).toEqual([]);
    expect(peers).toEqual(['node_modules/a -> react@^18.0.0: 17.0.2']);
  });

  it('lists the majors the store moves members to', async () => {
    const { root, report } = await setup();
    const storeLock = path.join(root, 'store-lock.json');
    await writeFile(
      storeLock,
      JSON.stringify({ packages: { 'node_modules/react': { version: '19.3.1' } } }),
    );
    const members = report.projects.map((entry) => entry.project);
    expect(await lockChanges(members, storeLock)).toEqual([
      'react: 18.3.1 (app-a, app-b, app-d) -> 19.3.1',
    ]);
  });
});

describe('store link tree check', () => {
  it('refuses to link a tree with a dependency outside its range and links nothing', async () => {
    const { root, report } = await setup();
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    const install = async (dir: string): Promise<number> => {
      await fakeInstall(dir);
      await writeFile(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({
          packages: {
            '': {},
            'node_modules/react': { version: '18.3.1', dependencies: { 'loose-envify': '^1.1.0' } },
            'node_modules/loose-envify': { version: '2.0.0' },
          },
        }),
      );
      return 0;
    };
    await expect(
      linkGroup(root, report, group, { replaceExisting: true, install }),
    ).rejects.toThrow('node_modules/react -> loose-envify@^1.1.0: 2.0.0');
    expect(await readLinks(root)).toEqual([]);
  });

  it('links a tree with peer gaps and reports them as incompatibilities', async () => {
    const { root, report } = await setup();
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    const install = async (dir: string): Promise<number> => {
      await fakeInstall(dir);
      await writeFile(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({
          packages: {
            '': {},
            'node_modules/react': { version: '18.3.1' },
            'node_modules/old-ui': { version: '1.0.0', peerDependencies: { react: '^16.0.0' } },
          },
        }),
      );
      return 0;
    };
    const result = await linkGroup(root, report, group, { replaceExisting: true, install });
    expect(result.peers).toEqual(['node_modules/old-ui -> react@^16.0.0: 18.3.1']);
    expect((await readLinks(root)).length).toBeGreaterThan(0);
  });

  it('writes project locks a standalone npm ci can install: nested copies hoisted where free', async () => {
    const { root, report } = await setup();
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('group expected');
    const install = async (dir: string): Promise<number> => {
      await fakeInstall(dir);
      await writeFile(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({
          packages: {
            '': {},
            'node_modules/react': { version: '18.3.1' },
            'node_modules/react-dom': { version: '18.3.1', dependencies: { scheduler: '^0.23.0' } },
            'node_modules/react-dom/node_modules/scheduler': { version: '0.23.2' },
            // Top slot taken in the store by a package no member of this test reaches.
            'node_modules/scheduler': { version: '0.99.0' },
          },
        }),
      );
      return 0;
    };
    await linkGroup(root, report, group, { replaceExisting: true, install, syncLocks: true });
    const { packages: lock } = JSON.parse(
      await readFile(path.join(root, 'app-a', 'package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version?: string }> };
    expect(Object.keys(lock)).toEqual([
      '',
      'node_modules/react',
      'node_modules/react-dom',
      'node_modules/scheduler',
    ]);
    expect(lock['node_modules/scheduler']?.version).toBe('0.23.2');
  });
});

describe('store plan warnings', () => {
  const vite = (name: string): Record<string, string | object> => ({
    [`${name}/package.json`]: { name, devDependencies: { vite: '7.3.7' } },
    [`${name}/package-lock.json`]: lockfile(name, { vite: '7.3.7' }, { vite: '7.3.7' }),
    [`${name}/vite.config.js`]: 'export default {};\n',
  });

  it('warns about the shared Vite cache only where node_modules is one junction (exact)', async () => {
    const { report } = await setup({ ...vite('vite-a'), ...vite('vite-b') });
    const viteGroup = (union: boolean) =>
      planStore(report, { union }).groups.find((group) => group.projectIds.includes('vite-a'));
    expect(viteGroup(false)?.warnings).toContain(
      'vite: set cacheDir per project, node_modules/.vite would be shared',
    );
    // `packages` links keep node_modules a real project folder: .vite and .vite-temp stay there.
    const union = viteGroup(true);
    expect(union?.projectIds).toEqual(['vite-a', 'vite-b']);
    expect(union?.warnings.some((warning) => warning.startsWith('vite:'))).toBe(false);
  });

  it('names gulpfile webpack rules written against <project>/node_modules', async () => {
    const rule = (wrapped: boolean): string =>
      `const path = require('path');\nmodule.exports = { rules: [{ test: /js$/, include: ${
        wrapped
          ? "require('fs').realpathSync(path.join(__dirname, 'node_modules', 'web-push'))"
          : "path.join(__dirname, 'node_modules', 'web-push')"
      } }] };\n`;
    const { report } = await setup({
      'app-a/gulpfile.js': rule(false),
      'app-b/gulpfile.js': rule(true),
    });
    const group = planStore(report).groups.find((item) => item.projectIds.includes('app-a'));
    const found = group?.warnings.filter((warning) => warning.includes('gulpfile.js'));
    expect(found).toEqual([
      'app-a: gulpfile.js webpack rule include matches <project>/node_modules, but webpack resolves linked packages to the store; wrap that path in fs.realpathSync(...)',
    ]);
  });
});

describe('project locks written from the store tree', () => {
  it('hoists a nested copy into a free top-level slot, and repeats for what it brought along', () => {
    // In the store, the top slot holds another member's @rushstack/eslint-config 2.5.1.
    const tree = hoistLockTree({
      'node_modules/@microsoft/eslint-config-spfx': {
        version: '1.18.2',
        dependencies: { '@rushstack/eslint-config': '3.4.0' },
      },
      'node_modules/@microsoft/eslint-config-spfx/node_modules/@rushstack/eslint-config': {
        version: '3.4.0',
        dependencies: { parser: '5.59.11' },
      },
      'node_modules/@microsoft/eslint-config-spfx/node_modules/@rushstack/eslint-config/node_modules/parser':
        { version: '5.59.11' },
    });
    // Its own dependency had a free slot too, as in a standalone npm install.
    expect(
      Object.fromEntries(Object.entries(tree).map(([key, entry]) => [key, entry.version])),
    ).toEqual({
      'node_modules/@microsoft/eslint-config-spfx': '1.18.2',
      'node_modules/@rushstack/eslint-config': '3.4.0',
      'node_modules/parser': '5.59.11',
    });
  });

  it('leaves a package nested and says so when a hoist does not settle within the limit', () => {
    const packages = {
      'node_modules/cfg': { version: '1.0.0', dependencies: { rules: '3.4.0' } },
      'node_modules/cfg/node_modules/rules': { version: '3.4.0' },
    };
    const warnings: string[] = [];
    expect(hoistLockTree(packages, { limit: 0, warnings })).toEqual(packages);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/rules stays nested at node_modules\/cfg\/node_modules\/rules/);
    expect(warnings[0]).toMatch(/2 lock entries/);
    // With the default limit the same tree hoists fine and says nothing.
    const quiet: string[] = [];
    expect(Object.keys(hoistLockTree(packages, { warnings: quiet }))).toContain(
      'node_modules/rules',
    );
    expect(quiet).toEqual([]);
  });

  it('moves a nested copy together with the packages nested under it', () => {
    const tree = hoistLockTree({
      'node_modules/cfg': { version: '1.0.0', dependencies: { rules: '3.4.0' } },
      'node_modules/cfg/node_modules/rules': {
        version: '3.4.0',
        dependencies: { parser: '5.59.11' },
      },
      'node_modules/cfg/node_modules/rules/node_modules/parser': { version: '5.59.11' },
      'node_modules/parser': { version: '5.62.0' },
    });
    expect(Object.keys(tree)).toEqual([
      'node_modules/cfg',
      'node_modules/parser',
      'node_modules/rules',
      'node_modules/rules/node_modules/parser',
    ]);
  });

  it('never nests a peer under the package that needs it (npm ci rejects such a lock)', () => {
    // heft 1.22: ajv-draft-04 wants ajv ^8 as a peer, next to it under api-extractor; ajv 6 at the top.
    const packages = {
      'node_modules/api-extractor': {
        version: '7.52.0',
        dependencies: { ajv: '~8.13.0', 'ajv-draft-04': '~1.0.0' },
      },
      'node_modules/api-extractor/node_modules/ajv': { version: '8.13.0' },
      'node_modules/api-extractor/node_modules/ajv-draft-04': {
        version: '1.0.0',
        peerDependencies: { ajv: '^8.5.0' },
      },
      'node_modules/ajv': { version: '6.15.0' },
    };
    expect(hoistLockTree(packages)).toEqual(packages);
  });

  it('copies under the hoisted package what it found next to it, as npm nests it', () => {
    const tree = hoistLockTree({
      'node_modules/a': { version: '1.0.0', dependencies: { b: '1.0.0', c: '2.0.0' } },
      'node_modules/a/node_modules/b': { version: '1.0.0', dependencies: { c: '2.0.0' } },
      'node_modules/a/node_modules/c': { version: '2.0.0' },
      'node_modules/c': { version: '1.0.0' },
    });
    // b at the top alone would load c@1 instead of the c@2 it used under a.
    expect(
      Object.fromEntries(Object.entries(tree).map(([key, entry]) => [key, entry.version])),
    ).toEqual({
      'node_modules/a': '1.0.0',
      'node_modules/a/node_modules/c': '2.0.0',
      'node_modules/b': '1.0.0',
      'node_modules/b/node_modules/c': '2.0.0',
      'node_modules/c': '1.0.0',
    });
  });
});
