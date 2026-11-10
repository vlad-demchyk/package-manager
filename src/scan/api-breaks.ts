import semver from 'semver';
import { loadData } from '../core/data.js';
import { minVersionOf, resolveVersion } from '../core/versions.js';
import type { Project } from '../core/types.js';

/** A code pattern of one API generation, matched against comment-stripped source text. */
export interface ApiPattern {
  id: string;
  regex: string;
  /** Second regex that must also match somewhere in the file (the importing package, usually). */
  requires?: string;
  what: string;
  /** `removed`: gone in the new version; `deprecated`: still runs with warnings. Old patterns only. */
  kind?: 'removed' | 'deprecated';
  verified?: boolean;
}

/** One documented API break: the API of versions below `since` versus the API from `since` on. */
export interface ApiBreak {
  id: string;
  packages: string[];
  /** Old-side packages the new ones replaced (renames such as office-ui-fabric-react). */
  replaces?: string[];
  since: string;
  title: string;
  guide: string;
  verified: boolean;
  /** `false` keeps the break out of `api/migration-required` (another rule owns it). */
  check?: boolean;
  steps: string[];
  old: ApiPattern[];
  new: ApiPattern[];
}

interface ApiBreaksData {
  verifiedAt: string;
  sources: string[];
  breaks: ApiBreak[];
}

export function apiBreaks(): ApiBreak[] {
  return loadData<ApiBreaksData>('api-breaks.json').breaks;
}

const compiled = new Map<string, { regex: RegExp; requires?: RegExp }>();

function compile(pattern: ApiPattern): { regex: RegExp; requires?: RegExp } {
  let entry = compiled.get(pattern.id);
  if (!entry) {
    entry = { regex: new RegExp(pattern.regex, 'g') };
    if (pattern.requires) entry.requires = new RegExp(pattern.requires);
    compiled.set(pattern.id, entry);
  }
  return entry;
}

/** Locations kept per pattern and file; evidence stays readable and the scan bounded. */
const MAX_LOCATIONS_PER_FILE = 5;

/**
 * Every API pattern of every break found in one file: pattern id -> `file:line` locations.
 * `text` is comment-stripped source, `rel` the project-relative path used in evidence.
 */
export function matchApiPatterns(text: string, rel: string, out: Map<string, string[]>): void {
  let lineStarts: number[] | undefined;
  const lineOf = (index: number): number => {
    lineStarts ??= [0, ...[...text.matchAll(/\n/g)].map((match) => match.index + 1)];
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  for (const item of apiBreaks())
    for (const pattern of [...item.old, ...item.new]) {
      const { regex, requires } = compile(pattern);
      if (requires && !requires.test(text)) continue;
      regex.lastIndex = 0;
      let count = 0;
      for (const match of text.matchAll(regex)) {
        if (count++ >= MAX_LOCATIONS_PER_FILE) break;
        const list = out.get(pattern.id) ?? [];
        list.push(`${rel}:${lineOf(match.index)}`);
        out.set(pattern.id, list);
      }
    }
}

export interface Crossing {
  break: ApiBreak;
  package: string;
  from: string;
  to: string;
  /** `upgrade` when moving onto the new API, `downgrade` when moving back below `since`. */
  direction: 'upgrade' | 'downgrade';
}

/**
 * Breaks a version change crosses: `from` below `since` and `to` at or above it (or the reverse).
 * A package that replaced another (`replaces`) crosses when the old one is declared and `from`
 * is unknown, which is how a rename shows up in a manifest edit.
 */
export function crossings(
  project: Project,
  name: string,
  to: string,
  from: string | undefined = resolveVersion(project, name)?.version,
): Crossing[] {
  const target = semver.valid(to) ?? minVersionOf(to);
  if (!target) return [];
  const result: Crossing[] = [];
  for (const item of apiBreaks()) {
    if (!item.packages.includes(name)) continue;
    const replaced = item.replaces?.find((old) =>
      project.dependencies.some((dep) => dep.name === old && dep.section !== 'peerDependencies'),
    );
    const base = from ?? (replaced ? resolveVersion(project, replaced)?.version : undefined);
    if (!base || !semver.valid(base)) continue;
    const toNew = semver.gte(target, item.since);
    const fromNew = replaced && !from ? false : semver.gte(base, item.since);
    if (toNew === fromNew) continue;
    result.push({
      break: item,
      package: name,
      from: replaced && !from ? `${replaced}@${base}` : base,
      to: target,
      direction: toNew ? 'upgrade' : 'downgrade',
    });
  }
  return result;
}

/** Severity of an old-API pattern once the new version is installed. */
export function patternSeverity(item: ApiBreak, pattern: ApiPattern): 'error' | 'warning' {
  return item.verified && pattern.verified !== false && (pattern.kind ?? 'removed') === 'removed'
    ? 'error'
    : 'warning';
}

/** `file:line` locations of the given patterns, in a stable order. */
export type ApiUsage = Readonly<Record<string, string[]>>;

export function locationsOf(usage: ApiUsage, patterns: ApiPattern[]): string[] {
  return patterns.flatMap((pattern) => usage[pattern.id] ?? []);
}

/** Evidence lines for one crossing: title, guide, and where the old (or new) API is used. */
export function describeCrossing(crossing: Crossing, usage: ApiUsage, limit = 6): string[] {
  const { break: item } = crossing;
  const patterns = crossing.direction === 'upgrade' ? item.old : item.new;
  const places = locationsOf(usage, patterns);
  const lines = [
    `${crossing.package} ${crossing.from} -> ${crossing.to}: ${item.title}${item.verified ? '' : ' (unverified)'} (${item.guide})`,
  ];
  if (places.length === 0)
    lines.push(
      `  no known ${crossing.direction === 'upgrade' ? 'old' : 'new'}-API usage found in scanned sources`,
    );
  else {
    lines.push(...places.slice(0, limit).map((place) => `  ${place}`));
    if (places.length > limit) lines.push(`  ... +${places.length - limit}`);
  }
  return lines;
}
