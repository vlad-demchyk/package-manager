import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { alignPackage } from '../src/ops/align.js';
import { makeWorkspace } from './helpers.js';

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
