import path from 'node:path';
import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type { Report } from '../analyze.js';
import { declaredDependencies } from '../core/discovery.js';
import type { Project, Risk } from '../core/types.js';
import { runWithNode } from '../exec/run.js';
import { collectEdits } from '../fixes/apply.js';
import { t, tm } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import { nodeSetup } from '../ops/node-setup.js';
import { planStore, readLinks } from '../store/store.js';
import { projectFilesOf, restoreSnapshot, takeSnapshot, type Snapshot } from '../store/switch.js';
import { editedManifest, planUpgrade } from '../upgrade/plan.js';
import type { UpgradePlan } from '../upgrade/types.js';
import { openSession, runAnalysis, type CommonOptions, type Session } from './context.js';
import { commonOptions, recordVerifiedBuilds, reviewAndApply, type BuildResult } from './shared.js';
import { prepareNodes, runSync, switchStale, type SyncStep } from '../ops/sync.js';

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
  verify?: boolean | string;
  policy?: boolean;
  installNode?: boolean;
  sync?: boolean;
  risk?: Risk;
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
    .option('--relock', 'regenerate lockfiles of all migrated projects')
    .option('--no-relock', 'keep lockfiles unchanged (default: relock after version edits)')
    .option('--install', 'install migrated projects')
    .option(
      '--shared',
      'install once, delete local modules and link the migrated group; back up manifests/locks only',
    )
    .option(
      '--verify [script]',
      'install and run the build/test script (or this one) of every migrated project',
    )
    .option(
      '--no-policy',
      'do not write targets, profiles or groups to packman.config.json (migrate the projects only)',
    )
    .option(
      '--install-node',
      'install a missing target Node with the detected manager (never switches the active Node)',
    )
    .option('--sync', 'after the migration, run `packman sync` passes (fix, store, build, check)')
    .addOption(
      new Option('--risk <level>', 'with --sync: highest fix risk to apply')
        .choices(['safe', 'review', 'breaking'])
        .default('safe'),
    )
    .option('-y, --yes', 'do not ask for confirmation')
    .action(async (root: string, options: UpgradeCliOptions) => {
      if (options.json && options.apply) throw new Error(t('upgrade.jsonReadOnly'));
      const session = await openSession(root, options);
      let { report, plan, linkedGroup } = await planFor(session, options);
      if (plan.projects.length === 0) throw new Error(t('upgrade.noProjects'));
      // A missing target Node: the exact command that installs it, run only with --install-node.
      if (!plan.node && plan.nodeVersion && !options.json) {
        const ready = await prepareNodes(
          new Map([[plan.nodeVersion, plan.order]]),
          report,
          {
            ...(options.apply ? { apply: true } : {}),
            ...(options.installNode ? { installNode: true } : {}),
          },
          [],
        );
        if (ready && options.installNode && options.apply)
          ({ report, plan, linkedGroup } = await planFor(session, options));
      }
      const shared = options.shared === true || linkedGroup;
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
      if (linkedGroup) console.log(t('upgrade.linkedSwitch', { count: plan.order.length }));
      if (blockers.length > 0) {
        await reviewAndApply(session, report, plan.fixes, { apply: false, command: 'upgrade' });
        console.error(t('upgrade.blocked', { count: blockers.length }));
        process.exitCode = 1;
        return;
      }
      // Version edits relock by default unless --no-relock (shared mode writes locks from the store).
      const relocks = !shared && options.relock !== false;
      const runsNpm = shared || options.install || options.verify || relocks;
      if (options.apply && runsNpm && !plan.node)
        throw new Error(t('upgrade.nodeMissing', { version: plan.nodeVersion ?? '?' }));
      let snapshot: Snapshot | undefined;
      const previous = await readLinks(session.root);
      if (options.apply) {
        const dirs = plan.projects.flatMap((migration) => {
          const project = report.projects.find(
            (entry) => entry.project.id === migration.id,
          )?.project;
          return project ? [project.dir] : [];
        });
        // Every file the migration edits (tsconfig, config/*.json, packman.config.json, ...) and the
        // manifests and locks the store switch rewrites.
        snapshot = await takeSnapshot(session.root, [
          ...projectFilesOf(dirs),
          ...collectEdits(plan.fixes).map((edit) => edit.file),
        ]);
        await journal(session.root, {
          command: 'upgrade:backup',
          projects: plan.order,
          result: 'ok',
          detail: path.relative(session.root, snapshot.dir),
        });
      }
      const applied = await reviewAndApply(session, report, plan.fixes, {
        ...options,
        relock: shared ? false : options.relock,
        command: 'upgrade',
      });
      if (!options.apply || !applied || !snapshot) return;
      const fresh = await runAnalysis(
        session,
        { ...options, security: false },
        { targetVersions: true },
      );
      const migrated = fresh.projects.filter((entry) => plan.order.includes(entry.project.id));
      const script =
        typeof options.verify === 'string'
          ? options.verify
          : options.verify
            ? (plan.projects[0]?.verifyScript ?? 'build')
            : undefined;
      if (shared) {
        const group = planStore(fresh, { union: true }).groups.find(
          (item) =>
            item.projectIds.length === migrated.length &&
            item.projectIds.every((id) => plan.order.includes(id)),
        );
        if (!group) {
          // Nothing was installed or linked yet: the migration goes back with the manifests.
          await restoreSnapshot(snapshot);
          throw new Error(t('upgrade.sharedBlocked'));
        }
        const steps: SyncStep[] = [];
        const switched = await switchStale(session, fresh, previous, snapshot, {
          ...(script ? { script } : {}),
          ...(options.shared ? { replaceExisting: true } : {}),
          command: 'upgrade:shared',
          steps,
          projectIds: group.projectIds,
        });
        for (const step of steps)
          console.log(
            `${step.status === 'ok' ? pc.green(step.status) : pc.red(step.status)} ${step.step}${step.detail ? `  ${step.detail}` : ''}`,
          );
        if (!switched) {
          process.exitCode = 1;
          return;
        }
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
        const results: BuildResult[] = [];
        if (options.verify)
          for (const id of plan.order) {
            const entry = migrated.find((project) => project.project.id === id);
            const migration = plan.projects.find((project) => project.id === id);
            if (!entry || !migration) continue;
            const run =
              typeof options.verify === 'string' ? options.verify : migration.verifyScript;
            console.log(`\n> ${id}: npm run ${run} (node ${plan.node.version})`);
            const result = await runWithNode(plan.node, entry.project.dir, ['run', run]);
            await journal(session.root, {
              command: 'upgrade:verify',
              projects: [id],
              result: result.code === 0 ? 'ok' : 'failed',
              detail: `npm run ${run}`,
            });
            if (result.code !== 0) process.exitCode = result.code;
            results.push({
              project: entry.project,
              node: plan.node.version,
              script: run,
              ok: result.code === 0,
            });
          }
        await recordVerifiedBuilds(session.root, results);
      }
      if (options.sync && !process.exitCode) {
        const ok = await runSync(session, {
          ...options,
          apply: true,
          script: script ?? plan.projects[0]?.verifyScript ?? 'build',
          risk: options.risk ?? 'safe',
        });
        if (!ok) process.exitCode = 1;
      }
    });
}

