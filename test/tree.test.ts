import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { fakeNodes, makeWorkspace, TODAY } from './helpers.js';

/** The anima case in an ordinary project: schema-utils@2 loads ajv-keywords@5 nested under it. */
const LOCK = {
  name: 'app',
  lockfileVersion: 3,
  packages: {
    '': { name: 'app', dependencies: { 'copy-webpack-plugin': '6.0.4', 'old-ui': '1.0.0' } },
    'node_modules/copy-webpack-plugin': {
      version: '6.0.4',
      dependencies: { 'schema-utils': '^2.7.0' },
    },
    'node_modules/schema-utils': {
      version: '2.7.1',
      dependencies: { 'ajv-keywords': '^3.5.2' },
    },
    'node_modules/schema-utils/node_modules/ajv-keywords': {
      version: '5.1.0',
      peerDependencies: { ajv: '^8.8.2' },
    },
    'node_modules/ajv': { version: '6.12.6' },
    // A direct dependency's peer is npm/peer-unsatisfied's to report, not the tree check's.
    'node_modules/old-ui': { version: '1.0.0', peerDependencies: { ajv: '^4.0.0' } },
  },
};

describe('locked tree check in check', () => {
  it('reports transitive edges outside their range and nested peers, once each', async () => {
    const { root, cleanup } = await makeWorkspace({
      'app/package.json': {
        name: 'app',
        dependencies: { 'copy-webpack-plugin': '6.0.4', 'old-ui': '1.0.0' },
      },
      'app/package-lock.json': LOCK,
    });
    try {
      const config = configSchema.parse({});
      const report = await analyze(await discoverWorkspace(root, { config }), {
        config,
        offline: true,
        security: false,
        today: TODAY,
        installedNodes: fakeNodes('22.19.0'),
      });
      const findings = report.projects[0]?.findings ?? [];
      const evidence = (id: string) => findings.find((item) => item.ruleId === id)?.evidence;
      expect(findings.find((item) => item.ruleId === 'npm/tree-broken')?.severity).toBe('error');
      expect(evidence('npm/tree-broken')).toEqual([
        'node_modules/schema-utils -> ajv-keywords@^3.5.2: 5.1.0',
      ]);
      expect(evidence('npm/tree-peer')).toEqual([
        'node_modules/schema-utils/node_modules/ajv-keywords -> ajv@^8.8.2: 6.12.6',
      ]);
    } finally {
      await cleanup();
    }
  });
});
