import path from 'node:path';
import type { Command } from 'commander';
import type { Report } from '../analyze.js';
import { declaredDependencies } from '../core/discovery.js';
import type { Project } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { backupFiles } from '../fixes/apply.js';
import { t, tm } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import { linkGroup, planStore } from '../store/store.js';
import { editedManifest, planUpgrade } from '../upgrade/plan.js';
import type { UpgradePlan } from '../upgrade/types.js';
import { openSession, runAnalysis, type CommonOptions } from './context.js';
import { commonOptions, reviewAndApply } from './shared.js';

interface UpgradeCliOptions extends CommonOptions {
  stack?: string[];
  to?: string;
  node?: string;
  json?: boolean;
  apply?: boolean;
  yes?: boolean;
  relock?: boolean;
  install?: boolean;
  shared?: boolean;
  verify?: boolean;
}

export function registerUpgrade(program: Command): void {
  commonOptions(
    program
      .command('upgrade')
      .description('converge projects on the newest stack already present in this repository'),
  )
    .option('--stack <names...>', 'framework families to migrate, e.g. spfx, react, vite, angular')
    .option('--to <version>', 'explicit target version or line (default: newest existing project)')
    .option('--node <version>', 'explicit Node version/range (default: a common installed Node)')
    .option('--json', 'print the migration plan as JSON (read-only)')
    .option('--apply', 'write the reviewed migration and repository policy')
    .option('--relock', 'regenerate project lockfiles after migration')
    .option('--install', 'install migrated projects')
    .option(
      '--shared',
      'install once, delete local modules and link the migrated group; back up manifests/locks only',
    )
    .option('--verify', 'install and run the build/test script of every migrated project')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: UpgradeCliOptions) => {
      if (options.json && options.apply) throw new Error(t('upgrade.jsonReadOnly'));
      const session = await openSession(root, options);
      const report = await runAnalysis(
        session,
        { ...options, security: false },
        { targetVersions: true },
      );
      const plan = await planUpgrade(report, {
        config: session.loaded.config,
        offline: options.offline ?? false,
        ...(options.stack ? { stack: options.stack } : {}),
        ...(options.to ? { to: options.to } : {}),
        ...(options.node ? { node: options.node } : {}),
        persistTarget: !options.project && !options.exclude,
        shared: options.shared === true,
      });
      if (plan.projects.length === 0) throw new Error(t('upgrade.noProjects'));
      if (options.shared) checkShared(report, plan);
      if (options.verify)
        for (const migration of plan.projects) {
          const project = report.projects.find(
            (entry) => entry.project.id === migration.id,
          )?.project;
          if (!project?.manifest.scripts?.[migration.verifyScript] && migration.stack !== 'spfx')
            plan.issues.push({
              code: 'no-build',
              level: 'blocker',
              message: { key: 'upgrade.noBuild', params: { project: migration.id } },
            });
        }
      const blockers = [
        ...plan.issues,
        ...plan.projects.flatMap((project) => project.issues),
      ].filter((issue) => issue.level === 'blocker');
      if (options.json) {
        process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
        if (blockers.length > 0) process.exitCode = 1;
        return;
      }
      printPlan(plan, options.shared === true);
      if (blockers.length > 0) {
        await reviewAndApply(session, report, plan.fixes, { apply: false, command: 'upgrade' });
        console.error(t('upgrade.blocked', { count: blockers.length }));
        process.exitCode = 1;
        return;
      }
      const runsNpm = options.shared || options.install || options.verify || options.relock;
      if (options.apply && runsNpm && !plan.node)
        throw new Error(t('upgrade.nodeMissing', { version: plan.nodeVersion ?? '?' }));
      if (options.apply) {
        const files = plan.projects.flatMap((migration) => {
          const project = report.projects.find(
            (entry) => entry.project.id === migration.id,
          )?.project;
          return project
            ? [project.manifestPath, ...(project.lockfile ? [project.lockfile.path] : [])]
            : [];
        });
        const backupDir = await backupFiles(session.root, files);
        await journal(session.root, {
          command: 'upgrade:backup',
          projects: plan.order,
          result: 'ok',
          detail: path.relative(session.root, backupDir),
        });
      }
      const applied = await reviewAndApply(session, report, plan.fixes, {
        ...options,
        relock: options.shared ? false : (options.relock ?? false),
        command: 'upgrade',
      });
      if (!options.apply || !applied) return;
      const fresh = await runAnalysis(
        session,
        { ...options, security: false },
        { targetVersions: true },
      );
      const migrated = fresh.projects.filter((entry) => plan.order.includes(entry.project.id));
      if (options.shared) {
        const groups = planStore(fresh, { union: true }).groups.filter((group) =>
          group.projectIds.every((id) => plan.order.includes(id)),
        );
        const group = groups.find((item) => item.projectIds.length === migrated.length);
        if (!group) throw new Error(t('upgrade.sharedBlocked'));
        const result = await linkGroup(session.root, fresh, group, {
          replaceExisting: true,
          syncLocks: true,
          install: async (dir, node) =>
            (await runWithNode(node, dir, ['install', '--no-audit', '--no-fund'])).code,
        });
        for (const conflict of result.conflicts ?? []) console.log(`  ~ ${conflict}`);
        await journal(session.root, {
          command: 'upgrade:shared',
          projects: result.linked,
          result: 'ok',
          detail: path.relative(session.root, result.storeDir),
        });
      } else if (options.install || options.verify) {
        if (!plan.node)
          throw new Error(t('upgrade.nodeMissing', { version: plan.nodeVersion ?? '?' }));
        for (const id of plan.order) {
          const entry = migrated.find((project) => project.project.id === id);
          if (!entry) continue;
          console.log(`\n> ${id}: npm install (node ${plan.node.version})`);
          const result = await runWithNode(plan.node, entry.project.dir, [
            'install',
            '--no-audit',
            '--no-fund',
          ]);
          await journal(session.root, {
            command: 'upgrade:install',
            projects: [id],
            result: result.code === 0 ? 'ok' : 'failed',
          });
          if (result.code !== 0) {
            process.exitCode = result.code;
            return;
          }
        }
      }
      if (options.verify && plan.node)
        for (const id of plan.order) {
          const entry = migrated.find((project) => project.project.id === id);
          const migration = plan.projects.find((project) => project.id === id);
          if (!entry || !migration) continue;
          console.log(`\n> ${id}: npm run ${migration.verifyScript} (node ${plan.node.version})`);
          const result = await runWithNode(plan.node, entry.project.dir, [
            'run',
            migration.verifyScript,
          ]);
          await journal(session.root, {
            command: 'upgrade:verify',
            projects: [id],
            result: result.code === 0 ? 'ok' : 'failed',
            detail: `npm run ${migration.verifyScript}`,
          });
          if (result.code !== 0) process.exitCode = result.code;
        }
    });
}

