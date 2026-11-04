import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  copyFile,
  rename,
  rm,
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
import { treeViolations, type TreeEntry } from '../core/tree.js';
import { lockVersions, versionChanges } from '../core/verified.js';
import type { PackageManifest, Project } from '../core/types.js';
import type { InstalledNode } from '../node/toolchain.js';
import { STORE_MARKER } from '../core/discovery.js';
import { backupFiles } from '../fixes/apply.js';
import { t } from '../i18n/index.js';

const STORE_DIR = path.join('.packman', 'store');
const LINKS_FILE = path.join('.packman', 'links.json');
const TRASH_DIR = path.join('.packman', 'trash');
const READY_FILE = '.packman-ready.json';
/** Result of the edge check of a completed store: peer incompatibilities to report on re-link. */
const CHECK_FILE = '.packman-check.json';

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
  /** Legacy records only: old releases moved node_modules here. New links never move modules. */
  movedTo?: string;
  /** Backup of the project's package.json and lockfiles, without installed modules. */
  backupDir?: string;
  /** Input snapshots used to reuse a linked store after per-project locks were synchronized. */
  lockKey?: string;
  nodeVersion?: string;
  /** Manifest key of the project when it was linked; a different key means the link is stale. */
  manifestKey?: string;
  /** {@link UNION_STORE_VERSION} the union store was built with; absent on older links. */
  storeVersion?: number;
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

/**
 * How union stores are built, part of every union store key and link record: a completed store is
 * reused on re-link, so a store built the old way must get a new key to be rebuilt.
 * 3: npm resolves the store tree fresh from the group manifest, checked edge by edge
 * (1-2 pieced members' lockfiles together and could mix a parent with another lock's nested packages).
 */
const UNION_STORE_VERSION = 3;

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function manifestKey(manifest: PackageManifest): string {
  return hash(
    canonical(Object.fromEntries(SHARED_FIELDS.map((field) => [field, manifest[field] ?? {}]))),
  );
}

function lockFingerprint(project: Pick<Project, 'lockfile'>): string | undefined {
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
  const plan = options.union ? planUnion(report) : planExact(report);
  for (const group of plan.groups) {
    const records = group.projectIds.map((id) =>
      report.links?.find((link) => link.projectId === id),
    );
    const first = records[0];
    if (
      first &&
      records.every((record, index) => {
        const project = report.projects.find(
          (entry) => entry.project.id === group.projectIds[index],
        )?.project;
        return (
          record &&
          project &&
          record.key === first.key &&
          // A union store built the older way is rebuilt, never kept for its existing links.
          (group.mode !== 'union' || record.storeVersion === UNION_STORE_VERSION) &&
          record.nodeVersion === group.node?.version &&
          record.manifestKey === manifestKey(project.manifest) &&
          record.lockKey === lockFingerprint(project)
        );
      })
    )
      group.key = first.key;
  }
  return plan;
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
      key: `u-${hash(canonical({ store: UNION_STORE_VERSION, manifest: storeManifest, overrides: first?.project.manifest.overrides ?? {}, node: node?.version, locks: eligible.map((entry) => [entry.project.id, lockFingerprint(entry.project) ?? null]) }))}`,
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
  /** Delete existing node_modules after the shared installation succeeds. Only manifests/locks are backed up. */
  replaceExisting: boolean;
  /** `packages` links only what each project needs; defaults to `packages` for union stores. */
  linkMode?: 'folder' | 'packages';
  /** Installs dependencies in the store directory; returns the exit code. */
  install: (dir: string, node: InstalledNode, mode: StoreGroup['mode']) => Promise<number>;
  now?: Date;
  /** Write per-project npm locks from the completed union installation, after a repository upgrade. */
  syncLocks?: boolean;
  /** Union mode: the group's verified store lockfile to resolve from instead of a fresh tree. */
  seedLock?: Record<string, unknown>;
}

