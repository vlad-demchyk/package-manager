import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import {
  bundledDataPath,
  fetchedAt,
  loadData,
  resetData,
  UPDATABLE_DATA,
  userDataDir,
} from '../core/data.js';
import type { NodeVuln } from '../node/releases.js';

const SCHEDULE_URL = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
const INDEX_URL = 'https://nodejs.org/dist/index.json';
const VULNS_URL = 'https://raw.githubusercontent.com/nodejs/security-wg/main/vuln/core/index.json';

const REGISTRY = 'https://registry.npmjs.org/';

/**
 * Where each framework states what it needs, per major: Node in the anchor's `engines`, companion
 * packages in `peerDependencies` (TypeScript for Angular sits on @angular/compiler-cli).
 */
const FRAMEWORK_SOURCES: Record<
  string,
  {
    anchor: string;
    fromMajor: number;
    read: { package: string; engines?: boolean; peers?: string[] }[];
  }
> = {
  angular: {
    anchor: '@angular/core',
    fromMajor: 14,
    read: [
      { package: '@angular/core', engines: true, peers: ['rxjs', 'zone.js'] },
      { package: '@angular/compiler-cli', peers: ['typescript'] },
    ],
  },
  next: {
    anchor: 'next',
    fromMajor: 13,
    read: [{ package: 'next', engines: true, peers: ['react', 'react-dom'] }],
  },
  vite: { anchor: 'vite', fromMajor: 4, read: [{ package: 'vite', engines: true }] },
};

export interface FrameworkMajor {
  /** Newest stable release of the major the ranges were read from. */
  version: string;
  node?: string;
  packages: Record<string, string>;
}

export interface FrameworkData {
  fetchedAt: string;
  sources: string[];
  frameworks: Record<string, { anchor: string; majors: Record<string, FrameworkMajor> }>;
}

type Packument = { versions?: Record<string, { engines?: unknown; peerDependencies?: unknown }> };

/** Builds the framework matrix from registry documents (`name -> packument`). */
export function frameworkMatrix(
  packuments: Map<string, unknown>,
  fetchedAt: string,
): FrameworkData {
  const newestPerMajor = (name: string): Map<number, string> => {
    const doc = packuments.get(name) as Packument | undefined;
    const result = new Map<number, string>();
    for (const version of Object.keys(doc?.versions ?? {})) {
      if (semver.valid(version) === null || semver.prerelease(version) !== null) continue;
      const major = semver.major(version);
      const current = result.get(major);
      if (!current || semver.gt(version, current)) result.set(major, version);
    }
    return result;
  };
  const data: FrameworkData = {
    fetchedAt,
    sources: Object.values(FRAMEWORK_SOURCES).flatMap((spec) =>
      spec.read.map((source) => `${REGISTRY}${source.package.replace('/', '%2F')}`),
    ),
    frameworks: {},
  };
  for (const [id, spec] of Object.entries(FRAMEWORK_SOURCES)) {
    const majors: Record<string, FrameworkMajor> = {};
    for (const [major, version] of [...newestPerMajor(spec.anchor)].sort(([a], [b]) => a - b)) {
      if (major < spec.fromMajor) continue;
      const entry: FrameworkMajor = { version, packages: {} };
      for (const source of spec.read) {
        const sourceVersion = newestPerMajor(source.package).get(major);
        const manifest = sourceVersion
          ? (packuments.get(source.package) as Packument | undefined)?.versions?.[sourceVersion]
          : undefined;
        if (!manifest) continue;
        const engines = isRecord(manifest.engines) ? text(manifest.engines.node) : null;
        if (source.engines && engines) entry.node = engines;
        const peers = isRecord(manifest.peerDependencies) ? manifest.peerDependencies : {};
        for (const name of source.peers ?? []) {
          const range = text(peers[name]);
          if (range) entry.packages[name] = range;
        }
      }
      majors[String(major)] = entry;
    }
    data.frameworks[id] = { anchor: spec.anchor, majors };
  }
  return data;
}

/** Edited by hand from Microsoft documentation and generator output; never fetched. */
const CURATED_DATA = ['spfx.json', 'spfx-scaffold.json', 'families.json', 'network.json'];

const SEVERITIES = new Set<NodeVuln['severity']>(['critical', 'high', 'medium', 'low', 'unknown']);

export interface DataFileStatus {
  name: string;
  /** fetchedAt/verifiedAt of the bundled file. */
  bundled: string;
  /** fetchedAt of the updated copy, when there is one. */
  updated?: string;
  /** Which copy {@link loadData} uses. */
  active: 'bundled' | 'updated';
  /** False for curated files (SPFx matrix, scaffold, families) that are edited by hand. */
  updatable: boolean;
}

