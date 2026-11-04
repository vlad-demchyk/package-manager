import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORE_MARKER } from '../src/core/discovery.js';
import { HOOK_MARKER, hookScript } from '../src/cli/hooks.js';
import { linkDrift, type LinkRecord } from '../src/store/store.js';
import { makeWorkspace } from './helpers.js';

/** A project linked in `packages` mode to a store with `a`, `b` and `@s/c`. */
async function linkedWorkspace() {
  const workspace = await makeWorkspace({
    'app/package.json': { name: 'app', dependencies: { a: '1.0.0', b: '1.0.0', '@s/c': '1.0.0' } },
    '.packman/store/u-1/node_modules/a/package.json': { name: 'a', version: '1.0.0' },
    '.packman/store/u-1/node_modules/b/package.json': { name: 'b', version: '1.0.0' },
    '.packman/store/u-1/node_modules/@s/c/package.json': { name: '@s/c', version: '1.0.0' },
  });
  const store = path.join(workspace.root, '.packman', 'store', 'u-1', 'node_modules');
  const modules = path.join(workspace.root, 'app', 'node_modules');
  await mkdir(path.join(modules, '@s'), { recursive: true });
  await writeFile(path.join(modules, STORE_MARKER), '{}');
  for (const name of ['a', 'b', '@s/c'])
    await symlink(path.join(store, name), path.join(modules, name), 'junction');
  const link: LinkRecord = {
    projectId: 'app',
    key: 'u-1',
    target: store,
    createdAt: '2026-11-04T00:00:00Z',
    mode: 'packages',
    packages: ['@s/c', 'a', 'b'],
  };
  return { ...workspace, modules, link };
}

describe('git hooks', () => {
  it('only reports, never fails the git command, and quotes nothing for the shell', () => {
    const script = hookScript(path.join('apps', 'spfx'));
    expect(script.split('\n').slice(0, 2)).toEqual(['#!/bin/sh', HOOK_MARKER]);
    expect(script).toContain('packman store status --check "apps/spfx"');
    expect(script.trimEnd().endsWith('exit 0')).toBe(true);
    // Backticks inside double quotes would run as a command in sh.
    expect(script.split('\n').filter((line) => line.includes('echo'))).toEqual([
      "  echo 'packman: linked projects changed, run: packman store status apps/spfx'",
    ]);
    expect(hookScript('')).toContain('--check "."');
  });
});

describe('linked node_modules drift', () => {
  it('matches right after linking', async () => {
    const { root, cleanup, link } = await linkedWorkspace();
    try {
      expect(await linkDrift(root, link)).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('reports what npm install, update and uninstall leave behind', async () => {
    const { root, cleanup, modules, link } = await linkedWorkspace();
    try {
      const { rm } = await import('node:fs/promises');
      // npm update: the junction becomes a real copy.
      await rm(path.join(modules, 'a'));
      await mkdir(path.join(modules, 'a'));
      await writeFile(path.join(modules, 'a', 'package.json'), '{"name":"a"}');
      // npm uninstall: the junction is gone.
      await rm(path.join(modules, '@s', 'c'));
      // npm install <package>: a real folder packman did not link, plus npm's hidden lockfile.
      await mkdir(path.join(modules, 'left-pad'));
      await writeFile(path.join(modules, '.package-lock.json'), '{}');
      expect(await linkDrift(root, link)).toEqual({
        missing: ['@s/c'],
        replaced: ['a'],
        extra: ['left-pad'],
      });
    } finally {
      await cleanup();
    }
  });
});
