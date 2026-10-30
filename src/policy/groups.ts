import picomatch from 'picomatch';
import semver from 'semver';
import type { GroupConfig } from '../core/config.js';
import { finding, fix, msg, setDependency } from '../core/findings.js';
import type { Edit, Finding, Project, StackInfo } from '../core/types.js';
import { resolveVersion } from '../core/versions.js';

/** Stacks that define the shape of a project, in priority order. */
const PRIMARY_STACKS = ['spfx', 'angular', 'next', 'electron', 'vue', 'vite', 'react'];

export interface GroupMember {
  project: Project;
  stacks: StackInfo[];
  nodeRecommended?: string;
}

export interface VersionGroup {
  name: string;
  /** `config` when declared in packman.config.json, `auto` when derived from stacks. */
  origin: 'config' | 'auto';
  stack?: string;
  stackVersion?: string;
  node?: string;
  projectIds: string[];
  pins: Record<string, string>;
  baseline: boolean;
}

export function primaryStack(stacks: StackInfo[]): StackInfo | undefined {
  for (const id of PRIMARY_STACKS) {
    const stack = stacks.find((item) => item.provider === id);
    if (stack) return stack;
  }
  return undefined;
}

export function buildGroups(members: GroupMember[], configured: GroupConfig[]): VersionGroup[] {
  const groups = new Map<string, VersionGroup>();
  const matchers = configured.map((group) => ({ group, isMatch: picomatch(group.projects) }));

  for (const member of members) {
    const match = matchers.find(({ isMatch }) => isMatch(member.project.id));
    let group: VersionGroup | undefined;
    if (match) {
      group = groups.get(`config:${match.group.name}`);
      if (!group) {
        group = {
          name: match.group.name,
          origin: 'config',
          projectIds: [],
          pins: match.group.pins,
          baseline: false,
        };
        if (match.group.node) group.node = match.group.node;
        groups.set(`config:${match.group.name}`, group);
      }
    } else {
      const primary = primaryStack(member.stacks);
      const nodeMajor = member.nodeRecommended ? String(semver.major(member.nodeRecommended)) : '?';
      const stackLabel = primary ? `${primary.provider}@${primary.version ?? '?'}` : 'node';
      const key = `auto:${stackLabel}:node${nodeMajor}`;
      group = groups.get(key);
      if (!group) {
        group = {
          name: `${stackLabel} / node ${nodeMajor}`,
          origin: 'auto',
          projectIds: [],
          pins: {},
          baseline: false,
        };
        if (primary) group.stack = primary.provider;
        if (primary?.version) group.stackVersion = primary.version;
        if (member.nodeRecommended) group.node = member.nodeRecommended;
        groups.set(key, group);
      }
    }
    group.projectIds.push(member.project.id);
  }

  const list = [...groups.values()].sort(
    (a, b) => b.projectIds.length - a.projectIds.length || a.name.localeCompare(b.name),
  );
  const first = list[0];
  if (first) first.baseline = true;
  return list;
}

/**
 * Inside a group every shared package should resolve to one version.
 * The target is the most common version, ties broken by the highest.
 */
export function groupFindings(group: VersionGroup, members: GroupMember[]): Finding[] {
  const projects = members
    .filter((member) => group.projectIds.includes(member.project.id))
    .map((member) => member.project);
  const findings: Finding[] = [];

  for (const [name, version] of Object.entries(group.pins)) {
    const offenders = projects.filter((project) => {
      const resolved = resolveVersion(project, name);
      return resolved !== undefined && resolved.version !== version;
    });
    if (offenders.length > 0) {
      findings.push(
        finding(
          'policy/pin-violation',
          'error',
          undefined,
          msg('policy.pinViolation', { group: group.name, name, version, count: offenders.length }),
          {
            evidence: offenders.map(
              (project) => `${project.id}: ${resolveVersion(project, name)?.version ?? '?'}`,
            ),
            fixes: [
              fix(
                'policy/apply-pin',
                msg('fix.setVersion', { name, version }),
                'review',
                offenders.map((project) => setDependency(project, name, version)),
              ),
            ],
            tags: ['alignment', 'group'],
          },
        ),
      );
    }
  }

  if (projects.length < 2) return findings;
  const names = new Set(projects.flatMap((project) => project.dependencies.map((dep) => dep.name)));
  const ownNames = new Set(projects.map((project) => project.manifest.name));
  for (const name of [...names].sort()) {
    if (ownNames.has(name) || name in group.pins) continue;
    const usage = projects
      .map((project) => ({ project, resolved: resolveVersion(project, name) }))
      .filter(
        (item): item is { project: Project; resolved: NonNullable<typeof item.resolved> } =>
          item.resolved !== undefined,
      );
    if (usage.length < 2) continue;
    const counts = new Map<string, number>();
    for (const item of usage)
      counts.set(item.resolved.version, (counts.get(item.resolved.version) ?? 0) + 1);
    if (counts.size < 2) continue;

    const target = [...counts.entries()].sort(
      ([va, ca], [vb, cb]) =>
        cb - ca || semver.rcompare(semver.coerce(va) ?? '0.0.0', semver.coerce(vb) ?? '0.0.0'),
    )[0]?.[0];
    if (!target) continue;
    const edits: Edit[] = usage
      .filter((item) => item.resolved.version !== target)
      .map((item) => setDependency(item.project, name, target));
    const crossesMajor =
      new Set([...counts.keys()].map((version) => semver.coerce(version)?.major)).size > 1;
    findings.push(
      finding(
        'policy/group-divergence',
        crossesMajor ? 'error' : 'warning',
        undefined,
        msg('policy.groupDivergence', { group: group.name, name, count: counts.size, target }),
        {
          evidence: [...counts.entries()].map(
            ([version, count]) =>
              `${version}: ${count} (${usage
                .filter((item) => item.resolved.version === version)
                .map((item) => item.project.id)
                .slice(0, 6)
                .join(', ')}${count > 6 ? ', ...' : ''})`,
          ),
          fixes: [
            fix(
              `policy/align-${name}`,
              msg('fix.alignGroup', { name, version: target }),
              crossesMajor ? 'breaking' : 'review',
              edits,
            ),
          ],
          tags: ['alignment', 'group'],
        },
      ),
    );
  }
  return findings;
}