export interface DataUpdateResult {
  dir: string;
  files: { name: string; before: string; after: string; changes: string[] }[];
}

export function dataStatus(): DataFileStatus[] {
  const dir = userDataDir();
  const names = [...UPDATABLE_DATA, ...CURATED_DATA];
  return names.map((name) => {
    const bundled = readDate(bundledDataPath(name));
    const updatable = (UPDATABLE_DATA as readonly string[]).includes(name);
    const userFile = dir && updatable ? path.join(dir, name) : undefined;
    const updated = userFile && existsSync(userFile) ? readDate(userFile) : undefined;
    const status: DataFileStatus = {
      name,
      bundled,
      active: updated !== undefined && updated >= bundled ? 'updated' : 'bundled',
      updatable,
    };
    if (updated !== undefined) status.updated = updated;
    return status;
  });
}

/**
 * Rebuilds the Node release lines and the Node core vulnerability list from their public sources
 * and stores them in the per-user data folder. Bundled files stay untouched; a result that looks
 * truncated (fewer lines or vulnerabilities than already known) is refused.
 */
export async function updateData(
  options: { fetchImpl?: typeof fetch; today?: Date; write?: boolean } = {},
): Promise<DataUpdateResult> {
  const dir = userDataDir();
  if (!dir) throw new Error('PACKMAN_DATA_DIR is empty: updated data is disabled');
  const fetchJson = async (url: string, accept?: string): Promise<unknown> => {
    const response = await (options.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(120_000),
      ...(accept ? { headers: { accept } } : {}),
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  };
  const packageNames = [
    ...new Set(Object.values(FRAMEWORK_SOURCES).flatMap((spec) => spec.read.map((s) => s.package))),
  ];
  const [schedule, index, vulns, ...documents] = await Promise.all([
    fetchJson(SCHEDULE_URL),
    fetchJson(INDEX_URL),
    fetchJson(VULNS_URL),
    // Abbreviated metadata still carries engines and peerDependencies of every version.
    ...packageNames.map((name) =>
      fetchJson(`${REGISTRY}${name.replace('/', '%2F')}`, 'application/vnd.npm.install-v1+json'),
    ),
  ]);
  const today = (options.today ?? new Date()).toISOString().slice(0, 10);

  const currentNode = loadData<NodeData>('node.json');
  const currentVulns = loadData<VulnData>('node-vulns.json');
  const node: NodeData = {
    fetchedAt: today,
    sources: [SCHEDULE_URL, INDEX_URL],
    lines: nodeLines(schedule, index),
  };
  const vulnData: VulnData = { fetchedAt: today, source: VULNS_URL, vulns: nodeVulns(vulns) };
  const missingLines = Object.keys(currentNode.lines).filter((major) => !(major in node.lines));
  if (missingLines.length > 0) {
    throw new Error(`${SCHEDULE_URL}: release lines missing (${missingLines.join(', ')})`);
  }
  if (vulnData.vulns.length < currentVulns.vulns.length) {
    throw new Error(
      `${VULNS_URL}: ${vulnData.vulns.length} entries, fewer than the ${currentVulns.vulns.length} already known`,
    );
  }

  const currentFrameworks = loadData<FrameworkData>('frameworks.json');
  const frameworks = frameworkMatrix(
    new Map(packageNames.map((name, i) => [name, documents[i]])),
    today,
  );
  for (const [id, current] of Object.entries(currentFrameworks.frameworks)) {
    const known = Object.keys(current.majors).length;
    const now = Object.keys(frameworks.frameworks[id]?.majors ?? {}).length;
    if (now < known)
      throw new Error(
        `${REGISTRY}${current.anchor}: ${now} majors, fewer than the ${known} already known`,
      );
  }

  const result: DataUpdateResult = {
    dir,
    files: [
      {
        name: 'node.json',
        before: currentNode.fetchedAt,
        after: today,
        changes: lineChanges(currentNode.lines, node.lines),
      },
      {
        name: 'node-vulns.json',
        before: currentVulns.fetchedAt,
        after: today,
        changes: vulnData.vulns
          .filter((vuln) => !currentVulns.vulns.some((known) => known.id === vuln.id))
          .map(
            (vuln) => `${vuln.id} ${vuln.cve.join(', ')} ${vuln.vulnerable}: ${vuln.description}`,
          ),
      },
      {
        name: 'frameworks.json',
        before: currentFrameworks.fetchedAt,
        after: today,
        changes: frameworkChanges(currentFrameworks, frameworks),
      },
    ],
  };
  if (options.write === false) return result;
  await mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, 'node.json'), node);
  await writeAtomic(path.join(dir, 'node-vulns.json'), vulnData);
  await writeAtomic(path.join(dir, 'frameworks.json'), frameworks);
  resetData();
  return result;
}

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
  sources: string[];
  lines: Record<string, NodeLine>;
}

