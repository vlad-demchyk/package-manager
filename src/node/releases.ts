import semver from 'semver';
import { loadData } from '../core/data.js';

interface NodeLine {
  start: string;
  lts: string | null;
  maintenance: string | null;
  end: string;
  codename: string | null;
  latest: string | null;
  latestSecurity: string | null;
}

interface NodeData {
  fetchedAt: string;
  lines: Record<string, NodeLine>;
}

export interface NodeVuln {
  id: string;
  cve: string[];
  vulnerable: string;
  patched: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  description: string;
  ref: string | null;
  affectedEnvironments: string[];
}

interface NodeVulnData {
  fetchedAt: string;
  source: string;
  vulns: NodeVuln[];
}

export type NodePhase = 'current' | 'active-lts' | 'maintenance-lts' | 'eol' | 'unknown';

export interface NodeLineStatus {
  major: number;
  phase: NodePhase;
  end?: string;
  latest?: string;
  codename?: string;
}

export function nodeDataDate(): string {
  return loadData<NodeData>('node.json').fetchedAt;
}

export function nodeLineStatus(version: string, today = new Date()): NodeLineStatus {
  const parsed = semver.coerce(version);
  if (!parsed) return { major: Number.NaN, phase: 'unknown' };
  const line = loadData<NodeData>('node.json').lines[String(parsed.major)];
  if (!line) return { major: parsed.major, phase: 'unknown' };

  const day = today.toISOString().slice(0, 10);
  let phase: NodePhase;
  if (day > line.end) phase = 'eol';
  else if (line.maintenance && day >= line.maintenance) phase = 'maintenance-lts';
  else if (line.lts && day >= line.lts) phase = 'active-lts';
  else phase = 'current';

  const status: NodeLineStatus = { major: parsed.major, phase, end: line.end };
  if (line.latest) status.latest = line.latest;
  if (line.codename) status.codename = line.codename;
  return status;
}

/** Known core vulnerabilities affecting an exact Node version and not patched in it. */
export function nodeVulnerabilities(version: string): NodeVuln[] {
  const clean = semver.clean(version) ?? semver.coerce(version)?.version;
  if (!clean) return [];
  const data = loadData<NodeVulnData>('node-vulns.json');
  return data.vulns.filter((vuln) => {
    if (!safeSatisfies(clean, vuln.vulnerable)) return false;
    return !(vuln.patched && safeSatisfies(clean, vuln.patched));
  });
}

export function nodeVulnDataInfo(): { fetchedAt: string; source: string } {
  const { fetchedAt, source } = loadData<NodeVulnData>('node-vulns.json');
  return { fetchedAt, source };
}

/** Latest release of the same major line, or undefined when the line is EOL. */
export function latestInLine(version: string): string | undefined {
  const status = nodeLineStatus(version);
  return status.phase === 'eol' ? undefined : status.latest;
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range);
  } catch {
    return false;
  }
}
