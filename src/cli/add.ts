import type { Command } from 'commander';
import pc from 'picocolors';
import picomatch from 'picomatch';
import type { ProjectReport, Report } from '../analyze.js';
import type { Fix } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { t } from '../i18n/index.js';
import { parseRequest, planAdd, planRemove, removalUsage } from '../ops/add.js';
import { journal } from '../ops/journal.js';
import { scanSources, type SourceScan } from '../scan/sources.js';
import { planStore } from '../store/store.js';
import { openSession, runAnalysis, type Session } from './context.js';
import {
  langOption,
  linkedGroupOrExplain,
  nonNegativeInt,
  relinkGroup,
  reportUnverified,
  reviewAndApply,
  verifyProjects,
} from './shared.js';

interface EditOptions {
  project: string[];
  cwd: string;
  depth?: number;
  lang?: 'auto' | 'en' | 'it' | 'uk';
  offline?: boolean;
  apply?: boolean;
  yes?: boolean;
  install: boolean;
  refresh?: boolean;
  verify?: string | boolean;
}

interface AddCliOptions extends EditOptions {
  dev?: boolean;
  exact?: boolean;
}

/**
 * `packman add` and `packman remove`: change the declared dependencies of one or more projects and
 * install the right way. The packages are variadic, so the workspace comes from `-C` and the
 * projects from `-p`, like `ignore add`. The whole workspace is analyzed so that groups and the
 * shared store are known even when one project is selected.
 */
export function registerAdd(program: Command): void {
  editCommand(
    program
      .command('add')
      .description(
        'add packages to a project: version from the group, checks, then install or store rebuild',
      )
      .argument('<packages...>', 'package names, optionally name@range'),
  )
    .option('-D, --dev', 'declare under devDependencies')
    .option(
      '--exact',
      'pin registry picks to the exact version (default follows policy.exactVersions)',
    )
    .action(async (packages: string[], options: AddCliOptions) => {
      const { session, report, targets } = await selectProjects(options);
      if (!targets) return;
      const plans = await planAdd(report, targets, packages.map(parseRequest), {
        ...(options.dev ? { dev: true } : {}),
        ...(options.exact ? { exact: true } : {}),
        offline: options.offline ?? false,
        config: session.loaded.config,
      });
      let failed = 0;
      for (const plan of plans) {
        console.log(
          t('add.plan', {
            project: plan.project.id,
            name: plan.name,
            version: plan.choice.spec,
            section: plan.section,
            source: plan.choice.source,
            detail: plan.choice.detail,
          }),
        );
        for (const check of plan.checks) {
          const color = check.severity === 'error' ? pc.red : pc.yellow;
          console.log(
            color(`  ${check.severity === 'error' ? '!' : '~'} ${check.kind}: ${check.message}`),
          );
          if (check.suggestion) console.log(pc.dim(`    -> ${check.suggestion}`));
          for (const line of check.lines ?? []) console.log(pc.dim(`    ${line}`));
          if (check.severity === 'error') failed++;
        }
      }
      if (failed > 0) {
        console.error(pc.red(t('add.blocked', { count: failed })));
        process.exitCode = 1;
        return;
      }
      await applyAndInstall(
        session,
        report,
        targets,
        plans.flatMap((plan) => (plan.fix ? [plan.fix] : [])),
        options,
        'add',
      );
    });

  editCommand(
    program
      .command('remove')
      .description('remove packages from a project and install or rebuild the store accordingly')
      .argument('<packages...>', 'package names'),
  ).action(async (packages: string[], options: EditOptions) => {
    const { session, report, targets, scans } = await selectProjects(options);
    if (!targets) return;
    const fixes: Fix[] = [];
    for (const entry of targets) {
      const removal = planRemove(entry.project, packages);
      for (const name of removal.missing)
        console.log(pc.yellow(t('add.notDeclared', { project: entry.project.id, name })));
      if (!removal.fix) continue;
      fixes.push(removal.fix);
      const declared = packages.filter((name) => !removal.missing.includes(name));
      for (const use of await removalUsage(entry.project, declared, scans.get(entry.project.id)))
        console.log(
          pc.yellow(
            t('add.stillUsed', {
              project: entry.project.id,
              name: use.name,
              places: use.places.join('; '),
            }),
          ),
        );
    }
    await applyAndInstall(session, report, targets, fixes, options, 'remove');
  });
}

function editCommand(command: Command): Command {
  return command
    .requiredOption('-p, --project <globs...>', 'project ids or globs to change')
    .option('-C, --cwd <path>', 'workspace root', '.')
    .option('--depth <n>', 'how deep to search for projects', nonNegativeInt)
    .addOption(langOption())
    .option('--offline', 'do not use the network (registry metadata from cache only)')
    .option('--apply', 'write the changes (backups in .packman/backups)')
    .option('-y, --yes', 'do not ask for confirmation')
    .option('--no-install', 'only edit package.json; do not run npm or rebuild the store')
    .option(
      '--refresh',
      'linked projects: resolve the store fresh instead of from the verified set',
    )
    .option(
      '--verify [script]',
      'linked projects: run this npm script in every member after relinking (default build)',
    );
}

