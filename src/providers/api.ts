import semver from 'semver';
import { finding, msg } from '../core/findings.js';
import type { Finding, Project } from '../core/types.js';
import { resolveVersion } from '../core/versions.js';
import {
  apiBreaks,
  locationsOf,
  patternSeverity,
  type ApiBreak,
  type ApiUsage,
} from '../scan/api-breaks.js';
import type { ProjectContext } from './types.js';

interface BreakSide {
  name: string;
  version: string;
  side: 'old' | 'new';
  /** Packages of the same family resolved on the other side of `since` (mixed majors). */
  mixed?: BreakSide[];
}

/** Every package of the break's family the project resolves, each with its side of `since`. */
function breakSides(project: Project, item: ApiBreak): BreakSide[] {
  const sides: BreakSide[] = [];
  for (const name of item.packages) {
    const resolved = resolveVersion(project, name);
    if (!resolved || !semver.valid(resolved.version)) continue;
    sides.push({
      name,
      version: resolved.version,
      side: semver.gte(resolved.version, item.since) ? 'new' : 'old',
    });
  }
  if (sides.length > 0) return sides;
  for (const name of item.replaces ?? []) {
    const resolved = resolveVersion(project, name);
    if (resolved) sides.push({ name, version: resolved.version, side: 'old' });
  }
  return sides;
}

/**
 * Which side of a break a project is on. A family split across `since` (`@pnp/sp` 3 next to
 * `@pnp/logging` 4) counts as the new side, the one whose old-API usage fails first, and carries
 * the packages left behind in `mixed`.
 */
function breakSide(project: Project, item: ApiBreak): BreakSide | undefined {
  const sides = breakSides(project, item);
  const main = sides.find((side) => side.side === 'new') ?? sides[0];
  if (!main) return undefined;
  const mixed = sides.filter((side) => side.side !== main.side);
  return mixed.length > 0 ? { ...main, mixed } : main;
}

/**
 * `api/migration-required`: the installed version of a package is on one side of a documented
 * API break while the source still (or already) uses the API of the other side.
 */
export async function checkApiMigration(ctx: ProjectContext): Promise<Finding[]> {
  const scan = await ctx.sources();
  if (scan.filesScanned === 0) return [];
  const usage: ApiUsage = Object.fromEntries(scan.api);
  const findings: Finding[] = [];
  for (const item of apiBreaks()) {
    if (item.check === false) continue;
    const side = breakSide(ctx.project, item);
    if (!side) continue;
    const patterns = (side.side === 'new' ? item.old : item.new).filter(
      (pattern) => (usage[pattern.id]?.length ?? 0) > 0,
    );
    if (patterns.length === 0) continue;
    const places = locationsOf(usage, patterns);
    const severity =
      side.side === 'new'
        ? patterns.some((pattern) => patternSeverity(item, pattern) === 'error')
          ? 'error'
          : 'warning'
        : item.verified
          ? 'error'
          : 'warning';
    findings.push(
      finding(
        'api/migration-required',
        severity,
        ctx.project,
        msg(side.side === 'new' ? 'api.oldUsage' : 'api.newUsage', {
          package: side.name,
          version: side.version,
          since: item.since,
          count: places.length,
          title: item.title,
        }),
        {
          evidence: [
            ...patterns.flatMap((pattern) => [
              `${pattern.what}${pattern.verified === false ? ' (unverified)' : ''}`,
              ...(usage[pattern.id] ?? []).map((place) => `  ${place}`),
            ]),
            ...(side.mixed
              ? [
                  `mixed majors: ${side.mixed.map((other) => `${other.name}@${other.version}`).join(', ')} still ${side.side === 'new' ? 'below' : 'at or above'} ${item.since}`,
                ]
              : []),
            `guide: ${item.guide}`,
            ...item.steps.map((step) => `-> ${step}`),
          ],
          tags: ['api', 'compatibility'],
        },
      ),
    );
  }
  return findings;
}

/**
 * `api/migration-split`: projects of the repository sit on both sides of a break and at least one
 * on the old side still uses the old API, so converging the versions needs code changes there.
 */
export function apiSplitFindings(entries: { project: Project; apiUsage: ApiUsage }[]): Finding[] {
  const findings: Finding[] = [];
  for (const item of apiBreaks()) {
    if (item.check === false) continue;
    const sides = entries.flatMap((entry) => {
      const side = breakSide(entry.project, item);
      return side ? [{ ...side, entry }] : [];
    });
    const old = sides.filter((side) => side.side === 'old');
    const fresh = sides.filter((side) => side.side === 'new');
    if (old.length === 0 || fresh.length === 0) continue;
    const needWork = old.filter((side) => locationsOf(side.entry.apiUsage, item.old).length > 0);
    if (needWork.length === 0) continue;
    findings.push(
      finding(
        'api/migration-split',
        'warning',
        undefined,
        msg('api.split', {
          package: item.packages[0] ?? '',
          since: item.since,
          old: old.length,
          new: fresh.length,
          work: needWork.length,
        }),
        {
          evidence: [
            ...sides.map(
              (side) =>
                `${side.entry.project.id}: ${side.name}@${side.version} (${side.side === 'new' ? `>= ${item.since}` : `< ${item.since}`}${
                  needWork.includes(side)
                    ? `, ${locationsOf(side.entry.apiUsage, item.old).length} old-API places`
                    : ''
                })`,
            ),
            `guide: ${item.guide}`,
          ],
          tags: ['api', 'compatibility', 'alignment'],
        },
      ),
    );
  }
  return findings;
}
