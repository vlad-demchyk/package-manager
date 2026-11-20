/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures are known to exist */
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze, type Report } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import type { Fix } from '../src/core/types.js';
import { CANCEL_EXIT, runCommand, TIMEOUT_EXIT, withRunLimits } from '../src/exec/run.js';
import { describeCycle, editSteps, findCycles, withoutCycles } from '../src/ops/converge.js';
import { detectNodeManager, nodeSetup } from '../src/ops/node-setup.js';
import { gulpRuleWarnings, linkGroup, planStore, readLinks } from '../src/store/store.js';
import {
  planRollback,
  projectFilesOf,
  readSwitches,
  rollbackLastSwitch,
  switchGroup,
  takeSnapshot,
} from '../src/store/switch.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('exec time limit and cancellation', () => {
  it('kills a run that exceeds its time limit, with its child processes, and reports exit 124', async () => {
    const workspace = await makeWorkspace({});
    cleanup = workspace.cleanup;
    const pidFile = path.join(workspace.root, 'child.pid');
    // The parent starts a grandchild that would outlive a plain kill of the parent.
    const script = [
      "const { spawn } = require('child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const started = Date.now();
    const result = await runCommand(process.execPath, ['-e', script], workspace.root, {
      stdio: 'ignore',
      timeoutMs: 1500,
    });
    expect(result).toEqual({ code: TIMEOUT_EXIT, timedOut: true });
    expect(Date.now() - started).toBeLessThan(10_000);
    const grandchild = Number(await readFile(pidFile, 'utf8'));
    for (let wait = 0; wait < 20 && alive(grandchild); wait++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(grandchild)).toBe(false);
  }, 20_000);

  it('cancels a run when the signal aborts and reports exit 130', async () => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 300);
    const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], '.', {
      stdio: 'ignore',
      signal: controller.signal,
    });
    expect(result).toEqual({ code: CANCEL_EXIT, cancelled: true });
  }, 20_000);

  it('applies the limits of withRunLimits to runs that set none, and leaves fast runs alone', async () => {
    const limited = await withRunLimits({ timeoutMs: 500 }, () =>
      runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], '.', { stdio: 'ignore' }),
    );
    expect(limited.timedOut).toBe(true);
    const quick = await withRunLimits({ timeoutMs: 10_000 }, () =>
      runCommand(process.execPath, ['-e', 'process.exit(3)'], '.', { stdio: 'ignore' }),
    );
    expect(quick).toEqual({ code: 3 });
  }, 20_000);
});

describe('sync passes converge', () => {
  const setDep = (file: string, value: string | undefined, id: string): Fix => ({
    id,
    title: { key: 'x' },
    risk: 'review',
    commands: [],
    edits: [
      value === undefined
        ? { kind: 'json-remove', file, path: ['dependencies', '@pnp/logging'] }
        : { kind: 'json-set', file, path: ['dependencies', '@pnp/logging'], value },
    ],
  });

  it('holds back a fix that would undo an earlier pass and keeps the others', () => {
    const file = '/w/app/package.json';
    let manifest: Record<string, unknown> = { dependencies: { '@pnp/logging': '4.1.0' } };
    const read = (): unknown => manifest;
    // Pass 1 removes the package as unused.
    const first = editSteps([setDep(file, undefined, 'unused/app')], 1, read);
    expect(findCycles([], first)).toEqual([]);
    manifest = { dependencies: {} };
    // Pass 2 would add it back (undeclared import), next to an unrelated fix.
    const other: Fix = {
      ...setDep('/w/other/package.json', '2.0.0', 'pin/other'),
      id: 'pin/other',
    };
    const second = editSteps([setDep(file, '4.1.0', 'undeclared/app'), other], 2, read);
    const cycles = findCycles(first, second);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.undoes.fixId).toBe('unused/app');
    expect(describeCycle(cycles[0]!)).toContain('pass 2 would change it back');
    expect(
      withoutCycles([setDep(file, '4.1.0', 'undeclared/app'), other], cycles).map((fix) => fix.id),
    ).toEqual(['pin/other']);
  });

  it('finds a cycle that takes three passes to come back', () => {
    const file = '/w/app/package.json';
    const at = (version: string) => () => ({ dependencies: { '@pnp/logging': version } });
    const history = [
      ...editSteps([setDep(file, '4.2.0', 'a')], 1, at('4.1.0')),
      ...editSteps([setDep(file, '4.3.0', 'b')], 2, at('4.2.0')),
    ];
    const third = editSteps([setDep(file, '4.1.0', 'c')], 3, at('4.3.0'));
    expect(findCycles(history, third).map((cycle) => cycle.undoes.fixId)).toEqual(['a']);
  });

  it('does not call a further change of the same value a cycle', () => {
    const file = '/w/app/package.json';
    const one = editSteps([setDep(file, '4.2.0', 'a')], 1, () => ({
      dependencies: { '@pnp/logging': '4.1.0' },
    }));
    const two = editSteps([setDep(file, '4.3.0', 'b')], 2, () => ({
      dependencies: { '@pnp/logging': '4.2.0' },
    }));
    expect(findCycles(one, two)).toEqual([]);
  });
});

