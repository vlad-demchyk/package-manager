import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { analyze, type ProjectReport, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import {
  findSpfxVersion,
  latestSpfx,
  resolveSpfxTarget,
  setSpfxRegistry,
} from '../src/providers/spfx/matrix.js';
import type { Advisory } from '../src/security/advisories.js';
import { planRemediations } from '../src/security/remediation.js';
import { planUpgrade } from '../src/upgrade/plan.js';
import { fakeNodes, makeWorkspace, TODAY } from './helpers.js';

/** Synthetic advisories: every package name is made up for these tests. */
const ADVISORIES: Record<string, Advisory[]> = {
  'pm-relock': [advisory(1, 'pm-relock', '<1.0.2', 'high')],
  'pm-ranged': [advisory(2, 'pm-ranged', '<1.1.0', 'critical')],
  'pm-major': [advisory(3, 'pm-major', '<2.0.0', 'high')],
  'pm-direct': [advisory(4, 'pm-direct', '<3.4.1', 'moderate')],
  'pm-dead': [advisory(5, 'pm-dead', '*', 'high')],
  'pm-later': [
    advisory(6, 'pm-later', '<1.1.0', 'high'),
    advisory(7, 'pm-later', '>=1.1.0 <1.2.0', 'high'),
  ],
};

/** Registry documents: versions with the dependencies each one declares. */
const PACKUMENTS: Record<string, { latest: string; versions: Record<string, object> }> = {
  'pm-relock': { latest: '1.1.0', versions: v('1.0.0', '1.0.1', '1.0.2', '1.1.0') },
  'pm-ranged': { latest: '1.1.0', versions: v('1.0.0', '1.0.5', '1.1.0') },
  'pm-major': { latest: '2.0.0', versions: v('1.0.0', '1.9.0', '2.0.0') },
  'pm-direct': { latest: '3.4.1', versions: v('3.4.0', '3.4.1', '4.0.0') },
  'pm-dead': { latest: '1.0.0', versions: v('1.0.0') },
  // 1.1.0 fixes the first advisory but has its own: the plan must skip it.
  'pm-later': { latest: '1.2.0', versions: v('1.0.0', '1.1.0', '1.2.0') },
  'pm-parent': {
    latest: '1.1.0',
    versions: {
      '1.0.0': { dependencies: { 'pm-ranged': '~1.0.0' } },
      '1.1.0': { dependencies: { 'pm-ranged': '^1.1.0' } },
    },
  },
  '@microsoft/sp-core-library': {
    latest: '1.24.2',
    versions: v('1.21.1', '1.24.0', '1.24.1', '1.24.2', '1.25.0-beta.1'),
  },
};

function v(...versions: string[]): Record<string, object> {
  return Object.fromEntries(versions.map((version) => [version, {}]));
}

function advisory(
  id: number,
  name: string,
  range: string,
  severity: Advisory['severity'],
): Advisory {
  return {
    id,
    url: `https://example.invalid/${name}`,
    title: `${name} test advisory`,
    severity,
    vulnerable_versions: range,
  };
}

const fakeFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/-/npm/v1/security/advisories/bulk')) {
    const asked = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
      string,
      string[]
    >;
    const body = Object.fromEntries(
      Object.keys(asked)
        .filter((name) => ADVISORIES[name])
        .map((name) => [name, ADVISORIES[name]]),
    );
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }
  const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', ''));
  const doc = PACKUMENTS[name];
  if (!doc) return Promise.resolve(new Response('{}', { status: 404 }));
  return Promise.resolve(
    new Response(JSON.stringify({ 'dist-tags': { latest: doc.latest }, versions: doc.versions }), {
      status: 200,
    }),
  );
};

const lock = (packages: Record<string, object>): object => ({
  name: 'x',
  lockfileVersion: 3,
  requires: true,
  packages,
});

