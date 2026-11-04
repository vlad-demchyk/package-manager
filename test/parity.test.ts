import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze, type ProjectReport, type Report } from '../src/analyze.js';
import { loadConfig } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import type { Fix } from '../src/core/types.js';
import { applyPreviews, collectEdits, previewEdits } from '../src/fixes/apply.js';
import { alignPackage, alignToProject, closestProjects, diffProjects } from '../src/ops/align.js';
import { executeClean, planClean } from '../src/ops/clean.js';
import { generateProfile } from '../src/ops/generate.js';
import { journal, pruneJournal, readJournal } from '../src/ops/journal.js';
import { versionMatrix } from '../src/ops/matrix.js';
import { outdated } from '../src/ops/outdated.js';
import {
  linkGroup,
  planStore,
  pruneTargets,
  readLinks,
  unlinkProjects,
} from '../src/store/store.js';
import { configReferences } from '../src/scan/implicit.js';
import { fakeNodes, TODAY } from './helpers.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'workspace');

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'packman-parity-'));
  await cp(FIXTURE, root, { recursive: true });
  process.env.LOCALAPPDATA = path.join(root, '.cache-test');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(options: { only?: string[]; usage?: boolean } = {}): Promise<Report> {
  const { config } = await loadConfig(root);
  const workspace = await discoverWorkspace(root, {
    config,
    ...(options.only ? { only: options.only } : {}),
  });
  return analyze(workspace, {
    config,
    today: TODAY,
    security: false,
    usage: options.usage ?? true,
    installedNodes: fakeNodes('24.9.0', '22.19.0', '18.20.8'),
  });
}

