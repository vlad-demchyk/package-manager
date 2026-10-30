import pc from 'picocolors';
import type { Report } from '../analyze.js';
import type { Finding, Severity } from '../core/types.js';
import { t, tm } from '../i18n/index.js';
import { allFindings, dataLine, summarize } from './model.js';

const COLORS: Record<Severity, (text: string) => string> = {
  critical: (text) => pc.bold(pc.red(text)),
  error: pc.red,
  warning: pc.yellow,
  info: pc.cyan,
};

const ICONS: Record<Severity, string> = { critical: '!!', error: 'x', warning: '!', info: 'i' };

export interface TextOptions {
  /** Minimum severity to print. */
  minSeverity?: Severity;
  verbose?: boolean;
}

const ORDER: Severity[] = ['critical', 'error', 'warning', 'info'];

export function renderText(report: Report, options: TextOptions = {}): string {
  const min = ORDER.indexOf(options.minSeverity ?? 'info');
  const visible = (item: Finding): boolean => ORDER.indexOf(item.severity) <= min;
  const lines: string[] = [];
  lines.push(pc.bold(`${t('report.title')} - ${report.root}`));
  lines.push(pc.dim(dataLine(report)));
  lines.push('');

  lines.push(pc.bold(t('report.groups')));
  for (const group of report.groups) {
    const badge = group.baseline ? pc.green(` [${t('report.baseline')}]`) : '';
    lines.push(
      `  ${group.name}${badge}  ${pc.dim(`${group.projectIds.length} ${t('report.projects').toLowerCase()}`)}`,
    );
  }
  lines.push('');

  const workspace = report.workspaceFindings.filter(visible);
  if (workspace.length > 0) {
    lines.push(pc.bold(t('report.workspaceFindings')));
    for (const item of workspace) lines.push(...renderFinding(item, options.verbose ?? false));
    lines.push('');
  }

  for (const entry of report.projects) {
    const findings = entry.findings.filter(visible);
    const stacks = entry.stacks
      .filter((stack) => stack.provider !== 'npm')
      .map((stack) => `${stack.provider}${stack.version ? `@${stack.version}` : ''}`)
      .join(', ');
    const node = entry.node.selected
      ? t('report.nodeSelected', {
          version: entry.node.selected.version,
          manager: entry.node.selected.manager,
        })
      : t('report.nodeNone');
    const recommended = entry.node.recommended
      ? `, ${t('report.nodeRecommended', { version: entry.node.recommended })}`
      : '';
    const counts = summarize(entry.findings);
    const header = `${pc.bold(entry.project.id)} ${pc.dim(`(${stacks || 'node'})`)}`;
    const status =
      counts.critical + counts.error > 0
        ? pc.red('x')
        : counts.warning > 0
          ? pc.yellow('!')
          : pc.green('ok');
    lines.push(`${status} ${header}`);
    lines.push(
      pc.dim(
        `    ${t('report.node')}: ${node}${recommended} | ${t('report.exposure')}: ${t(`exposure.${entry.exposure}`)}${entry.network.used ? ` | ${t('report.network')}` : ''}`,
      ),
    );
    for (const item of findings) lines.push(...renderFinding(item, options.verbose ?? false));
    if (findings.length > 0) lines.push('');
  }

  const total = summarize(allFindings(report));
  lines.push(pc.bold(t('report.summary', { ...total })));
  return lines.join('\n');
}

function renderFinding(item: Finding, verbose: boolean): string[] {
  const color = COLORS[item.severity];
  const lines = [
    `    ${color(`${ICONS[item.severity]} ${tm(item.message)}`)} ${pc.dim(item.ruleId)}`,
  ];
  const evidence = verbose ? item.evidence : item.evidence.slice(0, 4);
  for (const line of evidence) lines.push(pc.dim(`        ${line}`));
  if (!verbose && item.evidence.length > evidence.length)
    lines.push(pc.dim(`        ... +${item.evidence.length - evidence.length}`));
  for (const entry of item.fixes)
    lines.push(pc.green(`        -> ${tm(entry.title)} ${pc.dim(`[${entry.id}, ${entry.risk}]`)}`));
  return lines;
}