describe('Node preflight', () => {
  const nodes = fakeNodes('22.19.0');

  it('prints the install command of the manager in use and never one that switches Node', () => {
    const setup = nodeSetup('22.23.4', nodes, { NVM_HOME: 'C:\\nvm' }, 'win32');
    expect(setup.manager).toBe('nvm-windows');
    expect(setup.display).toBe('nvm install 22.23.4');
    expect(setup.command?.args).toEqual(['install', '22.23.4']);
    for (const env of [{ NVM_DIR: '/home/u/.nvm' }, { FNM_DIR: '/f' }, { VOLTA_HOME: '/v' }]) {
      const other = nodeSetup('22.23.4', [], env, 'linux');
      expect(other.command).toBeDefined();
      expect(`${other.command?.file} ${other.command?.args.join(' ')}`).not.toMatch(
        /\b(?:use|default|volta install)\b/,
      );
    }
    expect(nodeSetup('22.23.4', [], { VOLTA_HOME: '/v' }, 'linux').display).toBe(
      'volta fetch node@22.23.4',
    );
  });

  it('prefers the manager that installed the existing versions and has no command without one', () => {
    expect(detectNodeManager([{ ...nodes[0]!, manager: 'fnm' }], { NVM_HOME: 'x' }, 'win32')).toBe(
      'fnm',
    );
    const none = nodeSetup('22.23.4', [], {}, 'linux');
    expect(none.manager).toBeUndefined();
    expect(none.command).toBeUndefined();
    expect(none.note).toContain('no Node manager');
  });
});

const app = (name: string, extra: Record<string, string> = {}): Record<string, object> => ({
  [`${name}/package.json`]: { name, dependencies: { react: '18.3.1', ...extra } },
  [`${name}/package-lock.json`]: lockfile(name, { react: '18.3.1' }, { react: '18.3.1' }),
});

async function analyzeAt(root: string): Promise<Report> {
  const config = configSchema.parse({});
  return analyze(await discoverWorkspace(root, { config }), {
    config,
    today: TODAY,
    security: false,
    usage: false,
    installedNodes: fakeNodes('24.9.0'),
  });
}

/** Stands in for `npm install` in a store: every declared dependency, version 1.0.0 except react. */
async function fakeInstall(dir: string): Promise<number> {
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const packages: Record<string, object> = { '': {} };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const version = name === 'react' ? '18.3.1' : '1.0.0';
    await mkdir(path.join(dir, 'node_modules', name), { recursive: true });
    await writeFile(
      path.join(dir, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
    packages[`node_modules/${name}`] = { version };
  }
  await writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ packages }));
  return 0;
}

/** Two projects linked to one union store, then a dependency added to both manifests. */
async function linkedThenEdited(): Promise<{
  root: string;
  oldTarget: string;
  edited: Report;
  snapshot: Awaited<ReturnType<typeof takeSnapshot>>;
}> {
  const workspace = await makeWorkspace({ ...app('app-a'), ...app('app-b') });
  cleanup = workspace.cleanup;
  const root = workspace.root;
  const before = await analyzeAt(root);
  const group = planStore(before, { union: true }).groups[0];
  if (!group) throw new Error('group expected');
  await linkGroup(root, before, group, {
    replaceExisting: true,
    install: fakeInstall,
    syncLocks: true,
  });
  const oldTarget = (await readLinks(root))[0]?.target ?? '';
  const snapshot = await takeSnapshot(
    root,
    projectFilesOf([path.join(root, 'app-a'), path.join(root, 'app-b')]),
  );
  for (const name of ['app-a', 'app-b'])
    await writeFile(
      path.join(root, name, 'package.json'),
      JSON.stringify({ name, dependencies: { react: '18.3.1', 'left-pad': '1.0.0' } }),
    );
  return { root, oldTarget, edited: await analyzeAt(root), snapshot };
}

const manifestOf = async (root: string, id: string): Promise<string> =>
  readFile(path.join(root, id, 'package.json'), 'utf8');

