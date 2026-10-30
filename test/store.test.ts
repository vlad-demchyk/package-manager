import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import {
  linkGroup,
  planStore,
  pruneTargets,
  readLinks,
  storeClosure,
  unlinkProjects,
} from '../src/store/store.js';
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