/**
 * Analyzes the whole workspace without the source scan (cheap), then scans the sources of the
 * selected projects only: the API-break check needs the places that use an API, and `remove` the
 * imports. The scans are written into the report entries and returned by project id.
 */
async function selectProjects(options: EditOptions): Promise<{
  session: Session;
  report: Report;
  targets?: ProjectReport[];
  scans: Map<string, SourceScan>;
}> {
  const session = await openSession(options.cwd, {
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
    ...(options.lang ? { lang: options.lang } : {}),
  });
  const report = await runAnalysis(
    session,
    { security: false, usage: false, offline: options.offline ?? false },
    { targetVersions: true },
  );
  const isSelected = picomatch(options.project);
  const targets = report.projects.filter((entry) => isSelected(entry.project.id));
  const scans = new Map<string, SourceScan>();
  if (targets.length === 0) {
    console.error(t('add.unknownProject', { project: options.project.join(', ') }));
    process.exitCode = 1;
    return { session, report, scans };
  }
  for (const entry of targets) {
    const scan = await scanSources(entry.project.dir, session.loaded.config.checks.ignorePaths);
    scans.set(entry.project.id, scan);
    entry.imports = [...scan.imports.keys()].sort();
    entry.apiUsage = Object.fromEntries(scan.api);
  }
  return { session, report, targets, scans };
}

/**
 * Writes the manifests through the shared preview/apply flow, then installs: a project with its own
 * node_modules runs `npm install` with its Node; a project linked to the shared store never runs npm
 * itself, its group's store is rebuilt, every member relinked and their lockfiles synchronized.
 */
async function applyAndInstall(
  session: Session,
  report: Report,
  targets: ProjectReport[],
  fixes: Fix[],
  options: EditOptions,
  command: string,
): Promise<void> {
  // The API breaks the edits cross were printed with the checks; the shared flow stays quiet.
  const applied = await reviewAndApply(session, report, fixes, {
    ...(options.apply ? { apply: true } : {}),
    ...(options.yes ? { yes: true } : {}),
    relock: false,
    apiNotes: false,
    command,
  });
  if (!options.apply || !applied || fixes.length === 0) return;
  if (!options.install) {
    console.log(pc.dim(t('add.noInstall')));
    return;
  }
  const fresh = await runAnalysis(
    session,
    { security: false, offline: options.offline ?? false },
    { targetVersions: true },
  );
  const ids = new Set(targets.map((entry) => entry.project.id));
  const changed = fresh.projects.filter((entry) => ids.has(entry.project.id));

  for (const entry of changed.filter((item) => item.project.nodeModules !== 'link')) {
    if (!entry.node.selected) {
      console.error(
        `${entry.project.id}: ${t('node.notInstalled', { ranges: entry.node.effective.join(' & '), recommended: entry.node.recommended ?? '-' })}`,
      );
      process.exitCode = 1;
      continue;
    }
    console.log(
      pc.bold(
        `\n> ${t('add.installing', { project: entry.project.id, node: entry.node.selected.version })}`,
      ),
    );
    const result = await runWithNode(entry.node.selected, entry.project.dir, [
      'install',
      '--no-audit',
      '--no-fund',
    ]);
    await journal(session.root, {
      command: `${command}:install`,
      projects: [entry.project.id],
      result: result.code === 0 ? 'ok' : 'failed',
      detail: `npm install (node ${entry.node.selected.version}) exit ${result.code}`,
    });
    if (result.code !== 0) process.exitCode = result.code;
    else
      await reportUnverified(
        (await runAnalysis(session, { security: false, usage: false })).projects.find(
          (item) => item.project.id === entry.project.id,
        )?.project ?? entry.project,
      );
  }

  const linked = changed.filter((item) => item.project.nodeModules === 'link');
  const verify =
    options.verify !== undefined && options.verify !== false
      ? typeof options.verify === 'string'
        ? options.verify
        : 'build'
      : undefined;
  if (verify !== undefined)
    for (const entry of changed.filter((item) => item.project.nodeModules !== 'link'))
      console.log(
        pc.yellow(t('add.verifyUnlinked', { project: entry.project.id, script: verify })),
      );
  if (linked.length === 0) return;
  const plan = planStore(fresh, { union: true });
  const done = new Set<string>();
  for (const entry of linked) {
    if (done.has(entry.project.id)) continue;
    const group = linkedGroupOrExplain(plan, entry.project.id);
    if (!group) {
      done.add(entry.project.id);
      continue;
    }
    console.log(
      pc.bold(
        `\n> ${t('add.linkedRebuild', { project: entry.project.id, group: group.key, count: group.projectIds.length })}`,
      ),
    );
    for (const warning of group.warnings) console.log(pc.yellow(`  ! ${warning}`));
    await relinkGroup(session, fresh, group, {
      ...(options.refresh ? { refresh: true } : {}),
      command: `${command}:store`,
    });
    for (const id of group.projectIds) done.add(id);
    if (verify !== undefined) {
      const after = await runAnalysis(session, { security: false, usage: false });
      await verifyProjects(session, after, group.projectIds, verify, `${command}:verify`);
    }
  }
}
