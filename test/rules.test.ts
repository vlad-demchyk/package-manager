import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze, type ProjectReport, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import type { Fix } from '../src/core/types.js';
import { applyPreviews, collectEdits, previewEdits } from '../src/fixes/apply.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

/** SPFx 1.18.2 gulp project: expects rush-stack-compiler-4.7 and Node >=18.17.1 <19.0.0. */
function spfx118(
  name: string,
  extra: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  options: { engines?: string; compiler: string; tsconfigCompiler?: string },
): Record<string, string | object> {
  const dependencies = { '@microsoft/sp-core-library': '1.18.2', ...extra.dependencies };
  const devDependencies = {
    '@microsoft/sp-build-web': '1.18.2',
    [`@microsoft/${options.compiler}`]: '0.1.0',
    typescript: '4.7.4',
    ...extra.devDependencies,
  };
  return {
    [`${name}/package.json`]: {
      name,
      ...(options.engines ? { engines: { node: options.engines } } : {}),
      dependencies,
      devDependencies,
    },
    [`${name}/package-lock.json`]: lockfile(name, {}, { ...dependencies, ...devDependencies }),
    [`${name}/gulpfile.js`]: '',
    [`${name}/tsconfig.json`]: {
      extends: `./node_modules/@microsoft/${options.tsconfigCompiler ?? options.compiler}/includes/tsconfig-web.json`,
    },
  };
}

const FILES = {
  // The right compiler package, but tsconfig still extends the one it replaced.
  ...spfx118(
    'tsconfig-only',
    {},
    { compiler: 'rush-stack-compiler-4.7', tsconfigCompiler: 'rush-stack-compiler-3.9' },
  ),
  // The wrong compiler package and a tsconfig that follows it.
  ...spfx118('wrong-compiler', {}, { compiler: 'rush-stack-compiler-3.9' }),
  // Exact engines pin nobody has installed while 18.20.8 fits the SPFx range.
  ...spfx118('exact-engines', {}, { compiler: 'rush-stack-compiler-4.7', engines: '18.18.2' }),
  // PnP property controls 3.20 are built for SPFx 1.20.
  ...spfx118(
    'pnp-newer',
    { dependencies: { '@pnp/spfx-property-controls': '3.20.0' } },
    { compiler: 'rush-stack-compiler-4.7' },
  ),
};

let root: string;
let cleanup: () => Promise<void>;
let report: Report;

beforeAll(async () => {
  ({ root, cleanup } = await makeWorkspace(FILES));
  process.env.LOCALAPPDATA = path.join(root, '.cache-test');
  const config = configSchema.parse({});
  report = await analyze(await discoverWorkspace(root, { config }), {
    config,
    today: TODAY,
    security: false,
    installedNodes: fakeNodes('22.19.0', '18.20.8'),
  });
});

afterAll(async () => {
  await cleanup();
});

const project = (id: string): ProjectReport => {
  const found = report.projects.find((entry) => entry.project.id === id);
  if (!found) throw new Error(`project ${id} missing`);
  return found;
};

function fixOf(id: string, ruleId: string, fixId: string): Fix {
  const found = project(id)
    .findings.filter((item) => item.ruleId === ruleId)
    .flatMap((item) => item.fixes)
    .find((item) => item.id === fixId);
  if (!found) throw new Error(`${id}: no ${fixId} fix on ${ruleId}`);
  return found;
}

async function applyFix(item: Fix): Promise<void> {
  await applyPreviews(root, await previewEdits(collectEdits([item])), TODAY);
}

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path.join(root, file), 'utf8')) as Record<string, unknown>;

describe('spfx/tsconfig-compiler', () => {
  it('points tsconfig at the declared compiler with a safe edit, package.json untouched', async () => {
    const rules = project('tsconfig-only').findings.map((item) => item.ruleId);
    expect(rules).toContain('spfx/tsconfig-compiler');
    expect(rules).not.toContain('spfx/compiler-mismatch');
    const item = fixOf('tsconfig-only', 'spfx/tsconfig-compiler', 'spfx/tsconfig-extends');
    expect(item.risk).toBe('safe');
    expect(item.edits.map((edit) => path.basename(edit.file))).toEqual(['tsconfig.json']);

    await applyFix(item);
    expect((await readJson('tsconfig-only/tsconfig.json')).extends).toBe(
      './node_modules/@microsoft/rush-stack-compiler-4.7/includes/tsconfig-web.json',
    );
  });
});

describe('spfx/replace-compiler', () => {
  it('swaps the compiler package and moves tsconfig extends with it', async () => {
    const item = fixOf('wrong-compiler', 'spfx/compiler-mismatch', 'spfx/replace-compiler');
    expect(item.edits.map((edit) => path.basename(edit.file)).sort()).toEqual([
      'package.json',
      'package.json',
      'tsconfig.json',
    ]);
    // One finding per problem: the tsconfig edit rides on the compiler fix.
    expect(project('wrong-compiler').findings.map((entry) => entry.ruleId)).not.toContain(
      'spfx/tsconfig-compiler',
    );

    await applyFix(item);
    const manifest = await readJson('wrong-compiler/package.json');
    const dev = manifest.devDependencies as Record<string, string>;
    expect(dev['@microsoft/rush-stack-compiler-4.7']).toBe('0.1.0');
    expect(dev['@microsoft/rush-stack-compiler-3.9']).toBeUndefined();
    expect((await readJson('wrong-compiler/tsconfig.json')).extends).toBe(
      './node_modules/@microsoft/rush-stack-compiler-4.7/includes/tsconfig-web.json',
    );
  });
});

describe('node/set-engines on an exact engines pin', () => {
  it('offers the stack range for review when the pin is not installed but the range is', async () => {
    const entry = project('exact-engines');
    expect(entry.node.selected).toBeUndefined();
    const notInstalled = entry.findings.find((item) => item.ruleId === 'node/not-installed');
    expect(notInstalled?.evidence).toEqual(['18.20.8 fits >=18.17.1 <19.0.0 (SPFx 1.18.2)']);
    const item = fixOf('exact-engines', 'node/not-installed', 'node/set-engines');
    expect(item.risk).toBe('review');

    await applyFix(item);
    expect((await readJson('exact-engines/package.json')).engines).toEqual({
      node: '>=18.17.1 <19.0.0',
    });
  });
});

describe('spfx/library-target', () => {
  it('pins the PnP controls line built for the project SPFx version, for review', async () => {
    const finding = project('pnp-newer').findings.find(
      (item) => item.ruleId === 'spfx/library-target-mismatch',
    );
    // Built for a newer SPFx than the project runs: an error, not a warning.
    expect(finding?.severity).toBe('error');
    const item = fixOf('pnp-newer', 'spfx/library-target-mismatch', 'spfx/library-target');
    expect(item.risk).toBe('review');

    await applyFix(item);
    const manifest = await readJson('pnp-newer/package.json');
    expect((manifest.dependencies as Record<string, string>)['@pnp/spfx-property-controls']).toBe(
      '3.15.0',
    );
  });
});
