import semver from 'semver';
import { loadData } from '../../core/data.js';

export interface SpfxVersion {
  version: string;
  released: string | null;
  node: string;
  nodeMs: string | null;
  toolchain: 'gulp' | 'heft';
  heft?: string;
  typescript: string;
  compiler: string;
  gulpVariant?: { typescript: string; compiler: string };
  gulpUnsupported?: boolean;
  react: string | null;
  typesReact?: string;
  typesReactDom?: string;
  lint: 'tslint' | 'eslint';
  eslint?: string;
  sharepoint: string[];
  buildToolsVersion?: string;
  withdrawn?: boolean;
  unverified?: string[];
}

export interface SpfxLibraryMap {
  package: string;
  map: { range: string; spfx: string }[];
}

export interface SpfxMatrix {
  verifiedAt: string;
  sources: string[];
  versions: SpfxVersion[];
  compilers: Record<string, { version: string; typescript: string }>;
  lockstep: { exact: string[]; buildTools: string[] };
  libraries: SpfxLibraryMap[];
  pnpjs: { major: number; spfx: string; node?: string; note: string }[];
}

export function spfxMatrix(): SpfxMatrix {
  return loadData<SpfxMatrix>('spfx.json');
}

export function findSpfxVersion(version: string): SpfxVersion | undefined {
  const clean = semver.coerce(version)?.version;
  return spfxMatrix().versions.find((entry) => entry.version === clean);
}

export function latestSpfx(
  filter: (entry: SpfxVersion) => boolean = () => true,
): SpfxVersion | undefined {
  return spfxMatrix()
    .versions.filter((entry) => !entry.withdrawn && filter(entry))
    .sort((a, b) => semver.rcompare(a.version, b.version))[0];
}

/** Expected TypeScript and compiler for a version and the toolchain the project actually uses. */
export function expectedCompiler(
  entry: SpfxVersion,
  toolchain: 'gulp' | 'heft' | 'mixed' | 'unknown',
): { typescript: string; compiler: string } {
  if (toolchain === 'gulp' && entry.gulpVariant) {
    return entry.gulpVariant;
  }
  return { typescript: entry.typescript, compiler: entry.compiler };
}

/** SPFx version a PnP controls library release was built against. */
export function libraryTarget(pkg: string, version: string): string | undefined {
  const library = spfxMatrix().libraries.find((entry) => entry.package === pkg);
  return library?.map.find((row) => semver.satisfies(version, row.range))?.spfx;
}

/** Highest library line built for an SPFx version not newer than `spfx`. */
export function libraryRangeFor(pkg: string, spfx: string): string | undefined {
  const library = spfxMatrix().libraries.find((entry) => entry.package === pkg);
  const candidates = library?.map.filter((row) => semver.lte(row.spfx, spfx)) ?? [];
  return candidates.at(-1)?.range;
}