const linkTargetOf = async (root: string, id: string, pkg: string): Promise<string> =>
  path.resolve(
    path.join(root, id, 'node_modules'),
    await readlink(path.join(root, id, 'node_modules', pkg)),
  );

describe('switching a linked group to a new store', () => {
  it('switches every member to the new store when prepare, relink and builds pass', async () => {
    const { root, oldTarget, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const group = planStore(edited, { union: true }).groups[0]!;
    const result = await switchGroup(root, edited, group, previous, snapshot, {
      install: fakeInstall,
      verify: () => Promise.resolve([]),
    });
    expect(result.status).toBe('switched');
    const links = await readLinks(root);
    expect(links.map((link) => link.projectId).sort()).toEqual(['app-a', 'app-b']);
    expect(links.every((link) => link.target !== oldTarget)).toBe(true);
    expect(existsSync(path.join(root, 'app-a', 'node_modules', 'left-pad'))).toBe(true);
    // The old store stays on disk until `store prune`: a later rollback needs no npm.
    expect(existsSync(oldTarget)).toBe(true);
  });

  it('leaves the previous links and restores the manifests when the new store fails to install', async () => {
    const { root, oldTarget, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const before = await manifestOf(root, 'app-a');
    const group = planStore(edited, { union: true }).groups[0]!;
    const result = await switchGroup(root, edited, group, previous, snapshot, {
      install: () => Promise.resolve(1),
    });
    expect(result).toMatchObject({ status: 'rolled-back', phase: 'prepare' });
    expect(await readLinks(root)).toEqual(previous);
    expect(await manifestOf(root, 'app-a')).not.toBe(before);
    expect(
      (JSON.parse(await manifestOf(root, 'app-a')) as { dependencies: unknown }).dependencies,
    ).toEqual({ react: '18.3.1' });
    expect(await linkTargetOf(root, 'app-a', 'react')).toBe(path.join(oldTarget, 'react'));
  });

  it('puts back the previous store links, manifests and lockfiles when a build fails after the switch', async () => {
    const { root, oldTarget, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const lockBefore = await readFile(path.join(root, 'app-b', 'package-lock.json'), 'utf8');
    const group = planStore(edited, { union: true }).groups[0]!;
    const result = await switchGroup(root, edited, group, previous, snapshot, {
      install: fakeInstall,
      verify: () => Promise.resolve(['app-b']),
    });
    expect(result).toMatchObject({
      status: 'rolled-back',
      phase: 'verify',
      failedBuilds: ['app-b'],
    });
    const links = await readLinks(root);
    expect(links.map((link) => link.target)).toEqual([oldTarget, oldTarget]);
    for (const id of ['app-a', 'app-b']) {
      expect(await linkTargetOf(root, id, 'react')).toBe(path.join(oldTarget, 'react'));
      expect(existsSync(path.join(root, id, 'node_modules', 'left-pad'))).toBe(false);
      expect(
        (JSON.parse(await manifestOf(root, id)) as { dependencies: unknown }).dependencies,
      ).toEqual({ react: '18.3.1' });
    }
    expect(await readFile(path.join(root, 'app-b', 'package-lock.json'), 'utf8')).toBe(lockBefore);
    expect((await lstat(path.join(root, 'app-a', 'node_modules'))).isDirectory()).toBe(true);
  });

  it('keeps the switched state for inspection when rollback is turned off', async () => {
    const { root, oldTarget, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const group = planStore(edited, { union: true }).groups[0]!;
    const result = await switchGroup(root, edited, group, previous, snapshot, {
      install: fakeInstall,
      verify: () => Promise.resolve(['app-a']),
      rollback: false,
    });
    expect(result.status).toBe('failed');
    expect((await readLinks(root)).every((link) => link.target !== oldTarget)).toBe(true);
  });
});

describe('gulpfile rules and linked packages', () => {
  const gulpfile = (wrapped: boolean): string =>
    `const path = require('path');\nmodule.exports = { rules: [{ test: /js$/, include: ${
      wrapped
        ? "require('fs').realpathSync(path.join(__dirname, 'node_modules', 'web-push'))"
        : "path.join(__dirname, 'node_modules', 'web-push')"
    } }] };\n`;

  it('marks a rule inactive while linked and downgrades it to info once a build passed linked', async () => {
    const workspace = await makeWorkspace({
      ...app('app-a', { 'web-push': '1.0.0' }),
      ...app('app-b', { 'web-push': '1.0.0' }),
      'app-a/gulpfile.js': gulpfile(false),
      'app-b/gulpfile.js': gulpfile(true),
    });
    cleanup = workspace.cleanup;
    const root = workspace.root;
    const report = await analyzeAt(root);
    const notLinked = gulpRuleWarnings(
      report.projects.find((e) => e.project.id === 'app-a')!.project,
    );
    expect(notLinked).toHaveLength(1);
    expect(notLinked[0]).toContain('app-a: gulpfile.js:2 include');
    expect(notLinked[0]).toContain('stops matching once linked');
    expect(notLinked[0]).toContain('fs.realpathSync(');
    expect(
      gulpRuleWarnings(report.projects.find((e) => e.project.id === 'app-b')!.project),
    ).toEqual([]);

    const group = planStore(report, { union: true }).groups[0]!;
    await linkGroup(root, report, group, { replaceExisting: true, install: fakeInstall });
    const link = (await readLinks(root)).find((item) => item.projectId === 'app-a');
    const linked = (await analyzeAt(root)).projects.find((e) => e.project.id === 'app-a')!.project;
    const pending = gulpRuleWarnings(linked, link);
    expect(pending[0]).toContain('is inactive while linked');
    expect(pending[0]).toContain('packman store verify -p app-a');

    const verified = {
      ...linked,
      verified: { at: '2999-01-01T00:00:00.000Z', node: '24.9.0', script: 'buildp', versions: {} },
    };
    const info = gulpRuleWarnings(verified, link);
    expect(info[0]).toMatch(/^info: app-a: gulpfile\.js:2 include/);
    expect(info[0]).toContain('`buildp` passed linked');
  });

  it('says nothing when webpack keeps symlinks, and names rules over all of node_modules', async () => {
    const workspace = await makeWorkspace({
      ...app('app-a'),
      ...app('app-b'),
      'app-a/gulpfile.js': `${gulpfile(false)}config.resolve.symlinks = false;\n`,
      'app-b/gulpfile.js':
        "const path = require('path');\nconst x = { exclude: path.resolve(__dirname, 'node_modules') };\n",
    });
    cleanup = workspace.cleanup;
    const report = await analyzeAt(workspace.root);
    const project = (id: string) => report.projects.find((e) => e.project.id === id)!.project;
    expect(gulpRuleWarnings(project('app-a'))).toEqual([]);
    expect(gulpRuleWarnings(project('app-b'))[0]).toContain('covers all of <project>/node_modules');
  });
});

describe('store rollback after a kept switch', () => {
  it('records the switch and puts the previous links and files back without npm', async () => {
    const { root, oldTarget, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const group = planStore(edited, { union: true }).groups[0]!;
    const switched = await switchGroup(root, edited, group, previous, snapshot, {
      install: fakeInstall,
      verify: () => Promise.resolve([]),
    });
    expect(switched.status).toBe('switched');
    expect(await readSwitches(root)).toHaveLength(1);
    const plan = await planRollback(root);
    expect(plan.problems).toEqual([]);
    expect(plan.record?.projectIds.sort()).toEqual(['app-a', 'app-b']);

    const done = await rollbackLastSwitch(root);
    expect(done.problems).toEqual([]);
    expect((await readLinks(root)).map((link) => link.target)).toEqual([oldTarget, oldTarget]);
    for (const id of ['app-a', 'app-b']) {
      expect(await linkTargetOf(root, id, 'react')).toBe(path.join(oldTarget, 'react'));
      expect(existsSync(path.join(root, id, 'node_modules', 'left-pad'))).toBe(false);
      expect(
        (JSON.parse(await manifestOf(root, id)) as { dependencies: unknown }).dependencies,
      ).toEqual({ react: '18.3.1' });
    }
    expect(await readSwitches(root)).toEqual([]);
    expect((await planRollback(root)).problems).toEqual(['no store switch recorded']);
  });

  it('refuses when a file of the snapshot changed after the switch', async () => {
    const { root, edited, snapshot } = await linkedThenEdited();
    const previous = await readLinks(root);
    const group = planStore(edited, { union: true }).groups[0]!;
    await switchGroup(root, edited, group, previous, snapshot, { install: fakeInstall });
    const later = path.join(root, 'app-a', 'package.json');
    await writeFile(later, JSON.stringify({ name: 'app-a', dependencies: { react: '18.3.1' } }));
    const linksBefore = await readLinks(root);
    const result = await rollbackLastSwitch(root);
    expect(result.problems).toEqual([
      `changed since the switch: ${path.join('app-a', 'package.json')}`,
    ]);
    expect(await readLinks(root)).toEqual(linksBefore);
  });
});
