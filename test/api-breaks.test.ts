import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, type ProjectReport, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { apiBreaks, crossings } from '../src/scan/api-breaks.js';
import { packageCompatibility, pickProject } from '../src/policy/compat.js';
import { planUpgrade } from '../src/upgrade/plan.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY, type FileTree } from './helpers.js';

/** A project with the given dependencies, locked at the same versions, and one source file. */
function project(
  name: string,
  deps: Record<string, string>,
  source: string,
  locked: Parameters<typeof lockfile>[2] = deps,
): FileTree {
  return {
    [`${name}/package.json`]: { name, version: '1.0.0', dependencies: deps },
    [`${name}/package-lock.json`]: lockfile(name, deps, locked),
    [`${name}/src/index.ts`]: source,
  };
}

const PNP1_CODE = `import { sp, Web } from "@pnp/sp";
const web = new Web("https://contoso.example/sites/a");
export async function titles(): Promise<string[]> {
  const items = await sp.web.lists.getByTitle("Docs").items.get();
  return items.map((item: { Title: string }) => item.Title);
}
`;
const PNP2_CODE = `import { sp } from "@pnp/sp/presets/all";
export function setup(context: unknown): void {
  sp.setup({ spfxContext: context });
}
export async function titles(): Promise<string[]> {
  // the old .get() call: v3 invokes the queryable instead
  return sp.web.lists.getByTitle("Docs").items.select("Title").get();
}
`;
const PNP3_GETALL_CODE = `import { spfi, SPFx } from "@pnp/sp";
import "@pnp/sp/webs";
import "@pnp/sp/lists";
import "@pnp/sp/items";
import "@pnp/sp/items/get-all";
export async function all(context: unknown): Promise<unknown[]> {
  const sp = spfi().using(SPFx(context));
  return sp.web.lists.getByTitle("Docs").items.getAll();
}
`;
const PNP4_CODE = `import { spfi, SPFx } from "@pnp/sp";
import "@pnp/sp/webs";
import "@pnp/sp/lists";
import "@pnp/sp/items";
export async function all(context: unknown): Promise<unknown[]> {
  const sp = spfi().using(SPFx(context));
  const result: unknown[] = [];
  for await (const page of sp.web.lists.getByTitle("Docs").items.top(500)) result.push(...page);
  return result;
}
`;
const REACT17_CODE = `import * as React from 'react';
import * as ReactDom from 'react-dom';
export function mount(el: HTMLElement): void {
  ReactDom.render(React.createElement('div'), el);
}
export function unmount(el: HTMLElement): void {
  ReactDom.unmountComponentAtNode(el);
}
`;
const REACT18_CODE = `import * as React from 'react';
import { createRoot } from 'react-dom/client';
export function mount(el: HTMLElement): void {
  createRoot(el).render(React.createElement('div'));
}
`;
const FABRIC_CODE = `import { PrimaryButton } from 'office-ui-fabric-react';
import { useBoolean } from '@uifabric/react-hooks';
export { PrimaryButton, useBoolean };
`;
const FLUENT_CODE = `import { PrimaryButton, ThemeProvider } from '@fluentui/react';
export { PrimaryButton, ThemeProvider };
`;

