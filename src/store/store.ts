import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import type { ProjectReport, Report } from '../analyze.js';
import { readJsonFile } from '../core/json.js';
import { isTopLevel, readNpmLockfile } from '../core/lockfile.js';
import type { PackageManifest, Project } from '../core/types.js';
import type { InstalledNode } from '../node/toolchain.js';
import { STORE_MARKER } from '../core/discovery.js';

export const STORE_DIR = path.join('.packman', 'store');
const LINKS_FILE = path.join('.packman', 'links.json');
const TRASH_DIR = path.join('.packman', 'trash');
const READY_FILE = '.packman-ready.json';

/** Dependency-shaped fields that must be identical for projects to share one install. */
const SHARED_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'overrides',
] as const;
/** Lifecycle scripts that write into the project directory and would target the store instead. */
const UNSAFE_SCRIPTS = /\b(?:husky|patch-package|postinstall-postinstall)\b/;

export interface StoreGroup {
  key: string;
  /**
   * `exact`: members have identical manifests and lockfiles; the store reuses that lockfile.
   * `union`: members agree on every shared version; the store installs the union of their dependencies.
   */
  mode: 'exact' | 'union';
  projectIds: string[];
  /** Node binary the store is installed with. */
  node?: InstalledNode;
  nodeMajor?: number;
  /** Project whose lockfile seeds the store (exact mode). */
  lockSource?: string;
  /** Dependency fields of the store manifest (union mode). */
  manifest?: Record<string, Record<string, string>>;
  warnings: string[];
}

export interface StoreCandidate {
  projectIds: string[];
  reason: 'lockfile-differs' | 'node-differs' | 'versions-differ';
  /** Packages declared with different versions inside the group (union mode). */
  packages?: string[];
}

export interface StorePlan {
  groups: StoreGroup[];
  /** Projects with identical manifests that cannot share yet, and why. */
  candidates: StoreCandidate[];
  /** Projects excluded from sharing, with the reason. */
  excluded: { projectId: string; reason: string }[];
}

