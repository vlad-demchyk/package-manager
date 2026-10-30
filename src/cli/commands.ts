import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type { Report } from '../analyze.js';
import { CONFIG_FILE } from '../core/config.js';
import { editJsonText } from '../core/json.js';
import type { Fix } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { t, tm } from '../i18n/index.js';
import { alignPackage, alignToProject, closestProjects, diffProjects } from '../ops/align.js';
import { executeClean, planClean } from '../ops/clean.js';
import { generateProfile, type VersionStrategy } from '../ops/generate.js';
import { journal, pruneJournal, readJournal } from '../ops/journal.js';
import { versionMatrix } from '../ops/matrix.js';
import { outdated } from '../ops/outdated.js';
import { primaryStack } from '../policy/groups.js';
import { allFindings } from '../report/model.js';
import { openSession, runAnalysis, type CommonOptions, type Session } from './context.js';
import {
  commonOptions,
  confirm,
  langOption,
  progressReporter,
  relock,
  reviewAndApply,
} from './shared.js';

type InstallMode = 'normal' | 'legacy-peer-deps' | 'force';

interface InstallOptions extends CommonOptions {
  yes?: boolean;
  mode?: InstallMode;
  lockOnly?: boolean;
}

function npmArgs(
  entry: Report['projects'][number],
  options: { mode?: InstallMode; lockOnly?: boolean },
): string[] {
  // `npm ci` refuses a lockfile that no longer matches package.json (e.g. right after an alignment).
  const drift = entry.findings.some((item) => item.ruleId === 'npm/lockfile-drift');
  const args = options.lockOnly
    ? ['install', '--package-lock-only', '--ignore-scripts']
    : entry.project.lockfile?.kind === 'npm' && options.mode !== 'force' && !drift
      ? ['ci']
      : ['install'];
  if (options.mode === 'legacy-peer-deps') args.push('--legacy-peer-deps');
  if (options.mode === 'force') args.push('--force');
  return [...args, '--no-audit', '--no-fund'];
}

/** Runs npm in every selected project with that project's Node; linked projects are skipped. */
async function runInstall(
  session: Session,
  report: Report,
  options: InstallOptions,
  command: string,
): Promise<boolean> {
  const plan = report.projects.map((entry) => ({ entry, args: npmArgs(entry, options) }));
  for (const { entry, args } of plan) {
    const note =
      entry.project.nodeModules === 'link' ? pc.yellow(` (${t('install.linkedSkipped')})`) : '';
    console.log(
      `${entry.project.id}: npm ${args.join(' ')} @ node ${entry.node.selected?.version ?? pc.red('?')}${note}`,
    );
  }
  if (!options.yes && !(await confirm(t('install.confirm', { count: plan.length })))) {
    console.log(t('cli.aborted'));
    return false;
  }
  let ok = true;
  for (const { entry, args } of plan) {
    if (!entry.node.selected || entry.project.nodeModules === 'link') continue;
    console.log(pc.bold(`\n> ${entry.project.id}`));
    const result = await runWithNode(entry.node.selected, entry.project.dir, args);
    await journal(session.root, {
      command,
      projects: [entry.project.id],
      result: result.code === 0 ? 'ok' : 'failed',
      detail: `npm ${args.join(' ')} (node ${entry.node.selected.version}) exit ${result.code}`,
    });
    if (result.code !== 0) {
      ok = false;
      process.exitCode = result.code;
    }
  }
  return ok;
}

const installModeOption = (): Option =>
  new Option('--mode <mode>', 'npm install mode')
    .choices(['normal', 'legacy-peer-deps', 'force'])
    .default('normal');

async function quickReport(
  root: string,
  options: CommonOptions,
): Promise<{ session: Session; report: Report }> {
  const session = await openSession(root, options);
  const report = await runAnalysis(session, { ...options, security: false, usage: false });
  return { session, report };
}

