import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledDataPath, loadData, resetData } from '../src/core/data.js';
import type { Report } from '../src/analyze.js';
import { dataLine } from '../src/report/model.js';
import { nodeLineStatus, nodeVulnerabilities, type NodeVuln } from '../src/node/releases.js';
import {
  dataStatus,
  frameworkMatrix,
  nodeLines,
  updateData,
  type FrameworkData,
} from '../src/ops/data.js';
import { makeWorkspace, TODAY } from './helpers.js';

interface Line {
  start: string;
  lts: string | null;
  maintenance: string | null;
  end: string;
  codename: string | null;
  latest: string | null;
  latestSecurity: string | null;
}

const bundledNode = JSON.parse(await readFile(bundledDataPath('node.json'), 'utf8')) as {
  lines: Record<string, Line>;
};
const bundledVulns = JSON.parse(await readFile(bundledDataPath('node-vulns.json'), 'utf8')) as {
  vulns: NodeVuln[];
};

/** The public sources as they would look for the bundled data. */
function sources(extraVulns: Record<string, object> = {}) {
  const schedule: Record<string, object> = { 'v0.10': { start: '2013-03-11', end: '2016-10-31' } };
  const index: object[] = [{ version: 'v27.0.0-alpha.0.0.0', security: false }];
  for (const [major, line] of Object.entries(bundledNode.lines)) {
    const { latest, latestSecurity, ...dates } = line;
    schedule[`v${major}`] = Object.fromEntries(
      Object.entries({ ...dates, codename: dates.codename ?? '' }).filter(
        ([, value]) => value !== null,
      ),
    );
    if (latest) index.push({ version: `v${latest}`, security: latest === latestSecurity });
    if (latestSecurity && latestSecurity !== latest) {
      index.push({ version: `v${latestSecurity}`, security: true });
    }
  }
  const vulns: Record<string, object> = {};
  for (const { id, description, ...vuln } of bundledVulns.vulns) {
    vulns[id] = { ...vuln, overview: `${description}\n\nDetails.` };
  }
  return { schedule, index, vulns: { ...vulns, ...extraVulns } };
}

const bundledFrameworks = JSON.parse(
  await readFile(bundledDataPath('frameworks.json'), 'utf8'),
) as FrameworkData;

/** Registry documents as they would look for the bundled framework matrix. */
function registry(): Map<string, unknown> {
  const docs = new Map<string, { versions: Record<string, object> }>();
  const owner: Record<string, string> = {
    '@angular/core': 'angular',
    '@angular/compiler-cli': 'angular',
    next: 'next',
    vite: 'vite',
  };
  for (const [name, id] of Object.entries(owner)) {
    const versions: Record<string, object> = { '99.0.0-next.1': {} };
    for (const entry of Object.values(bundledFrameworks.frameworks[id]?.majors ?? {}))
      versions[entry.version] = {
        ...(entry.node ? { engines: { node: entry.node } } : {}),
        peerDependencies: entry.packages,
      };
    docs.set(name, { versions });
  }
  return docs;
}

function fakeFetch(data: ReturnType<typeof sources>): typeof fetch {
  const docs = registry();
  return (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const name = url.startsWith('https://registry.npmjs.org/')
      ? decodeURIComponent(url.slice('https://registry.npmjs.org/'.length))
      : undefined;
    const body = name
      ? docs.get(name)
      : url.includes('schedule')
        ? data.schedule
        : url.includes('dist/index')
          ? data.index
          : data.vulns;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
}

let cleanup: (() => Promise<void>) | undefined;
let dir: string;

beforeEach(async () => {
  const workspace = await makeWorkspace({});
  cleanup = workspace.cleanup;
  dir = path.join(workspace.root, 'data');
  process.env.PACKMAN_DATA_DIR = dir;
  resetData();
});

afterEach(async () => {
  process.env.PACKMAN_DATA_DIR = '';
  resetData();
  await cleanup?.();
});

describe('packman data', () => {
  it('rebuilds the bundled Node lines from their sources, ignoring pre-releases', () => {
    const { schedule, index } = sources();
    expect(nodeLines(schedule, index)).toEqual(bundledNode.lines);
  });

  it('rebuilds the bundled framework matrix from registry documents, ignoring pre-releases', () => {
    const rebuilt = frameworkMatrix(registry(), bundledFrameworks.fetchedAt);
    expect(rebuilt.frameworks).toEqual(bundledFrameworks.frameworks);
  });

  it('reports new vulnerabilities, saves the update apart from the bundle and uses it', async () => {
    const extra = {
      '9999': {
        cve: ['CVE-2026-0001'],
        vulnerable: '22.x',
        patched: '^22.99.0',
        overview: 'Synthetic test entry\n\nmore text',
        affectedEnvironments: ['all'],
      },
    };
    const preview = await updateData({
      fetchImpl: fakeFetch(sources(extra)),
      today: TODAY,
      write: false,
    });
    expect(preview.files.map((file) => file.changes)).toEqual([
      [],
      ['9999 CVE-2026-0001 22.x: Synthetic test entry'],
      [],
    ]);
    expect(existsSync(dir)).toBe(false);

    await updateData({ fetchImpl: fakeFetch(sources(extra)), today: TODAY });
    expect(
      dataStatus()
        .filter((row) => row.active === 'updated')
        .map((row) => row.name),
    ).toEqual(['node.json', 'node-vulns.json']);
    const added = nodeVulnerabilities('22.19.0').find((vuln) => vuln.id === '9999');
    expect(added).toMatchObject({ severity: 'unknown', description: 'Synthetic test entry' });
    expect(nodeLineStatus('22.19.0', TODAY).latest).toBe(bundledNode.lines['22']?.latest);
    expect(loadData<{ fetchedAt: string }>('node.json').fetchedAt).toBe('2026-10-30');
  });

  it('refuses a vulnerability list shorter than the known one', async () => {
    const data = sources();
    data.vulns = Object.fromEntries(Object.entries(data.vulns).slice(0, 10));
    await expect(updateData({ fetchImpl: fakeFetch(data), today: TODAY })).rejects.toThrow(
      'fewer than',
    );
    expect(existsSync(dir)).toBe(false);
  });
});

describe('data age in reports', () => {
  const report = (generatedAt: string) =>
    ({
      generatedAt,
      data: {
        spfx: '2026-10-30',
        node: '2026-10-30',
        nodeVulns: '2026-10-01',
        advisories: { checked: false, source: 'npm' },
      },
    }) as unknown as Report;

  it('suggests an update only when Node data is older than 30 days', () => {
    expect(dataLine(report('2026-10-30T12:00:00Z'))).not.toContain('packman data update');
    expect(dataLine(report('2026-11-04T12:00:00Z'))).toContain('34');
    expect(dataLine(report('2026-11-04T12:00:00Z'))).toContain('packman data update');
  });
});