const FILES = {
  'web/package.json': {
    name: 'web',
    dependencies: { 'pm-parent': '1.0.0', 'pm-direct': '^3.4.0', 'pm-host': '1.0.0' },
  },
  'web/package-lock.json': lock({
    '': { name: 'web', dependencies: { 'pm-parent': '1.0.0', 'pm-direct': '^3.4.0' } },
    'node_modules/pm-parent': { version: '1.0.0', dependencies: { 'pm-ranged': '~1.0.0' } },
    'node_modules/pm-ranged': { version: '1.0.0' },
    'node_modules/pm-direct': { version: '3.4.0' },
    'node_modules/pm-host': {
      version: '1.0.0',
      dependencies: { 'pm-relock': '^1.0.0', 'pm-major': '^1.0.0', 'pm-dead': '1.0.0' },
    },
    'node_modules/pm-relock': { version: '1.0.0' },
    'node_modules/pm-major': { version: '1.0.0' },
    'node_modules/pm-dead': { version: '1.0.0' },
  }),
  'spfx/package.json': {
    name: 'spfx',
    dependencies: { '@microsoft/sp-core-library': '1.21.1' },
    devDependencies: { '@microsoft/sp-build-web': '1.21.1', 'pm-tool': '1.0.0' },
  },
  'spfx/package-lock.json': lock({
    '': { name: 'spfx' },
    'node_modules/@microsoft/sp-core-library': { version: '1.21.1' },
    'node_modules/@microsoft/sp-build-web': {
      version: '1.21.1',
      dev: true,
      dependencies: { 'pm-major': '^1.0.0' },
    },
    'node_modules/pm-major': { version: '1.0.0', dev: true },
    'node_modules/pm-tool': { version: '1.0.0', dev: true, dependencies: { 'pm-later': '~1.0.0' } },
    'node_modules/pm-later': { version: '1.0.0', dev: true },
  }),
  'spfx/gulpfile.js': '',
};

let root: string;
let cleanup: () => Promise<void>;
let report: Report;
const saved = { LOCALAPPDATA: process.env.LOCALAPPDATA, HOME: process.env.HOME };

const entry = (id: string): ProjectReport => {
  const found = report.projects.find((item) => item.project.id === id);
  if (!found) throw new Error(`project ${id} missing`);
  return found;
};
const plan = (id: string, name: string) => {
  const found = entry(id).remediation?.find((item) => item.package === name);
  if (!found) throw new Error(`no remediation for ${name} in ${id}`);
  return found;
};

beforeAll(async () => {
  ({ root, cleanup } = await makeWorkspace(FILES));
  // Registry and advisory caches go to the test folder (LOCALAPPDATA on Windows, HOME elsewhere).
  process.env.LOCALAPPDATA = path.join(root, '.cache-test');
  process.env.HOME = path.join(root, '.home-test');
  const config = configSchema.parse({});
  report = await analyze(await discoverWorkspace(root, { config }), {
    config,
    today: TODAY,
    installedNodes: fakeNodes('22.19.0'),
    fetchImpl: fakeFetch,
    usage: false,
  });
});

afterAll(async () => {
  setSpfxRegistry(undefined);
  process.env.LOCALAPPDATA = saved.LOCALAPPDATA;
  process.env.HOME = saved.HOME;
  await cleanup();
});

describe('vulnerability remediation plan', () => {
  it('pins a patched version every dependent already allows (relock, safe)', () => {
    expect(plan('web', 'pm-relock')).toMatchObject({
      status: 'relock',
      target: '1.1.0',
      risk: 'safe',
      changes: [{ kind: 'override', key: 'pm-relock@1', to: '1.1.0' }],
      chains: [['pm-host@1.0.0', 'pm-relock@1.0.0']],
    });
  });

  it('bumps the declared parent whose newer release requires a patched version', () => {
    expect(plan('web', 'pm-ranged')).toMatchObject({
      status: 'parent',
      target: '1.1.0',
      risk: 'review',
      changes: [{ kind: 'dependency', package: 'pm-parent', from: '1.0.0', to: '1.1.0' }],
    });
  });

  it('bumps a declared dependency keeping the spec style', () => {
    const item = plan('web', 'pm-direct');
    expect(item).toMatchObject({ status: 'direct', target: '3.4.1', risk: 'safe' });
    const fixItem = entry('web')
      .findings.flatMap((finding) => finding.fixes)
      .find((candidate) => candidate.id === 'security/pm-direct');
    expect(fixItem?.edits).toEqual([
      expect.objectContaining({ path: ['dependencies', 'pm-direct'], value: '^3.4.1' }),
    ]);
  });

  it('overrides across a major as breaking when no stack pins the chain', () => {
    expect(plan('web', 'pm-major')).toMatchObject({
      status: 'override',
      target: '2.0.0',
      risk: 'breaking',
      changes: [{ key: 'pm-major@1', to: '2.0.0' }],
    });
  });

  it('reports a package without any patched release as not fixable', () => {
    expect(plan('web', 'pm-dead')).toMatchObject({ status: 'no-fix', changes: [] });
    expect(plan('web', 'pm-dead').risk).toBeUndefined();
  });

  it('blocks a major-only fix under a build tool the SPFx version pins', () => {
    const item = plan('spfx', 'pm-major');
    expect(item).toMatchObject({ status: 'blocked', target: '2.0.0', context: 'build' });
    expect(item.reason.key).toBe('remediation.majorBlockedByStack');
    expect(item.reason.params?.root).toBe('@microsoft/sp-build-web@1.21.1');
    expect(item.fixId).toBeUndefined();
  });

  it('skips a release that has its own advisory', () => {
    expect(plan('spfx', 'pm-later')).toMatchObject({ status: 'override', target: '1.2.0' });
  });

  it('attaches fixes and plan lines to the vulnerability findings', () => {
    const findings = entry('web').findings.filter(
      (item) => item.ruleId === 'security/package-vulnerability',
    );
    expect(findings.flatMap((item) => item.fixes.map((fix) => fix.id)).sort()).toEqual([
      'security/pm-direct',
      'security/pm-major',
      'security/pm-ranged',
      'security/pm-relock',
    ]);
    expect(findings.flatMap((item) => item.evidence)).toContain(
      '  plan [relock, safe] pm-relock@1.1.0: overrides["pm-relock@1"] = 1.1.0',
    );
  });

  it('leaves packages unknown without registry data', async () => {
    const web = entry('web');
    const items = await planRemediations(
      web,
      [{ name: 'pm-relock', version: '1.0.0', advisories: [], devOnly: false, direct: false }],
      { packuments: new Map(), advisories: new Map() },
    );
    expect(items[0]).toMatchObject({ status: 'unknown', changes: [] });
  });
});