export interface LinkResult {
  storeDir: string;
  /**
   * Union mode: top-level packages the fresh store resolves to another major than a member's own
   * lockfile had, `name: old (members) -> new`. The members' locks change to the group's versions.
   */
  conflicts?: string[];
  /** Peer ranges the installed tree does not satisfy: incompatibilities to fix in the projects. */
  peers?: string[];
  /** Seeded stores: versions npm moved away from the verified set; not verified by a build yet. */
  unverified?: string[];
  linked: string[];
  skipped: { projectId: string; reason: string }[];
  /** Real packages npm had put into linked folders, moved to `.packman/trash` before relinking. */
  trashed: { projectId: string; packages: string[] }[];
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
      `real node_modules folders found (${blocked.map((project) => project.id).join(', ')}); re-run with --replace-existing to delete them after backing up package.json and lockfiles`,
    );
  }

  const storeDir = path.join(root, STORE_DIR, group.key);
  const result: LinkResult = { storeDir, linked: [], skipped: [], trashed: [] };
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
      // Members' lockfiles were resolved at different times and cannot be pieced together path by
      // path. The group's verified store lockfile (one tree a build passed with) seeds npm, which
      // keeps those versions and resolves only what the manifests changed; without one, npm resolves
      // the tree fresh. A package whose dependencies cannot use the group's version gets its own
      // nested copy either way.
      const lockPath = path.join(storeDir, 'package-lock.json');
      if (options.seedLock) {
        const seed = structuredClone(options.seedLock) as {
          name?: string;
          packages?: Record<string, { name?: string }>;
        };
        seed.name = storeName;
        const rootEntry = seed.packages?.[''];
        if (rootEntry) rootEntry.name = storeName;
        await writeFile(lockPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
      } else {
        await rm(lockPath, { force: true });
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
    const tree = await readJsonFile<{ packages?: Record<string, TreeEntry> }>(
      path.join(storeDir, 'package-lock.json'),
    );
    if (!tree.ok || !tree.value.packages)
      throw new Error(`installation wrote no package-lock.json in ${storeDir}; nothing was linked`);
    const checked = treeViolations(tree.value.packages);
    if (checked.broken.length > 0)
      throw new Error(
        `store ${group.key} has dependencies outside their ranges; nothing was linked:\n  ${checked.broken.slice(0, 20).join('\n  ')}`,
      );
    await writeFile(path.join(storeDir, CHECK_FILE), JSON.stringify({ peers: checked.peers }));
    if (options.seedLock) {
      const seeded: Record<string, string> = {};
      for (const [location, entry] of Object.entries(
        (options.seedLock.packages ?? {}) as Record<string, { version?: string; link?: boolean }>,
      ))
        if (location && entry.version && !entry.link) seeded[location] = entry.version;
      const installed = await lockVersions(path.join(storeDir, 'package-lock.json'));
      result.unverified = installed ? versionChanges(seeded, installed) : [];
    }
    await writeFile(
      path.join(storeDir, READY_FILE),
      JSON.stringify({ key: group.key, node: group.node.version }),
    );
  }

  const check = await readJsonFile<{ peers?: string[] }>(path.join(storeDir, CHECK_FILE));
  if (check.ok && check.value.peers?.length) result.peers = check.value.peers;
  if (group.mode === 'union') {
    const changes = await lockChanges(members, path.join(storeDir, 'package-lock.json'));
    if (changes.length > 0) result.conflicts = changes;
  }

  // Only a tree that passed the edge check above is ever written back into the projects.
  if (options.syncLocks) await syncProjectLocks(root, members, storeDir);

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
      nodeVersion: group.node.version,
      ...(group.mode === 'union' ? { storeVersion: UNION_STORE_VERSION } : {}),
    };
    const currentLock = options.syncLocks
      ? await readNpmLockfile(
          project.lockfile?.kind === 'npm'
            ? project.lockfile.path
            : path.join(project.dir, 'package-lock.json'),
        )
      : project.lockfile;
    const lockKey = currentLock ? lockFingerprint({ lockfile: currentLock }) : undefined;
    if (lockKey) record.lockKey = lockKey;
    const state = await linkState(linkPath);
    const earlier = previous.find((link) => link.projectId === project.id);
    const sameSnapshot =
      earlier !== undefined &&
      earlier.manifestKey === record.manifestKey &&
      earlier.lockKey === record.lockKey &&
      earlier.nodeVersion === record.nodeVersion;
    record.backupDir =
      (sameSnapshot ? earlier.backupDir : undefined) ??
      (await backupFiles(root, projectFiles(project.dir), options.now));
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
      // npm run inside a linked project leaves real copies here; move them aside, then relink.
      const moved = await trashUnlinked(root, project.id, linkPath, options.now ?? new Date());
      if (moved.length > 0) result.trashed.push({ projectId: project.id, packages: moved });
      await removeLinkedFolder(linkPath);
    }
    if (state.kind === 'folder') {
      // Recheck the boundary and type immediately before deletion; junctions are never followed.
      if (path.resolve(linkPath) !== path.resolve(root, project.id, 'node_modules'))
        throw new Error('node_modules outside project');
      const current = await lstat(linkPath);
      if (current.isSymbolicLink()) await unlink(linkPath);
      else await rm(linkPath, { recursive: true, force: true, maxRetries: 3 });
    }
    // Persist the manifest/lock backup before creating junctions. Earlier members remain tracked
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

