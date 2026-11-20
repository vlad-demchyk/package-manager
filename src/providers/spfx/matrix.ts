import { readFileSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { loadData, userDataDir } from '../../core/data.js';
import { fetchPackuments } from '../../ops/outdated.js';

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
  /**
   * Set on a registry patch the matrix does not list yet: the row is a copy of this verified
   * patch of the same minor (constraints assumed, not yet verified).
   */
  inferredFrom?: string;
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

/** The package whose registry releases are SPFx releases. */
export const SPFX_ANCHOR = '@microsoft/sp-core-library';

/** SPFx releases published on npm, when looked up in this process (see {@link loadSpfxRegistry}). */
export interface SpfxRegistry {
  /** `dist-tags.latest` of {@link SPFX_ANCHOR}. */
  latest?: string;
  /** Stable versions, ascending. */
  versions: string[];
}

/** What `packman data update` records in the user data folder: published, never verified. */
export interface SpfxRegistryRecord extends SpfxRegistry {
  fetchedAt: string;
  source: string;
}

/** User data file with the SPFx releases npm published at the last `packman data update`. */
export const SPFX_REGISTRY_FILE = 'spfx-registry.json';

let registry: SpfxRegistry | undefined;
let recorded: SpfxRegistryRecord | undefined;
let recordedRead = false;

/** The registry looked up in this process, else the one `data update` recorded (offline too). */
function currentRegistry(): SpfxRegistry | undefined {
  if (registry) return registry;
  if (!recordedRead) {
    recordedRead = true;
    recorded = readRecorded();
  }
  return recorded;
}

function readRecorded(): SpfxRegistryRecord | undefined {
  const dir = userDataDir();
  if (!dir) return undefined;
  try {
    const value = JSON.parse(
      readFileSync(path.join(dir, SPFX_REGISTRY_FILE), 'utf8'),
    ) as SpfxRegistryRecord;
    return Array.isArray(value.versions) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Stable releases and `latest` of an {@link SPFX_ANCHOR} registry document. */
export function spfxRegistryFrom(packument: unknown): SpfxRegistry | undefined {
  const doc = packument as { 'dist-tags'?: Record<string, string>; versions?: object } | null;
  const versions = Object.keys(doc?.versions ?? {})
    .filter((version) => semver.valid(version) && !semver.prerelease(version))
    .sort(semver.compare);
  if (versions.length === 0) return undefined;
  const latest = doc?.['dist-tags']?.latest;
  return { versions, ...(latest && semver.valid(latest) ? { latest } : {}) };
}

/** Published patches the matrix does not verify: `version` and the verified row assumed for it. */
export function unverifiedPatches(
  value: SpfxRegistry | undefined = currentRegistry(),
): { version: string; inferredFrom: string }[] {
  return (value?.versions ?? []).flatMap((version) => {
    const base = findSpfxVersion(version)?.inferredFrom;
    return base ? [{ version, inferredFrom: base }] : [];
  });
}

/** `packman data status`: latest verified matrix row against what npm publishes. */
export function spfxDataStatus(): {
  verifiedAt: string;
  latestVerified?: string;
  registryLatest?: string;
  registry: 'process' | 'recorded' | 'none';
  recordedAt?: string;
  unverified: { version: string; inferredFrom: string }[];
} {
  const value = currentRegistry();
  const latestVerified = latestSpfx()?.version;
  return {
    verifiedAt: spfxMatrix().verifiedAt,
    ...(latestVerified ? { latestVerified } : {}),
    ...(value?.latest ? { registryLatest: value.latest } : {}),
    registry: registry ? 'process' : value ? 'recorded' : 'none',
    ...(!registry && recorded ? { recordedAt: recorded.fetchedAt } : {}),
    unverified: unverifiedPatches(value),
  };
}

/**
 * Reads the published SPFx releases (registry, or the 12-hour packument cache) so a patch newer
 * than the bundled matrix is known. Offline the network is not used: what `packman data update`
 * recorded is used, else the matrix alone. Returns undefined when nothing is known.
 */
export async function loadSpfxRegistry(options: {
  offline: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SpfxRegistry | undefined> {
  if (options.offline) return currentRegistry();
  const packument = (
    await fetchPackuments([SPFX_ANCHOR], {
      offline: false,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
  ).get(SPFX_ANCHOR);
  registry = spfxRegistryFrom(packument) ?? registry;
  return currentRegistry();
}

export function spfxRegistry(): SpfxRegistry | undefined {
  return currentRegistry();
}

/** Sets the registry view (`data update` after writing; tests). `undefined` ignores the record. */
export function setSpfxRegistry(value: SpfxRegistry | undefined): void {
  registry = value;
  recorded = undefined;
  recordedRead = true;
}

/** Forgets the registry view: the next lookup reads the recorded file again. */
export function resetSpfxRegistry(): void {
  registry = undefined;
  recorded = undefined;
  recordedRead = false;
}

/**
 * Matrix row of an SPFx version. A patch the matrix does not list yet (newer than every verified
 * patch of a known minor) gets a copy of the newest verified patch of that minor, marked with
 * `inferredFrom` and `unverified: ['all']`, instead of no constraints at all.
 */
export function findSpfxVersion(version: string): SpfxVersion | undefined {
  const clean = semver.coerce(version)?.version;
  if (!clean) return undefined;
  const versions = spfxMatrix().versions;
  return versions.find((entry) => entry.version === clean) ?? inferPatch(versions, clean);
}

function inferPatch(versions: SpfxVersion[], version: string): SpfxVersion | undefined {
  const base = versions
    .filter(
      (entry) =>
        !entry.withdrawn &&
        semver.major(entry.version) === semver.major(version) &&
        semver.minor(entry.version) === semver.minor(version),
    )
    .sort((a, b) => semver.rcompare(a.version, b.version))[0];
  if (!base || semver.lte(version, base.version)) return undefined;
  return {
    ...base,
    version,
    released: null,
    unverified: ['all'],
    inferredFrom: base.version,
  };
}

/** Newest published SPFx release the matrix can describe (verified, or an inferred patch). */
export function registryLatestSpfx(): SpfxVersion | undefined {
  const latest = currentRegistry()?.latest;
  return latest ? findSpfxVersion(latest) : undefined;
}

export type SpfxTargetResult =
  | { ok: true; version: string; entry: SpfxVersion }
  | { ok: false; reason: 'no-match' | 'unconfirmed'; nearest?: string };

/**
 * Upgrade target for `--to <range>`. A range picks the newest verified matrix version it allows;
 * only when it allows none (or names an exact unverified patch) is a published patch of a known
 * minor taken, as an inferred row the caller must flag as not yet verified. An exact version the
 * registry does not confirm (offline, or not published) is refused with the nearest verified one.
 */
export function resolveSpfxTarget(range: string): SpfxTargetResult {
  const verified = spfxMatrix()
    .versions.filter((entry) => !entry.withdrawn)
    .map((entry) => entry.version);
  const exact = semver.valid(range);
  const fromMatrix = semver.maxSatisfying(verified, range);
  if (fromMatrix && (!exact || exact === fromMatrix)) {
    const entry = findSpfxVersion(fromMatrix);
    if (entry) return { ok: true, version: fromMatrix, entry };
  }
  const known = currentRegistry();
  const published = (known?.versions ?? []).filter((version) =>
    Boolean(findSpfxVersion(version)?.inferredFrom),
  );
  const inferred = semver.maxSatisfying(published, range);
  const entry = inferred ? findSpfxVersion(inferred) : undefined;
  if (inferred && entry) return { ok: true, version: inferred, entry };
  const nearest = nearestVerified(verified, exact ?? lowestOf(range));
  const exactKnownMinor = exact ? findSpfxVersion(exact)?.inferredFrom : undefined;
  return {
    ok: false,
    reason: exactKnownMinor && !known ? 'unconfirmed' : 'no-match',
    ...(nearest ? { nearest } : {}),
  };
}

function lowestOf(range: string): string | undefined {
  try {
    return semver.minVersion(range)?.version;
  } catch {
    return undefined;
  }
}

function nearestVerified(verified: string[], wanted: string | undefined): string | undefined {
  if (!wanted) return undefined;
  const lower = verified.filter((version) => semver.lte(version, wanted)).sort(semver.rcompare)[0];
  return lower ?? [...verified].sort(semver.compare)[0];
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
