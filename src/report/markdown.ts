import type { Report } from '../analyze.js';
import type { Finding } from '../core/types.js';
import { t, tm } from '../i18n/index.js';
import { allFindings, dataLine, summarize } from './model.js';

const escape = (text: string): string => text.replace(/\|/g, '\\|');

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(
    `# ${t('report.title')}`,
    '',
    `${t('report.workspace')}: \`${report.root}\``,
    '',
    dataLine(report),
    '',
  );
  lines.push(t('report.summary', { ...summarize(allFindings(report)) }), '');

  lines.push(
    `## ${t('report.groups')}`,
    '',
    `| ${t('report.groups')} | ${t('report.projects')} | Node |`,
    '|---|---|---|',
  );
  for (const group of report.groups) {
    lines.push(
      `| ${escape(group.name)}${group.baseline ? ` (${t('report.baseline')})` : ''} | ${group.projectIds.length} | ${group.node ?? '-'} |`,
    );
  }
  lines.push('');

  if (report.workspaceFindings.length > 0) {
    lines.push(`## ${t('report.workspaceFindings')}`, '');
    for (const item of report.workspaceFindings) lines.push(...findingLines(item));
    lines.push('');
  }

  lines.push(`## ${t('report.projects')}`, '');
  lines.push(
    `| ${t('report.projects')} | ${t('report.stacks')} | Node | ${t('report.exposure')} | ${t('report.findings')} |`,
    '|---|---|---|---|---|',
  );
  for (const entry of report.projects) {
    const counts = summarize(entry.findings);
    const stacks = entry.stacks
      .filter((s) => s.provider !== 'npm')
      .map((s) => `${s.provider}${s.version ? ` ${s.version}` : ''}`)
      .join(', ');
    lines.push(
      `| ${escape(entry.project.id)} | ${escape(stacks || '-')} | ${entry.node.selected?.version ?? '-'} / ${entry.node.recommended ?? '-'} | ${t(`exposure.${entry.exposure}`)} | ${counts.critical}/${counts.error}/${counts.warning}/${counts.info} |`,
    );
  }
  lines.push('');

  for (const entry of report.projects) {
    if (entry.findings.length === 0) continue;
    lines.push(`### ${entry.project.id}`, '');
    for (const item of entry.findings) lines.push(...findingLines(item));
    lines.push('');
  }
  return lines.join('\n');
}

function findingLines(item: Finding): string[] {
  const lines = [`- **${t(`severity.${item.severity}`)}** ${tm(item.message)} \`${item.ruleId}\``];
  for (const line of item.evidence) lines.push(`  - ${line}`);
  for (const entry of item.fixes)
    lines.push(`  - ${t('report.fixes')}: ${tm(entry.title)} (\`${entry.id}\`, ${entry.risk})`);
  return lines;
}
