import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { linkGroup, planStore, readLinks, unlinkProjects } from '../src/store/store.js';
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
    const { root, report } = await setup();
    const group = planStore(report).groups[0];
    if (!group) throw new Error('group expected');
    await expect(
      linkGroup(root, report, group, { replaceExisting: false, install: () => Promise.resolve(1) }),
    ).rejects.toThrow(/nothing was linked/);
    expect(existsSync(path.join(root, 'app-a', 'node_modules'))).toBe(false);
  });

  it('links projects to one store and restores them on unlink', async () => {
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
    expect(links.find((link) => link.projectId === 'app-a')?.movedTo).toContain(
      path.join('.packman', 'trash'),
    );

    const unlinked = await unlinkProjects(root, undefined, { restore: true });
    expect(unlinked.unlinked).toEqual(['app-a', 'app-b']);
    expect(unlinked.restored).toEqual(['app-a']);
    expect(await readFile(path.join(root, 'app-a', 'node_modules', 'own.txt'), 'utf8')).toBe(
      'original',
    );
    expect(existsSync(path.join(root, 'app-b', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(result.storeDir, 'node_modules', 'react', 'package.json'))).toBe(
      true,
    );
    expect(await readLinks(root)).toEqual([]);
  });
});