function printPlan(plan: UpgradePlan, shared: boolean): void {
  console.log(t('upgrade.title'));
  for (const target of plan.targets)
    console.log(
      `  ${target.stack}: ${target.currentVersions.join(', ')} -> ${target.version} (${target.origin}, ${target.baseline}${target.toolchain ? `, ${target.toolchain}` : ''})`,
    );
  console.log(`  Node ${plan.nodeVersion ?? '?'}${plan.node ? '' : ' (not installed)'}`);
  if (shared) console.log(t('upgrade.sharedNotice'));
  console.log(t('upgrade.order', { projects: plan.order.join(' -> ') }));
  for (const issue of plan.issues) console.log(`  ${issue.level}: ${tm(issue.message)}`);
  for (const project of plan.projects) {
    console.log(`\n${project.id}: ${project.current} -> ${project.target}`);
    for (const issue of project.issues) console.log(`  ${issue.level}: ${tm(issue.message)}`);
    for (const issue of project.issues)
      if (issue.files?.length) console.log(`    ${issue.files.join(', ')}`);
  }
}

function checkShared(report: Report, plan: UpgradePlan): void {
  if (plan.targets.length !== 1 || plan.projects.length < 2) {
    plan.issues.push({
      code: 'shared-family',
      level: 'blocker',
      message: { key: 'upgrade.sharedBlocked' },
    });
    return;
  }
  const projects = plan.projects.flatMap((migration) => {
    const entry = report.projects.find((project) => project.project.id === migration.id);
    if (!entry) return [];
    const manifest = editedManifest(entry.project, migration.edits);
    const project: Project = {
      ...entry.project,
      manifest,
      dependencies: declaredDependencies(manifest),
    };
    return [
      { ...entry, project, node: { ...entry.node, ...(plan.node ? { selected: plan.node } : {}) } },
    ];
  });
  const simulated: Report = {
    ...report,
    projects,
    groups: [
      {
        name: 'upgrade',
        origin: 'config',
        projectIds: projects.map((entry) => entry.project.id),
        pins: {},
        baseline: true,
      },
    ],
  };
  const result = planStore(simulated, { union: true });
  if (!result.groups.some((group) => group.projectIds.length === projects.length))
    plan.issues.push({
      code: 'shared-excluded',
      level: 'blocker',
      message: { key: 'upgrade.sharedBlocked' },
    });
  if (projects.some((entry) => entry.project.lockfile && entry.project.lockfile.kind !== 'npm'))
    plan.issues.push({
      code: 'shared-lock',
      level: 'blocker',
      message: { key: 'upgrade.sharedNpm' },
    });
}