const FILES: FileTree = {
  ...project('pnp1-old', { '@pnp/sp': '1.3.11' }, PNP1_CODE),
  ...project('pnp2-v1code', { '@pnp/sp': '2.14.0' }, PNP1_CODE),
  ...project('pnp3-v2code', { '@pnp/sp': '3.20.1' }, PNP2_CODE),
  ...project('pnp3-getall', { '@pnp/sp': '3.20.1' }, PNP3_GETALL_CODE),
  ...project('pnp3-v4code', { '@pnp/sp': '3.20.1' }, PNP4_CODE),
  ...project('pnp4-getall', { '@pnp/sp': '4.12.0' }, PNP3_GETALL_CODE),
  ...project('pnp4-clean', { '@pnp/sp': '4.12.0' }, PNP4_CODE),
  ...project('pnp-mixed', { '@pnp/sp': '3.20.1', '@pnp/logging': '4.12.0' }, PNP3_GETALL_CODE),
  ...project('react17-ok', { react: '17.0.1', 'react-dom': '17.0.1' }, REACT17_CODE, {
    react: '17.0.1',
    'react-dom': { version: '17.0.1', peerDependencies: { react: '17.0.1' } },
  }),
  ...project('react18-legacy', { react: '18.3.1', 'react-dom': '18.3.1' }, REACT17_CODE),
  ...project('react17-newcode', { react: '17.0.1', 'react-dom': '17.0.1' }, REACT18_CODE),
  ...project('fabric-ok', { 'office-ui-fabric-react': '7.199.1' }, FABRIC_CODE),
  ...project('fluent-mixed', { '@fluentui/react': '8.106.4' }, FABRIC_CODE),
  ...project('fluent-ok', { '@fluentui/react': '8.106.4' }, FLUENT_CODE),
  'packman.config.json': {
    profiles: {
      'pnp-latest': { projects: ['pnp2-v1code'], dependencies: { '@pnp/sp': '4.12.0' } },
      'pnp-patch': { projects: ['pnp4-clean'], dependencies: { '@pnp/sp': '4.13.0' } },
      fluent: {
        projects: ['fabric-ok'],
        devDependencies: { '@fluentui/react': '8.106.4' },
        deprecated: ['office-ui-fabric-react'],
      },
    },
  },
};

let root: string;
let cleanup: () => Promise<void>;
let report: Report;

beforeAll(async () => {
  ({ root, cleanup } = await makeWorkspace(FILES));
  const config = configSchema.parse(FILES['packman.config.json']);
  report = await analyze(await discoverWorkspace(root, { config }), {
    config,
    today: TODAY,
    security: false,
    offline: true,
    installedNodes: fakeNodes('22.19.0', '18.20.8'),
  });
});

afterAll(async () => {
  await cleanup();
});

const entry = (id: string): ProjectReport => {
  const found = report.projects.find((item) => item.project.id === id);
  if (!found) throw new Error(`project ${id} missing`);
  return found;
};
const migrations = (id: string) =>
  entry(id).findings.filter((item) => item.ruleId === 'api/migration-required');

