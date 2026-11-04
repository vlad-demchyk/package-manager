import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, Option } from 'commander';
import pc from 'picocolors';
import picomatch from 'picomatch';
import type { Report } from '../analyze.js';
import { CONFIG_FILE, ConfigError } from '../core/config.js';
import { SEVERITY_ORDER } from '../core/findings.js';
import type { Fix, Risk, Severity } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { setLanguage, t, type Language } from '../i18n/index.js';
import { nodeLineStatus, nodeVulnerabilities } from '../node/releases.js';
import { listInstalledNodes } from '../node/toolchain.js';
import { spfxMatrix } from '../providers/spfx/matrix.js';
import { renderMarkdown } from '../report/markdown.js';
import { allFindings, toJson } from '../report/model.js';
import { renderText } from '../report/text.js';
import { openSession, runAnalysis, type CommonOptions } from './context.js';
import { registerCommands } from './commands.js';
import { registerUpgrade } from './upgrade.js';
import {
  commonOptions,
  confirm,
  langOption,
  progressReporter,
  recordVerifiedBuilds,
  reviewAndApply,
  RISK_ORDER,
  type BuildResult,
} from './shared.js';
import { existsSync, readFileSync } from 'node:fs';
import { readJsonFile } from '../core/json.js';
import { readStoreVerified } from '../core/verified.js';
import type { PackageManifest } from '../core/types.js';
import {
  linkGroup,
  manifestKey,
  planStore,
  pruneTargets,
  readLinks,
  unlinkProjects,
} from '../store/store.js';
import { journal } from '../ops/journal.js';
import { applyPreviews } from '../fixes/apply.js';
import { rm } from 'node:fs/promises';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

interface CheckOptions extends CommonOptions {
  json?: boolean;
  md?: string;
  severity?: Severity;
  verbose?: boolean;
  failOn?: Severity | 'none';
}

interface FixOptions extends CommonOptions {
  rule?: string[];
  fix?: string[];
  risk?: Risk;
  apply?: boolean;
  yes?: boolean;
}

