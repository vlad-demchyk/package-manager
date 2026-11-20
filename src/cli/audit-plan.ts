import pc from 'picocolors';
import type { Report } from '../analyze.js';
import { t, tm } from '../i18n/index.js';
import type { Remediation, RemediationStatus } from '../security/remediation.js';

export interface PlanSummary {
  packages: number;
  /** Remediations with a fix `packman fix -f <fixId>` applies. */
  fixable: number;
  relock: number;
  blocked: number;
  noFix: number;
  unknown: number;
  byStatus: Record<RemediationStatus, number>;
}

export function summarizePlan(report: Report): PlanSummary {
  const items = report.projects.flatMap((entry) => entry.remediation ?? []);
  const byStatus: Record<RemediationStatus, number> = {
    relock: 0,
    direct: 0,
    parent: 0,
    override: 0,
    blocked: 0,
    'no-fix': 0,
    unknown: 0,
  };
  for (const item of items) byStatus[item.status]++;
  return {
    packages: items.length,
    fixable: items.filter((item) => item.fixId).length,
    relock: byStatus.relock,
    blocked: byStatus.blocked,
    noFix: byStatus['no-fix'],
    unknown: byStatus.unknown,
    byStatus,
  };
}

/** `packman audit --plan --json`: remediations per project with translated reasons. */
export function planJson(report: Report): unknown {
  return {
    root: report.root,
    advisories: report.data.advisories,
    summary: summarizePlan(report),
    projects: report.projects
      .filter((entry) => (entry.remediation ?? []).length > 0)
      .map((entry) => ({
        id: entry.project.id,
        remediation: (entry.remediation ?? []).map((item) => ({
          ...item,
          reason: tm(item.reason),
          reasonKey: item.reason.key,
        })),
      })),
  };
}

const ORDER: Remediation['severity'][] = ['critical', 'high', 'moderate', 'low', 'info'];

export function printPlan(report: Report): void {
  const summary = summarizePlan(report);
  console.log(pc.bold(t('audit.planTitle', { count: summary.packages })));
  for (const entry of report.projects) {
    const items = [...(entry.remediation ?? [])].sort(
      (a, b) =>
        ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.package.localeCompare(b.package),
    );
    if (items.length === 0) continue;
    console.log(pc.bold(`\n${entry.project.id}`));
    for (const item of items) {
      const color =
        item.status === 'blocked' || item.status === 'no-fix'
          ? pc.red
          : item.status === 'unknown'
            ? pc.dim
            : pc.green;
      const changes = item.changes
        .map((change) =>
          change.kind === 'override'
            ? `overrides["${change.key ?? change.package}"]=${change.to}`
            : `${change.package} ${change.from} -> ${change.to}`,
        )
        .join(', ');
      console.log(
        `  ${color(`[${item.status}${item.risk ? ` ${item.risk}` : ''}]`)} ${item.package}@${item.version}${item.target ? ` -> ${item.target}` : ''} ${pc.dim(`(${item.severity}, ${item.context})`)}${changes ? `  ${changes}` : ''}`,
      );
      console.log(pc.dim(`      ${tm(item.reason)}`));
      const chain = item.chains[0];
      if (chain && chain.length > 1) console.log(pc.dim(`      via ${chain.join(' > ')}`));
      if (item.fixId)
        console.log(
          pc.dim(`      packman fix -p ${entry.project.id} -f ${item.fixId} --risk ${item.risk}`),
        );
    }
  }
  console.log(
    `\n${t('audit.planSummary', {
      fixable: summary.fixable,
      relock: summary.relock,
      blocked: summary.blocked,
      noFix: summary.noFix,
      unknown: summary.unknown,
    })}`,
  );
  if (summary.packages > 0) console.log(pc.yellow(t('audit.buildNote')));
}
