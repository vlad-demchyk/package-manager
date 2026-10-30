import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, type ProjectReport, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { applyPreviews, collectEdits, previewEdits } from '../src/fixes/apply.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

const SP_118 = {
  '@microsoft/sp-core-library': '1.18.2',
  '@microsoft/sp-webpart-base': '1.18.2',
  '@microsoft/sp-property-pane': '1.18.2',
};

/** Workspace reproducing patterns found in real SPFx repositories. */
const FILES = {
  '.nvmrc': '22.19.0\n',

  // SPFx 1.22.0 upgraded by hand from 1.18: gulp kept, wrong compiler, wide engines.
  'spfx-122-rsc47/package.json': {
    name: 'spfx-122-rsc47',
    engines: { node: '>=20.0.0 <23.0.0' },
    dependencies: {
      '@microsoft/sp-core-library': '1.22.0',
      '@microsoft/sp-webpart-base': '1.22.0',
      react: '17.0.1',
      'react-dom': '17.0.1',
    },
    devDependencies: {
      '@microsoft/sp-build-web': '1.22.0',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '~5.3.3',
    },
  },
  'spfx-122-rsc47/package-lock.json': lockfile(
    'spfx-122-rsc47',
    {},
    {
      '@microsoft/sp-core-library': '1.22.0',
      '@microsoft/sp-webpart-base': '1.22.0',
      react: '17.0.1',
      'react-dom': '17.0.1',
      '@microsoft/sp-build-web': '1.22.0',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '5.3.3',
    },
  ),
  'spfx-122-rsc47/gulpfile.js': "require('@microsoft/sp-build-web');\n",
  'spfx-122-rsc47/.yo-rc.json': {
    '@microsoft/generator-sharepoint': { version: '1.10.0', environment: 'spo' },
  },
  'spfx-122-rsc47/src/WebPart.ts':
    "import * as React from 'react';\nimport * as ReactDom from 'react-dom';\nimport { Version } from '@microsoft/sp-core-library';\nimport { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';\nimport * as strings from 'WebPartStrings';\n",
  'spfx-122-rsc47/config/config.json': {
    localizedResources: { WebPartStrings: 'lib/loc/{locale}.js' },
  },

  // SPFx 1.18.2 runtime mixed with 1.21.1 build tools, PnPjs majors mixed, undeclared import, stale pin.
  'spfx-118-mixed/package.json': {
    name: 'spfx-118-mixed',
    dependencies: {
      ...SP_118,
      '@pnp/sp': '3.26.0',
      '@pnp/logging': '4.17.0',
      react: '17.0.1',
      'react-dom': '17.0.1',
    },
    devDependencies: {
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '4.7.4',
    },
  },
  'spfx-118-mixed/package-lock.json': lockfile(
    'spfx-118-mixed',
    {},
    {
      ...SP_118,
      '@pnp/sp': '3.26.0',
      '@pnp/logging': '4.17.0',
      react: '17.0.1',
      'react-dom': '17.0.1',
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/sp-http': '1.18.2',
      '@microsoft/rush-stack-compiler-4.7': '0.1.0',
      typescript: '4.7.4',
    },
  ),
  'spfx-118-mixed/.nvmrc': '14.15.4\n',
  'spfx-118-mixed/gulpfile.js': '',
  'spfx-118-mixed/src/Like.tsx':
    "import * as React from 'react';\nimport { SPHttpClient } from '@microsoft/sp-http';\nimport { spfi } from '@pnp/sp';\nimport { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';\nimport { PropertyPaneTextField } from '@microsoft/sp-property-pane';\nimport { Version } from '@microsoft/sp-core-library';\nimport * as ReactDom from 'react-dom';\nexport const load = () => SPHttpClient;\n",

  // Two 1.21.1 projects that diverge on a shared library.
  'spfx-121-a/package.json': {
    name: 'spfx-121-a',
    engines: { node: '>=22.14.0 <23.0.0' },
    dependencies: { '@microsoft/sp-core-library': '1.21.1', '@fluentui/react': '8.122.16' },
    devDependencies: {
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      typescript: '5.3.3',
    },
  },
  'spfx-121-a/package-lock.json': lockfile(
    'spfx-121-a',
    {},
    {
      '@microsoft/sp-core-library': '1.21.1',
      '@fluentui/react': '8.122.16',
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      typescript: '5.3.3',
    },
  ),
  'spfx-121-a/gulpfile.js': '',
  'spfx-121-b/package.json': {
    name: 'spfx-121-b',
    engines: { node: '>=22.14.0 <23.0.0' },
    dependencies: { '@microsoft/sp-core-library': '1.21.1', '@fluentui/react': '8.125.3' },
    devDependencies: {
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      typescript: '5.3.3',
    },
  },
  'spfx-121-b/package-lock.json': lockfile(
    'spfx-121-b',
    {},
    {
      '@microsoft/sp-core-library': '1.21.1',
      '@fluentui/react': '8.125.3',
      '@microsoft/sp-build-web': '1.21.1',
      '@microsoft/rush-stack-compiler-5.3': '0.1.0',
      typescript: '5.3.3',
    },
  ),
  'spfx-121-b/gulpfile.js': '',

  // Non-SharePoint stack: React 18 with React DOM 19 and an HTTP client with a known advisory.
  'web-app/package.json': {
    name: 'web-app',
    dependencies: { react: '18.3.1', 'react-dom': '19.3.1', axios: '1.6.0' },
    devDependencies: { vite: '7.3.7' },
  },
  'web-app/package-lock.json': lockfile(
    'web-app',
    {},
    {
      react: '18.3.1',
      'react-dom': { version: '19.3.1', peerDependencies: { react: '^19.3.1' } },
      axios: '1.6.0',
      vite: { version: '7.3.7', dev: true },
    },
  ),
  'web-app/src/main.tsx':
    "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport axios from 'axios';\nexport const get = () => axios.get('/api/items');\n",
};