const entry = (report: Report, id: string): ProjectReport => {
  const found = report.projects.find((item) => item.project.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};
const finding = (report: Report, id: string, rule: string) =>
  entry(report, id).findings.find((item) => item.ruleId === rule);
const rules = (report: Report, id: string): string[] =>
  entry(report, id).findings.map((item) => item.ruleId);

async function apply(fixes: Fix[]): Promise<void> {
  await applyPreviews(root, await previewEdits(collectEdits(fixes)), TODAY);
}

describe('discovery filters (2.x prefix / structure / list / regex / recursive)', () => {
  it('honours requiredFiles, match and exclude', async () => {
    const { config } = await loadConfig(root);
    const byStructure = await discoverWorkspace(root, {
      config: { ...config, projects: { ...config.projects, requiredFiles: ['tsconfig.json'] } },
    });
    expect(byStructure.projects.map((p) => p.id)).toEqual([
      'spfx-extension-121',
      'spfx-webpart-121',
      'web-app',
    ]);
    const byRegex = await discoverWorkspace(root, {
      config: { ...config, projects: { ...config.projects, match: '^spfx-.*-121$' } },
    });
    expect(byRegex.projects.map((p) => p.id)).toEqual(['spfx-extension-121', 'spfx-webpart-121']);
    const excluded = await discoverWorkspace(root, { config, skip: ['spfx-*'] });
    expect(excluded.projects.map((p) => p.id)).toEqual(['api-server', 'web-app']);
    const shallow = await discoverWorkspace(root, { config, depth: 0 });
    expect(shallow.projects.map((p) => p.id)).toEqual(['.']);
  });
});

describe('SPFx core packages', () => {
  it('detects component types from manifests', async () => {
    const report = await run();
    expect(
      entry(report, 'spfx-extension-121').stacks.find((s) => s.provider === 'spfx')?.details
        .components,
    ).toBe('applicationCustomizer,extension');
    expect(
      entry(report, 'spfx-webpart-121').stacks.find((s) => s.provider === 'spfx')?.details
        .components,
    ).toBe('webpart');
  });

  it('separates missing, transitive and unverifiable core packages', async () => {
    const report = await run();
    expect(finding(report, 'spfx-webpart-121', 'spfx/core-missing')?.evidence).toEqual([
      '@microsoft/sp-module-interfaces@1.21.1 (devDependencies)',
      'eslint-plugin-react-hooks@4.3.0 (devDependencies)',
    ]);
    expect(finding(report, 'spfx-webpart-121', 'spfx/core-transitive')?.evidence).toEqual([
      'tslib@2.3.1 (dependencies)',
    ]);
    expect(finding(report, 'spfx-old-17', 'spfx/core-unverified')).toBeDefined();
    expect(rules(report, 'spfx-extension-121')).not.toContain('spfx/core-missing');
  });

  it('never reports scaffold packages as unused, even when not imported', async () => {
    const report = await run();
    const unused = [
      ...(finding(report, 'spfx-webpart-121', 'npm/unused-dependency')?.evidence ?? []),
      ...(finding(report, 'spfx-webpart-121', 'npm/unused-dev-dependency')?.evidence ?? []),
    ];
    expect(unused).toEqual(['@pnp/logging@3.26.0', 'moment@2.29.4']);
  });

  it('flags tslint.json only on ESLint-era SPFx and deletes it on apply', async () => {
    const report = await run();
    const leftover = finding(report, 'spfx-webpart-121', 'spfx/tslint-leftover');
    expect(leftover?.fixes[0]?.edits[0]).toMatchObject({ kind: 'file-delete' });
    await apply(leftover?.fixes ?? []);
    expect(existsSync(path.join(root, 'spfx-webpart-121', 'tslint.json'))).toBe(false);
  });
});

describe('implicit usage (2.x depcheck whitelist)', () => {
  it('keeps tools implied by config files and scripts, pins of transitive versions and type packages', async () => {
    const report = await run();
    const unusedDev = finding(report, 'spfx-webpart-121', 'npm/unused-dev-dependency');
    expect(unusedDev).toBeUndefined();
    expect(finding(report, 'api-server', 'npm/unused-dev-dependency')?.evidence).toEqual([
      'nodemon@3.1.9',
    ]);
  });

  it('merges a duplicated tool into devDependencies with the highest version', async () => {
    const report = await run();
    const duplicate = finding(report, 'spfx-webpart-121', 'npm/duplicate-declaration');
    expect(duplicate?.fixes[0]?.edits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'json-remove',
          path: ['dependencies', '@microsoft/eslint-config-spfx'],
        }),
        expect.objectContaining({
          kind: 'json-set',
          path: ['devDependencies', '@microsoft/eslint-config-spfx'],
          value: '1.21.1',
        }),
      ]),
    );
  });

  it('still reports duplicate declarations without the source scan', async () => {
    const report = await run({ usage: false });
    expect(rules(report, 'spfx-webpart-121')).toContain('npm/duplicate-declaration');
  });
});