export function buildProgram(): Command {
  const program = new Command('packman')
    .description(t('cli.description'))
    .version(pkg.version)
    .showHelpAfterError()
    .hook('preAction', (_program, action) => {
      const { lang } = action.opts<{ lang?: Language | 'auto' }>();
      // Commands with a workspace session apply the config language afterwards.
      setLanguage(lang ?? 'auto');
    });

  commonOptions(
    program
      .command('check', { isDefault: true })
      .description('analyze projects and print findings'),
  )
    .option('--json', 'print the report as JSON')
    .option('--md <file>', 'also write a Markdown report')
    .addOption(
      new Option('--severity <level>', 'minimum severity to print')
        .choices(['critical', 'error', 'warning', 'info'])
        .default('info'),
    )
    .addOption(
      new Option('--fail-on <level>', 'exit with code 1 at this severity or worse')
        .choices(['critical', 'error', 'warning', 'info', 'none'])
        .default('error'),
    )
    .option('-v, --verbose', 'print all evidence lines')
    .action(async (root: string, options: CheckOptions) => {
      const session = await openSession(root, options);
      if (session.workspace.projects.length === 0) {
        console.error(t('cli.noProjects', { root: session.root }));
        process.exitCode = 1;
        return;
      }
      const report = await runAnalysis(session, options, progressReporter(options.json === true));
      if (options.json) {
        process.stdout.write(`${JSON.stringify(toJson(report), null, 2)}\n`);
      } else {
        console.log(
          renderText(report, {
            minSeverity: options.severity ?? 'info',
            verbose: options.verbose ?? false,
          }),
        );
      }
      if (options.md) {
        await writeFile(path.resolve(options.md), renderMarkdown(report), 'utf8');
      }
      process.exitCode = exitCodeFor(report, options.failOn ?? 'error');
    });

  commonOptions(
    program.command('fix').description('preview or apply fixes (dry run unless --apply)'),
  )
    .option('-r, --rule <ids...>', 'only fixes of findings with these rule ids')
    .option('-f, --fix <ids...>', 'only these fix ids')
    .addOption(
      new Option('--risk <level>', 'highest risk to include')
        .choices(['safe', 'review', 'breaking'])
        .default('safe'),
    )
    .option('--apply', 'write the changes (backups in .packman/backups)')
    .option('--relock', 'regenerate lockfiles of all changed projects with their Node')
    .option('--no-relock', 'keep lockfiles unchanged (default: relock after version edits)')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: FixOptions & { relock?: boolean }) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(session, options, progressReporter(false));
      await reviewAndApply(session, report, selectFixes(report, options), {
        ...options,
        command: 'fix',
      });
    });

  commonOptions(program.command('tui').description('interactive terminal UI')).action(
    async (root: string, options: CommonOptions) => {
      const session = await openSession(root, options);
      const { runTui } = await import('../tui/run.js');
      await runTui(session, options);
    },
  );

  commonOptions(
    program.command('init').description('create packman.config.json in the workspace root'),
  )
    .option('--with-groups', 'pre-fill policy.groups from the detected version groups')
    .option('--force', 'overwrite an existing packman.config.json')
    .action(
      async (root: string, options: CommonOptions & { withGroups?: boolean; force?: boolean }) => {
        const session = await openSession(root, options);
        const file = path.join(session.root, CONFIG_FILE);
        if (existsSync(file) && !options.force) {
          console.error(t('init.exists', { file }));
          process.exitCode = 1;
          return;
        }
        const config: Record<string, unknown> = {
          language: 'auto',
          projects: { include: ['**'], exclude: [], maxDepth: 4, includeRoot: false },
          policy: { exactVersions: true, groups: [] as unknown[] },
          checks: { disabled: [], ignoreUnused: [], ignorePaths: [] },
        };
        if (options.withGroups) {
          const report = await runAnalysis(session, { ...options, security: false, usage: false });
          (config.policy as { groups: unknown[] }).groups = report.groups.map((group) => ({
            name: group.name.replace(/\s+\/\s+/g, ' ').replace(/[^\w@.\- ]/g, ''),
            projects: group.projectIds,
            ...(group.node
              ? {
                  node:
                    report.projects.find(
                      (entry) => group.projectIds.includes(entry.project.id) && entry.node.selected,
                    )?.node.selected?.version ?? group.node,
                }
              : {}),
            pins: {},
          }));
        }
        await applyPreviews(session.root, [
          {
            file,
            before: existsSync(file) ? readFileSync(file, 'utf8') : '',
            after: `${JSON.stringify(config, null, 2)}\n`,
          },
        ]);
        console.log(pc.green(t('init.created', { file })));
      },
    );

  const store = program
    .command('store')
    .description('shared node_modules per group of identical projects (junctions)');

  commonOptions(store.command('plan').description('show which projects can share one install'))
    .option('--union', 'one install per version group with the union of aligned dependencies')
    .option('--json', 'machine-readable output')
    .action(async (root: string, options: CommonOptions & { union?: boolean; json?: boolean }) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(
        session,
        { ...options, security: false, usage: false },
        { targetVersions: true },
      );
      const plan = planStore(report, { union: options.union ?? false });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        return;
      }
      for (const group of plan.groups) {
        console.log(
          `${pc.bold(group.key)} ${pc.dim(`node ${group.node?.version ?? '?'}, ${group.projectIds.length} projects`)}`,
        );
        for (const id of group.projectIds) console.log(`  ${id}`);
        for (const warning of group.warnings) console.log(pc.yellow(`  ! ${warning}`));
      }
      for (const candidate of plan.candidates) {
        console.log(pc.dim(`~ ${candidate.reason}: ${candidate.projectIds.join(', ')}`));
        if (candidate.packages)
          console.log(
            pc.yellow(`    ${t('store.alignFirst', { packages: candidate.packages.join(', ') })}`),
          );
      }
      if (plan.groups.length === 0) console.log(t('store.none'));
    });

  commonOptions(
    store.command('link').description('install a group once and link its projects to it'),
  )
    .requiredOption('-g, --group <key>', 'group key from `packman store plan`')
    .option('--union', 'the group comes from `packman store plan --union`')
    .option(
      '--replace-existing',
      'delete local node_modules after successful store installation; back up manifests and locks only',
    )
    .option('--refresh', 'union: resolve the store fresh instead of from the verified set')
    .option(
      '--no-sync-locks',
      'union: leave project lockfiles unchanged instead of writing the group tree into them',
    )
    .option('-y, --yes', 'do not ask for confirmation')
    .action(
      async (
        root: string,
        options: CommonOptions & {
          group: string;
          union?: boolean;
          replaceExisting?: boolean;
          syncLocks: boolean;
          refresh?: boolean;
          yes?: boolean;
        },
      ) => {
        const session = await openSession(root, options);
        const report = await runAnalysis(
          session,
          { ...options, security: false },
          { targetVersions: true },
        );
        const group = planStore(report, { union: options.union ?? false }).groups.find((item) =>
          item.key.startsWith(options.group),
        );
        if (!group) {
          console.error(t('store.groupNotFound', { group: options.group }));
          process.exitCode = 1;
          return;
        }
        console.log(
          t('store.linkPlan', { count: group.projectIds.length, node: group.node?.version ?? '?' }),
        );
        for (const id of group.projectIds) console.log(`  ${id}`);
        for (const warning of group.warnings) console.log(pc.yellow(`  ! ${warning}`));
        if (!options.yes && !(await confirm(t('store.confirmLink')))) {
          console.log(t('cli.aborted'));
          return;
        }
        const verified =
          group.mode === 'union' && !options.refresh
            ? await readStoreVerified(session.root, group.projectIds)
            : undefined;
        if (verified)
          console.log(
            pc.dim(t('store.seeded', { date: verified.at.slice(0, 10), node: verified.node })),
          );
        const result = await linkGroup(session.root, report, group, {
          ...(verified ? { seedLock: verified.lock } : {}),
          replaceExisting: options.replaceExisting ?? false,
          // The projects' lockfiles follow the versions they now run with.
          syncLocks: group.mode === 'union' && options.syncLocks,
          install: async (dir, node, mode) =>
            (
              await runWithNode(
                node,
                dir,
                mode === 'exact' ? ['ci'] : ['install', '--no-audit', '--no-fund'],
              )
            ).code,
        });
        for (const conflict of result.conflicts ?? []) console.log(pc.yellow(`  ~ ${conflict}`));
        if (result.peers?.length)
          console.log(pc.yellow(t('store.peers', { count: result.peers.length })));
        for (const peer of result.peers ?? []) console.log(pc.yellow(`    ${peer}`));
        if (result.unverified?.length)
          console.log(pc.yellow(t('store.unverified', { count: result.unverified.length })));
        for (const line of result.unverified ?? []) console.log(pc.yellow(`    ${line}`));
        await journal(session.root, {
          command: 'store link',
          projects: result.linked,
          result: 'ok',
          detail: `${path.relative(session.root, result.storeDir)}${result.conflicts?.length ? `, ${result.conflicts.length} major changes` : ''}${result.peers?.length ? `, ${result.peers.length} peer gaps` : ''}`,
        });
        console.log(
          pc.green(
            t('store.linked', {
              count: result.linked.length,
              dir: path.relative(session.root, result.storeDir),
            }),
          ),
        );
      },
    );

  store
    .command('unlink')
    .description('remove links created by packman (never deletes real folders)')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .option('-p, --project <globs...>', 'only these project ids or globs')
    .option('-x, --exclude <globs...>', 'leave out these project ids or globs')
    .option(
      '--restore',
      'restore backed-up package.json and lockfiles; run install to recreate local modules',
    )
    .action(
      async (
        root: string,
        options: { project?: string[]; exclude?: string[]; restore?: boolean },
      ) => {
        const absRoot = path.resolve(root);
        const isSelected = options.project?.length ? picomatch(options.project) : () => true;
        const isExcluded = options.exclude?.length ? picomatch(options.exclude) : () => false;
        const selected =
          options.project || options.exclude
            ? (await readLinks(absRoot))
                .map((link) => link.projectId)
                .filter((id) => isSelected(id) && !isExcluded(id))
            : undefined;
        const result = await unlinkProjects(absRoot, selected, {
          restore: options.restore ?? false,
        });
        console.log(
          t('store.unlinked', { count: result.unlinked.length, restored: result.restored.length }),
        );
        await journal(absRoot, {
          command: 'store unlink',
          projects: result.unlinked,
          result: 'ok',
          detail: `restored ${result.restored.length}`,
        });
        for (const item of result.skipped)
          console.log(pc.yellow(`  ${item.projectId}: ${item.reason}`));
      },
    );

  store
    .command('status')
    .description('list linked projects and whether their manifest still matches the store')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .option('--json', 'machine-readable output')
    .action(async (root: string, options: { json?: boolean }) => {
      const absRoot = path.resolve(root);
      const rows = [];
      for (const link of await readLinks(absRoot)) {
        const manifest = await readJsonFile<PackageManifest>(
          path.join(absRoot, link.projectId, 'package.json'),
        );
        const current = manifest.ok ? manifestKey(manifest.value) : undefined;
        const stale =
          current !== undefined && current !== (link.manifestKey ?? link.key.slice(0, 16));
        rows.push({ projectId: link.projectId, target: link.target, stale });
      }
      if (options.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      if (rows.length === 0) console.log(t('store.noLinks'));
      for (const row of rows)
        console.log(
          `${row.stale ? pc.red('stale') : pc.green('ok   ')} ${row.projectId} ${pc.dim(`-> ${path.relative(absRoot, row.target)}`)}`,
        );
    });

  commonOptions(
    store.command('verify').description('run a script in every linked project with the group Node'),
  )
    .option('--script <name>', 'npm script to run', 'build')
    .action(async (root: string, options: CommonOptions & { script: string }) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(session, { ...options, security: false, usage: false });
      const linked = report.projects.filter((entry) => entry.project.nodeModules === 'link');
      const results: BuildResult[] = [];
      for (const entry of linked) {
        if (!entry.node.selected) {
          console.error(
            `${entry.project.id}: ${t('node.notInstalled', { ranges: entry.node.effective.join(' & '), recommended: entry.node.recommended ?? '-' })}`,
          );
          process.exitCode = 1;
          continue;
        }
        console.log(pc.bold(`\n> ${entry.project.id}: npm run ${options.script}`));
        const result = await runWithNode(entry.node.selected, entry.project.dir, [
          'run',
          options.script,
        ]);
        console.log(result.code === 0 ? pc.green('ok') : pc.red(`exit ${result.code}`));
        if (result.code !== 0) process.exitCode = result.code;
        await journal(session.root, {
          command: 'store verify',
          projects: [entry.project.id],
          result: result.code === 0 ? 'ok' : 'failed',
          detail: `npm run ${options.script} (node ${entry.node.selected.version}) exit ${result.code}`,
        });
        results.push({
          project: entry.project,
          node: entry.node.selected.version,
          script: options.script,
          ok: result.code === 0,
        });
      }
      await recordVerifiedBuilds(session.root, results);
    });

  store
    .command('prune')
    .description('delete stores no project links to (and, with --trash, moved node_modules)')
    .argument('[path]', 'workspace root', '.')
    .addOption(langOption())
    .option('--trash', 'also delete node_modules folders moved to .packman/trash')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: { trash?: boolean; yes?: boolean }) => {
      const absRoot = path.resolve(root);
      const targets = await pruneTargets(absRoot, { trash: options.trash ?? false });
      if (targets.length === 0) {
        console.log(t('clean.nothing'));
        return;
      }
      for (const target of targets) console.log(`  ${path.relative(absRoot, target)}`);
      if (!options.yes && !(await confirm(t('clean.confirm', { count: targets.length })))) {
        console.log(t('cli.aborted'));
        return;
      }
      for (const target of targets)
        await rm(target, { recursive: true, force: true, maxRetries: 3 });
      await journal(absRoot, {
        command: 'store prune',
        projects: [],
        files: targets.map((target) => path.relative(absRoot, target)),
        result: 'ok',
      });
      console.log(pc.green(t('clean.done', { count: targets.length })));
    });

  commonOptions(program.command('groups').description('show version groups and the baseline'))
    .option('--json', 'print as JSON')
    .action(async (root: string, options: CommonOptions & { json?: boolean }) => {
      const session = await openSession(root, options);
      const report = await runAnalysis(session, { ...options, security: false, usage: false });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report.groups, null, 2)}\n`);
        return;
      }
      for (const group of report.groups) {
        console.log(
          `${pc.bold(group.name)}${group.baseline ? pc.green(` [${t('report.baseline')}]`) : ''} ${pc.dim(`node ${group.node ?? '?'}`)}`,
        );
        for (const id of group.projectIds) console.log(`  ${id}`);
      }
    });

  program
    .command('node')
    .description('list installed Node versions with support status and known vulnerabilities')
    .option('--json', 'print as JSON')
    .addOption(
      new Option('--lang <language>', 'output language').choices(['auto', 'en', 'it', 'uk']),
    )
    .action(async (options: { json?: boolean; lang?: Language }) => {
      const { setLanguage } = await import('../i18n/index.js');
      setLanguage(options.lang ?? 'auto');
      const nodes = await listInstalledNodes();
      const rows = nodes.map((node) => {
        const status = nodeLineStatus(node.version);
        const vulns = nodeVulnerabilities(node.version);
        return {
          ...node,
          phase: status.phase,
          end: status.end,
          latest: status.latest,
          vulnerabilities: vulns.length,
          worst: worstSeverity(vulns.map((v) => v.severity)),
        };
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      console.log(pc.bold(t('report.installedNodes')));
      for (const row of rows) {
        const phase =
          row.phase === 'eol'
            ? pc.red(row.phase)
            : row.phase === 'maintenance-lts'
              ? pc.yellow(row.phase)
              : pc.green(row.phase);
        const vuln =
          row.phase === 'eol'
            ? pc.red(t('node.eolNotAssessed', { count: row.vulnerabilities }))
            : row.vulnerabilities > 0
              ? pc.red(`${row.vulnerabilities} CVE (${row.worst})`)
              : pc.green('0 CVE');
        console.log(
          `  ${row.version.padEnd(10)} ${row.manager.padEnd(12)} ${phase.padEnd(26)} ${vuln} ${pc.dim(`latest ${row.latest ?? '-'}, EOL ${row.end ?? '-'}`)}`,
        );
      }
    });

  program
    .command('spfx')
    .description('print the SPFx compatibility matrix')
    .addOption(langOption())
    .option('--json', 'print as JSON')
    .action((options: { json?: boolean }) => {
      const matrix = spfxMatrix();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
        return;
      }
      console.log(pc.dim(`verified ${matrix.verifiedAt}`));
      for (const v of matrix.versions) {
        const flags = [
          v.withdrawn ? pc.red('withdrawn') : '',
          v.toolchain === 'heft' ? 'heft' : 'gulp',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(
          `  ${v.version.padEnd(8)} node ${v.node.padEnd(58)} react ${(v.react ?? '-').padEnd(8)} ${v.compiler.padEnd(26)} ${flags}`,
        );
      }
    });

  registerCommands(program);
  registerUpgrade(program);
  return program;
}

function selectFixes(report: Report, options: FixOptions): Fix[] {
  const maxRisk = RISK_ORDER[options.risk ?? 'safe'];
  return allFindings(report)
    .filter((item) => !options.rule || options.rule.includes(item.ruleId))
    .flatMap((item) => item.fixes)
    .filter(
      (entry) =>
        RISK_ORDER[entry.risk] <= maxRisk && (!options.fix || options.fix.includes(entry.id)),
    );
}

function exitCodeFor(report: Report, failOn: Severity | 'none'): number {
  if (failOn === 'none') return 0;
  const threshold = SEVERITY_ORDER[failOn];
  return allFindings(report).some((item) => SEVERITY_ORDER[item.severity] <= threshold) ? 1 : 0;
}

function worstSeverity(values: string[]): string {
  for (const level of ['critical', 'high', 'medium', 'low'])
    if (values.includes(level)) return level;
  return values[0] ?? '-';
}

export async function main(argv = process.argv): Promise<void> {
  try {
    // Without a command in an interactive terminal, open the TUI (the 2.x menu entry point).
    const args = argv.slice(2);
    const interactive = process.stdout.isTTY && process.stdin.isTTY && !process.env.CI;
    const effective =
      interactive && (args.length === 0 || args.every((arg) => !/^[a-z]/.test(arg) || arg === '.'))
        ? [...argv.slice(0, 2), 'tui', ...args]
        : argv;
    await buildProgram().parseAsync(effective);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(pc.red(error.message));
      process.exitCode = 2;
      return;
    }
    // Operations refuse unsafe states with an Error: show the message, the stack only on demand.
    if (error instanceof Error && !process.env.PACKMAN_DEBUG) {
      console.error(pc.red(error.message));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