describe('data/api-breaks.json', () => {
  it('has unique pattern ids, valid regexes and versions, and a verification date with sources', () => {
    const ids = new Set<string>();
    for (const item of apiBreaks()) {
      expect(item.since).toMatch(/^\d+\.\d+\.\d+$/);
      expect(item.guide).toMatch(/^https:\/\//);
      expect(item.packages.length).toBeGreaterThan(0);
      for (const pattern of [...item.old, ...item.new]) {
        expect(ids.has(pattern.id), `duplicate pattern id ${pattern.id}`).toBe(false);
        ids.add(pattern.id);
        expect(() => new RegExp(pattern.regex)).not.toThrow();
        if (pattern.requires) expect(() => new RegExp(pattern.requires ?? '')).not.toThrow();
      }
    }
    expect(apiBreaks().map((item) => item.id)).toEqual(
      expect.arrayContaining(['pnpjs-2', 'pnpjs-3', 'pnpjs-4', 'react-18', 'fluent-8']),
    );
  });
});

describe('api/migration-required', () => {
  it('is silent when the code matches the installed major', () => {
    for (const id of ['pnp1-old', 'pnp4-clean', 'react17-ok', 'fabric-ok', 'fluent-ok'])
      expect(migrations(id), id).toEqual([]);
  });

  it('PnPjs 1 -> 2: class imports from the @pnp/sp root and `new Web` on 2.x', () => {
    const [item] = migrations('pnp2-v1code');
    expect(item?.severity).toBe('error');
    expect(item?.message.params).toMatchObject({
      package: '@pnp/sp',
      version: '2.14.0',
      since: '2.0.0',
    });
    expect(item?.evidence).toEqual(
      expect.arrayContaining([
        '  src/index.ts:1',
        '  src/index.ts:2',
        'guide: https://pnp.github.io/pnpjs/v2/transition-guide/',
      ]),
    );
  });

  it('PnPjs 2 -> 3: global sp, sp.setup and .get() on 3.x', () => {
    const [item] = migrations('pnp3-v2code');
    expect(item?.severity).toBe('error');
    expect(item?.message.params).toMatchObject({ since: '3.0.0', count: 3 });
    expect(item?.evidence.filter((line) => line.startsWith('  src/'))).toEqual([
      '  src/index.ts:1',
      '  src/index.ts:3',
      '  src/index.ts:7',
    ]);
  });

  it('PnPjs 3 -> 4: getAll and the items/get-all import on 4.x, but not on 3.x', () => {
    const [item] = migrations('pnp4-getall');
    expect(item?.severity).toBe('error');
    expect(item?.message.params).toMatchObject({ since: '4.0.0', count: 2 });
    expect(migrations('pnp3-getall')).toEqual([]);
  });

  it('a family split across the break counts as the new side and names the packages left behind', () => {
    const [item] = migrations('pnp-mixed');
    expect(item?.severity).toBe('error');
    expect(item?.message.params).toMatchObject({
      package: '@pnp/logging',
      version: '4.12.0',
      since: '4.0.0',
      count: 2,
    });
    expect(item?.evidence).toContain('mixed majors: @pnp/sp@3.20.1 still below 4.0.0');
  });

  it('reports the new API used on an old major (for await over PnPjs items on 3.x)', () => {
    const [item] = migrations('pnp3-v4code');
    expect(item?.message.key).toBe('api.newUsage');
    expect(item?.message.params).toMatchObject({ since: '4.0.0', version: '3.20.1' });
  });

  it('React 17 -> 18: ReactDom.render on 18 is a warning (deprecated), createRoot on 17 an error', () => {
    const [legacy] = migrations('react18-legacy');
    expect(legacy?.severity).toBe('warning');
    expect(legacy?.message.params).toMatchObject({ package: 'react', since: '18.0.0', count: 2 });
    const [fresh] = migrations('react17-newcode');
    expect(fresh?.severity).toBe('error');
    expect(fresh?.message.key).toBe('api.newUsage');
  });

  it('Fabric 7 -> Fluent UI 8: office-ui-fabric-react and @uifabric imports with @fluentui/react 8', () => {
    const [item] = migrations('fluent-mixed');
    expect(item?.severity).toBe('error');
    expect(item?.message.params).toMatchObject({ package: '@fluentui/react', count: 2 });
  });
});

describe('api/migration-split', () => {
  it('names the projects on the old side that still use the old API', () => {
    const split = report.workspaceFindings.filter((item) => item.ruleId === 'api/migration-split');
    const pnp4 = split.find((item) => item.message.params?.since === '4.0.0');
    expect(pnp4?.message.params).toMatchObject({ package: '@pnp/sp', work: 1 });
    expect(pnp4?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pnp3-getall: @pnp\/sp@3\.20\.1 \(< 4\.0\.0, 2 old-API places\)$/),
      ]),
    );
  });
});

describe('fix risk on documented breaks', () => {
  it('raises a profile fix crossing @pnp/sp 2 -> 4 to breaking and lists the old-API places', () => {
    const versions = entry('pnp2-v1code').findings.find(
      (item) => item.ruleId === 'profile/versions',
    );
    expect(versions?.fixes[0]?.risk).toBe('breaking');
    expect(versions?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^api: @pnp\/sp 2\.14\.0 -> 4\.12\.0: PnPjs 3/),
        expect.stringMatching(/^api: @pnp\/sp 2\.14\.0 -> 4\.12\.0: PnPjs 4/),
        '  src/index.ts:1',
      ]),
    );
  });

  it('keeps a change inside the same API generation at its own risk', () => {
    const versions = entry('pnp4-clean').findings.find(
      (item) => item.ruleId === 'profile/versions',
    );
    expect(versions?.fixes[0]?.risk).toBe('review');
    expect(versions?.evidence.some((line) => line.startsWith('api:'))).toBe(false);
  });

  it('treats adding @fluentui/react 8 next to office-ui-fabric-react as the Fluent 8 break', () => {
    const missing = entry('fabric-ok').findings.find((item) => item.ruleId === 'profile/missing');
    expect(missing?.fixes[0]?.risk).toBe('breaking');
    expect(missing?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^api: @fluentui\/react office-ui-fabric-react@7\.199\.1 -> 8\.106\.4/,
        ),
      ]),
    );
    expect(
      crossings(entry('fabric-ok').project, '@fluentui/react', '8.106.4').map(
        (item) => item.break.id,
      ),
    ).toEqual(['fluent-8']);
  });
});