export interface LinkRecord {
  projectId: string;
  key: string;
  target: string;
  createdAt: string;
  /** Where the project's own node_modules was moved, when it existed. */
  movedTo?: string;
  /** Manifest key of the project when it was linked; a different key means the link is stale. */
  manifestKey?: string;
  /** `folder`: node_modules is one junction; `packages`: a folder with one junction per needed package. */
  mode?: 'folder' | 'packages';
  /** Packages linked in `packages` mode (closure of `roots`). */
  packages?: string[];
  /** What the project asked for: declared, core, imported and config-referenced packages. */
  roots?: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function manifestKey(manifest: PackageManifest): string {
  return hash(
    canonical(Object.fromEntries(SHARED_FIELDS.map((field) => [field, manifest[field] ?? {}]))),
  );
}

function lockFingerprint(project: Project): string | undefined {
  const lock = project.lockfile;
  if (lock?.kind !== 'npm' || (lock.version ?? 1) < 2 || lock.packages.length === 0)
    return undefined;
  return hash(
    (lock.contentHash ?? '') +
      lock.packages
        .map((pkg) => `${pkg.location}@${pkg.version}`)
        .sort()
        .join('\n'),
  );
}

export function planStore(report: Report, options: { union?: boolean } = {}): StorePlan {
  return options.union ? planUnion(report) : planExact(report);
}

function unsafeScripts(project: Project): boolean {
  return UNSAFE_SCRIPTS.test(Object.values(project.manifest.scripts ?? {}).join(' '));
}

function localDependencies(project: Project): boolean {
  return project.dependencies.some((dep) =>
    /^(?:file:|link:|workspace:|portal:|\.{1,2}[\\/])/.test(dep.spec),
  );
}

function stackWarnings(members: ProjectReport[]): string[] {
  const warnings: string[] = [];
  const stacks = new Set(members.flatMap((member) => member.stacks.map((stack) => stack.provider)));
  if (stacks.has('vite'))
    warnings.push('vite: set cacheDir per project, node_modules/.vite would be shared');
  if (stacks.has('spfx')) {
    warnings.push('spfx: run `packman store verify` (gulp/heft build) on the linked projects');
  }
  return warnings;
}

/** Union of the dependency fields of the version group, when every shared package agrees. */
function planUnion(report: Report): StorePlan {
  const excluded: StorePlan['excluded'] = [];
  const groups: StoreGroup[] = [];
  const candidates: StoreCandidate[] = [];
  for (const versionGroup of report.groups) {
    const members = report.projects.filter(
      (entry) => versionGroup.projectIds.includes(entry.project.id) && !entry.project.isRoot,
    );
    const eligible = members.filter((entry) => {
      if (localDependencies(entry.project)) {
        excluded.push({
          projectId: entry.project.id,
          reason: 'local dependencies cannot be relocated into the store',
        });
        return false;
      }
      if (unsafeScripts(entry.project)) {
        excluded.push({
          projectId: entry.project.id,
          reason: 'install scripts write into the project directory',
        });
        return false;
      }
      return true;
    });
    if (eligible.length < 2) continue;

    const manifest: Record<string, Record<string, string>> = {};
    const conflicts = new Set<string>();
    const seen = new Map<string, string>();
    for (const entry of eligible) {
      for (const dep of entry.project.dependencies) {
        if (dep.section === 'peerDependencies') continue;
        const previous = seen.get(dep.name);
        if (previous !== undefined && previous !== dep.spec) conflicts.add(dep.name);
        seen.set(dep.name, previous ?? dep.spec);
        // A package used as runtime anywhere stays a runtime dependency of the store.
        if (dep.section === 'devDependencies' && manifest.dependencies?.[dep.name]) continue;
        if (dep.section === 'dependencies') delete manifest.devDependencies?.[dep.name];
        (manifest[dep.section] ??= {})[dep.name] = previous ?? dep.spec;
      }
    }
    const storeManifest = Object.fromEntries(
      Object.entries(manifest).filter(([, deps]) => Object.keys(deps).length > 0),
    );
    const overrides = new Set(
      eligible.map((entry) => canonical(entry.project.manifest.overrides ?? {})),
    );
    if (overrides.size > 1) conflicts.add('overrides');
    const nodes = new Set(eligible.map((entry) => entry.node.selected?.version));
    const ids = eligible.map((entry) => entry.project.id);
    if (conflicts.size > 0) {
      candidates.push({
        projectIds: ids,
        reason: 'versions-differ',
        packages: [...conflicts].sort(),
      });
      continue;
    }
    if (nodes.size > 1 || nodes.has(undefined)) {
      candidates.push({ projectIds: ids, reason: 'node-differs' });
      continue;
    }
    const first = eligible[0];
    const node = first?.node.selected;
    const group: StoreGroup = {
      key: `u-${hash(canonical({ manifest: storeManifest, overrides: first?.project.manifest.overrides ?? {}, node: node?.version, locks: eligible.map((entry) => [entry.project.id, lockFingerprint(entry.project) ?? null]) }))}`,
      mode: 'union',
      projectIds: ids,
      manifest: storeManifest,
      warnings: stackWarnings(eligible),
    };
    if (node) {
      group.node = node;
      group.nodeMajor = semver.major(node.version);
    }
    groups.push(group);
  }
  return { groups, candidates, excluded };
}

function planExact(report: Report): StorePlan {
  const excluded: StorePlan['excluded'] = [];
  const byManifest = new Map<string, ProjectReport[]>();
  for (const entry of report.projects) {
    const { project } = entry;
    if (project.isRoot) continue;
    if (localDependencies(project)) {
      excluded.push({
        projectId: project.id,
        reason: 'local dependencies cannot be relocated into the store',
      });
      continue;
    }
    if (!lockFingerprint(project)) {
      excluded.push({ projectId: project.id, reason: 'needs an npm lockfile v2+' });
      continue;
    }
    if (unsafeScripts(project)) {
      excluded.push({
        projectId: project.id,
        reason: 'install scripts write into the project directory',
      });
      continue;
    }
    const key = manifestKey(project.manifest);
    byManifest.set(key, [...(byManifest.get(key) ?? []), entry]);
  }

  const groups: StoreGroup[] = [];
  const candidates: StoreCandidate[] = [];
  for (const entries of byManifest.values()) {
    if (entries.length < 2) continue;
    const byLock = new Map<string, ProjectReport[]>();
    for (const entry of entries) {
      if (!entry.node.selected) {
        excluded.push({ projectId: entry.project.id, reason: 'no compatible installed Node' });
        continue;
      }
      const key = `${lockFingerprint(entry.project) ?? ''}|${entry.node.selected.version}`;
      byLock.set(key, [...(byLock.get(key) ?? []), entry]);
    }
    for (const members of byLock.values()) {
      const first = members[0];
      if (members.length < 2 || !first) continue;
      const node = first.node.selected;
      const warnings = stackWarnings(members);
      const group: StoreGroup = {
        key: hash(
          canonical({
            manifest: manifestKey(first.project.manifest),
            lock: lockFingerprint(first.project),
            node: node?.version,
          }),
        ),
        mode: 'exact',
        projectIds: members.map((member) => member.project.id),
        lockSource: first.project.id,
        warnings,
      };
      if (node) {
        group.node = node;
        group.nodeMajor = semver.major(node.version);
      }
      groups.push(group);
    }
    if (byLock.size > 1) {
      const nodes = new Set(entries.map((entry) => entry.node.selected?.version.split('.')[0]));
      candidates.push({
        projectIds: entries.map((entry) => entry.project.id),
        reason: nodes.size > 1 ? 'node-differs' : 'lockfile-differs',
      });
    }
  }
  return { groups, candidates, excluded };
}

export async function readLinks(root: string): Promise<LinkRecord[]> {
  const result = await readJsonFile<LinkRecord[]>(path.join(root, LINKS_FILE));
  return result.ok && Array.isArray(result.value) ? result.value : [];
}

async function writeLinks(root: string, links: LinkRecord[]): Promise<void> {
  await mkdir(path.join(root, '.packman'), { recursive: true });
  await writeFile(path.join(root, LINKS_FILE), `${JSON.stringify(links, null, 2)}\n`, 'utf8');
}

export interface LinkOptions {
  /** Move existing node_modules folders to .packman/trash instead of refusing. */
  replaceExisting: boolean;
  /** `packages` links only what each project needs; defaults to `packages` for union stores. */
  linkMode?: 'folder' | 'packages';
  /** Installs dependencies in the store directory; returns the exit code. */
  install: (dir: string, node: InstalledNode, mode: StoreGroup['mode']) => Promise<number>;
  now?: Date;
}

export interface LinkResult {
  storeDir: string;
  /** Packages whose locked versions differ between members (union mode): `name: v1 (a, b) | v2 (c)`. */
  conflicts?: string[];
  linked: string[];
  skipped: { projectId: string; reason: string }[];
}

/** Installs one store for the group and links every member's node_modules to it. */
export async function linkGroup(
  root: string,
  report: Report,
  group: StoreGroup,
  options: LinkOptions,
): Promise<LinkResult> {
  if (!group.node) throw new Error(`no installed Node for group ${group.key}`);
  const members = group.projectIds
    .map((id) => report.projects.find((entry) => entry.project.id === id)?.project)
    .filter((project): project is Project => project !== undefined);
  const source = group.lockSource
    ? members.find((project) => project.id === group.lockSource)
    : undefined;
  if (group.mode === 'exact' && !source?.lockfile) {
    throw new Error(`lockfile of ${group.lockSource ?? '?'} not found`);
  }

  // Filesystem state can have changed since the report was built.
  const blocked: Project[] = [];
  for (const project of members) {
    if (
      (await linkState(path.join(project.dir, 'node_modules'))).kind === 'folder' &&
      !options.replaceExisting
    )
      blocked.push(project);
  }
  if (blocked.length > 0) {
    throw new Error(
      `real node_modules folders found (${blocked.map((project) => project.id).join(', ')}); re-run with --replace-existing to move them to ${TRASH_DIR}`,
    );
  }

  const storeDir = path.join(root, STORE_DIR, group.key);
  const result: LinkResult = { storeDir, linked: [], skipped: [] };
  const target = path.join(storeDir, 'node_modules');
  const previous = await readLinks(root);
  const ready = await readJsonFile<{ key: string; node: string }>(path.join(storeDir, READY_FILE));
  const reusable =
    ready.ok &&
    ready.value.key === group.key &&
    ready.value.node === group.node.version &&
    existsSync(target);
  if (!reusable && previous.some((link) => path.resolve(link.target) === path.resolve(target))) {
    throw new Error(
      `store ${group.key} is linked but has no completed installation; unlink its projects before rebuilding`,
    );
  }
  if (!reusable) {
    await mkdir(storeDir, { recursive: true });
    const storeName = `packman-store-${group.key.slice(0, 8)}`;
    const manifest: Record<string, unknown> = { name: storeName, version: '0.0.0', private: true };
    if (source?.lockfile) {
      for (const field of SHARED_FIELDS) {
        if (source.manifest[field]) manifest[field] = source.manifest[field];
      }
      const lock = JSON.parse(await readFile(source.lockfile.path, 'utf8')) as {
        name?: string;
        packages?: Record<string, { name?: string }>;
      };
      lock.name = storeName;
      const rootEntry = lock.packages?.[''];
      if (rootEntry) rootEntry.name = storeName;
      await writeFile(
        path.join(storeDir, 'package-lock.json'),
        `${JSON.stringify(lock, null, 2)}\n`,
        'utf8',
      );
    } else {
      Object.assign(manifest, group.manifest);
      const overrides = members[0]?.manifest.overrides;
      if (overrides) manifest.overrides = overrides;
      // Without a lockfile npm would re-resolve every range to today's latest; the merged lockfile keeps
      // the versions the projects are locked to, and npm only resolves what is missing.
      const merged = await mergeLockfiles(members, storeName, manifest);
      if (merged) {
        await writeFile(
          path.join(storeDir, 'package-lock.json'),
          `${JSON.stringify(merged.lock, null, 2)}\n`,
          'utf8',
        );
        result.conflicts = merged.conflicts;
      }
    }
    await writeFile(
      path.join(storeDir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    const code = await options.install(storeDir, group.node, group.mode);
    if (code !== 0)
      throw new Error(`npm ci failed in ${storeDir} (exit ${code}); nothing was linked`);
    if (!existsSync(target))
      throw new Error(`installation created no node_modules in ${storeDir}; nothing was linked`);
    await writeFile(
      path.join(storeDir, READY_FILE),
      JSON.stringify({ key: group.key, node: group.node.version }),
    );
  }

  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  let links = [...previous];

  const linkMode = options.linkMode ?? (group.mode === 'union' ? 'packages' : 'folder');
  for (const project of members) {
    const linkPath = path.join(project.dir, 'node_modules');
    const record: LinkRecord = {
      projectId: project.id,
      key: group.key,
      target,
      createdAt: new Date().toISOString(),
      manifestKey: manifestKey(project.manifest),
      mode: linkMode,
    };
    const state = await linkState(linkPath);
    const earlier = previous.find((link) => link.projectId === project.id)?.movedTo;
    if (earlier && state.kind !== 'folder') record.movedTo = earlier;
    if (state.kind === 'link') {
      if (linkMode === 'folder' && path.resolve(state.target) === path.resolve(target)) {
        links = links.filter((link) => link.projectId !== project.id);
        links.push(record);
        await writeLinks(root, links);
        result.skipped.push({ projectId: project.id, reason: 'already linked' });
        continue;
      }
      await unlink(linkPath);
    } else if (state.kind === 'packages') {
      await removeLinkedFolder(linkPath);
    }
    // A re-link must not forget where the project's own node_modules was moved.
    if (state.kind === 'folder') {
      const movedTo = path.join(root, TRASH_DIR, stamp, project.id, 'node_modules');
      await mkdir(path.dirname(movedTo), { recursive: true });
      await rename(linkPath, movedTo);
      record.movedTo = movedTo;
    }
    // Persist recovery information before creating junctions. Earlier members remain tracked
    // if a later link fails (for example because a tool kept a directory open).
    links = links.filter((link) => link.projectId !== project.id);
    links.push(record);
    await writeLinks(root, links);
    if (linkMode === 'folder') {
      await symlink(target, linkPath, 'junction');
    } else {
      const entry = report.projects.find((item) => item.project.id === project.id);
      const roots = neededPackages(project, [
        ...(entry?.implicit ?? []),
        ...(entry?.imports ?? []),
        ...(entry?.configReferences ?? []),
      ]);
      record.roots = roots.filter((name) => existsSync(path.join(target, name)));
      record.packages = await linkPackages(linkPath, target, await storeClosure(target, roots));
    }
    await writeLinks(root, links);
    result.linked.push(project.id);
  }
  await writeLinks(root, links);
  return result;
}

type LinkState =
  { kind: 'absent' } | { kind: 'folder' } | { kind: 'packages' } | { kind: 'link'; target: string };

async function linkState(file: string): Promise<LinkState> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return { kind: 'link', target: await readlink(file) };
    if (existsSync(path.join(file, STORE_MARKER))) return { kind: 'packages' };
    return { kind: 'folder' };
  } catch {
    return { kind: 'absent' };
  }
}

export interface UnlinkResult {
  unlinked: string[];
  restored: string[];
  skipped: { projectId: string; reason: string }[];
}

/** Removes links recorded in .packman/links.json; never deletes a real folder. */
export async function unlinkProjects(
  root: string,
  projectIds: string[] | undefined,
  options: { restore: boolean },
): Promise<UnlinkResult> {
  const links = await readLinks(root);
  const result: UnlinkResult = { unlinked: [], restored: [], skipped: [] };
  const keep: LinkRecord[] = [];
  for (const link of links) {
    if (projectIds && !projectIds.includes(link.projectId)) {
      keep.push(link);
      continue;
    }
    const linkPath = path.join(root, link.projectId, 'node_modules');
    const state = await linkState(linkPath);
    if (state.kind === 'folder') {
      result.skipped.push({
        projectId: link.projectId,
        reason: 'node_modules is a real folder, left untouched',
      });
      keep.push(link);
      continue;
    }
    if (state.kind === 'link') {
      await unlink(linkPath);
      result.unlinked.push(link.projectId);
    } else if (state.kind === 'packages') {
      await removeLinkedFolder(linkPath);
      result.unlinked.push(link.projectId);
    }
    if (options.restore && link.movedTo && existsSync(link.movedTo)) {
      await rename(link.movedTo, linkPath);
      result.restored.push(link.projectId);
    }
  }
  await writeLinks(root, keep);
  return result;
}

/** What a project needs from the store: its own declarations plus packages its stack needs implicitly. */
export function neededPackages(project: Project, roots: string[]): string[] {
  const names = project.dependencies
    .filter((dep) => dep.section !== 'peerDependencies')
    .map((dep) => dep.name);
  return [...new Set([...names, ...roots])].sort();
}

/**
 * Transitive closure of `roots` over the store's dependency graph, by package name. Tools such as
 * the SPFx Sass task (`~pkg` -> `<project>/node_modules/pkg`) and ESLint resolve transitive packages
 * from the project directory, so a project needs the same top-level names a standalone install
 * would give it, and nothing that only other projects need.
 */
export async function storeClosure(storeModules: string, roots: string[]): Promise<string[]> {
  const lock = await readNpmLockfile(path.join(path.dirname(storeModules), 'package-lock.json'));
  const packages = new Map(lock.packages.map((pkg) => [pkg.location, pkg]));
  const seen = new Set<string>();
  const linked = new Set<string>();
  const queue = roots
    .filter((name) => existsSync(path.join(storeModules, name)))
    .map((name) => `node_modules/${name}`);
  while (queue.length > 0) {
    const location = queue.pop() as string;
    if (seen.has(location)) continue;
    seen.add(location);
    const pkg = packages.get(location);
    if (!pkg || isTopLevel(pkg)) linked.add(location.slice('node_modules/'.length));
    for (const next of pkg?.requires ?? []) {
      let parent = location;
      for (;;) {
        const candidate = parent ? `${parent}/node_modules/${next}` : `node_modules/${next}`;
        if (packages.has(candidate)) {
          queue.push(candidate);
          break;
        }
        if (!parent) break;
        const index = parent.lastIndexOf('/node_modules/');
        parent = index < 0 ? '' : parent.slice(0, index);
      }
    }
  }
  return [...linked].sort();
}

/**
 * Creates `node_modules` as a real folder with one junction per needed package (and `.bin`).
 * Transitive dependencies resolve inside the store because Node and webpack follow real paths.
 */
async function linkPackages(
  linkPath: string,
  storeModules: string,
  needed: string[],
): Promise<string[]> {
  await mkdir(linkPath, { recursive: true });
  await writeFile(path.join(linkPath, STORE_MARKER), JSON.stringify({ store: storeModules }));
  const linked: string[] = [];
  for (const name of needed) {
    const source = path.join(storeModules, name);
    if (!existsSync(source)) continue;
    const destination = path.join(linkPath, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(source, destination, 'junction');
    linked.push(name);
  }
  const bin = path.join(storeModules, '.bin');
  if (existsSync(bin)) await symlink(bin, path.join(linkPath, '.bin'), 'junction');
  await writeFile(
    path.join(linkPath, STORE_MARKER),
    `${JSON.stringify({ store: storeModules, packages: linked }, null, 2)}\n`,
    'utf8',
  );
  return linked;
}

/**
 * Removes a folder created by `linkPackages`: junctions are unlinked (never followed), scope folders
 * are emptied, and anything else is left in place so that no real file is ever deleted.
 */
async function removeLinkedFolder(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) {
      await unlink(full);
    } else if (stat.isDirectory() && entry.name.startsWith('@')) {
      await removeLinkedFolder(full);
    } else if (entry.name === STORE_MARKER || entry.name === '.package-lock.json') {
      await unlink(full);
    }
  }
  try {
    await rmdir(dir);
  } catch {
    // Not empty: something real was added after linking; it stays where it is.
  }
}

