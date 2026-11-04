import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { buildProgram } from '../src/cli/main.js';
import { loadConfig, configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { applyPreviews, collectEdits, previewEdits } from '../src/fixes/apply.js';
import * as runner from '../src/exec/run.js';
import * as nodes from '../src/node/toolchain.js';
import * as packuments from '../src/ops/outdated.js';
import type { PackageVersionMetadata } from '../src/ops/outdated.js';
import { planUpgrade } from '../src/upgrade/plan.js';
import { planStore, readLinks, unlinkProjects } from '../src/store/store.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY, type FileTree } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
const installed = fakeNodes('24.9.0', '22.19.0', '18.20.8');
const versions: Record<string, string[]> = {
  ajv: ['6.12.5'],
  typescript: ['5.3.3', '5.8.3'],
  '@types/webpack-env': ['1.15.3'],
  '@fluentui/react': ['8.122.15'],
  'css-loader': ['7.1.2'],
  '@rushstack/eslint-config': ['4.0.1', '4.3.0', '4.5.2'],
  '@microsoft/eslint-config-spfx': ['1.21.1', '1.24.0'],
  '@typescript-eslint/parser': ['8.26.1', '8.46.2'],
  '@typescript-eslint/eslint-plugin': ['8.26.1', '8.46.2'],
  '@typescript-eslint/utils': ['8.26.1', '8.46.2'],
  '@pnp/spfx-property-controls': ['3.20.0', '3.21.0', '3.22.0', '3.24.0'],
  '@pnp/spfx-controls-react': ['3.21.0', '3.23.0', '3.25.0'],
};
function versionMetadata(name: string, version: string): PackageVersionMetadata {
  if (name === '@microsoft/eslint-config-spfx')
    return {
      dependencies: {
        '@rushstack/eslint-config': version === '1.21.1' ? '4.3.0' : '4.5.2',
        '@typescript-eslint/utils': version === '1.21.1' ? '8.26.1' : '8.46.2',
      },
    };
  if (name === '@rushstack/eslint-config')
    return {
      dependencies: {
        '@typescript-eslint/parser': version === '4.3.0' ? '~8.26.1' : '~8.46.2',
        '@typescript-eslint/eslint-plugin': version === '4.3.0' ? '~8.26.1' : '~8.46.2',
      },
    };
  return {};
}
const registry: typeof fetch = (input) => {
  const name = decodeURIComponent(
    (input instanceof Request ? input.url : input.toString()).split('/').pop() ?? '',
  );
  return Promise.resolve(
    new Response(
      JSON.stringify({
        versions: Object.fromEntries(
          (versions[name] ?? []).map((version) => [version, versionMetadata(name, version)]),
        ),
      }),
    ),
  );
};

beforeEach(() => {
  vi.spyOn(nodes, 'listInstalledNodes').mockResolvedValue(installed);
  vi.spyOn(packuments, 'fetchPackuments').mockImplementation((names) =>
    Promise.resolve(
      new Map(
        names.map((name) => [
          name,
          {
            versions: Object.fromEntries(
              (versions[name] ?? []).map((version) => [version, versionMetadata(name, version)]),
            ),
          },
        ]),
      ),
    ),
  );
});
afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
});

function spfx(name: string, version: string): FileTree {
  const compiler = version === '1.21.1' ? '5.3' : '4.7';
  return {
    [`${name}/package.json`]: {
      name,
      version: '1.0.0',
      scripts: { build: 'gulp bundle' },
      dependencies: {
        '@microsoft/sp-core-library': version,
        '@microsoft/sp-webpart-base': version,
        react: '17.0.1',
        'react-dom': '17.0.1',
      },
      devDependencies: {
        '@microsoft/sp-build-web': version,
        [`@microsoft/rush-stack-compiler-${compiler}`]: '0.1.0',
        typescript: compiler === '5.3' ? '5.3.3' : '4.7.4',
        '@types/webpack-env': '~1.15.2',
      },
    },
    [`${name}/package-lock.json`]: lockfile(
      name,
      {},
      {
        '@microsoft/sp-core-library': version,
        '@microsoft/sp-webpart-base': version,
        react: '17.0.1',
        'react-dom': '17.0.1',
        typescript: compiler === '5.3' ? '5.3.3' : '4.7.4',
        '@types/webpack-env': '1.15.3',
      },
    ),
    [`${name}/gulpfile.js`]:
      "'use strict';\nconst build = require('@microsoft/sp-build-web');\nbuild.initialize(require('gulp'));\n",
    [`${name}/tsconfig.json`]: {
      extends: `./node_modules/@microsoft/rush-stack-compiler-${compiler}/includes/tsconfig-web.json`,
      compilerOptions: { skipLibCheck: true },
    },
    [`${name}/.yo-rc.json`]: {
      '@microsoft/generator-sharepoint': { version, solutionName: name, environment: 'spo' },
    },
  };
}