const ADVISORIES = {
  axios: [
    {
      id: 1,
      url: 'https://github.com/advisories/GHSA-test-0001',
      title: 'Server-Side Request Forgery in axios',
      severity: 'high',
      vulnerable_versions: '<1.8.2',
    },
  ],
};

const fakeFetch: typeof fetch = () =>
  Promise.resolve(new Response(JSON.stringify(ADVISORIES), { status: 200 }));

let root: string;
let cleanup: () => Promise<void>;
let report: Report;

const project = (id: string): ProjectReport => {
  const found = report.projects.find((entry) => entry.project.id === id);
  if (!found) throw new Error(`project ${id} missing`);
  return found;
};
const rules = (id: string): string[] => project(id).findings.map((item) => item.ruleId);

beforeAll(async () => {
  ({ root, cleanup } = await makeWorkspace(FILES));
  process.env.LOCALAPPDATA = path.join(root, '.cache-test');
  const config = configSchema.parse({});
  const workspace = await discoverWorkspace(root, { config });
  report = await analyze(workspace, {
    config,
    today: TODAY,
    installedNodes: fakeNodes('24.9.0', '22.19.0', '18.20.8'),
    fetchImpl: fakeFetch,
  });
});

afterAll(async () => {
  await cleanup();
});

describe('discovery', () => {
  it('finds every project by package.json and skips the root by default', () => {
    expect(report.projects.map((entry) => entry.project.id)).toEqual([
      'spfx-118-mixed',
      'spfx-121-a',
      'spfx-121-b',
      'spfx-122-rsc47',
      'web-app',
    ]);
  });
});

describe('SPFx', () => {
  it('detects the version from packages, not from .yo-rc.json', () => {
    const spfx = project('spfx-122-rsc47').stacks.find((stack) => stack.provider === 'spfx');
    expect(spfx?.version).toBe('1.22.0');
    expect(spfx?.details.toolchain).toBe('gulp');
    expect(rules('spfx-122-rsc47')).toContain('spfx/yo-rc-mismatch');
  });

  it('flags rush-stack-compiler-4.7 on SPFx 1.22 gulp and the misleading TypeScript 5.3', () => {
    expect(rules('spfx-122-rsc47')).toEqual(
      expect.arrayContaining(['spfx/compiler-mismatch', 'spfx/typescript-compiler-mismatch']),
    );
    const fix = project('spfx-122-rsc47').findings.find(
      (item) => item.ruleId === 'spfx/compiler-mismatch',
    )?.fixes[0];
    expect(fix?.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'json-remove',
          path: ['devDependencies', '@microsoft/rush-stack-compiler-4.7'],
        }),
        expect.objectContaining({
          kind: 'json-set',
          path: ['devDependencies', '@microsoft/rush-stack-compiler-5.3'],
          value: '0.1.0',
        }),
      ]),
    );
  });

  it('flags engines wider than the SPFx Node range', () => {
    expect(rules('spfx-122-rsc47')).toContain('node/engines-too-wide');
  });

  it('does not report localized string modules as undeclared imports', () => {
    const undeclared = project('spfx-122-rsc47').findings.find(
      (item) => item.ruleId === 'npm/undeclared-import',
    );
    expect(undeclared).toBeUndefined();
  });

  it('flags build tools from another SPFx release (runtime 1.18.2 with build 1.21.1)', () => {
    const lockstep = project('spfx-118-mixed').findings.find(
      (item) => item.ruleId === 'spfx/lockstep-mismatch',
    );
    expect(lockstep?.evidence).toContain('@microsoft/sp-build-web: 1.21.1 -> 1.18.2');
  });

  it('flags mixed PnPjs majors and undeclared direct imports', () => {
    expect(rules('spfx-118-mixed')).toEqual(
      expect.arrayContaining(['npm/family-mismatch', 'npm/undeclared-import']),
    );
    const undeclared = project('spfx-118-mixed').findings.find(
      (item) => item.ruleId === 'npm/undeclared-import',
    );
    expect(undeclared?.evidence[0]).toMatch(/^@microsoft\/sp-http /);
    expect(undeclared?.fixes[0]?.edits[0]).toMatchObject({
      path: ['dependencies', '@microsoft/sp-http'],
      value: '1.18.2',
    });
  });

  it('reports the unused PnP logging package', () => {
    const unused = project('spfx-118-mixed').findings.find(
      (item) => item.ruleId === 'npm/unused-dependency',
    );
    expect(unused?.evidence).toContain('@pnp/logging@4.17.0');
  });

  it('proposes a staged upgrade path', () => {
    const upgrade = project('spfx-118-mixed').findings.find(
      (item) => item.ruleId === 'spfx/upgrade-available',
    );
    expect(upgrade?.evidence[0]).toMatch(/^SPFx 1\.21\.1; Node >=22\.14\.0 <23\.0\.0/);
    expect(upgrade?.evidence.at(-1)).toMatch(
      /^SPFx 1\.24\.0.*React 17\.0\.1 -> 18\.3\.1.*gulp -> heft/,
    );
  });
});