interface LockEntry {
  version?: string;
  [key: string]: unknown;
}

/**
 * Merges the members' npm v2/v3 lockfiles into one for the store: entries that agree are kept,
 * conflicting versions resolve to the version locked by most members (ties: the first member).
 */
export async function mergeLockfiles(
  members: Project[],
  storeName: string,
  manifest: Record<string, unknown>,
): Promise<{ lock: Record<string, unknown>; conflicts: string[] } | undefined> {
  const locks: { project: Project; packages: Record<string, LockEntry> }[] = [];
  for (const project of members) {
    if (project.lockfile?.kind !== 'npm' || (project.lockfile.version ?? 1) < 2) continue;
    const parsed = await readJsonFile<{ packages?: Record<string, LockEntry> }>(
      project.lockfile.path,
    );
    if (parsed.ok && parsed.value.packages)
      locks.push({ project, packages: parsed.value.packages });
  }
  if (locks.length === 0) return undefined;
  const candidates = new Map<string, Map<string, { entry: LockEntry; projects: string[] }>>();
  for (const { project, packages } of locks) {
    for (const [location, entry] of Object.entries(packages)) {
      if (location === '' || entry.version === undefined) continue;
      const byVersion =
        candidates.get(location) ?? new Map<string, { entry: LockEntry; projects: string[] }>();
      const current = byVersion.get(entry.version) ?? { entry, projects: [] };
      current.projects.push(project.id);
      byVersion.set(entry.version, current);
      candidates.set(location, byVersion);
    }
  }
  const packages: Record<string, LockEntry> = {
    '': {
      name: storeName,
      version: '0.0.0',
      ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
      ...(manifest.devDependencies ? { devDependencies: manifest.devDependencies } : {}),
      ...(manifest.optionalDependencies
        ? { optionalDependencies: manifest.optionalDependencies }
        : {}),
    },
  };
  const conflicts: string[] = [];
  for (const [location, byVersion] of [...candidates.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const options = [...byVersion.values()].sort((a, b) => b.projects.length - a.projects.length);
    const chosen = options[0];
    if (!chosen) continue;
    packages[location] = chosen.entry;
    if (options.length > 1 && !location.includes('/node_modules/', 'node_modules/'.length)) {
      conflicts.push(
        `${location.slice('node_modules/'.length)}: ${options.map((option) => `${option.entry.version ?? '?'} (${option.projects.join(', ')})`).join(' | ')}`,
      );
    }
  }
  return {
    lock: { name: storeName, version: '0.0.0', lockfileVersion: 3, requires: true, packages },
    conflicts,
  };
}

/**
 * Stores that no recorded link points to, plus (with `trash`) moved node_modules folders whose
 * projects no longer reference them. Nothing referenced by `.packman/links.json` is ever returned.
 */
export async function pruneTargets(root: string, options: { trash: boolean }): Promise<string[]> {
  const links = await readLinks(root);
  const used = new Set(links.map((link) => path.resolve(path.dirname(link.target))));
  const targets: string[] = [];
  const storeRoot = path.join(root, STORE_DIR);
  for (const entry of await readdir(storeRoot, { withFileTypes: true }).catch(() => [])) {
    const dir = path.resolve(storeRoot, entry.name);
    if (entry.isDirectory() && !used.has(dir)) targets.push(dir);
  }
  if (options.trash) {
    const kept = new Set(
      links.flatMap((link) => (link.movedTo ? [path.resolve(link.movedTo)] : [])),
    );
    const trashRoot = path.join(root, TRASH_DIR);
    for (const stamp of await readdir(trashRoot, { withFileTypes: true }).catch(() => [])) {
      const dir = path.resolve(trashRoot, stamp.name);
      const holdsKept = [...kept].some((moved) => moved.startsWith(dir + path.sep));
      if (stamp.isDirectory() && !holdsKept) targets.push(dir);
    }
  }
  return targets;
}
