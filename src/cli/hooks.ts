import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import { langOption } from './shared.js';

/** First line after the shebang of every hook packman writes; only such files are replaced or removed. */
export const HOOK_MARKER = '# packman: added by `packman hooks install`';
export const HOOKS = ['post-merge', 'post-checkout'] as const;

/** Git's hooks folder for the repository holding `dir` (respects core.hooksPath). */
export function gitHooksDir(dir: string): { repo: string; hooks: string } {
  const run = (...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  const repo = run('rev-parse', '--show-toplevel');
  const hooks = run('rev-parse', '--git-path', 'hooks');
  // Git prints long paths; the workspace may come as a Windows short name (C:\Users\ABCDEF~1).
  return { repo: realpathSync.native(repo), hooks: path.resolve(dir, hooks) };
}

/**
 * A hook that reports linked projects whose manifest or node_modules no longer match the store
 * after a pull or a branch switch. It never relinks (that may need a network install) and never
 * fails the git command.
 */
export function hookScript(workspace: string): string {
  const target = workspace === '' ? '.' : workspace.split(path.sep).join('/');
  return [
    '#!/bin/sh',
    HOOK_MARKER,
    'command -v packman >/dev/null 2>&1 || exit 0',
    `cd "$(git rev-parse --show-toplevel)" || exit 0`,
    `packman store status --check "${target}" >/dev/null 2>&1 || {`,
    `  echo 'packman: linked projects changed, run: packman store status ${target}'`,
    '}',
    'exit 0',
    '',
  ].join('\n');
}

export function registerHooks(program: Command): void {
  const hooks = program
    .command('hooks')
    .description('git hooks that check linked projects after pull and checkout');

  hooks
    .command('install')
    .description(`add ${HOOKS.join(' and ')} hooks (existing hooks are never replaced)`)
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .action(async (root: string) => {
      const absRoot = path.resolve(root);
      const { repo, hooks: dir } = gitHooksDir(absRoot);
      await mkdir(dir, { recursive: true });
      const written: string[] = [];
      for (const name of HOOKS) {
        const file = path.join(dir, name);
        if (existsSync(file) && !(await readFile(file, 'utf8')).includes(HOOK_MARKER)) {
          console.log(pc.yellow(t('hooks.foreign', { file })));
          continue;
        }
        await writeFile(
          file,
          hookScript(path.relative(repo, realpathSync.native(absRoot))),
          'utf8',
        );
        await chmod(file, 0o755);
        written.push(file);
        console.log(pc.green(t('hooks.installed', { file })));
      }
      await journal(absRoot, {
        command: 'hooks install',
        projects: [],
        files: written,
        result: 'ok',
      });
    });

  hooks
    .command('uninstall')
    .description('remove the hooks packman added')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .action(async (root: string) => {
      const absRoot = path.resolve(root);
      const { hooks: dir } = gitHooksDir(absRoot);
      for (const name of HOOKS) {
        const file = path.join(dir, name);
        if (existsSync(file) && (await readFile(file, 'utf8')).includes(HOOK_MARKER)) {
          await unlink(file);
          console.log(t('hooks.removed', { file }));
        }
      }
    });
}
