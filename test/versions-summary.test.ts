import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli/main.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import * as toolchain from '../src/node/toolchain.js';
import { versionMatrix } from '../src/ops/matrix.js';
import { fakeNodes, lockfile, makeWorkspace } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
let out: string[];

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue(fakeNodes('22.19.0'));
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

const CORE = '@microsoft/sp-core-library';

const manifest = (name: string, spec: string) => ({ name, dependencies: { [CORE]: spec } });

/**
 * Declared specs moved to 1.22.0 in two projects while their lockfiles still hold 1.7.0; one
 * project has no lockfile. No project has node_modules.
 */
const DRIFT = {
  'a/package.json': manifest('a', '1.22.0'),
  'a/package-lock.json': lockfile('a', { [CORE]: '1.22.0' }, { [CORE]: '1.7.0' }),
  'b/package.json': manifest('b', '1.22.0'),
  'b/package-lock.json': lockfile('b', { [CORE]: '1.22.0' }, { [CORE]: '1.7.0' }),
  'c/package.json': manifest('c', '1.7.0'),
  'c/package-lock.json': lockfile('c', { [CORE]: '1.7.0' }, { [CORE]: '1.7.0' }),
  'd/package.json': manifest('d', '1.21.1'),
};

async function workspace(files: Record<string, string | object>) {
  const result = await makeWorkspace(files);
  cleanup = result.cleanup;
  return result.root;
}

async function matrixOf(root: string) {
  const config = configSchema.parse({});
  const ws = await discoverWorkspace(root, { config });
  return versionMatrix(ws.projects);
}

const cli = (args: string[]) => buildProgram().parseAsync(args, { from: 'user' });

describe('versions: summaries per source', () => {
  it('keeps declared, locked and installed apart and never calls a missing node_modules installed', async () => {
    const root = await workspace(DRIFT);
    const row = (await matrixOf(root)).rows.find((item) => item.name === CORE);
    expect(row?.summary.declared).toEqual({
      total: 4,
      count: 4,
      unknown: 0,
      latest: '1.22.0',
      mostCommon: { version: '1.22.0', count: 2 },
    });
    expect(row?.summary.locked).toEqual({
      total: 4,
      count: 3,
      unknown: 1,
      latest: '1.7.0',
      mostCommon: { version: '1.7.0', count: 3 },
    });
    expect(row?.summary.installed).toEqual({ total: 4, count: 0, unknown: 4 });
    expect(row?.drift).toBe(true);
    expect(row?.cells.a).toMatchObject({
      spec: '1.22.0',
      locked: '1.7.0',
      versionSource: 'lockfile',
    });
    expect(row?.cells.a?.installed).toBeUndefined();
    expect(row?.cells.d).toMatchObject({ spec: '1.21.1', versionSource: 'manifest' });
  });

  it('reads installed versions from node_modules and sees no drift when the lock satisfies the spec', async () => {
    const root = await workspace({
      'a/package.json': { name: 'a', dependencies: { lodash: '^4.17.0' } },
      'a/package-lock.json': lockfile('a', { lodash: '^4.17.0' }, { lodash: '4.17.21' }),
      'a/node_modules/lodash/package.json': { name: 'lodash', version: '4.17.20' },
    });
    const row = (await matrixOf(root)).rows.find((item) => item.name === 'lodash');
    expect(row?.summary.installed).toEqual({
      total: 1,
      count: 1,
      unknown: 0,
      latest: '4.17.20',
      mostCommon: { version: '4.17.20', count: 1 },
    });
    expect(row?.cells.a).toMatchObject({ installed: '4.17.20', locked: '4.17.21' });
    expect(row?.drift).toBe(false);
  });

  it('prints the per-source lines and the drift in text, and adds the fields to --json', async () => {
    const root = await workspace(DRIFT);
    await cli(['versions', root, '--offline', '--lang', 'en']);
    const text = out.join('\n');
    expect(text).toContain('declared and locked versions disagree');
    expect(text).toMatch(/declared\s+latest 1\.22\.0, most common 1\.22\.0 \(2\/4\)/);
    expect(text).toMatch(
      /locked\s+latest 1\.7\.0, most common 1\.7\.0 \(3\/3\); unknown in 1\/4 \(no lockfile\)/,
    );
    expect(text).toMatch(/installed\s+unknown in 4\/4 \(no node_modules\)/);
    expect(text).not.toMatch(/installed\s+latest/);

    out = [];
    await cli(['versions', root, '--offline', '--json']);
    const json = JSON.parse(out.join('')) as {
      projects: string[];
      rows: {
        name: string;
        versions: string[];
        diverging: boolean;
        drift: boolean;
        summary: object;
      }[];
    };
    const row = json.rows.find((item) => item.name === CORE);
    // Existing fields stay; summary and drift are added.
    expect(row?.versions).toEqual(['1.7.0', '1.21.1']);
    expect(row?.diverging).toBe(true);
    expect(row?.drift).toBe(true);
    expect(row?.summary).toMatchObject({ installed: { count: 0, unknown: 4 } });
  });
});

describe('compat: where the current version comes from', () => {
  it('names declared, locked and installed instead of the raw source', async () => {
    const root = await workspace(DRIFT);
    await cli(['compat', CORE, root, '-p', 'a', '--offline', '--lang', 'en']);
    const text = out.join('\n');
    expect(text).toContain(
      `current: ${CORE}: declared 1.22.0, locked 1.7.0, installed unknown (no node_modules); checked 1.7.0 (locked); in dependencies`,
    );
    expect(text).not.toContain('(lockfile)');
  });

  it('says inferred, not installed, without lockfile and node_modules, and keeps the JSON fields', async () => {
    const root = await workspace(DRIFT);
    await cli(['compat', CORE, root, '-p', 'd', '--offline', '--json']);
    const json = JSON.parse(out.join('')) as {
      current: { version: string; source: string };
      evidence: string;
    };
    expect(json.current).toMatchObject({ version: '1.21.1', source: 'manifest' });
    expect(json.evidence).toBe(
      `${CORE}: declared 1.21.1, locked unknown (no lockfile), installed unknown (no node_modules); checked 1.21.1 (inferred from the declared range)`,
    );
  });
});