async function setup(files: FileTree): Promise<{ root: string; report: Report }> {
  const result = await makeWorkspace(files);
  cleanup = result.cleanup;
  const { config } = await loadConfig(result.root);
  const report = await analyze(await discoverWorkspace(result.root, { config }), {
    config,
    security: false,
    installedNodes: installed,
    today: TODAY,
    targetVersions: true,
  });
  return { root: result.root, report };
}
const config = () => configSchema.parse({});

describe('repository targets', () => {
  it('preserves an existing global profile during scoped migration and folds scopes back into the full policy', async () => {
    const { root, report } = await setup({ ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') });
    const initial = configSchema.parse({
      profiles: {
        'packman-spfx': {
          projects: ['**', '.'],
          stack: 'spfx',
          dependencies: { '@microsoft/sp-core-library': '1.18.2' },
        },
      },
      policy: { groups: [{ name: 'packman-spfx', stack: 'spfx', projects: ['**', '.'] }] },
    });
    await writeFile(path.join(root, 'packman.config.json'), JSON.stringify(initial));
    const scoped = await planUpgrade(report, {
      config: initial,
      persistTarget: false,
      fetchImpl: registry,
    });
    await applyPreviews(root, await previewEdits(collectEdits(scoped.fixes)));
    const { config: saved } = await loadConfig(root);
    expect(saved.profiles['packman-spfx']?.dependencies['@microsoft/sp-core-library']).toBe(
      '1.18.2',
    );
    expect(Object.keys(saved.profiles).some((name) => name.startsWith('packman-spfx-scope-'))).toBe(
      true,
    );
    expect(saved.target).toEqual({});
    const current = await analyze(await discoverWorkspace(root, { config: saved }), {
      config: saved,
      security: false,
      installedNodes: installed,
      targetVersions: true,
    });
    const full = await planUpgrade(current, { config: saved, fetchImpl: registry });
    await applyPreviews(root, await previewEdits(collectEdits(full.fixes)));
    const { config: merged } = await loadConfig(root);
    expect(Object.keys(merged.profiles)).toEqual(['packman-spfx']);
    expect(merged.profiles['packman-spfx']?.dependencies['@microsoft/sp-core-library']).toBe(
      '1.21.1',
    );
  });
  it('keeps future projects in their stack policy without applying SPFx profiles to an unrelated React app', async () => {
    const { root, report } = await setup({ ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') });
    const plan = await planUpgrade(report, { config: config(), fetchImpl: registry });
    await applyPreviews(root, await previewEdits(collectEdits(plan.fixes)));
    const additions = {
      ...spfx('future', '1.21.1'),
      'react-app/package.json': { name: 'react-app', dependencies: { react: '18.3.1' } },
    };
    for (const [relative, content] of Object.entries(additions)) {
      const file = path.join(root, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    }
    const { config: saved } = await loadConfig(root);
    const after = await analyze(await discoverWorkspace(root, { config: saved }), {
      config: saved,
      security: false,
      installedNodes: installed,
      targetVersions: true,
    });
    expect(after.groups.find((group) => group.name === 'packman-spfx')?.projectIds).toContain(
      'future',
    );
    expect(after.groups.find((group) => group.name === 'packman-spfx')?.projectIds).not.toContain(
      'react-app',
    );
    expect(
      after.projects
        .find((entry) => entry.project.id === 'react-app')
        ?.findings.some((finding) => finding.ruleId.startsWith('profile/')),
    ).toBe(false);
    expect(
      after.projects
        .find((entry) => entry.project.id === 'future')
        ?.findings.some((finding) => finding.ruleId.startsWith('profile/')),
    ).toBe(true);
  });

  it('blocks a legacy profile that would revert the selected target versions', async () => {
    const { report } = await setup({ ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') });
    const plan = await planUpgrade(report, {
      config: configSchema.parse({
        profiles: {
          old: { projects: ['**'], dependencies: { '@microsoft/sp-core-library': '1.18.2' } },
        },
      }),
      fetchImpl: registry,
    });
    expect(
      plan.projects
        .flatMap((entry) => entry.issues)
        .some((issue) => issue.code === 'profile-conflict' && issue.level === 'blocker'),
    ).toBe(true);
  });

  it('defaults to the newest existing SPFx project, not the newest published SPFx', async () => {
    const { report } = await setup({
      ...spfx('old', '1.18.2'),
      ...spfx('middle', '1.20.0'),
      ...spfx('new', '1.21.1'),
    });
    const request = vi.fn(registry);
    const plan = await planUpgrade(report, { config: config(), fetchImpl: request });
    expect(plan.targets).toMatchObject([
      {
        stack: 'spfx',
        version: '1.21.1',
        baseline: 'new',
        origin: 'repository',
        toolchain: 'gulp',
      },
    ]);
    expect(plan.nodeVersion).toBe('22.19.0');
    expect(plan.projects.map((project) => project.target)).toEqual(['1.21.1', '1.21.1', '1.21.1']);
    expect(
      vi
        .mocked(packuments.fetchPackuments)
        .mock.calls.some(([names]) => names.includes('@microsoft/sp-core-library')),
    ).toBe(false);
    expect(plan.issues.filter((issue) => issue.level === 'blocker')).toEqual([]);
    expect(
      report.workspaceFindings.some((finding) => finding.ruleId === 'policy/repository-target'),
    ).toBe(true);
  });

  it('updates the complete SPFx stack and Node pins while preserving project identities and custom TS options', async () => {
    const files = {
      ...spfx('old', '1.18.2'),
      ...spfx('new', '1.21.1'),
      'old/.nvmrc': '18.20.8',
      'old/.node-version': '18.20.8',
      'old/.tool-versions': 'python 3.12.0\nnodejs 18.20.8\n',
    };
    const { root, report } = await setup(files);
    const plan = await planUpgrade(report, { config: config(), fetchImpl: registry });
    await applyPreviews(root, await previewEdits(collectEdits(plan.fixes)));
    const manifest = JSON.parse(await readFile(path.join(root, 'old/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: { node: string };
    };
    expect(manifest.dependencies['@microsoft/sp-core-library']).toBe('1.21.1');
    expect(manifest.devDependencies['@microsoft/sp-build-web']).toBe('1.21.1');
    expect(manifest.devDependencies['@microsoft/rush-stack-compiler-4.7']).toBeUndefined();
    expect(manifest.devDependencies['@microsoft/rush-stack-compiler-5.3']).toBe('0.1.0');
    expect(manifest.devDependencies.typescript).toBe('5.3.3');
    expect(manifest.devDependencies['@rushstack/eslint-config']).toBe('4.3.0');
    expect(manifest.devDependencies['@typescript-eslint/parser']).toBe('8.26.1');
    expect(manifest.devDependencies['@typescript-eslint/eslint-plugin']).toBe('8.26.1');
    expect(manifest.engines.node).toBe('22.19.0');
    const tsconfig = JSON.parse(await readFile(path.join(root, 'old/tsconfig.json'), 'utf8')) as {
      extends: string;
      compilerOptions: object;
    };
    expect(tsconfig.extends).toContain('rush-stack-compiler-5.3');
    expect(tsconfig.compilerOptions).toEqual({ skipLibCheck: true });
    expect(await readFile(path.join(root, 'old/.nvmrc'), 'utf8')).toBe('22.19.0\n');
    expect(await readFile(path.join(root, 'old/.tool-versions'), 'utf8')).toContain(
      'python 3.12.0\nnodejs 22.19.0',
    );
    expect(JSON.parse(await readFile(path.join(root, 'old/.yo-rc.json'), 'utf8'))).toMatchObject({
      '@microsoft/generator-sharepoint': { solutionName: 'old', version: '1.21.1' },
    });
    const { config: saved } = await loadConfig(root);
    expect(saved.target).toEqual({ spfx: '1.21.1', node: '22.19.0' });
    expect(saved.policy.groups[0]?.projects).toEqual(['**', '.']);
    expect(saved.policy.groups[0]?.stack).toBe('spfx');
    const after = await analyze(await discoverWorkspace(root, { config: saved }), {
      config: saved,
      security: false,
      targetVersions: true,
      installedNodes: installed,
    });
    expect(
      after.projects
        .flatMap((entry) => entry.findings)
        .filter((finding) => finding.ruleId.startsWith('policy/target')),
    ).toEqual([]);
  });

  it('reports configured target violations and preserves a repository target when projects differ', async () => {
    const { report } = await setup({
      ...spfx('old', '1.18.2'),
      'packman.config.json': { target: { spfx: '1.21.1', node: '22.19.0' } },
    });
    expect(report.projects[0]?.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(['policy/target-stack', 'policy/target-node']),
    );
  });

  it('plans unrelated frameworks separately, using their own existing baseline versions', async () => {
    const { report } = await setup({
      'react-old/package.json': {
        name: 'react-old',
        dependencies: { react: '17.0.1', 'react-dom': '17.0.1' },
      },
      'react-new/package.json': {
        name: 'react-new',
        dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
      },
      'vite-old/package.json': {
        name: 'vite-old',
        dependencies: { vite: '5.4.0', react: '18.3.1' },
      },
      'vite-new/package.json': {
        name: 'vite-new',
        dependencies: { vite: '6.1.0', react: '18.3.1' },
      },
    });
    const plan = await planUpgrade(report, { config: config(), offline: true });
    expect(plan.targets.map((target) => [target.stack, target.version])).toEqual([
      ['react', '18.3.1'],
      ['vite', '6.1.0'],
    ]);
    await expect(planUpgrade(report, { config: config(), to: '18.3.1' })).rejects.toThrow(
      '--stack',
    );
  });

  it('orders local project dependencies before their consumers', async () => {
    const { report } = await setup({
      'a-app/package.json': {
        name: 'app',
        dependencies: { react: '18.3.1', '@demo/base': 'file:../z-base' },
      },
      'z-base/package.json': { name: '@demo/base', dependencies: { react: '18.3.1' } },
    });
    const plan = await planUpgrade(report, { config: config(), offline: true });
    expect(plan.order).toEqual(['z-base', 'a-app']);
  });
});

describe('explicit SPFx migrations and blockers', () => {
  it('detects generic getPaged calls as a source blocker and preserves TS 5.3 legacy option semantics', async () => {
    const files = { ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') };
    (files['old/package.json'] as { dependencies: Record<string, string> }).dependencies[
      '@pnp/sp'
    ] = '3.26.0';
    (files['new/package.json'] as { dependencies: Record<string, string> }).dependencies[
      '@pnp/sp'
    ] = '4.12.0';
    files['old/tsconfig.json'] = {
      compilerOptions: { suppressImplicitAnyIndexErrors: true, skipLibCheck: true },
    };
    const { report } = await setup({
      ...files,
      'old/src/data.ts': 'const page = await query.getPaged<T[]>();',
    });
    const plan = await planUpgrade(report, { config: config(), fetchImpl: registry });
    const old = plan.projects.find((project) => project.id === 'old');
    expect(old?.issues).toContainEqual(
      expect.objectContaining({
        code: 'pnp-api',
        level: 'blocker',
        files: [path.join('src', 'data.ts')],
      }),
    );
    expect(old?.edits).toContainEqual(
      expect.objectContaining({
        kind: 'json-set',
        path: ['compilerOptions', 'ignoreDeprecations'],
        value: '5.0',
      }),
    );
  });

  it('warns that async iterators over PnPjs need ES2018+ or downlevelIteration', async () => {
    const asyncTarget = async (compilerOptions: object) => {
      const files = { ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') };
      (files['old/package.json'] as { dependencies: Record<string, string> }).dependencies[
        '@pnp/sp'
      ] = '3.26.0';
      (files['new/package.json'] as { dependencies: Record<string, string> }).dependencies[
        '@pnp/sp'
      ] = '4.12.0';
      files['old/tsconfig.json'] = { compilerOptions };
      const { report } = await setup({
        ...files,
        'old/src/data.ts': 'const page = await query.getPaged<T[]>();',
      });
      const plan = await planUpgrade(report, { config: config(), fetchImpl: registry });
      return plan.projects
        .find((project) => project.id === 'old')
        ?.issues.find((issue) => issue.code === 'pnp-async-target');
    };
    expect(await asyncTarget({ target: 'es5' })).toMatchObject({
      level: 'review',
      message: { params: { target: 'es5' } },
      files: ['tsconfig.json'],
    });
    expect(await asyncTarget({ target: 'ES2017' })).toBeDefined();
    expect(await asyncTarget({ target: 'es2020' })).toBeUndefined();
    expect(await asyncTarget({ target: 'es5', downlevelIteration: true })).toBeUndefined();
  });

  it('generates Heft configuration only for an explicit newer target', async () => {
    const { root, report } = await setup({
      ...spfx('app', '1.21.1'),
      'app/.eslintrc.js':
        'require("@rushstack/eslint-config/patch/modern-module-resolution");\nmodule.exports = { extends: ["@microsoft/eslint-config-spfx/lib/profiles/default"], parserOptions: { tsconfigRootDir: __dirname } };\n',
    });
    const plan = await planUpgrade(report, { config: config(), to: '1.24', fetchImpl: registry });
    expect(plan.targets[0]).toMatchObject({
      version: '1.24.0',
      origin: 'explicit',
      toolchain: 'heft',
    });
    expect(plan.projects[0]?.issues.filter((issue) => issue.level === 'blocker')).toEqual([]);
    await applyPreviews(root, await previewEdits(collectEdits(plan.fixes)));
    expect(existsSync(path.join(root, 'app/gulpfile.js'))).toBe(false);
    expect(existsSync(path.join(root, 'app/.eslintrc.js'))).toBe(false);
    expect(await readFile(path.join(root, 'app/eslint.config.cjs'), 'utf8')).toContain(
      'flat-profiles/default',
    );
    expect(
      JSON.parse(await readFile(path.join(root, 'app/config/rig.json'), 'utf8')),
    ).toMatchObject({ rigPackageName: '@microsoft/spfx-web-build-rig' });
    const manifest = JSON.parse(await readFile(path.join(root, 'app/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: { build: string };
    };
    expect(manifest.dependencies.react).toBe('18.3.1');
    expect(manifest.devDependencies.gulp).toBeUndefined();
    expect(manifest.devDependencies['@microsoft/sp-build-web']).toBeUndefined();
    expect(manifest.devDependencies['@microsoft/spfx-web-build-rig']).toBe('1.24.0');
    expect(manifest.scripts.build).toBe('heft build');
  });

  it('identifies concrete React API, custom Gulp and incompatible controls blockers', async () => {
    const files = spfx('app', '1.21.1');
    const manifest = files['app/package.json'] as { dependencies: Record<string, string> };
    manifest.dependencies['@pnp/spfx-property-controls'] = '3.21.0';
    const { report } = await setup({
      ...files,
      'app/gulpfile.js':
        "const build = require('@microsoft/sp-build-web'); build.addSuppression('custom'); build.initialize(require('gulp'));",
      'app/src/main.ts':
        "import * as ReactDom from 'react-dom'; ReactDom.render(element, container);",
    });
    const plan = await planUpgrade(report, { config: config(), to: '1.24.0', fetchImpl: registry });
    expect(
      plan.projects[0]?.issues
        .filter((issue) => issue.level === 'blocker')
        .map((issue) => issue.code),
    ).toEqual(expect.arrayContaining(['controls', 'react-api', 'custom-gulp']));
  });
});

describe('upgrade CLI', () => {
  it('refuses verification without a compatible installed Node before writing the migration', async () => {
    const { root } = await setup(spfx('app', '1.21.1'));
    vi.mocked(nodes.listInstalledNodes).mockResolvedValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const before = await readFile(path.join(root, 'app/package.json'), 'utf8');
    await expect(
      buildProgram().parseAsync(['upgrade', root, '--apply', '--verify', '-y'], { from: 'user' }),
    ).rejects.toThrow('not installed');
    expect(await readFile(path.join(root, 'app/package.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(root, 'packman.config.json'))).toBe(false);
  });
  it('is read-only by default and refuses a blocked apply before writing', async () => {
    const { root } = await setup({ ...spfx('old', '1.18.2'), ...spfx('new', '1.21.1') });
    const before = await readFile(path.join(root, 'old/package.json'), 'utf8');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await buildProgram().parseAsync(['upgrade', root, '--offline'], { from: 'user' });
    expect(await readFile(path.join(root, 'old/package.json'), 'utf8')).toBe(before);
    expect(existsSync(path.join(root, 'packman.config.json'))).toBe(false);
    await writeFile(path.join(root, 'new/gulpfile.js'), 'custom task');
    await buildProgram().parseAsync(
      ['upgrade', root, '--to', '1.24', '--apply', '--offline', '-y'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(await readFile(path.join(root, 'old/package.json'), 'utf8')).toBe(before);
  });

  it('installs a shared group once, synchronizes project locks, deletes local modules and verifies every member', async () => {
    const { root } = await setup({
      'old/package.json': {
        name: 'old',
        dependencies: { react: '17.0.1', 'react-dom': '17.0.1' },
        scripts: { build: 'node build.js' },
      },
      'new/package.json': {
        name: 'new',
        dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
        scripts: { build: 'node build.js' },
      },
      'old/package-lock.json': lockfile(
        'old',
        { react: '17.0.1', 'react-dom': '17.0.1' },
        { react: '17.0.1', 'react-dom': '17.0.1' },
      ),
      'new/package-lock.json': lockfile(
        'new',
        { react: '18.3.1', 'react-dom': '18.3.1' },
        { react: '18.3.1', 'react-dom': '18.3.1' },
      ),
      'old/node_modules/own.txt': 'delete this',
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.spyOn(runner, 'runWithNode').mockImplementation(async (_node, dir, args) => {
      if (args[0] === 'install') {
        for (const name of ['react', 'react-dom'])
          await mkdir(path.join(dir, 'node_modules', name), { recursive: true });
        const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
          dependencies: Record<string, string>;
        };
        await writeFile(
          path.join(dir, 'package-lock.json'),
          JSON.stringify(lockfile('store', manifest.dependencies, manifest.dependencies)),
        );
      }
      return { code: 0 };
    });
    await buildProgram().parseAsync(
      ['upgrade', root, '--apply', '--shared', '--verify', '--offline', '-y'],
      { from: 'user' },
    );
    expect(run.mock.calls.filter(([, , args]) => args[0] === 'install')).toHaveLength(1);
    expect(run.mock.calls.filter(([, , args]) => args[0] === 'run')).toHaveLength(2);
    expect(existsSync(path.join(root, '.packman/trash'))).toBe(false);
    const { config: saved } = await loadConfig(root);
    const report = await analyze(await discoverWorkspace(root, { config: saved }), {
      config: saved,
      security: false,
      installedNodes: installed,
      targetVersions: true,
    });
    expect(
      report.projects
        .flatMap((entry) => entry.findings)
        .filter((finding) => finding.ruleId === 'npm/lockfile-drift'),
    ).toEqual([]);
    expect((await readLinks(root)).every((link) => !!link.backupDir && !link.movedTo)).toBe(true);
    expect(planStore(report, { union: true }).groups).toHaveLength(1);
    expect(planStore(report, { union: true }).groups[0]?.key).toBe((await readLinks(root))[0]?.key);
    await buildProgram().parseAsync(['upgrade', root, '--apply', '--shared', '--offline', '-y'], {
      from: 'user',
    });
    expect(run.mock.calls.filter(([, , args]) => args[0] === 'install')).toHaveLength(1);
    await unlinkProjects(root, undefined, { restore: true });
    expect(existsSync(path.join(root, 'old/node_modules'))).toBe(false);
    expect(
      JSON.parse(await readFile(path.join(root, 'old/package-lock.json'), 'utf8')),
    ).toMatchObject({ packages: { '': { dependencies: { react: '18.3.1' } } } });
  });
});