describe('upgrade plan code changes', () => {
  it('lists the React 18 root API migration for the project moving from 17', async () => {
    const plan = await planUpgrade(report, { config: configSchema.parse({}), stack: ['react'] });
    const legacy = plan.projects.find((item) => item.id === 'react17-ok');
    expect(legacy?.target).toBe('18.3.1');
    // One entry per break and project: react-dom crosses the same break and is folded in.
    expect(legacy?.codeChanges.map((change) => [change.package, change.from, change.to])).toEqual([
      ['react', '17.0.1', '18.3.1'],
    ]);
    expect(legacy?.codeChanges[0]?.places).toEqual(['src/index.ts:4', 'src/index.ts:7']);
    expect(legacy?.issues.map((issue) => issue.code)).toContain('api-migration');
    const clean = plan.projects.find((item) => item.id === 'react18-legacy');
    expect(clean?.codeChanges).toEqual([]);
  });
});

describe('packman compat', () => {
  it('lists the breaks between the current and the target version with the places to change', () => {
    const result = packageCompatibility(entry('pnp2-v1code'), '@pnp/sp', '4.12.0');
    expect(result.current).toMatchObject({
      version: '2.14.0',
      spec: '2.14.0',
      section: 'dependencies',
    });
    expect(result.breaks.map((item) => [item.id, item.direction])).toEqual([
      ['pnpjs-3', 'upgrade'],
      ['pnpjs-4', 'upgrade'],
    ]);
    // Line 1 imports the global `sp` object, line 4 calls .get(): both go with PnPjs 3.
    expect(result.breaks[0]?.places).toEqual(['src/index.ts:1', 'src/index.ts:4']);
    expect(result.path).toEqual(['2.14.0', '3.0.0', '4.0.0', '4.12.0']);
  });

  it('shows every later break as the upgrade path when no target is given, and peers of installed packages', () => {
    const result = packageCompatibility(entry('react17-ok'), 'react');
    expect(result.breaks.map((item) => item.since)).toEqual(['18.0.0', '19.0.0']);
    expect(result.peers).toEqual([{ range: '17.0.1', source: 'react-dom@17.0.1', current: true }]);
    expect(result.path).toEqual(['17.0.1', '18.0.0', '19.0.0']);
  });

  it('marks a downgrade path and an undeclared package', () => {
    const down = packageCompatibility(entry('pnp4-clean'), '@pnp/sp', '2.14.0');
    expect(down.breaks.map((item) => [item.since, item.direction])).toEqual([
      ['3.0.0', 'downgrade'],
      ['4.0.0', 'downgrade'],
    ]);
    expect(down.path).toEqual(['4.12.0', '4.0.0', '3.0.0', '2.14.0']);
    const missing = packageCompatibility(entry('pnp4-clean'), 'left-pad', '1.0.0');
    expect(missing.current).toBeUndefined();
    expect(missing.breaks).toEqual([]);
  });
});

describe('compat -p', () => {
  it('matches project ids by glob and needs exactly one match', () => {
    expect(pickProject(report.projects, ['pnp4-c*']).project.id).toBe('pnp4-clean');
    expect(pickProject([entry('fluent-ok')], undefined).project.id).toBe('fluent-ok');
    expect(() => pickProject(report.projects, ['pnp3-*'])).toThrow(
      /3: pnp3-getall, pnp3-v2code, pnp3-v4code/,
    );
    expect(() => pickProject(report.projects, ['nope'])).toThrow(/0: -/);
    expect(() => pickProject(report.projects, undefined)).toThrow(/compat/);
  });
});

describe('upgrade --no-policy', () => {
  it('plans the project edits without the packman.config.json fix', async () => {
    const withPolicy = await planUpgrade(report, {
      config: configSchema.parse({}),
      stack: ['react'],
    });
    expect(withPolicy.fixes.map((item) => item.id)).toContain('upgrade/policy');
    const without = await planUpgrade(report, {
      config: configSchema.parse({}),
      stack: ['react'],
      policy: false,
    });
    expect(without.fixes.map((item) => item.id)).not.toContain('upgrade/policy');
    expect(without.fixes.length).toBe(withPolicy.fixes.length - 1);
    expect(
      without.fixes
        .flatMap((item) => item.edits)
        .some((edit) => edit.file.endsWith('packman.config.json')),
    ).toBe(false);
  });
});
