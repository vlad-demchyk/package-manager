import { Option, type Command } from 'commander';
import { DEFAULT_PASSES, DEFAULT_TIMEOUT_MINUTES, runSync, type SyncOptions } from '../ops/sync.js';
import { openSession } from './context.js';
import { commonOptions, nonNegativeInt } from './shared.js';
import { registerStoreRollback } from './rollback.js';

export function registerSync(program: Command): void {
  commonOptions(
    program
      .command('sync')
      .description(
        'fix, rebuild linked stores, build and check again until stable (dry run unless --apply)',
      ),
  )
    .option('-r, --rule <ids...>', 'only fixes of findings with these rule ids')
    .option('-f, --fix <ids...>', 'only these fix ids')
    .addOption(
      new Option('--risk <level>', 'highest fix risk to apply')
        .choices(['safe', 'review', 'breaking'])
        .default('safe'),
    )
    .option('--script <name>', 'npm script that verifies every changed project', 'build')
    .option('--no-verify', 'do not build after rebuilding a store (the final check still runs)')
    .option(
      '--max-passes <n>',
      `fix passes before giving up (default ${DEFAULT_PASSES})`,
      nonNegativeInt,
    )
    .option(
      '--timeout <minutes>',
      `time limit of each npm step; 0 for none (default ${DEFAULT_TIMEOUT_MINUTES})`,
      nonNegativeInt,
    )
    .option(
      '--install-node',
      'install a missing Node with the detected manager (never switches it)',
    )
    .option('--refresh', 'resolve rebuilt stores fresh instead of from their verified set')
    .option('--apply', 'run the cycle and write the changes (backups in .packman/backups)')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: SyncOptions & { verify?: boolean }) => {
      const session = await openSession(root, options);
      const ok = await runSync(session, {
        ...options,
        ...(options.verify === false ? { script: false as const } : {}),
      });
      if (!ok) process.exitCode = 1;
    });
  registerStoreRollback(program);
}
