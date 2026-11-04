import semver from 'semver';

/** One package entry of an npm v2/v3 lockfile, as far as dependency edges go. */
export interface TreeEntry {
  version?: string;
  link?: boolean;
  optional?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * Checks every dependency edge of an installed npm v2/v3 lockfile the way Node resolves it: from the
 * package's own node_modules up to the root, as `dependent -> dependency@range: found` lines.
 * `broken`: a regular dependency resolves outside its range (or is missing); the package would load
 * the wrong copy at runtime, so such a tree is never linked. `peers`: peer ranges npm tolerated;
 * reported as incompatibilities to fix in the projects, they do not block.
 */
export function treeViolations(packages: Record<string, TreeEntry>): {
  broken: string[];
  peers: string[];
} {
  const result = { broken: [] as string[], peers: [] as string[] };
  const resolve = (from: string, name: string): TreeEntry | undefined => {
    let base = from;
    for (;;) {
      const entry = packages[base ? `${base}/node_modules/${name}` : `node_modules/${name}`];
      if (entry) return entry;
      if (!base) return undefined;
      const index = base.lastIndexOf('/node_modules/');
      base = index === -1 ? '' : base.slice(0, index);
    }
  };
  for (const [location, entry] of Object.entries(packages)) {
    if (location !== '' && (entry.link || !location.startsWith('node_modules/'))) continue;
    const edges: [string, string, 'broken' | 'peers'][] = [
      ...Object.entries(entry.dependencies ?? {}).map(
        ([name, range]): [string, string, 'broken'] => [name, range, 'broken'],
      ),
      ...Object.entries(entry.peerDependencies ?? {})
        .filter(([name]) => entry.peerDependenciesMeta?.[name]?.optional !== true)
        .map(([name, range]): [string, string, 'peers'] => [name, range, 'peers']),
    ];
    for (const [name, range, kind] of edges) {
      if (semver.validRange(range) === null) continue; // npm:, git, file and URL specs
      const found = resolve(location, name);
      if (!found?.version) {
        // Missing peers are npm's to warn about; a missing regular dependency of an optional
        // (platform-specific) package is expected.
        if (kind === 'broken' && !entry.optional)
          result.broken.push(`${location || '(root)'} -> ${name}@${range}: missing`);
        continue;
      }
      if (!semver.satisfies(found.version, range, { includePrerelease: true }))
        result[kind].push(`${location || '(root)'} -> ${name}@${range}: ${found.version}`);
    }
  }
  return result;
}
