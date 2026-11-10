import { DEPENDENCY_SECTIONS, type Finding, type Fix, type Project } from '../core/types.js';
import { crossings, describeCrossing, type ApiUsage, type Crossing } from '../scan/api-breaks.js';

export interface BreakEntry {
  project: Project;
  apiUsage: ApiUsage;
}

export interface FixCrossing {
  projectId: string;
  crossing: Crossing;
  /** Evidence lines: the break, its guide and where the project uses the affected API. */
  lines: string[];
}

/**
 * Documented API breaks the manifest edits of a fix cross: a dependency set from a version on one
 * side of `since` to the other. Projects are matched by manifest path, so fixes spanning several
 * projects (group alignment) are covered.
 */
export function fixCrossings(fix: Fix, entries: BreakEntry[]): FixCrossing[] {
  const byManifest = new Map(entries.map((entry) => [entry.project.manifestPath, entry]));
  const seen = new Set<string>();
  const out: FixCrossing[] = [];
  for (const edit of fix.edits) {
    if (edit.kind !== 'json-set' || typeof edit.value !== 'string') continue;
    const [section, name] = edit.path;
    if (
      edit.path.length !== 2 ||
      typeof name !== 'string' ||
      !(DEPENDENCY_SECTIONS as readonly unknown[]).includes(section) ||
      section === 'peerDependencies'
    )
      continue;
    const entry = byManifest.get(edit.file);
    if (!entry) continue;
    for (const crossing of crossings(entry.project, name, edit.value)) {
      const key = `${entry.project.id}:${crossing.break.id}:${crossing.direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        projectId: entry.project.id,
        crossing,
        lines: describeCrossing(crossing, entry.apiUsage),
      });
    }
  }
  return out;
}

/**
 * Fixes that cross a documented break become `breaking` and their finding explains which files
 * use the affected API. Returns the number of fixes changed.
 */
export function annotateBreakingFixes(findings: Finding[], entries: BreakEntry[]): number {
  let changed = 0;
  for (const item of findings) {
    const lines: string[] = [];
    for (const fix of item.fixes) {
      const crossed = fixCrossings(fix, entries);
      if (crossed.length === 0) continue;
      if (fix.risk !== 'breaking') {
        fix.risk = 'breaking';
        changed++;
      }
      for (const entry of crossed)
        for (const line of entry.lines) {
          const text = line.startsWith('  ')
            ? line
            : `api: ${item.projectId ? '' : `${entry.projectId}: `}${line}`;
          if (!lines.includes(text) && !item.evidence.includes(text)) lines.push(text);
        }
    }
    item.evidence.push(...lines);
  }
  return changed;
}
