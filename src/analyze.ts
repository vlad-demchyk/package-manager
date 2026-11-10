import type { PackmanConfig } from './core/config.js';
import picomatch from 'picomatch';
import path from 'node:path';
import { finding, msg, sortFindings } from './core/findings.js';
import type {
  Constraint,
  ExposureContext,
  Finding,
  Project,
  StackInfo,
  Workspace,
} from './core/types.js';
import { satisfies, resolveVersion, isRegistrySpec } from './core/versions.js';
import { isTopLevel } from './core/lockfile.js';
import { planNode, type NodePlan } from './node/plan.js';
import { nodeDataDate, nodeVulnDataInfo } from './node/releases.js';
import { readNodeRequirements } from './node/requirement.js';
import { listInstalledNodes, type InstalledNode } from './node/toolchain.js';
import {
  buildGroups,
  groupFindings,
  primaryStack,
  type GroupMember,
  type VersionGroup,
} from './policy/groups.js';
import { profileFindings } from './policy/profiles.js';
import { targetFindings } from './policy/target.js';
import { migrationStack, newestProject, stackVersion } from './upgrade/targets.js';
import {
  describeDrift,
  linkDrift,
  manifestKey,
  readLinks,
  type LinkRecord,
} from './store/store.js';
import {
  angularProvider,
  electronProvider,
  eslintProvider,
  jestProvider,
  nextProvider,
  reactProvider,
  typescriptProvider,
  viteProvider,
  vitestProvider,
  vueProvider,
} from './providers/frameworks.js';
import { annotateBreakingFixes } from './fixes/breaks.js';
import { apiSplitFindings, checkApiMigration } from './providers/api.js';
import { checkDuplicateDeclarations, checkUsage, npmProvider } from './providers/npm.js';
import { spfxProvider } from './providers/spfx/index.js';
import { spfxMatrix } from './providers/spfx/matrix.js';
import type { ProjectContext, StackProvider } from './providers/types.js';
import { configReferences } from './scan/implicit.js';
import { scanSources, type SourceScan } from './scan/sources.js';
import {
  collectPackageVersions,
  fetchAdvisories,
  projectVulnerabilities,
  type AdvisoryStatus,
} from './security/advisories.js';
import {
  exposureOf,
  networkUsage,
  nodeVulnerabilityFindings,
  packageVulnerabilityFindings,
  type NetworkUsage,
} from './security/exposure.js';

export const PROVIDERS: StackProvider[] = [
  npmProvider,
  spfxProvider,
  reactProvider,
  typescriptProvider,
  viteProvider,
  nextProvider,
  angularProvider,
  vueProvider,
  electronProvider,
  eslintProvider,
  jestProvider,
  vitestProvider,
];

export interface AnalyzeOptions {
  config: PackmanConfig;
  /** Never touch the network (advisories come from cache only). */
  offline?: boolean;
  /** Query npm advisories for package vulnerabilities. */
  security?: boolean;
  /** Scan sources for undeclared/unused imports and network usage. */
  usage?: boolean;
  /** Plan npm against the desired manifest, ignoring installed/locked roots that no longer satisfy it. */
  targetVersions?: boolean;
  today?: Date;
  installedNodes?: InstalledNode[];
  fetchImpl?: typeof fetch;
  onProgress?: (done: number, total: number, projectId: string) => void;
}

export interface ProjectReport {
  project: Project;
  stacks: StackInfo[];
  constraints: Constraint[];
  node: NodePlan;
  exposure: ExposureContext;
  network: NetworkUsage;
  /** Packages the stacks need without importing them (SPFx core, build tools); linked by the store. */
  implicit: string[];
  /** Packages imported by source and style files, declared or not. */
  imports: string[];
  /** Package names referenced as strings in config files (.eslintrc.js, gulpfile.js, config/*.json). */
  configReferences: string[];
  /** API-break pattern id (`data/api-breaks.json`) -> `file:line` places in the source scan. */
  apiUsage: Record<string, string[]>;
  findings: Finding[];
}

export interface Report {
  root: string;
  generatedAt: string;
  projects: ProjectReport[];
  groups: VersionGroup[];
  /** Findings that span several projects (group divergence, pins). */
  workspaceFindings: Finding[];
  installedNodes: InstalledNode[];
  links?: LinkRecord[];
  data: { spfx: string; node: string; nodeVulns: string; advisories: AdvisoryStatus };
}