/**
 * The analysis and migration plan. Projects already linked to a shared store are migrated with
 * their group: the plan has no `linked` blocker, and applying it switches the group to a new store
 * ({@link switchStale}: prepare, relink, build, roll back on failure) instead of asking for an
 * unlink first.
 */
async function planFor(
  session: Session,
  options: UpgradeCliOptions,
): Promise<{ report: Report; plan: UpgradePlan; linkedGroup: boolean }> {
  const report = await runAnalysis(
    session,
    { ...options, security: false },
    { targetVersions: true },
  );
  const linked = new Set(
    report.projects
      .filter((entry) => entry.project.nodeModules === 'link')
      .map((entry) => entry.project.id),
  );
  const plan = await planUpgrade(report, {
    config: session.loaded.config,
    offline: options.offline ?? false,
    ...(options.stack ? { stack: options.stack } : {}),
    ...(options.to ? { to: options.to } : {}),
    ...(options.node ? { node: options.node } : {}),
    persistTarget: !options.project && !options.exclude,
    shared: options.shared === true || linked.size > 0,
    policy: options.policy !== false,
  });
  if (!plan.node && plan.nodeVersion) {
    const setup = nodeSetup(plan.nodeVersion, report.installedNodes);
    plan.nodeSetup = {
      command: setup.display,
      ...(setup.manager ? { manager: setup.manager } : {}),
      note: setup.note,
    };
  }
  const linkedIds = plan.order.filter((id) => linked.has(id));
  const linkedGroup = linkedIds.length > 0;
  if (linkedGroup) {
    // A store is switched as a whole, and only linked members switch without --shared.
    const links = report.links ?? [];
    const outside = links
      .filter(
        (link) =>
          !plan.order.includes(link.projectId) &&
          links.some(
            (other) => other.target === link.target && linkedIds.includes(other.projectId),
          ),
      )
      .map((link) => link.projectId);
    if (outside.length > 0)
      plan.issues.push({
        code: 'linked-partial',
        level: 'blocker',
        message: { key: 'upgrade.linkedPartial', params: { projects: outside.join(', ') } },
      });
    const unlinked = plan.order.filter((id) => !linked.has(id));
    if (unlinked.length > 0 && !options.shared)
      plan.issues.push({
        code: 'linked-mixed',
        level: 'blocker',
        message: { key: 'upgrade.linkedMixed', params: { projects: unlinked.join(', ') } },
      });
  }
  if (options.shared || linkedGroup) checkShared(report, plan);
  if (options.verify)
    for (const migration of plan.projects) {
      const project = report.projects.find((entry) => entry.project.id === migration.id)?.project;
      const script = typeof options.verify === 'string' ? options.verify : migration.verifyScript;
      if (!project?.manifest.scripts?.[script] && migration.stack !== 'spfx')
        plan.issues.push({
          code: 'no-build',
          level: 'blocker',
          message: { key: 'upgrade.noBuild', params: { project: migration.id } },
        });
    }
  return { report, plan, linkedGroup };
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
    if (project.codeChanges.length > 0) {
      console.log(`  ${t('upgrade.codeChanges')}`);
      for (const change of project.codeChanges) {
        console.log(
          `    ${change.package} ${change.from} -> ${change.to}: ${change.title}${change.verified ? '' : ' (unverified)'}`,
        );
        console.log(`      ${change.guide}`);
        for (const place of change.places.slice(0, 8)) console.log(`      ${place}`);
        if (change.places.length > 8) console.log(`      ... +${change.places.length - 8}`);
        if (change.places.length === 0) console.log(`      ${t('upgrade.noOldApi')}`);
        for (const step of change.steps) console.log(`      -> ${step}`);
      }
    }
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
