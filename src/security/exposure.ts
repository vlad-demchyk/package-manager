import { loadData } from '../core/data.js';
import { finding, msg } from '../core/findings.js';
import type { ExposureContext, Finding, Project, Severity, StackInfo } from '../core/types.js';
import type { NodeVuln } from '../node/releases.js';
import type { SourceScan } from '../scan/sources.js';
import type { Advisory, PackageVulnerability } from './advisories.js';

interface NetworkData {
  packages: string[];
  networkAdvisoryPackages: string[];
}

const BROWSER_STACKS = ['spfx', 'react', 'vue', 'angular', 'vite'];
const SERVER_STACKS = ['next', 'electron', 'express', 'nest'];
/** Advisory classes exploitable through HTTP traffic handled by the package. */
const NETWORK_ADVISORY =
  /\bssrf\b|server-side request|open redirect|request smuggling|\bproxy\b|\bcookie|header injection|\bcrlf\b|\btls\b|certificate/i;
/** Node core areas reachable through HTTP/REST traffic. */
const NETWORK_CVE =
  /\b(?:http|https|http2|tls|ssl|fetch|undici|brotli|zlib|dns|url|websocket|request smuggling|header)/i;

export interface NetworkUsage {
  used: boolean;
  signals: string[];
}

const REQUEST_SERVERS = ['express', '@nestjs/core', 'fastify', 'koa', '@hapi/hapi', 'next', 'hono'];

/** Projects that accept incoming HTTP requests, where Node HTTP/TLS CVEs are directly reachable. */
function acceptsRequests(project: Project): boolean {
  return project.dependencies.some(
    (dep) => dep.section === 'dependencies' && REQUEST_SERVERS.includes(dep.name),
  );
}

export function exposureOf(stacks: StackInfo[], project: Project): ExposureContext {
  const ids = new Set(stacks.map((stack) => stack.provider));
  const deps = new Set(project.dependencies.map((dep) => dep.name));
  // Packages with executables (CLIs, servers) run in Node even when they use React (e.g. Ink).
  if (
    project.manifest.bin !== undefined ||
    SERVER_STACKS.some((id) => ids.has(id)) ||
    deps.has('express') ||
    deps.has('@nestjs/core') ||
    deps.has('fastify')
  ) {
    return 'server';
  }
  if (BROWSER_STACKS.some((id) => ids.has(id))) return 'browser';
  return 'unknown';
}

export function networkUsage(project: Project, scan: SourceScan | undefined): NetworkUsage {
  const known = new Set(loadData<NetworkData>('network.json').packages);
  const signals = project.dependencies
    .filter((dep) => dep.section === 'dependencies' && known.has(dep.name))
    .map((dep) => dep.name);
  for (const [id, file] of scan?.network ?? []) signals.push(`${id} (${file})`);
  return { used: signals.length > 0, signals };
}

const LEVELS: Severity[] = ['info', 'warning', 'error', 'critical'];

function shift(severity: Severity, delta: number): Severity {
  const index = Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(severity) + delta));
  return LEVELS[index] ?? severity;
}

function advisorySeverity(severity: Advisory['severity'] | NodeVuln['severity']): Severity {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'error';
    case 'moderate':
    case 'medium':
      return 'warning';
    default:
      return 'info';
  }
}

export function packageVulnerabilityFindings(
  project: Project,
  vulns: PackageVulnerability[],
  exposure: ExposureContext,
  network: NetworkUsage,
): Finding[] {
  const networkPackages = new Set(loadData<NetworkData>('network.json').networkAdvisoryPackages);
  const rated = vulns.map((vuln) => {
    const worst = vuln.advisories.reduce<Severity>((acc, advisory) => {
      const level = advisorySeverity(advisory.severity);
      return LEVELS.indexOf(level) > LEVELS.indexOf(acc) ? level : acc;
    }, 'info');
    const networkRelevant =
      networkPackages.has(vuln.name) || vuln.advisories.some((a) => NETWORK_ADVISORY.test(a.title));
    let severity = worst;
    let reason = '';
    if (vuln.devOnly) {
      severity = shift(severity, -1);
      reason = 'build only';
    } else if (networkRelevant && network.used) {
      severity = shift(severity, 1);
      reason = 'reachable through network calls';
    }
    return {
      vuln,
      severity,
      networkRelevant,
      reason,
      context: vuln.devOnly ? ('build' as const) : exposure,
    };
  });

  // One finding per severity keeps reports readable: direct dependencies first, then by name.
  const findings: Finding[] = [];
  for (const severity of [...LEVELS].reverse()) {
    const items = rated
      .filter((item) => item.severity === severity)
      .sort(
        (a, b) =>
          Number(b.vuln.direct) - Number(a.vuln.direct) || a.vuln.name.localeCompare(b.vuln.name),
      );
    if (items.length === 0) continue;
    const networkCount = items.filter((item) => item.networkRelevant).length;
    const contexts = [...new Set(items.map((item) => item.context))];
    findings.push(
      finding(
        'security/package-vulnerability',
        severity,
        project,
        msg('security.packageVulns', {
          count: items.length,
          direct: items.filter((item) => item.vuln.direct).length,
          network: networkCount,
        }),
        {
          evidence: items.map((item) => {
            const top = item.vuln.advisories[0];
            const more =
              item.vuln.advisories.length > 1 ? ` (+${item.vuln.advisories.length - 1})` : '';
            const flags = [
              item.vuln.direct ? 'direct' : 'transitive',
              item.context,
              ...(item.networkRelevant ? ['network'] : []),
              ...(item.reason ? [item.reason] : []),
            ].join(', ');
            return `${item.vuln.name}@${item.vuln.version} [${top?.severity ?? '?'}] ${top?.title ?? ''}${more} - ${flags}${top ? ` ${top.url}` : ''}`;
          }),
          tags: ['security', ...contexts, ...(networkCount > 0 ? ['network'] : [])],
        },
      ),
    );
  }
  return findings;
}

export function nodeVulnerabilityFindings(
  project: Project,
  nodeVersion: string,
  vulns: NodeVuln[],
  exposure: ExposureContext,
): Finding[] {
  if (vulns.length === 0) return [];
  const worst = vulns.reduce<Severity>((acc, vuln) => {
    const level = advisorySeverity(vuln.severity);
    return LEVELS.indexOf(level) > LEVELS.indexOf(acc) ? level : acc;
  }, 'info');
  const networkCves = vulns.filter((vuln) => NETWORK_CVE.test(vuln.description));
  let severity = worst;
  const context: ExposureContext = exposure === 'browser' ? 'build' : exposure;
  if (exposure === 'browser') {
    severity = shift(severity, -1);
  } else if (exposure === 'server' && acceptsRequests(project) && networkCves.length > 0) {
    severity = shift(severity, 1);
  }
  return [
    finding(
      'security/node-vulnerable',
      severity,
      project,
      msg('security.nodeVuln', { version: nodeVersion, count: vulns.length, context }),
      {
        evidence: vulns
          .slice(0, 10)
          .map(
            (vuln) =>
              `[${vuln.severity}] ${vuln.cve.join(', ') || vuln.id}: ${vuln.description}${vuln.patched ? ` (patched: ${vuln.patched})` : ''}`,
          )
          .concat(vulns.length > 10 ? [`... +${vulns.length - 10}`] : []),
        tags: ['security', 'node', context, ...(networkCves.length > 0 ? ['network'] : [])],
      },
    ),
  ];
}