interface VulnData {
  fetchedAt: string;
  source: string;
  vulns: NodeVuln[];
}

/** Lines from 4 on (schedule.json) with their latest stable and latest security releases. */
export function nodeLines(schedule: unknown, index: unknown): Record<string, NodeLine> {
  if (!isRecord(schedule) || !Array.isArray(index)) {
    throw new Error('Node release data has an unexpected shape');
  }
  const releases = index
    .map((entry) => (isRecord(entry) ? entry : {}))
    .map((entry) => ({
      version: typeof entry.version === 'string' ? semver.clean(entry.version) : null,
      security: entry.security === true,
    }))
    .filter(
      (entry): entry is { version: string; security: boolean } =>
        entry.version !== null && semver.prerelease(entry.version) === null,
    )
    .sort((a, b) => semver.rcompare(a.version, b.version));
  const lines: Record<string, NodeLine> = {};
  for (const [key, value] of Object.entries(schedule)) {
    const major = /^v(\d+)$/.exec(key)?.[1];
    if (!major || Number(major) < 4 || !isRecord(value)) continue;
    const start = text(value.start);
    const end = text(value.end);
    if (!start || !end) continue;
    const inLine = releases.filter((release) => semver.major(release.version) === Number(major));
    lines[major] = {
      start,
      lts: text(value.lts),
      maintenance: text(value.maintenance),
      end,
      codename: text(value.codename),
      latest: inLine[0]?.version ?? null,
      latestSecurity: inLine.find((release) => release.security)?.version ?? null,
    };
  }
  return lines;
}

/** nodejs/security-wg `vuln/core/index.json` (an object keyed by id) as a sorted list. */
export function nodeVulns(source: unknown): NodeVuln[] {
  if (!isRecord(source)) throw new Error('Node vulnerability data has an unexpected shape');
  return Object.entries(source)
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([id, entry]) => {
      const vulnerable = text(entry.vulnerable);
      const severity = text(entry.severity) as NodeVuln['severity'] | null;
      const overview = text(entry.overview)
        ?.split('\n')
        .find((line) => line.trim());
      return {
        id,
        cve: Array.isArray(entry.cve)
          ? entry.cve.filter((cve): cve is string => typeof cve === 'string')
          : [],
        vulnerable: vulnerable ?? '',
        patched: text(entry.patched),
        severity: severity && SEVERITIES.has(severity) ? severity : 'unknown',
        description: text(entry.description) ?? overview?.trim() ?? '',
        ref: text(entry.ref),
        affectedEnvironments: Array.isArray(entry.affectedEnvironments)
          ? entry.affectedEnvironments.filter((env): env is string => typeof env === 'string')
          : ['all'],
      };
    })
    .filter((vuln) => vuln.vulnerable !== '')
    .sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
}

function lineChanges(before: Record<string, NodeLine>, after: Record<string, NodeLine>): string[] {
  const changes: string[] = [];
  for (const [major, line] of Object.entries(after)) {
    const old = before[major];
    if (!old) {
      changes.push(`Node ${major}: new line, ${line.start} - ${line.end}`);
      continue;
    }
    for (const key of Object.keys(line) as (keyof NodeLine)[]) {
      if (old[key] !== line[key]) {
        changes.push(`Node ${major} ${key}: ${old[key] ?? '-'} -> ${line[key] ?? '-'}`);
      }
    }
  }
  return changes;
}

function frameworkChanges(before: FrameworkData, after: FrameworkData): string[] {
  const changes: string[] = [];
  for (const [id, framework] of Object.entries(after.frameworks))
    for (const [major, entry] of Object.entries(framework.majors)) {
      const old = before.frameworks[id]?.majors[major];
      if (!old) changes.push(`${id} ${major}: new major (${entry.version})`);
      else if (JSON.stringify(old) !== JSON.stringify(entry))
        changes.push(`${id} ${major}: ${old.version} -> ${entry.version}`);
    }
  return changes;
}
async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function readDate(file: string): string {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as {
      verifiedAt?: unknown;
      generatedAt?: unknown;
    };
    const curated = value.verifiedAt ?? value.generatedAt;
    return fetchedAt(value) || (typeof curated === 'string' ? curated : '');
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}