export async function analyze(workspace: Workspace, options: AnalyzeOptions): Promise<Report> {
  const today = options.today ?? new Date();
  const installedNodes = options.installedNodes ?? (await listInstalledNodes());
  const disabled = new Set(options.config.checks.disabled);
  const reports: ProjectReport[] = [];

  let index = 0;
  for (const project of workspace.projects) {
    options.onProgress?.(index++, workspace.projects.length, project.id);
    reports.push(
      await analyzeProject(
        workspace,
        options.targetVersions ? targetProject(project) : project,
        options,
        installedNodes,
        today,
      ),
    );
  }

  let advisoryStatus: AdvisoryStatus = { checked: false, source: 'none' };
  if (options.security !== false) {
    const { advisories, status } = await fetchAdvisories(
      collectPackageVersions(workspace.projects),
      {
        offline: options.offline ?? false,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
    );
    advisoryStatus = status;
    for (const report of reports) {
      const vulns = projectVulnerabilities(report.project, advisories);
      report.findings.push(
        ...packageVulnerabilityFindings(report.project, vulns, report.exposure, report.network),
      );
    }
  }

  const members: GroupMember[] = reports.map((report) => {
    const member: GroupMember = { project: report.project, stacks: report.stacks };
    if (report.node.recommended) member.nodeRecommended = report.node.recommended;
    return member;
  });
  const groups = buildGroups(members, options.config.policy.groups);
  const workspaceFindings = groups.flatMap((group) => groupFindings(group, members));
  if (options.usage !== false) workspaceFindings.push(...apiSplitFindings(reports));
  for (const stack of new Set(reports.map(migrationStack))) {
    const baseline = newestProject(reports, stack);
    const version = baseline ? stackVersion(baseline, stack) : undefined;
    if (
      baseline &&
      version &&
      reports.some(
        (entry) => migrationStack(entry) === stack && stackVersion(entry, stack) !== version,
      )
    )
      workspaceFindings.push(
        finding(
          'policy/repository-target',
          'info',
          undefined,
          msg('target.repository', { stack, version, project: baseline.project.id }),
          { tags: ['target', 'upgrade'], evidence: [`packman upgrade --stack ${stack}`] },
        ),
      );
  }
  const distinctNode = new Set(groups.map((group) => group.node?.split('.')[0]).filter(Boolean));
  if (distinctNode.size > 1) {
    workspaceFindings.push(
      finding(
        'policy/node-fragmentation',
        'info',
        undefined,
        msg('policy.nodeFragmentation', { count: distinctNode.size }),
        {
          evidence: groups.map((group) => `${group.name}: ${group.projectIds.length}`),
          tags: ['node', 'group'],
        },
      ),
    );
  }

  const links = await readLinks(workspace.root);
  for (const report of reports) {
    report.findings.push(...targetFindings(report, options.config));
    report.findings.push(...(await linkFindings(workspace.root, report, links)));
    report.findings = sortFindings(report.findings.filter((item) => !disabled.has(item.ruleId)));
  }
  // A version edit that crosses a documented API break is breaking, whatever rule proposed it.
  annotateBreakingFixes(
    [...workspaceFindings, ...reports.flatMap((entry) => entry.findings)],
    reports,
  );
  return {
    root: workspace.root,
    generatedAt: today.toISOString(),
    projects: reports,
    groups,
    workspaceFindings: sortFindings(workspaceFindings.filter((item) => !disabled.has(item.ruleId))),
    installedNodes,
    links,
    data: {
      spfx: spfxMatrix().verifiedAt,
      node: nodeDataDate(),
      nodeVulns: nodeVulnDataInfo().fetchedAt,
      advisories: advisoryStatus,
    },
  };
}

function targetProject(project: Project): Project {
  const accepted = (name: string, version: string): boolean => {
    const declared = project.dependencies.find((dependency) => dependency.name === name);
    return !declared || !isRegistrySpec(declared.spec) || satisfies(version, declared.spec);
  };
  return {
    ...project,
    installed: Object.fromEntries(
      Object.entries(project.installed).filter(([name, version]) => accepted(name, version)),
    ),
    ...(project.lockfile
      ? {
          lockfile: {
            ...project.lockfile,
            packages: project.lockfile.packages.filter(
              (pkg) => !isTopLevel(pkg) || accepted(pkg.name, pkg.version),
            ),
          },
        }
      : {}),
  };
}

async function analyzeProject(
  workspace: Workspace,
  project: Project,
  options: AnalyzeOptions,
  installedNodes: InstalledNode[],
  today: Date,
): Promise<ProjectReport> {
  let scan: Promise<SourceScan> | undefined;
  const stacks = new Map<string, StackInfo>();
  const ctx: ProjectContext = {
    workspace,
    project,
    config: options.config,
    nodeRequirements: await readNodeRequirements(project, workspace.root),
    stacks,
    sources: () => (scan ??= scanSources(project.dir, options.config.checks.ignorePaths)),
  };

  const active: { provider: StackProvider; stack: StackInfo }[] = [];
  for (const provider of PROVIDERS) {
    const stack = await provider.detect(ctx);
    if (stack) {
      stacks.set(provider.id, stack);
      active.push({ provider, stack });
    }
  }

  const findings: Finding[] = [];
  if (options.config.target.node)
    ctx.nodeRequirements.push({
      range: options.config.target.node,
      source: 'target',
      file: path.join(workspace.root, 'packman.config.json'),
      pinned: true,
    });
  const configuredGroup = options.config.policy.groups.find(
    (group) =>
      picomatch(group.projects)(project.id) &&
      (!group.stack || group.stack === (primaryStack([...stacks.values()])?.provider ?? 'node')),
  );
  if (configuredGroup?.node) {
    ctx.nodeRequirements.push({
      range: configuredGroup.node,
      source: 'policy.groups',
      file: path.join(workspace.root, 'packman.config.json'),
      pinned: true,
    });
  }
  const constraints: Constraint[] = [];
  const implicit: string[] = [];
  const virtual: string[] = [];
  for (const { provider, stack } of active) {
    constraints.push(...(provider.constraints?.(ctx, stack) ?? []));
    implicit.push(...((await provider.implicitlyUsed?.(ctx, stack)) ?? []));
    if (provider.virtualModules) virtual.push(...(await provider.virtualModules(ctx, stack)));
    findings.push(...((await provider.check?.(ctx, stack)) ?? []));
  }
  findings.push(...packageConstraintFindings(project, constraints, findings));
  findings.push(...(await profileFindings(ctx)));
  if (options.usage !== false) {
    findings.push(...(await checkUsage(ctx, implicit, virtual)));
    findings.push(...(await checkApiMigration(ctx)));
  } else {
    findings.push(...checkDuplicateDeclarations(project, new Map()));
  }

  const { plan, findings: nodeFindings } = planNode(
    project,
    ctx.nodeRequirements,
    constraints,
    installedNodes,
    today,
  );
  findings.push(...nodeFindings);

  const stackList = [...stacks.values()];
  const exposure = exposureOf(stackList, project);
  const network = networkUsage(project, options.usage === false ? undefined : await ctx.sources());
  if (plan.selected) {
    findings.push(
      ...nodeVulnerabilityFindings(project, plan.selected.version, plan.vulns, exposure),
    );
  }
  return {
    project,
    stacks: stackList,
    constraints,
    node: plan,
    exposure,
    network,
    implicit: [...new Set(implicit)].sort(),
    imports: options.usage === false ? [] : [...(await ctx.sources()).imports.keys()].sort(),
    configReferences: await configReferences(project.dir),
    apiUsage: options.usage === false ? {} : Object.fromEntries((await ctx.sources()).api),
    findings,
  };
}

/** Generic evaluation of package constraints not already reported by a provider rule. */
function packageConstraintFindings(
  project: Project,
  constraints: Constraint[],
  existing: Finding[],
): Finding[] {
  // Packages another rule already reported: `name: ...` evidence, or `x requires name@range` peers.
  const reported = new Set(
    existing.flatMap((item) =>
      item.evidence.flatMap((line) => [
        line.split(':')[0],
        ...(/ requires ((?:@[^/\s]+\/)?[^@\s]+)@/.exec(line)?.slice(1) ?? []),
      ]),
    ),
  );
  const findings: Finding[] = [];
  for (const constraint of constraints) {
    if (constraint.kind !== 'package' || reported.has(constraint.name)) continue;
    const resolved = resolveVersion(project, constraint.name);
    if (resolved && !satisfies(resolved.version, constraint.range)) {
      findings.push(
        finding(
          'constraint/package',
          'error',
          project,
          msg('constraint.package', {
            name: constraint.name,
            version: resolved.version,
            range: constraint.range,
            source: constraint.source,
          }),
          {
            tags: ['compatibility'],
          },
        ),
      );
    }
  }
  return findings;
}

/** A linked project whose manifest or node_modules no longer matches what packman linked. */
async function linkFindings(
  root: string,
  report: ProjectReport,
  links: LinkRecord[],
): Promise<Finding[]> {
  const link = links.find((entry) => entry.projectId === report.project.id);
  if (!link) return [];
  const relink = `packman store link --of ${link.projectId}${link.mode === 'packages' ? ' --union' : ''}`;
  const out: Finding[] = [];
  if (manifestKey(report.project.manifest) !== (link.manifestKey ?? link.key.slice(0, 16)))
    out.push(
      finding('store/link-stale', 'warning', report.project, msg('store.linkStale'), {
        tags: ['store'],
        evidence: ['packman store plan --union', relink],
      }),
    );
  const drift = await linkDrift(root, link);
  if (drift)
    out.push(
      finding('store/link-drift', 'error', report.project, msg('store.linkDrift'), {
        tags: ['store'],
        evidence: [describeDrift(drift), relink],
      }),
    );
  return out;
}
