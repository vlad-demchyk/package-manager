import path from 'node:path';
import type { Report } from '../analyze.js';
import type { Finding, Severity } from '../core/types.js';
import { t, tm } from '../i18n/index.js';

export type Summary = Record<Severity, number>;

export function summarize(findings: Finding[]): Summary {
  const summary: Summary = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const item of findings) summary[item.severity]++;
  return summary;
}

export function allFindings(report: Report): Finding[] {
  return [...report.workspaceFindings, ...report.projects.flatMap((project) => project.findings)];
}

export function dataLine(report: Report): string {
  const advisories = report.data.advisories.checked
    ? `${report.data.advisories.source} ${report.data.advisories.fetchedAt?.slice(0, 10) ?? ''}`.trim()
    : t('report.advisoriesSkipped', { reason: report.data.advisories.error ?? 'disabled' });
  return t('report.data', {
    spfx: report.data.spfx,
    node: report.data.node,
    nodeVulns: report.data.nodeVulns,
    advisories,
  });
}

/** Serializable report with translated messages, for `--json` and integrations. */
export function toJson(report: Report): unknown {
  const serializeFinding = (item: Finding): unknown => ({
    ruleId: item.ruleId,
    severity: item.severity,
    projectId: item.projectId,
    message: tm(item.message),
    key: item.message.key,
    params: item.message.params ?? {},
    evidence: item.evidence,
    tags: item.tags,
    fixes: item.fixes.map((entry) => ({
      id: entry.id,
      title: tm(entry.title),
      risk: entry.risk,
      edits: entry.edits.map((edit) => ({ ...edit, file: path.relative(report.root, edit.file) })),
    })),
  });
  return {
    root: report.root,
    generatedAt: report.generatedAt,
    data: report.data,
    summary: summarize(allFindings(report)),
    installedNodes: report.installedNodes.map((node) => ({
      version: node.version,
      manager: node.manager,
    })),
    groups: report.groups,
    workspaceFindings: report.workspaceFindings.map(serializeFinding),
    projects: report.projects.map((entry) => ({
      id: entry.project.id,
      name: entry.project.name,
      stacks: entry.stacks.map((stack) => ({
        provider: stack.provider,
        version: stack.version,
        confidence: stack.confidence,
        evidence: stack.evidence,
        details: stack.details,
      })),
      node: {
        effective: entry.node.effective,
        recommended: entry.node.recommended,
        selected: entry.node.selected
          ? { version: entry.node.selected.version, manager: entry.node.selected.manager }
          : undefined,
        requirements: entry.node.requirements.map((req) => ({
          range: req.range,
          source: req.source,
        })),
      },
      exposure: entry.exposure,
      network: entry.network,
      summary: summarize(entry.findings),
      findings: entry.findings.map(serializeFinding),
    })),
  };
}