describe('profiles (2.x update configs)', () => {
  it('reports every profile difference and is idempotent once applied', async () => {
    const before = await run();
    const webpart = entry(before, 'spfx-webpart-121');
    expect(
      webpart.findings
        .filter((f) => f.ruleId.startsWith('profile/'))
        .map((f) => f.ruleId)
        .sort(),
    ).toEqual([
      'profile/deprecated',
      'profile/engines',
      'profile/scripts',
      'profile/tsconfig',
      'profile/versions',
    ]);
    const fixes = before.projects.flatMap((p) =>
      p.findings.filter((f) => f.ruleId.startsWith('profile/')).flatMap((f) => f.fixes),
    );
    await apply(fixes);
    const manifest = JSON.parse(
      await readFile(path.join(root, 'spfx-webpart-121', 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;
    expect(manifest.dependencies?.moment).toBeUndefined();
    expect(manifest.dependencies?.['@pnp/sp']).toBe('4.12.0');
    expect(manifest.scripts).toMatchObject({ build: 'gulp bundle', clean: 'gulp clean' });
    expect(manifest.engines?.node).toBe('>=22.14.0 <23.0.0');
    const tsconfig = JSON.parse(
      await readFile(path.join(root, 'spfx-webpart-121', 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: Record<string, unknown> };
    expect(tsconfig.compilerOptions).toMatchObject({ skipLibCheck: true, target: 'es5' });
    const after = await run();
    expect(
      after.projects.flatMap((p) => p.findings).filter((f) => f.ruleId.startsWith('profile/')),
    ).toEqual([]);
  });

  it('generates a profile from projects like 2.x (base, conditional, dev, conditional dev)', async () => {
    const report = await run({ only: ['spfx-*-121'] });
    const profile = generateProfile(
      report.projects.map((p) => p.project),
      {
        strategy: 'highest',
        projectsGlob: ['spfx-*-121'],
        resolved: true,
        nodeRange: '>=22.14.0 <23.0.0',
      },
    );
    expect(profile.dependencies).toMatchObject({
      '@microsoft/sp-core-library': '1.21.1',
      '@pnp/sp': '4.12.0',
      react: '17.0.1',
    });
    expect(profile.devDependencies).toMatchObject({
      gulp: '4.0.2',
      '@microsoft/sp-build-web': '1.21.1',
    });
    expect(profile.conditionalDevDependencies).toMatchObject({ postcss: '8.4.49' });
    expect(profile.engines).toEqual({ node: '>=22.14.0 <23.0.0' });
  });
});

describe('alignment and matrix (2.x experimental 7 and main menu 8)', () => {
  it('compares two projects and copies the target versions into the base', async () => {
    const report = await run();
    const webpart = entry(report, 'spfx-webpart-121').project;
    const extension = entry(report, 'spfx-extension-121').project;
    expect(
      closestProjects(
        webpart,
        report.projects.map((p) => p.project),
      )[0]?.project.id,
    ).toBe('spfx-extension-121');
    const different = diffProjects(webpart, extension)
      .filter((row) => row.status === 'different')
      .map((row) => row.name);
    expect(different).toEqual(['@microsoft/eslint-config-spfx', '@pnp/sp']);
    const fix = alignToProject(webpart, extension, { pin: true, includeMissing: false });
    await apply(fix ? [fix] : []);
    const again = await run();
    const rows = diffProjects(
      entry(again, 'spfx-webpart-121').project,
      entry(again, 'spfx-extension-121').project,
    );
    expect(rows.find((row) => row.name === '@pnp/sp')?.status).toBe('same');
  });

  it('aligns one package everywhere to the most common version', async () => {
    const report = await run();
    const aligned = alignPackage(
      report.projects.map((p) => p.project),
      'typescript',
    );
    expect(aligned?.version).toBe('5.3.3');
    expect(aligned?.fix.edits.map((edit) => path.basename(path.dirname(edit.file))).sort()).toEqual(
      ['spfx-extension-121', 'spfx-legacy-118', 'spfx-webpart-121', 'web-app'],
    );
  });

  it('builds the version matrix on resolved versions', async () => {
    const report = await run();
    const matrix = versionMatrix(
      report.projects.map((p) => p.project),
      { divergingOnly: true },
    );
    const names = matrix.rows.map((row) => row.name);
    expect(names).toContain('react');
    expect(names).toContain('@microsoft/sp-core-library');
    expect(names).not.toContain('@pnp/sp');
  });
});

describe('npm tools (2.x experimental 4)', () => {
  it('lists outdated packages from registry metadata', async () => {
    const report = await run({ only: ['web-app'] });
    const registry: Record<string, object> = {
      axios: { 'dist-tags': { latest: '1.13.2' }, versions: { '1.6.0': {}, '1.13.2': {} } },
      react: { 'dist-tags': { latest: '19.3.1' }, versions: { '18.3.1': {}, '19.3.1': {} } },
    };
    const fakeFetch: typeof fetch = (input) => {
      const name = decodeURIComponent(
        (input instanceof Request ? input.url : input.toString()).split('/').pop() ?? '',
      );
      const body = registry[name];
      return Promise.resolve(
        body ? new Response(JSON.stringify(body)) : new Response('{}', { status: 404 }),
      );
    };
    const rows = await outdated(
      report.projects.map((p) => p.project),
      { offline: false, fetchImpl: fakeFetch },
    );
    expect(rows.find((row) => row.name === 'axios')).toMatchObject({
      current: '1.6.0',
      latest: '1.13.2',
      latestInMajor: '1.13.2',
    });
    expect(rows.find((row) => row.name === 'react')).toMatchObject({
      current: '18.3.1',
      latest: '19.3.1',
      latestInMajor: '18.3.1',
    });
  });

  it('cleans lockfiles and node_modules and records it', async () => {
    await mkdir(path.join(root, 'web-app', 'node_modules', 'react'), { recursive: true });
    const report = await run({ only: ['web-app', 'api-server'] });
    const targets = planClean(
      report.projects.map((p) => p.project),
      { modules: true, lockfile: true },
    );
    expect(targets.map((t) => `${t.projectId}:${t.kind}`)).toEqual([
      'api-server:lockfile',
      'web-app:node_modules',
      'web-app:lockfile',
    ]);
    await executeClean(root, targets);
    expect(existsSync(path.join(root, 'web-app', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, 'web-app', 'package-lock.json'))).toBe(false);
    await journal(root, { command: 'clean', projects: ['web-app'], result: 'ok' });
    expect((await readJournal(root)).at(-1)).toMatchObject({ command: 'clean', result: 'ok' });
    expect(await pruneJournal(root, 0, new Date(Date.now() + 1000))).toBe(1);
  });
});

/**
 * Stands in for npm resolving a store without a lockfile: the fake "registry" answers with the versions
 * the fixtures lock, and package-lock.json is written the way npm writes it.
 */
async function resolveLikeNpm(
  dir: string,
): Promise<{ packages: Record<string, { version?: string }> }> {
  expect(existsSync(path.join(dir, 'package-lock.json'))).toBe(false);
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const packages: Record<string, { version?: string }> = { '': manifest };
  for (const project of ['spfx-webpart-121', 'spfx-extension-121']) {
    const own = JSON.parse(
      await readFile(path.join(root, project, 'package-lock.json'), 'utf8'),
    ) as {
      packages: Record<string, { version?: string }>;
    };
    for (const [location, value] of Object.entries(own.packages))
      if (location && !(location in packages)) packages[location] = value;
  }
  const lock = { lockfileVersion: 3, packages };
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify(lock));
  return lock;
}
describe('shared store with per-project links', () => {
  it('links each project only to what it needs and resolves through the store', async () => {
    // Align the two 1.21.1 projects first, as `store plan --union` asks.
    let report = await run({ only: ['spfx-*-121'] });
    const webpart = entry(report, 'spfx-webpart-121');
    const fixes = webpart.findings
      .filter((f) => ['npm/duplicate-declaration', 'profile/versions'].includes(f.ruleId))
      .flatMap((f) => f.fixes);
    await apply(fixes);
    report = await run({ only: ['spfx-*-121'] });
    const plan = planStore(report, { union: true });
    expect(plan.candidates).toEqual([]);
    const group = plan.groups[0];
    if (!group) throw new Error('union group expected');
    expect(group.projectIds).toEqual(['spfx-extension-121', 'spfx-webpart-121']);

    const install = async (dir: string): Promise<number> => {
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as Record<
        string,
        Record<string, string>
      >;
      const names = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        tslib: '',
      });
      for (const name of names) {
        const pkgDir = path.join(dir, 'node_modules', name);
        await mkdir(pkgDir, { recursive: true });
        await writeFile(
          path.join(pkgDir, 'package.json'),
          JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
        );
        await writeFile(path.join(pkgDir, 'index.js'), `module.exports = ${JSON.stringify(name)};`);
      }
      await mkdir(path.join(dir, 'node_modules', '.bin'), { recursive: true });
      await resolveLikeNpm(dir);
      return 0;
    };
    const result = await linkGroup(root, report, group, { replaceExisting: false, install });
    expect(result.linked).toEqual(['spfx-extension-121', 'spfx-webpart-121']);

    const links = await readLinks(root);
    const webLinks = links.find((link) => link.projectId === 'spfx-webpart-121')?.packages ?? [];
    const extLinks = links.find((link) => link.projectId === 'spfx-extension-121')?.packages ?? [];
    expect(webLinks).toContain('react');
    expect(webLinks).toContain('tslib');
    expect(extLinks).not.toContain('react');
    expect(extLinks).toContain('@microsoft/sp-application-base');
    expect(
      (await lstat(path.join(root, 'spfx-webpart-121', 'node_modules', 'react'))).isSymbolicLink(),
    ).toBe(true);
    expect(existsSync(path.join(root, 'spfx-extension-121', 'node_modules', 'react'))).toBe(false);

    const requireFrom = createRequire(path.join(root, 'spfx-webpart-121', 'package.json'));
    expect(requireFrom('react')).toBe('react');
    expect(requireFrom.resolve('react')).toContain(path.join('.packman', 'store'));

    const relinked = await run({ only: ['spfx-*-121'] });
    expect(relinked.projects.every((p) => p.project.nodeModules === 'link')).toBe(true);

    const unlinked = await unlinkProjects(root, undefined, { restore: true });
    expect(unlinked.unlinked).toEqual(['spfx-extension-121', 'spfx-webpart-121']);
    expect(existsSync(path.join(root, 'spfx-webpart-121', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(result.storeDir, 'node_modules', 'react', 'index.js'))).toBe(true);
  });
});

describe('fix idempotency (rule <-> fix wiring)', () => {
  it('applying all non-install fixes removes the findings they target', async () => {
    const before = await run();
    const installDependent = new Set([
      'npm/lockfile-drift',
      'npm/not-installed',
      'npm/installed-drift',
      'npm/lockfile-missing',
      // The pinned line takes effect after installation (it judges the resolved version).
      'spfx/library-target-mismatch',
    ]);
    const fixable = before.projects
      .flatMap((p) => p.findings.map((f) => ({ project: p.project.id, finding: f })))
      .filter(({ finding: f }) => f.fixes.length > 0 && !installDependent.has(f.ruleId));
    const all = fixable.flatMap(({ finding: f }) => f.fixes);
    await apply(all);
    const after = await run();
    const remaining = after.projects
      .flatMap((p) => p.findings.map((f) => `${p.project.id} ${f.ruleId}`))
      .filter((key) => fixable.some(({ project, finding: f }) => key === `${project} ${f.ruleId}`));
    // React/React DOM still resolve from the old lock until npm regenerates it.
    expect(remaining).toEqual(['web-app npm/family-mismatch']);
  });
});

describe('store regressions found on real repositories', () => {
  /**
   * Stands in for `npm install` in the store: the store has no lockfile yet (npm resolves it), so the
   * fake "registry" answers with the versions the fixtures lock, writes package-lock.json like npm
   * and materializes every top-level entry.
   */
  const installFromLock = async (dir: string): Promise<number> => {
    const lock = await resolveLikeNpm(dir);

    for (const [location, value] of Object.entries(lock.packages)) {
      if (!location || location.slice('node_modules/'.length).includes('/node_modules/')) continue;
      const pkgDir = path.join(dir, location);
      await mkdir(pkgDir, { recursive: true });
      const name = location.slice('node_modules/'.length);
      await writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name, version: value.version, main: 'index.js' }),
      );
      await writeFile(
        path.join(pkgDir, 'index.js'),
        `module.exports = ${JSON.stringify(`${name}@${value.version ?? ''}`)};`,
      );
    }
    return 0;
  };

  async function alignedUnionGroup() {
    let report = await run({ only: ['spfx-*-121'] });
    await apply(
      entry(report, 'spfx-webpart-121')
        .findings.filter((f) =>
          ['npm/duplicate-declaration', 'profile/versions'].includes(f.ruleId),
        )
        .flatMap((f) => f.fixes),
    );
    report = await run({ only: ['spfx-*-121'] });
    const group = planStore(report, { union: true }).groups[0];
    if (!group) throw new Error('union group expected');
    return { report, group };
  }

  it("resolves the store fresh, without the members' lockfiles, and links the transitive closure", async () => {
    const { report, group } = await alignedUnionGroup();
    const result = await linkGroup(root, report, group, {
      replaceExisting: false,
      install: installFromLock,
    });
    const storeLock = JSON.parse(
      await readFile(path.join(result.storeDir, 'package-lock.json'), 'utf8'),
    ) as {
      packages: Record<string, { version?: string }>;
    };
    expect(storeLock.packages['node_modules/@pnp/sp']?.version).toBe('4.12.0');
    expect(storeLock.packages['node_modules/tslib']?.version).toBe('2.3.1');
    const links = await readLinks(root);
    const extension = links.find((link) => link.projectId === 'spfx-extension-121');
    // tslib is reached through @microsoft/sp-core-library in the lockfile graph.
    expect(extension?.packages).toContain('tslib');
    expect(extension?.packages).not.toContain('react');
    const requireFrom = createRequire(path.join(root, 'spfx-extension-121', 'package.json'));
    expect(requireFrom('@pnp/sp')).toBe('@pnp/sp@4.12.0');
  });

  it('keeps file backups across re-links without retaining local modules', async () => {
    await mkdir(path.join(root, 'spfx-webpart-121', 'node_modules', 'own'), { recursive: true });
    await writeFile(
      path.join(root, 'spfx-webpart-121', 'node_modules', 'own', 'marker.txt'),
      'original',
    );
    const first = await alignedUnionGroup();
    await linkGroup(root, first.report, first.group, {
      replaceExisting: true,
      install: installFromLock,
    });
    const again = await run({ only: ['spfx-*-121'] });
    const group = planStore(again, { union: true }).groups[0];
    if (!group) throw new Error('union group expected');
    await linkGroup(root, again, group, { replaceExisting: false, install: installFromLock });
    expect(
      (await readLinks(root)).find((link) => link.projectId === 'spfx-webpart-121')?.backupDir,
    ).toBeDefined();
    const result = await unlinkProjects(root, ['spfx-webpart-121'], { restore: true });
    expect(result.restored).toEqual(['spfx-webpart-121']);
    expect(existsSync(path.join(root, 'spfx-webpart-121', 'node_modules'))).toBe(false);
    expect(existsSync(path.join(root, '.packman', 'trash'))).toBe(false);
  });

  it('prunes only stores without links', async () => {
    const { report, group } = await alignedUnionGroup();
    const result = await linkGroup(root, report, group, {
      replaceExisting: false,
      install: installFromLock,
    });
    const orphan = path.join(root, '.packman', 'store', 'u-orphan');
    await mkdir(path.join(orphan, 'node_modules'), { recursive: true });
    const targets = await pruneTargets(root, { trash: true });
    expect(targets).toEqual([path.resolve(orphan)]);
    expect(targets).not.toContain(path.resolve(result.storeDir));
  });

  it('reads package references from config keys, not from every string', async () => {
    const references = await configReferences(path.join(root, 'spfx-webpart-121'));
    expect(references).toEqual(
      expect.arrayContaining([
        '@microsoft/eslint-config-spfx',
        '@rushstack/eslint-config',
        '@microsoft/sp-build-web',
        'gulp',
      ]),
    );
    expect(references).not.toContain('react');
  });
});