export function registerCommands(program: Command): void {
  commonOptions(
    program
      .command('install')
      .description('npm ci/install in each project with its own Node version'),
  )
    .addOption(installModeOption())
    .option('--lock-only', 'only update package-lock.json (npm install --package-lock-only)')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: InstallOptions) => {
      const { session, report } = await quickReport(root, options);
      await runInstall(session, report, options, 'install');
    });

  commonOptions(
    program
      .command('clean')
      .description('remove node_modules and/or lockfiles (linked projects are only unlinked)'),
  )
    .option('--lock', 'remove lockfiles')
    .option('--modules', 'remove node_modules')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(
      async (
        root: string,
        options: CommonOptions & { lock?: boolean; modules?: boolean; yes?: boolean },
      ) => {
        const { session, report } = await quickReport(root, options);
        const both = !options.lock && !options.modules;
        const targets = planClean(
          report.projects.map((entry) => entry.project),
          { modules: both || options.modules === true, lockfile: both || options.lock === true },
        );
        if (targets.length === 0) {
          console.log(t('clean.nothing'));
          return;
        }
        for (const target of targets)
          console.log(
            `${target.projectId}: ${target.kind} ${pc.dim(path.relative(session.root, target.path))}`,
          );
        if (!options.yes && !(await confirm(t('clean.confirm', { count: targets.length })))) {
          console.log(t('cli.aborted'));
          return;
        }
        const removed = await executeClean(session.root, targets);
        await journal(session.root, {
          command: 'clean',
          projects: [...new Set(targets.map((target) => target.projectId))],
          files: removed.map((file) => path.relative(session.root, file)),
          result: 'ok',
        });
        console.log(pc.green(t('clean.done', { count: removed.length })));
      },
    );

  commonOptions(
    program.command('reinstall').description('clean, then install with each project Node'),
  )
    .option('--lock-only', 'remove only lockfiles before installing (keeps node_modules)')
    .addOption(installModeOption())
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: InstallOptions & { lockOnly?: boolean }) => {
      const { session, report } = await quickReport(root, options);
      const targets = planClean(
        report.projects
          .filter((entry) => entry.project.nodeModules !== 'link')
          .map((entry) => entry.project),
        { modules: !options.lockOnly, lockfile: true },
      );
      for (const target of targets) console.log(`${target.projectId}: ${target.kind}`);
      if (
        !options.yes &&
        !(await confirm(t('reinstall.confirm', { count: report.projects.length })))
      ) {
        console.log(t('cli.aborted'));
        return;
      }
      await executeClean(session.root, targets);
      await journal(session.root, {
        command: 'reinstall:clean',
        projects: [...new Set(targets.map((x) => x.projectId))],
        result: 'ok',
      });
      const fresh = await runAnalysis(session, { ...options, security: false, usage: false });
      await runInstall(session, fresh, { ...options, yes: true, lockOnly: false }, 'reinstall');
    });

  commonOptions(
    program
      .command('update')
      .description('align projects with their dependency profiles (packman.config.json)'),
  )
    .option('--apply', 'write the changes (backups in .packman/backups)')
    .option('--relock', 'regenerate lockfiles of changed projects with their Node')
    .option('--install', 'run npm install in changed projects afterwards')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(
      async (
        root: string,
        options: CommonOptions & {
          apply?: boolean;
          relock?: boolean;
          install?: boolean;
          yes?: boolean;
        },
      ) => {
        const session = await openSession(root, options);
        if (Object.keys(session.loaded.config.profiles).length === 0) {
          console.log(t('update.noProfiles'));
          return;
        }
        const report = await runAnalysis(
          session,
          { ...options, security: false },
          progressReporter(false),
        );
        const fixes = allFindings(report)
          .filter((item) => item.ruleId.startsWith('profile/'))
          .flatMap((item) => item.fixes);
        await reviewAndApply(session, report, fixes, { ...options, command: 'update' });
        if (options.apply && options.install) {
          const fresh = await runAnalysis(session, { ...options, security: false, usage: false });
          await runInstall(
            session,
            fresh,
            { ...options, yes: true, lockOnly: false },
            'update:install',
          );
        }
      },
    );

  const profile = program.command('profile').description('dependency profiles');
  commonOptions(
    profile
      .command('generate')
      .description('build a profile from the selected projects (2.x "genera configurazione")'),
  )
    .requiredOption('-n, --name <name>', 'profile name')
    .addOption(
      new Option('--strategy <strategy>', 'version to keep when projects differ')
        .choices(['highest', 'common'])
        .default('highest'),
    )
    .option('--declared', 'use declared specs instead of resolved versions')
    .option('--write', `write the profile into ${CONFIG_FILE}`)
    .action(
      async (
        root: string,
        options: CommonOptions & {
          name: string;
          strategy: VersionStrategy;
          declared?: boolean;
          write?: boolean;
        },
      ) => {
        const { session, report } = await quickReport(root, options);
        const projects = report.projects.map((entry) => entry.project);
        if (projects.length === 0) {
          console.log(t('cli.noProjects', { root: session.root }));
          return;
        }
        const stacks = report.projects.map((entry) => primaryStack(entry.stacks));
        const nodeRanges = new Set(
          report.projects.map((entry) => entry.node.stackRanges[0]?.range).filter(Boolean),
        );
        const generated = generateProfile(projects, {
          strategy: options.strategy,
          projectsGlob: options.project ?? projects.map((project) => project.id),
          resolved: !options.declared,
          ...(nodeRanges.size === 1 && stacks.every((stack) => stack?.provider === 'spfx')
            ? { nodeRange: [...nodeRanges][0] as string }
            : {}),
        });
        const json = JSON.stringify(generated, null, 2);
        console.log(json);
        if (!options.write) {
          console.log(pc.yellow(t('profile.notWritten')));
          return;
        }
        const file = path.join(session.root, CONFIG_FILE);
        const before = existsSync(file) ? await readFile(file, 'utf8') : '{}\n';
        await writeFile(
          file,
          editJsonText(before, [{ path: ['profiles', options.name], value: generated }]),
          'utf8',
        );
        await journal(session.root, {
          command: 'profile generate',
          projects: projects.map((p) => p.id),
          files: [CONFIG_FILE],
          result: 'ok',
        });
        console.log(pc.green(t('profile.written', { name: options.name, file: CONFIG_FILE })));
      },
    );

  commonOptions(
    program.command('align').description('align one project to another, or one package everywhere'),
  )
    .option('--base <project>', 'project to change')
    .option('--to <project>', 'project to copy versions from')
    .option('--package <name>', 'align this package across the selected projects')
    .option('--version <version>', 'version for --package (default: most common, then highest)')
    .option('--only <names...>', 'with --base/--to: only these packages')
    .option('--pin', 'drop range prefixes (^ ~) from copied versions')
    .option('--include-missing', 'with --base/--to: also add packages the base does not declare')
    .option('--apply', 'write the changes (backups in .packman/backups)')
    .option('--relock', 'regenerate lockfiles of changed projects with their Node')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(
      async (
        root: string,
        options: CommonOptions & {
          base?: string;
          to?: string;
          package?: string;
          version?: string;
          only?: string[];
          pin?: boolean;
          includeMissing?: boolean;
          apply?: boolean;
          relock?: boolean;
          yes?: boolean;
        },
      ) => {
        const { session, report } = await quickReport(root, options);
        const projects = report.projects.map((entry) => entry.project);
        const byId = (id: string) => projects.find((project) => project.id === id);
        let fixes: Fix[] = [];
        if (options.package) {
          const aligned = alignPackage(projects, options.package, options.version);
          if (aligned) {
            console.log(t('align.package', { name: options.package, version: aligned.version }));
            fixes = [aligned.fix];
          }
        } else if (options.base) {
          const base = byId(options.base);
          if (!base) {
            console.error(t('align.unknownProject', { project: options.base }));
            process.exitCode = 1;
            return;
          }
          if (!options.to) {
            console.log(pc.bold(t('align.closest', { project: base.id })));
            for (const item of closestProjects(base, projects).slice(0, 15))
              console.log(`  ${item.matches.toString().padStart(3)}  ${item.project.id}`);
            return;
          }
          const target = byId(options.to);
          if (!target) {
            console.error(t('align.unknownProject', { project: options.to }));
            process.exitCode = 1;
            return;
          }
          for (const row of diffProjects(base, target).filter((item) => item.status !== 'same')) {
            const color = row.status === 'different' ? pc.yellow : pc.dim;
            console.log(
              color(
                `  ${row.status.padEnd(10)} ${row.name.padEnd(45)} ${(row.baseSpec ?? '-').padEnd(14)} -> ${row.targetSpec ?? '-'}`,
              ),
            );
          }
          const aligned = alignToProject(base, target, {
            pin: options.pin ?? false,
            includeMissing: options.includeMissing ?? false,
            ...(options.only ? { packages: options.only } : {}),
          });
          if (aligned) fixes = [aligned];
        } else {
          console.error(t('align.usage'));
          process.exitCode = 1;
          return;
        }
        await reviewAndApply(session, report, fixes, { ...options, command: 'align' });
      },
    );

  commonOptions(program.command('matrix').description('versions of every package in every project'))
    .option('--diverging', 'only packages with more than one version')
    .option('--package <globs...>', 'only these packages')
    .option('--json', 'print as JSON')
    .action(
      async (
        root: string,
        options: CommonOptions & { diverging?: boolean; package?: string[]; json?: boolean },
      ) => {
        const { report } = await quickReport(root, options);
        const matrix = versionMatrix(
          report.projects.map((entry) => entry.project),
          {
            divergingOnly: options.diverging ?? false,
            ...(options.package ? { packages: options.package } : {}),
          },
        );
        if (options.json) {
          process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
          return;
        }
        for (const row of matrix.rows) {
          const header = `${row.diverging ? pc.yellow('≠') : pc.green('=')} ${pc.bold(row.name)} ${pc.dim(`(${Object.keys(row.cells).length})`)}`;
          console.log(header);
          if (!row.diverging) continue;
          for (const version of row.versions) {
            const users = Object.entries(row.cells)
              .filter(([, cell]) => (cell.version ?? cell.spec) === version)
              .map(([id]) => id);
            console.log(`    ${version.padEnd(16)} ${pc.dim(users.join(', '))}`);
          }
        }
      },
    );

  commonOptions(
    program
      .command('outdated')
      .description('current, wanted and latest versions from the npm registry'),
  )
    .option('--json', 'print as JSON')
    .action(async (root: string, options: CommonOptions & { json?: boolean }) => {
      const { report } = await quickReport(root, options);
      const rows = await outdated(
        report.projects.map((entry) => entry.project),
        { offline: options.offline ?? false },
      );
      if (options.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      let current = '';
      for (const row of rows) {
        if (row.projectId !== current) {
          current = row.projectId;
          console.log(pc.bold(current));
        }
        const major =
          row.latest && row.current && row.latest.split('.')[0] !== row.current.split('.')[0];
        console.log(
          `  ${row.name.padEnd(45)} ${(row.current ?? '-').padEnd(12)} wanted ${(row.wanted ?? '-').padEnd(12)} latest ${major ? pc.red(row.latest ?? '-') : (row.latest ?? '-')}${row.deprecated ? pc.red(' deprecated') : ''}`,
        );
      }
      if (rows.length === 0) console.log(t('outdated.none'));
    });

  commonOptions(
    program.command('audit').description('known vulnerabilities only (packages and Node)'),
  )
    .option('--json', 'print as JSON')
    .action(async (root: string, options: CommonOptions & { json?: boolean }) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(
        session,
        { ...options, security: true },
        progressReporter(options.json === true),
      );
      const findings = allFindings(report).filter((item) => item.tags.includes('security'));
      if (options.json) {
        process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
      } else {
        for (const item of findings) {
          console.log(`${item.projectId ?? '*'}: ${tm(item.message)}`);
          for (const line of item.evidence.slice(0, 6)) console.log(pc.dim(`    ${line}`));
        }
        if (findings.length === 0) console.log(t('report.noFindings'));
      }
      if (findings.some((item) => item.severity === 'critical' || item.severity === 'error'))
        process.exitCode = 1;
    });

  commonOptions(program.command('list').description('projects found and their state'))
    .option('--json', 'print as JSON')
    .action(async (root: string, options: CommonOptions & { json?: boolean }) => {
      const { report } = await quickReport(root, options);
      const rows = report.projects.map((entry) => {
        const stack = primaryStack(entry.stacks);
        return {
          id: entry.project.id,
          name: entry.project.name,
          stack: stack ? `${stack.provider}${stack.version ? `@${stack.version}` : ''}` : '-',
          tsconfig: existsSync(path.join(entry.project.dir, 'tsconfig.json')),
          src: existsSync(path.join(entry.project.dir, 'src')),
          nodeModules: entry.project.nodeModules,
          lockfile: entry.project.lockfile
            ? `${entry.project.lockfile.kind}${entry.project.lockfile.version ? ` v${entry.project.lockfile.version}` : ''}`
            : '-',
          node: entry.node.selected?.version ?? '-',
        };
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      const yes = (value: boolean): string => (value ? pc.green('yes') : pc.dim('no '));
      for (const row of rows) {
        console.log(
          `${row.id.padEnd(40)} ${row.stack.padEnd(18)} tsconfig ${yes(row.tsconfig)} src ${yes(row.src)} node_modules ${row.nodeModules.padEnd(7)} lock ${row.lockfile.padEnd(7)} node ${row.node}`,
        );
      }
      console.log(pc.dim(t('list.total', { count: rows.length })));
    });

  const ignore = program
    .command('ignore')
    .description('packages never reported as unused (2.x depcheck whitelist)');
  for (const action of ['add', 'remove'] as const) {
    ignore
      .command(action)
      .argument('<packages...>', 'package names')
      .addOption(langOption())
      .option('-C, --cwd <path>', 'workspace root', '.')
      .action(async (packages: string[], options: { cwd: string }) => {
        const file = path.join(path.resolve(options.cwd), CONFIG_FILE);
        const text = existsSync(file) ? await readFile(file, 'utf8') : '{}\n';
        const session = await openSession(options.cwd, {});
        const current = new Set(session.loaded.config.checks.ignoreUnused);
        for (const name of packages) {
          if (action === 'add') current.add(name);
          else current.delete(name);
        }
        await writeFile(
          file,
          editJsonText(text, [{ path: ['checks', 'ignoreUnused'], value: [...current].sort() }]),
          'utf8',
        );
        console.log([...current].sort().join('\n') || t('ignore.empty'));
      });
  }
  ignore
    .command('list')
    .addOption(langOption())
    .option('-C, --cwd <path>', 'workspace root', '.')
    .action(async (options: { cwd: string }) => {
      const session = await openSession(options.cwd, {});
      console.log(session.loaded.config.checks.ignoreUnused.join('\n') || t('ignore.empty'));
    });

  program
    .command('log')
    .description('operations recorded in .packman/journal.jsonl')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .option('-n, --limit <n>', 'entries to show', (value) => Number.parseInt(value, 10), 30)
    .option('--prune <days>', 'delete entries older than this many days', (value) =>
      Number.parseInt(value, 10),
    )
    .action(async (root: string, options: { limit: number; prune?: number }) => {
      const absRoot = path.resolve(root);
      if (options.prune !== undefined) {
        console.log(t('log.pruned', { count: await pruneJournal(absRoot, options.prune) }));
        return;
      }
      const entries = (await readJournal(absRoot)).slice(-options.limit);
      if (entries.length === 0) console.log(t('log.empty'));
      for (const entry of entries) {
        const color =
          entry.result === 'ok' ? pc.green : entry.result === 'failed' ? pc.red : pc.yellow;
        console.log(
          `${pc.dim(entry.at)} ${color(entry.result.padEnd(7))} ${entry.command.padEnd(18)} ${entry.projects.join(', ')}${entry.detail ? pc.dim(`  ${entry.detail}`) : ''}`,
        );
      }
    });

  commonOptions(
    program
      .command('relock')
      .description('regenerate lockfiles with each project Node (npm install --package-lock-only)'),
  ).action(async (root: string, options: CommonOptions) => {
    const { session, report } = await quickReport(root, options);
    await relock(
      session,
      report.projects.map((entry) => entry.project.id),
      report,
    );
  });
}
