import semver from 'semver';
import type { ProjectReport, Report } from '../analyze.js';
import { fix, msg, setDependency } from '../core/findings.js';
import type { Fix } from '../core/types.js';
import { isRegistrySpec, satisfies } from '../core/versions.js';
import { checkChoice } from '../ops/add.js';
import {
  fetchPackuments,
  outdated,
  type OutdatedRow,
  type PackageVersionMetadata,
} from '../ops/outdated.js';
import { packageCompatibility } from './compat.js';

/**
 * What "update inside the current major" may write for one outdated row. The target passes the same
 * checks as `packman compat` and `packman add`: stack ranges (SPFx matrix, scaffold, group and
 * profile constraints), peer ranges in both directions, `engines.node`, lockstep and family rules,
 * the one-spec-per-package rule of a shared-store group, and documented API breaks.
 */
export interface InMajorBump {
  /** Highest allowed version above the current one in the current major. */
  target?: string;
  /** Why the newest version of the major (`blockedVersion`) is not allowed. */
  blocked?: string[];
  blockedVersion?: string;
  /** The manifest edit for `target`; absent when nothing is allowed or the spec is a range. */
  fix?: Fix;
}

export type PlannedOutdatedRow = OutdatedRow & { bump: InMajorBump };

/** `^`, `~` or '' for exact specs; undefined for ranges a bump would change the meaning of. */
function specOperator(spec: string): string | undefined {
  return /^([\^~]?)\d+\.\d+\.\d+$/.exec(spec)?.[1];
}

/** Reasons one candidate version is refused; empty when it may be written. */
function refusals(
  report: Report,
  entry: ProjectReport,
  row: OutdatedRow,
  version: string,
  spec: string,
  stackRanges: { range: string; source: string }[],
  meta: PackageVersionMetadata | undefined,
): string[] {
  const out: string[] = [];
  for (const item of stackRanges)
    if (!satisfies(version, item.range)) out.push(`${item.source}: ${item.range}`);
  for (const check of checkChoice(
    report,
    entry,
    row.name,
    { spec, version, source: 'registry', detail: 'outdated in-major' },
    meta,
  ))
    if (check.severity === 'error') out.push(check.message);
  if (out.length > 0) return out;
  // API breaks only for an otherwise allowed version: the lookup scans the crossed versions.
  for (const item of packageCompatibility(entry, row.name, version).breaks)
    out.push(`API break ${item.id} (${item.since}): ${item.title}`);
  return out;
}

/** Plans the in-major update of one row against the project and the registry metadata. */
export function planInMajorBump(
  report: Report,
  row: OutdatedRow,
  versions: Record<string, PackageVersionMetadata>,
): InMajorBump {
  const entry = report.projects.find((item) => item.project.id === row.projectId);
  const operator = specOperator(row.spec);
  if (!entry || operator === undefined) return {};
  // The spec is exact, ^ or ~ here, so its minimum version always parses.
  const floor =
    row.current && semver.valid(row.current) ? row.current : semver.minVersion(row.spec)?.version;
  if (!floor) return {};
  const major = semver.major(floor);
  const candidates = Object.keys(versions)
    .filter(
      (version) =>
        semver.valid(version) &&
        !semver.prerelease(version) &&
        semver.major(version) === major &&
        semver.gt(version, floor),
    )
    .sort(semver.rcompare);
  if (
    row.latestInMajor &&
    !candidates.includes(row.latestInMajor) &&
    semver.gt(row.latestInMajor, floor)
  )
    candidates.unshift(row.latestInMajor);
  const stackRanges = packageCompatibility(entry, row.name).constraints;
  const result: InMajorBump = {};
  for (const version of candidates) {
    const value = `${operator}${version}`;
    const reasons = refusals(report, entry, row, version, value, stackRanges, versions[version]);
    if (reasons.length > 0) {
      if (!result.blocked) {
        result.blocked = reasons;
        result.blockedVersion = version;
      }
      continue;
    }
    if (value === row.spec) break;
    result.target = version;
    result.fix = fix(
      'outdated/in-major',
      msg('fix.bumpInMajor', { name: row.name, version: value }),
      'review',
      [setDependency(entry.project, row.name, value)],
    );
    break;
  }
  return result;
}

/**
 * `outdated` rows with their in-major plan. Registry metadata (peers, engines) is fetched first so
 * the `outdated` lookup right after reads the same cache instead of asking the registry twice.
 */
export async function outdatedWithBumps(
  report: Report,
  options: { offline: boolean; fetchImpl?: typeof fetch },
): Promise<PlannedOutdatedRow[]> {
  const projects = report.projects.map((entry) => entry.project);
  const names = [
    ...new Set(
      projects.flatMap((project) =>
        project.dependencies.filter((dep) => isRegistrySpec(dep.spec)).map((dep) => dep.name),
      ),
    ),
  ];
  const fetchOptions = {
    offline: options.offline,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const packuments = await fetchPackuments(names, { ...fetchOptions, metadata: true });
  const rows = await outdated(projects, fetchOptions);
  return rows.map((row) => ({
    ...row,
    bump: planInMajorBump(report, row, packuments.get(row.name)?.versions ?? {}),
  }));
}