/** Recreate independent project locks from the shared tree; keep nested and hoisted resolutions. */
async function syncProjectLocks(root: string, members: Project[], storeDir: string): Promise<void> {
  const parsed = await readJsonFile<{
    lockfileVersion?: number;
    packages?: Record<string, LockEntry>;
  }>(path.join(storeDir, 'package-lock.json'));
  if (!parsed.ok || !parsed.value.packages) throw new Error('shared npm lockfile is missing');
  await backupFiles(
    root,
    members.flatMap((project) => projectFiles(project.dir)),
  );
  const source = parsed.value.packages;
  for (const project of members) {
    const seen = new Set<string>();
    const queue = project.dependencies
      .filter((dep) => dep.section !== 'peerDependencies')
      .map((dep) => `node_modules/${dep.name}`);
    while (queue.length > 0) {
      const location = queue.pop() as string;
      const entry = source[location];
      if (seen.has(location) || !entry) continue;
      seen.add(location);
      const dependencies = {
        ...asSpecs(entry.dependencies),
        ...asSpecs(entry.optionalDependencies),
        ...asSpecs(entry.peerDependencies),
      };
      for (const name of Object.keys(dependencies)) {
        let parent = location;
        for (;;) {
          const candidate = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
          if (source[candidate]) {
            queue.push(candidate);
            break;
          }
          if (!parent) break;
          const index = parent.lastIndexOf('/node_modules/');
          parent = index < 0 ? '' : parent.slice(0, index);
        }
      }
    }
    const manifest = project.manifest;
    const packages: Record<string, unknown> = {
      '': {
        name: manifest.name ?? project.name,
        version: manifest.version ?? '0.0.0',
        ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
        ...(manifest.devDependencies ? { devDependencies: manifest.devDependencies } : {}),
        ...(manifest.optionalDependencies
          ? { optionalDependencies: manifest.optionalDependencies }
          : {}),
        ...(manifest.peerDependencies ? { peerDependencies: manifest.peerDependencies } : {}),
        ...(manifest.engines ? { engines: manifest.engines } : {}),
      },
    };
    for (const location of [...seen].sort()) packages[location] = source[location];
    const file =
      project.lockfile?.kind === 'npm'
        ? project.lockfile.path
        : path.join(project.dir, 'package-lock.json');
    await writeFile(
      file,
      JSON.stringify(
        {
          name: manifest.name ?? project.name,
          version: manifest.version ?? '0.0.0',
          lockfileVersion: 3,
          requires: true,
          packages,
        },
        null,
        2,
      ) + '\n',
    );
  }
}

function asSpecs(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

const PROJECT_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];
function projectFiles(dir: string): string[] {
  return PROJECT_FILES.map((name) => path.join(dir, name)).filter((file) => existsSync(file));
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
    if (options.restore && link.backupDir) {
      const dir = path.join(root, link.projectId);
      for (const name of PROJECT_FILES) {
        const saved = path.join(link.backupDir, link.projectId, name);
        if (existsSync(saved)) await copyFile(saved, path.join(dir, name));
      }
      result.restored.push(link.projectId);
    }
  }
  await writeLinks(root, keep);
  return result;
}

/** What a project needs from the store: its own declarations plus packages its stack needs implicitly. */
function neededPackages(project: Project, roots: string[]): string[] {
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

/** How a linked `node_modules` differs from what packman linked (npm run inside the project, say). */
export interface LinkDrift {
  /** Linked packages that are gone. */
  missing: string[];
  /** Linked packages replaced by a real folder or a link elsewhere (npm update, npm install). */
  replaced: string[];
  /** Entries packman did not link (npm install <package>). */
  extra: string[];
}

const OWN_ENTRIES = new Set([STORE_MARKER, '.bin', '.package-lock.json']);

/** Top-level package entries of a `node_modules` folder, with `@scope/name` for scoped ones. */
async function moduleEntries(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    // Tools keep caches here (.vite-temp, .cache, .tmp); package names never start with a dot.
    if (OWN_ENTRIES.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('@') && !(await lstat(full)).isSymbolicLink())
      for (const child of await readdir(full).catch(() => [] as string[]))
        out.push(`${entry.name}/${child}`);
    else out.push(entry.name);
  }
  return out.sort();
}

