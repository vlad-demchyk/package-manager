import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { fakeNodes, makeWorkspace, TODAY } from './helpers.js';

async function run(files: Record<string, object>) {
  const { root, cleanup } = await makeWorkspace(files);
  try {
    const config = configSchema.parse({});
    return await analyze(await discoverWorkspace(root, { config }), {
      config,
      offline: true,
      security: false,
      usage: false,
      today: TODAY,
      installedNodes: fakeNodes('24.9.0', '22.19.0', '18.20.8'),
    });
  } finally {
    await cleanup();
  }
}

const constraintsOf = (report: Awaited<ReturnType<typeof run>>) =>
  (report.projects[0]?.findings ?? [])
    .filter((item) => item.ruleId === 'constraint/package')
    .map((item) => item.message.params);

describe('framework matrix (data/frameworks.json)', () => {
  it('checks Angular companions and picks Node from the matrix before anything is installed', async () => {
    const report = await run({
      'app/package.json': {
        name: 'app',
        dependencies: { '@angular/core': '17.3.12', rxjs: '7.8.1', 'zone.js': '0.14.4' },
        devDependencies: { '@angular/compiler-cli': '17.3.12', typescript: '5.6.2' },
      },
    });
    expect(constraintsOf(report)).toEqual([
      expect.objectContaining({ name: 'typescript', version: '5.6.2', range: '>=5.2 <5.5' }),
    ]);
    const node = report.projects[0]?.node;
    expect(node?.stackRanges.map((range) => range.range)).toContain('^18.13.0 || >=20.9.0');
    expect(node?.selected?.version).not.toBe(undefined);
  });

  it('checks the React version a Next major peers on', async () => {
    const report = await run({
      'web/package.json': {
        name: 'web',
        dependencies: { next: '14.2.35', react: '17.0.2', 'react-dom': '17.0.2' },
      },
    });
    expect(constraintsOf(report).map((params) => params?.name)).toEqual(['react', 'react-dom']);
  });

  it('accepts a matching set', async () => {
    const report = await run({
      'web/package.json': {
        name: 'web',
        dependencies: { next: '14.2.35', react: '18.3.1', 'react-dom': '18.3.1' },
      },
    });
    expect(constraintsOf(report)).toEqual([]);
  });
});