describe('network use', () => {
  it('makes no registry or advisory request with --offline or --no-security', async () => {
    const config = configSchema.parse({});
    const calls: string[] = [];
    const spy: typeof fetch = (input, init) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return fakeFetch(input, init);
    };
    setSpfxRegistry(undefined);
    for (const options of [{ offline: true }, { security: false }]) {
      await analyze(await discoverWorkspace(root, { config }), {
        config,
        today: TODAY,
        installedNodes: fakeNodes('22.19.0'),
        fetchImpl: spy,
        usage: false,
        ...options,
      });
    }
    expect(calls).toEqual([]);
  });
});

describe('SPFx registry patches', () => {
  afterEach(() => {
    setSpfxRegistry(undefined);
  });

  it('names npm latest apart from the latest verified version', () => {
    setSpfxRegistry({ latest: '1.24.2', versions: ['1.24.0', '1.24.1', '1.24.2'] });
    const finding = entry('spfx').findings.find((item) => item.ruleId === 'spfx/upgrade-available');
    expect(finding?.message).toEqual({
      key: 'spfx.upgradeAvailableUnverified',
      params: { version: '1.21.1', npm: '1.24.2', latest: latestSpfx()?.version ?? '' },
    });
  });

  it('infers a newer patch of a known minor from its verified row', () => {
    const verified = latestSpfx();
    if (!verified) throw new Error('matrix expected');
    const next = `${verified.version.split('.').slice(0, 2).join('.')}.99`;
    expect(findSpfxVersion(next)).toMatchObject({
      version: next,
      inferredFrom: verified.version,
      unverified: ['all'],
      node: verified.node,
    });
    expect(findSpfxVersion('9.0.0')).toBeUndefined();
  });

  it('resolves --to: verified for ranges, published patches when exact, refusal otherwise', () => {
    setSpfxRegistry({ latest: '1.24.2', versions: ['1.24.0', '1.24.1', '1.24.2'] });
    expect(resolveSpfxTarget('1.24')).toMatchObject({ ok: true, version: '1.24.0' });
    expect(resolveSpfxTarget('1.24.1')).toMatchObject({
      ok: true,
      version: '1.24.1',
      entry: { inferredFrom: '1.24.0' },
    });
    expect(resolveSpfxTarget('1.24.7')).toEqual({
      ok: false,
      reason: 'no-match',
      nearest: '1.24.0',
    });
    setSpfxRegistry(undefined);
    expect(resolveSpfxTarget('1.24.1')).toEqual({
      ok: false,
      reason: 'unconfirmed',
      nearest: '1.24.0',
    });
  });

  it('plans an upgrade to an unverified patch with a review issue', async () => {
    const config = configSchema.parse({});
    const upgrade = await planUpgrade(
      { ...report, projects: [entry('spfx')] },
      { config, to: '1.24.1', fetchImpl: fakeFetch, stack: ['spfx'] },
    );
    expect(upgrade.targets[0]).toMatchObject({ stack: 'spfx', version: '1.24.1' });
    expect(upgrade.issues).toContainEqual(
      expect.objectContaining({ code: 'spfx-unverified', level: 'review' }),
    );
    setSpfxRegistry(undefined);
    await expect(
      planUpgrade(
        { ...report, projects: [entry('spfx')] },
        { config, to: '1.24.1', offline: true, stack: ['spfx'] },
      ),
    ).rejects.toThrow(/could not confirm/);
  });
});
