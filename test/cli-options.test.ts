import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, main } from '../src/cli/main.js';
import * as runner from '../src/exec/run.js';
import * as toolchain from '../src/node/toolchain.js';
import { fakeNodes, lockfile, makeWorkspace } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(toolchain, 'listInstalledNodes').mockResolvedValue(fakeNodes('22.19.0'));
});

afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await cleanup?.();
  cleanup = undefined;
});

const PKG = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

async function twoProjects() {
  const result = await makeWorkspace({
    'a/package.json': { name: 'a', dependencies: { ajv: '6.12.6' } },
    'a/package-lock.json': lockfile('a', { ajv: '6.12.6' }, { ajv: '6.12.6' }),
    'b/package.json': { name: 'b', dependencies: { ajv: '6.12.6', 'is-number': '7.0.0' } },
    'b/package-lock.json': lockfile(
      'b',
      { ajv: '6.12.6', 'is-number': '7.0.0' },
      { ajv: '6.12.6', 'is-number': '7.0.0' },
    ),
  });
  cleanup = result.cleanup;
  return result.root;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/** Runs the program with commander's exits turned into exceptions and its output captured. */
async function runRoot(args: string[]): Promise<{ out: string; code: number | undefined }> {
  let out = '';
  const program = buildProgram()
    .exitOverride()
    .configureOutput({ writeOut: (text) => (out += text), writeErr: (text) => (out += text) });
  try {
    await program.parseAsync(args, { from: 'user' });
    return { out, code: undefined };
  } catch (error) {
    return { out, code: (error as { exitCode?: number }).exitCode };
  }
}

describe('root options do not swallow command options', () => {
  it.each([[['--version', '6.15.0']], [['--version=6.15.0']]])(
    'align --package ajv %j previews the same plan and writes nothing',
    async (flag) => {
      const root = await twoProjects();
      const before = await listFiles(root);
      const manifestA = await readFile(path.join(root, 'a/package.json'), 'utf8');
      const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
      await buildProgram().parseAsync(
        ['align', root, '--package', 'ajv', ...flag, '--offline', '--lang', 'en'],
        { from: 'user' },
      );
      const output = logs.join('\n');
      expect(output).toContain('Aligning ajv to 6.15.0');
      expect(output).toContain('+     "ajv": "6.15.0"');
      expect(output).not.toContain(PKG.version);
      expect(await readFile(path.join(root, 'a/package.json'), 'utf8')).toBe(manifestA);
      expect(await listFiles(root)).toEqual(before);
      expect(run).not.toHaveBeenCalled();
      expect(process.exitCode ?? 0).toBe(0);
    },
  );

  it('align --version <v> --apply changes exactly the manifests of the package', async () => {
    const root = await twoProjects();
    const lockA = await readFile(path.join(root, 'a/package-lock.json'), 'utf8');
    const run = vi.spyOn(runner, 'runWithNode').mockResolvedValue({ code: 0 });
    await buildProgram().parseAsync(
      [
        'align',
        root,
        '--package',
        'ajv',
        '--version',
        '6.15.0',
        '--apply',
        '-y',
        '--no-relock',
        '--offline',
        '--lang',
        'en',
      ],
      { from: 'user' },
    );
    expect(logs.join('\n')).toContain('Aligning ajv to 6.15.0');
    const a = JSON.parse(await readFile(path.join(root, 'a/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const b = JSON.parse(await readFile(path.join(root, 'b/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(a.dependencies).toEqual({ ajv: '6.15.0' });
    expect(b.dependencies).toEqual({ ajv: '6.15.0', 'is-number': '7.0.0' });
    // --no-relock: lockfiles untouched, no npm run.
    expect(await readFile(path.join(root, 'a/package-lock.json'), 'utf8')).toBe(lockA);
    expect(run).not.toHaveBeenCalled();
    const changed = (await listFiles(root)).filter((file) => !file.startsWith('.packman'));
    expect(changed).toEqual(
      ['a/package-lock.json', 'a/package.json', 'b/package-lock.json', 'b/package.json'].map(
        (file) => path.normalize(file),
      ),
    );
  });

  it.each([['--version'], ['-V']])('root %s still prints the packman version', async (flag) => {
    const { out, code } = await runRoot([flag]);
    expect(out.trim()).toBe(PKG.version);
    expect(code).toBe(0);
  });

  it('an interactive terminal keeps --version at the root instead of opening the TUI', async () => {
    const stdoutTty = process.stdout.isTTY;
    const stdinTty = process.stdin.isTTY;
    const ci = process.env.CI;
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    process.stdout.isTTY = true;
    process.stdin.isTTY = true;
    delete process.env.CI;
    try {
      // main() reports the mocked exit like any other error.
      await main(['node', 'packman', '--version']);
      expect(logs.join('\n')).toContain('exit 0');
    } finally {
      process.stdout.isTTY = stdoutTty;
      process.stdin.isTTY = stdinTty;
      if (ci !== undefined) process.env.CI = ci;
    }
    expect(written.join('').trim()).toBe(PKG.version);
  });

  it('every option that shares a root flag is reachable only through positional root options', () => {
    const program = buildProgram();
    const rootFlags = new Set(
      program.options.flatMap((option) => [option.long, option.short]).filter(Boolean),
    );
    rootFlags.add('-h').add('--help');
    const collisions: string[] = [];
    const walk = (command: Command, prefix: string) => {
      for (const sub of command.commands) {
        const name = `${prefix}${sub.name()}`;
        for (const option of sub.options)
          for (const flag of [option.long, option.short])
            if (flag && rootFlags.has(flag)) collisions.push(`${name} ${flag}`);
        walk(sub, `${name} `);
      }
    };
    walk(program, '');
    // A new collision needs a parsing test like the align ones above.
    expect(collisions).toEqual(['align --version']);
    expect(
      (program as unknown as { _enablePositionalOptions: boolean })._enablePositionalOptions,
    ).toBe(true);
  });
});