describe('Node', () => {
  it('reports a stale .nvmrc and still recommends a compatible version', () => {
    const entry = project('spfx-118-mixed');
    const conflict = entry.findings.find((item) => item.ruleId === 'node/pin-conflict');
    expect(conflict?.fixes[0]?.edits[0]).toMatchObject({
      kind: 'file-write',
      content: '18.20.8\n',
    });
    expect(entry.node.recommended).toBe('18.20.8');
    expect(entry.node.selected?.version).toBe('18.20.8');
    expect(rules('spfx-118-mixed')).toContain('node/eol');
  });

  it('selects the highest installed Node allowed by the stack and points to the patched release', () => {
    const entry = project('spfx-121-a');
    expect(entry.node.selected?.version).toBe('22.19.0');
    expect(entry.node.recommended).toBe('22.23.4');
    expect(rules('spfx-121-a')).toContain('node/patched-available');
  });

  it('treats Node CVEs as build-machine only for SPFx', () => {
    const vuln = project('spfx-121-a').findings.find(
      (item) => item.ruleId === 'security/node-vulnerable',
    );
    expect(vuln?.tags).toContain('build');
    expect(vuln?.message.params?.context).toBe('build');
  });
});

describe('other stacks and security', () => {
  it('flags React and React DOM on different versions with the failing peer requirement', () => {
    expect(rules('web-app')).toEqual(
      expect.arrayContaining(['npm/family-mismatch', 'npm/peer-unsatisfied']),
    );
  });

  it('raises a networking vulnerability when the project performs HTTP calls', () => {
    const entry = project('web-app');
    expect(entry.network.used).toBe(true);
    const vuln = entry.findings.find((item) => item.ruleId === 'security/package-vulnerability');
    expect(vuln?.severity).toBe('critical');
    expect(vuln?.message.params).toMatchObject({ count: 1, direct: 1, network: 1 });
    expect(vuln?.evidence[0]).toMatch(/^axios@1\.6\.0 \[high\] Server-Side Request Forgery/);
    expect(vuln?.evidence[0]).toContain('reachable through network calls');
    expect(vuln?.tags).toEqual(expect.arrayContaining(['security', 'network', 'browser']));
  });
});

describe('groups', () => {
  it('groups projects by stack version and reports divergence inside a group', () => {
    const group = report.groups.find((item) => item.name.startsWith('spfx@1.21.1'));
    expect(group?.projectIds).toEqual(['spfx-121-a', 'spfx-121-b']);
    const divergence = report.workspaceFindings.find(
      (item) =>
        item.ruleId === 'policy/group-divergence' &&
        item.message.params?.name === '@fluentui/react',
    );
    expect(divergence?.fixes[0]?.edits).toHaveLength(1);
  });
});

describe('fixes', () => {
  it('previews in memory and writes only on apply, with backups', async () => {
    const entry = project('spfx-122-rsc47');
    const fixes = entry.findings
      .flatMap((item) => item.fixes)
      .filter((item) => item.id === 'spfx/replace-compiler');
    const manifest = path.join(root, 'spfx-122-rsc47', 'package.json');
    const original = await readFile(manifest, 'utf8');

    const previews = await previewEdits(collectEdits(fixes));
    expect(previews).toHaveLength(1);
    expect(await readFile(manifest, 'utf8')).toBe(original);

    const result = await applyPreviews(root, previews, TODAY);
    const updated = JSON.parse(await readFile(manifest, 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(updated.devDependencies['@microsoft/rush-stack-compiler-5.3']).toBe('0.1.0');
    expect(updated.devDependencies['@microsoft/rush-stack-compiler-4.7']).toBeUndefined();
    expect(existsSync(path.join(result.backupDir, 'spfx-122-rsc47', 'package.json'))).toBe(true);
    expect(
      await readFile(path.join(result.backupDir, 'spfx-122-rsc47', 'package.json'), 'utf8'),
    ).toBe(original);
  });
});
