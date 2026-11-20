import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import { planRollback, rollbackLastSwitch } from '../store/switch.js';
import { confirm, langOption } from './shared.js';

/** `store rollback`, added to the existing `store` command (defined with the other store commands). */
export function registerStoreRollback(program: Command): void {
  program.commands
    .find((command) => command.name() === 'store')
    ?.command('rollback')
    .description('undo the last store switch of sync/upgrade: previous links and files (dry run)')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .option('--apply', 'restore the previous links, manifests and lockfiles')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: { apply?: boolean; yes?: boolean }) => {
      await storeRollback(path.resolve(root), options);
    });
}

/**
 * Preview, or with --apply restore, the state before the last kept store switch: the members'
 * previous links (the old store is still on disk, no npm runs) and the switch's file snapshot.
 * Refused when anything changed since the switch.
 */
export async function storeRollback(
  root: string,
  options: { apply?: boolean; yes?: boolean },
): Promise<boolean> {
  const plan = await planRollback(root);
  const record = plan.record;
  if (record) {
    const before = [...new Set(record.previous.map((link) => path.relative(root, link.target)))];
    console.log(
      t('rollback.plan', {
        at: record.at.slice(0, 16).replace('T', ' '),
        count: record.projectIds.length,
        from: path.relative(root, record.storeDir),
        to: before.join(', '),
        files: record.snapshot.existed.length + record.snapshot.absent.length,
      }),
    );
    console.log(`  ${record.projectIds.join(', ')}`);
  }
  if (plan.problems.length > 0) {
    for (const problem of plan.problems) console.error(pc.red(`  ! ${problem}`));
    console.error(pc.red(t('rollback.refused')));
    process.exitCode = 1;
    return false;
  }
  if (!options.apply) {
    console.log(pc.yellow(t('cli.dryRun')));
    return true;
  }
  if (!options.yes && !(await confirm(t('rollback.confirm')))) {
    console.log(t('cli.aborted'));
    return false;
  }
  const done = await rollbackLastSwitch(root);
  if (done.problems.length > 0) {
    for (const problem of done.problems) console.error(pc.red(`  ! ${problem}`));
    process.exitCode = 1;
    return false;
  }
  await journal(root, {
    command: 'store rollback',
    projects: record?.projectIds ?? [],
    result: 'ok',
    detail: record ? `${path.relative(root, record.storeDir)} -> previous links` : '',
  });
  console.log(pc.green(t('rollback.done', { count: record?.projectIds.length ?? 0 })));
  return true;
}
