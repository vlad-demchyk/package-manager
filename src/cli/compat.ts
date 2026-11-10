import type { Command } from 'commander';
import pc from 'picocolors';
import { t } from '../i18n/index.js';
import {
  packageCompatibility,
  pickProject,
  type CompatConstraint,
  type CompatReport,
} from '../policy/compat.js';
import { openSession, runAnalysis, type CommonOptions } from './context.js';
import { commonOptions } from './shared.js';

interface CompatCliOptions extends CommonOptions {
  to?: string;
  json?: boolean;
}

export function registerCompat(program: Command): void {
  commonOptions(
    program
      .command('compat')
      .description('what the stack, peers and API breaks say about one package in one project')
      .argument('<package>', 'package name'),
  )
    .option('--to <version>', 'target version or range to check against the current one')
    .option('--json', 'print the compatibility report as JSON')
    .action(async (name: string, root: string, options: CompatCliOptions) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(session, { ...options, security: false });
      const entry = pickProject(report.projects, options.project);
      const result = packageCompatibility(entry, name, options.to);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      printCompat(result);
    });
}

function mark(value: boolean | undefined): string {
  return value === undefined ? pc.dim('?') : value ? pc.green('ok') : pc.red('x');
}

function line(item: CompatConstraint, target: boolean): string {
  const checks = [
    `current ${mark(item.current)}`,
    ...(target ? [`target ${mark(item.target)}`] : []),
  ];
  return `  ${item.range}  ${pc.dim(item.source)}  ${checks.join(', ')}`;
}

export function printCompat(result: CompatReport): void {
  console.log(pc.bold(t('compat.title', { package: result.package, project: result.project })));
  console.log(
    result.current
      ? t('compat.current', {
          version: result.current.version,
          source: result.current.source,
          spec: result.current.spec,
          section: result.current.section,
        })
      : t('compat.notDeclared'),
  );
  if (result.target) console.log(t('compat.target', { version: result.target }));
  const target = result.target !== undefined;
  console.log(pc.bold(t('compat.constraints')));
  if (result.constraints.length === 0) console.log(`  ${pc.dim(t('compat.none'))}`);
  for (const item of result.constraints) console.log(line(item, target));
  console.log(pc.bold(t('compat.peers')));
  if (result.peers.length === 0) console.log(`  ${pc.dim(t('compat.none'))}`);
  for (const item of result.peers) console.log(line(item, target));
  if (result.engines)
    console.log(
      `${pc.bold(t('compat.engines'))} ${result.engines.range} ${pc.dim(result.engines.source)}  Node ${result.node ?? '?'} ${mark(result.engines.current)}`,
    );
  console.log(pc.bold(target ? t('compat.breaks') : t('compat.breaksAhead')));
  if (result.breaks.length === 0) console.log(`  ${pc.dim(t('compat.none'))}`);
  for (const item of result.breaks) {
    console.log(
      `  ${item.since}${item.direction === 'downgrade' ? ' (downgrade)' : ''}: ${item.title}${item.verified ? '' : ' (unverified)'}`,
    );
    console.log(pc.dim(`    ${item.guide}`));
    for (const place of item.places.slice(0, 8)) console.log(pc.yellow(`    ${place}`));
    if (item.places.length > 8) console.log(pc.yellow(`    ... +${item.places.length - 8}`));
    if (item.places.length === 0) console.log(pc.dim(`    ${t('upgrade.noOldApi')}`));
    for (const step of item.steps) console.log(pc.dim(`    -> ${step}`));
  }
  if (result.path.length > 1) console.log(t('compat.path', { path: result.path.join(' -> ') }));
}