export function describeDrift(drift: LinkDrift): string {
  return [
    drift.missing.length ? t('store.driftMissing', { packages: drift.missing.join(', ') }) : '',
    drift.replaced.length ? t('store.driftReplaced', { packages: drift.replaced.join(', ') }) : '',
    drift.extra.length ? t('store.driftExtra', { packages: drift.extra.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** Compares a linked project's `node_modules` with its link record; undefined when it matches. */
export async function linkDrift(root: string, link: LinkRecord): Promise<LinkDrift | undefined> {
  const linkPath = path.join(root, link.projectId, 'node_modules');
  const drift: LinkDrift = { missing: [], replaced: [], extra: [] };
  const pointsIntoStore = async (file: string): Promise<boolean> => {
    try {
      if (!(await lstat(file)).isSymbolicLink()) return false;
      const target = path.resolve(path.dirname(file), await readlink(file));
      return target.toLowerCase().startsWith(path.resolve(link.target).toLowerCase());
    } catch {
      return false;
    }
  };
  if (link.mode !== 'packages') {
    if (!existsSync(linkPath)) drift.missing.push('node_modules');
    else if (!(await pointsIntoStore(linkPath))) drift.replaced.push('node_modules');
  } else {
    const expected = new Set(link.packages ?? []);
    for (const name of expected) {
      const file = path.join(linkPath, name);
      if (!existsSync(file) && !(await lstat(file).catch(() => undefined)))
        drift.missing.push(name);
      else if (!(await pointsIntoStore(file))) drift.replaced.push(name);
    }
    for (const name of await moduleEntries(linkPath))
      if (!expected.has(name)) drift.extra.push(name);
  }
  return drift.missing.length + drift.replaced.length + drift.extra.length > 0 ? drift : undefined;
}

/**
 * Moves what npm put into a packman-linked folder (real package copies, packages it added) to
 * `.packman/trash/<time>/<project>/`, so the folder can be linked again; nothing is deleted.
 */
async function trashUnlinked(
  root: string,
  projectId: string,
  dir: string,
  now: Date,
): Promise<string[]> {
  const moved: string[] = [];
  const trash = path.join(
    root,
    '.packman',
    'trash',
    now.toISOString().replace(/[:.]/g, '-'),
    projectId,
  );
  for (const name of await moduleEntries(dir)) {
    const full = path.join(dir, name);
    if ((await lstat(full)).isSymbolicLink()) continue;
    const destination = path.join(trash, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(full, destination);
    moved.push(name);
  }
  return moved;
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
 * Top-level packages that the store resolves to another major than a member's own lockfile had:
 * `name: old (members) -> new`. These are the versions the members move to with the group.
 */
export async function lockChanges(members: Project[], storeLock: string): Promise<string[]> {
  const store = await readJsonFile<{ packages?: Record<string, LockEntry> }>(storeLock);
  if (!store.ok || !store.value.packages) return [];
  const resolved = store.value.packages;
  const previous = new Map<string, Map<string, string[]>>();
  for (const project of members) {
    if (project.lockfile?.kind !== 'npm') continue;
    const own = await readJsonFile<{ packages?: Record<string, LockEntry> }>(project.lockfile.path);
    for (const [location, entry] of Object.entries(own.ok ? (own.value.packages ?? {}) : {})) {
      const now = resolved[location]?.version;
      if (
        !location.startsWith('node_modules/') ||
        location.includes('/node_modules/', 'node_modules/'.length) ||
        !entry.version ||
        !now ||
        semver.valid(entry.version) === null ||
        semver.valid(now) === null ||
        semver.major(entry.version) === semver.major(now)
      )
        continue;
      const byVersion = previous.get(location) ?? new Map<string, string[]>();
      byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), project.id]);
      previous.set(location, byVersion);
    }
  }
  return [...previous.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([location, byVersion]) =>
        `${location.slice('node_modules/'.length)}: ${[...byVersion.entries()].map(([version, ids]) => `${version} (${ids.join(', ')})`).join(' | ')} -> ${resolved[location]?.version ?? '?'}`,
    );
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
