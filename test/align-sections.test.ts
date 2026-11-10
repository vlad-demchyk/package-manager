import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { alignPackage } from '../src/ops/align.js';
import { lockfile, makeWorkspace } from './helpers.js';

describe('align one package', () => {
  it('sets every section that declares it, and leaves peer ranges alone', async () => {
    const { root, cleanup } = await makeWorkspace({
      'a/package.json': { name: 'a', devDependencies: { tool: '1.18.2' } },
      'b/package.json': { name: 'b', devDependencies: { tool: '1.18.2' } },
      'c/package.json': {
        name: 'c',
        dependencies: { tool: '1.18.2' },
        devDependencies: { tool: '1.21.1' },
        peerDependencies: { tool: '>=1' },
      },
    });
    try {
      const workspace = await discoverWorkspace(root, { config: configSchema.parse({}) });
      const aligned = alignPackage(workspace.projects, 'tool');
      expect(aligned?.version).toBe('1.18.2');
      expect(aligned?.fix.edits).toEqual([
        expect.objectContaining({ path: ['devDependencies', 'tool'], value: '1.18.2' }),
      ]);
    } finally {
      await cleanup();
    }
  });
});

describe('align one package against peer ranges', () => {
  /** SPFx 1.18 group: two projects on eslint 8.7.0, one whose rush-stack-compiler-5.3 wants ^8.57.0. */
  const project = (name: string, eslint: string, compiler: string): Record<string, object> => ({
    [`${name}/package.json`]: {
      name,
      devDependencies: { eslint, [`@microsoft/${compiler}`]: '0.1.0' },
    },
    [`${name}/package-lock.json`]: lockfile(
      name,
      {},
      {
        eslint,
        [`@microsoft/${compiler}`]: {
          version: '0.1.0',
          ...(compiler === 'rush-stack-compiler-5.3'
            ? { peerDependencies: { eslint: '^8.57.0' } }
            : {}),
        },
      },
    ),
  });

  it('keeps the most common version and names the peer range it breaks (ERESOLVE)', async () => {
    const { root, cleanup } = await makeWorkspace({
      ...project('a', '8.7.0', 'rush-stack-compiler-4.7'),
      ...project('b', '8.7.0', 'rush-stack-compiler-4.7'),
      ...project('c', '8.57.1', 'rush-stack-compiler-5.3'),
    });
    try {
      const workspace = await discoverWorkspace(root, { config: configSchema.parse({}) });
      const aligned = alignPackage(workspace.projects, 'eslint');
      expect(aligned?.version).toBe('8.7.0');
      expect(aligned?.peers).toEqual([
        'c: @microsoft/rush-stack-compiler-5.3@0.1.0 wants eslint@^8.57.0',
      ]);
    } finally {
      await cleanup();
    }
  });

  it('reports nothing when every peer range accepts the chosen version', async () => {
    const { root, cleanup } = await makeWorkspace({
      ...project('a', '8.57.1', 'rush-stack-compiler-4.7'),
      ...project('b', '8.57.1', 'rush-stack-compiler-4.7'),
      ...project('c', '8.7.0', 'rush-stack-compiler-5.3'),
    });
    try {
      const workspace = await discoverWorkspace(root, { config: configSchema.parse({}) });
      const aligned = alignPackage(workspace.projects, 'eslint');
      expect(aligned?.version).toBe('8.57.1');
      expect(aligned?.peers).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('names the peer ranges an explicit version misses, so fix can run first', async () => {
    const { root, cleanup } = await makeWorkspace({
      ...project('a', '8.7.0', 'rush-stack-compiler-4.7'),
      ...project('c', '8.57.1', 'rush-stack-compiler-5.3'),
    });
    try {
      const workspace = await discoverWorkspace(root, { config: configSchema.parse({}) });
      const aligned = alignPackage(workspace.projects, 'eslint', '8.7.0');
      expect(aligned?.version).toBe('8.7.0');
      expect(aligned?.peers).toEqual([
        'c: @microsoft/rush-stack-compiler-5.3@0.1.0 wants eslint@^8.57.0',
      ]);
    } finally {
      await cleanup();
    }
  });
});
