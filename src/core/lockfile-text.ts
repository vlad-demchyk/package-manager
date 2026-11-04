import { readFile } from 'node:fs/promises';
import { validRange } from 'semver';
import type { LockedPackage, LockfileSummary, PackageManifest } from './types.js';

/**
 * Readers for the text lockfiles of yarn (classic v1 and berry) and pnpm (v5-v9). Neither format
 * records a node_modules layout, so packages are placed the way npm would hoist them: direct
 * dependencies at the top, then each transitive package at the top unless another version already
 * holds the name, in which case it nests under the package that first requires it.
 */

/** Block-map tree of an indentation-based lockfile; flow values (`{a: b}`) stay strings. */
interface Tree {
  [key: string]: Tree | string;
}

interface LockNode {
  name: string;
  version: string;
  /** Keys of the nodes this one installs (dependencies and optional dependencies). */
  children: string[];
  requires: string[];
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  deprecated?: string;
  /** Explicit dev flag (pnpm v5-v8); computed by reachability otherwise. */
  dev?: boolean;
}

interface Root {
  key: string;
  prod: boolean;
}

const ROOT_SECTIONS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const;

/** Ranges that point into the workspace or at a patch: not installed packages of their own. */
const LOCAL_PROTOCOL = /^(workspace|patch|link|portal):/;

export async function readYarnLockfile(
  file: string,
  manifest: PackageManifest = {},
): Promise<LockfileSummary> {
  const summary: LockfileSummary = { kind: 'yarn', path: file, rootSpecs: {}, packages: [] };
  const text = await readText(file);
  if (text === undefined) return summary;
  const berry = /^__metadata:/m.test(text);
  if (!berry) summary.version = 1;
  const tree = parseTree(text, berry ? splitYaml : splitYarnClassic);

  const nodes = new Map<string, LockNode>();
  const byDescriptor = new Map<string, string>();
  const pending = new Map<string, Tree>();
  for (const [header, value] of Object.entries(tree)) {
    const entry = sub(value);
    const version = str(entry?.version);
    if (!entry || !version || header === '__metadata') continue;
    const descriptors = header
      .split(',')
      .map((part) => splitDescriptor(part.trim().replace(/^["']|["']$/g, '')))
      .filter((descriptor) => descriptor !== undefined);
    const first = descriptors[0];
    if (!first || descriptors.every((descriptor) => LOCAL_PROTOCOL.test(descriptor.range))) {
      continue;
    }
    for (const descriptor of descriptors) {
      byDescriptor.set(`${descriptor.name}@${normalizeRange(descriptor.range)}`, header);
    }
    nodes.set(header, nodeOf(first.name, version, entry));
    pending.set(header, entry);
  }
  const resolve = (name: string, range: string): string | undefined =>
    byDescriptor.get(`${name}@${normalizeRange(range)}`);
  for (const [header, entry] of pending) {
    const node = nodes.get(header);
    if (!node) continue;
    for (const [name, range] of installedDependencies(entry)) {
      const key = resolve(name, range);
      if (key) node.children.push(key);
    }
  }

  const roots: Root[] = [];
  for (const section of ROOT_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      const key = resolve(name, spec);
      if (!key) continue;
      summary.rootSpecs[name] = spec;
      roots.push({ key, prod: section !== 'devDependencies' });
    }
  }
  summary.packages = layoutPackages(nodes, roots);
  return summary;
}

export async function readPnpmLockfile(file: string): Promise<LockfileSummary> {
  const summary: LockfileSummary = { kind: 'pnpm', path: file, rootSpecs: {}, packages: [] };
  const text = await readText(file);
  if (text === undefined) return summary;
  const tree = parseTree(text, splitYaml);
  const lockVersion = Number.parseFloat(str(tree.lockfileVersion) ?? '');
  if (Number.isFinite(lockVersion)) summary.version = lockVersion;
  const legacy = !(lockVersion >= 6);

  const nodes = new Map<string, LockNode>();
  const entries = new Map<string, Tree[]>();
  for (const section of [sub(tree.packages), sub(tree.snapshots)]) {
    for (const [key, value] of Object.entries(section ?? {})) {
      const id = parsePnpmKey(key, legacy);
      const entry = sub(value);
      if (!id || !entry) continue;
      const nodeKey = `${id.name}@${id.version}`;
      entries.set(nodeKey, [...(entries.get(nodeKey) ?? []), entry]);
      if (!nodes.has(nodeKey)) nodes.set(nodeKey, nodeOf(id.name, id.version, {}));
    }
  }
  for (const [nodeKey, parts] of entries) {
    const node = nodes.get(nodeKey);
    if (!node) continue;
    const merged = Object.assign(Object.create(null) as Tree, ...parts) as Tree;
    Object.assign(node, nodeOf(node.name, node.version, merged));
    const dev = str(merged.dev);
    if (dev !== undefined) node.dev = dev === 'true';
    for (const [name, version] of installedDependencies(merged)) {
      const key = pnpmDependencyKey(name, version, legacy);
      if (key && nodes.has(key)) node.children.push(key);
    }
  }

  const importer = sub(sub(tree.importers)?.['.']) ?? tree;
  const specifiers = sub(importer.specifiers);
  const roots: Root[] = [];
  for (const section of ROOT_SECTIONS) {
    for (const [name, value] of Object.entries(sub(importer[section]) ?? {})) {
      const entry = sub(value);
      const spec = entry ? str(entry.specifier) : str(specifiers?.[name]);
      const resolved = entry ? str(entry.version) : str(value);
      if (spec !== undefined) summary.rootSpecs[name] = spec;
      const version = resolved === undefined ? undefined : pnpmVersion(resolved);
      if (version !== undefined && nodes.has(`${name}@${version}`)) {
        roots.push({ key: `${name}@${version}`, prod: section !== 'devDependencies' });
      }
    }
  }
  summary.packages = layoutPackages(nodes, roots);
  return summary;
}

function layoutPackages(nodes: Map<string, LockNode>, roots: Root[]): LockedPackage[] {
  const located = new Map<string, string>();
  const topByName = new Map<string, string>();
  // Direct dependencies always hold the top level.
  for (const root of roots) {
    const node = nodes.get(root.key);
    if (!node || located.has(root.key) || topByName.has(node.name)) continue;
    topByName.set(node.name, root.key);
    located.set(root.key, `node_modules/${node.name}`);
  }
  const expand = (queue: string[]): void => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const parent = located.get(key);
      const node = nodes.get(key);
      if (!parent || !node) continue;
      for (const child of node.children) {
        const target = nodes.get(child);
        if (!target || located.has(child)) continue;
        if (topByName.has(target.name)) {
          located.set(child, `${parent}/node_modules/${target.name}`);
        } else {
          topByName.set(target.name, child);
          located.set(child, `node_modules/${target.name}`);
        }
        queue.push(child);
      }
    }
  };
  // The runtime closure is hoisted before dev tooling, so a conflict nests the dev-only copy.
  expand(roots.filter((root) => root.prod).map((root) => root.key));
  expand(roots.filter((root) => !root.prod).map((root) => root.key));

  const production = new Set<string>();
  const stack = roots.filter((root) => root.prod).map((root) => root.key);
  for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
    const node = nodes.get(key);
    if (!node || production.has(key)) continue;
    production.add(key);
    stack.push(...node.children);
  }

  const packages: LockedPackage[] = [];
  for (const [key, node] of nodes) {
    let location = located.get(key);
    if (location === undefined) {
      // Not reachable from the manifest: listed for advisories, placed outside the hoisted tree.
      location = `node_modules/.unreachable/node_modules/${node.name}`;
    }
    const pkg: LockedPackage = {
      name: node.name,
      version: node.version,
      location,
      dev: node.dev ?? !production.has(key),
    };
    if (node.deprecated) pkg.deprecated = node.deprecated;
    if (node.engines) pkg.engines = node.engines;
    if (node.peerDependencies) pkg.peerDependencies = node.peerDependencies;
    if (node.requires.length > 0) pkg.requires = node.requires;
    packages.push(pkg);
  }
  return packages.sort((a, b) => a.location.localeCompare(b.location));
}

function nodeOf(name: string, version: string, entry: Tree): LockNode {
  const peers = stringMap(entry.peerDependencies);
  const requires = [
    ...new Set([
      ...Object.keys(stringMap(entry.dependencies)),
      ...Object.keys(stringMap(entry.optionalDependencies)),
      ...Object.keys(peers),
    ]),
  ];
  const node: LockNode = { name, version, children: [], requires };
  if (Object.keys(peers).length > 0) node.peerDependencies = peers;
  const engines = str(entry.engines);
  if (engines !== undefined) node.engines = flowMap(engines);
  const deprecated = str(entry.deprecated);
  if (deprecated) node.deprecated = deprecated;
  return node;
}

function installedDependencies(entry: Tree): [string, string][] {
  return [
    ...Object.entries(stringMap(entry.dependencies)),
    ...Object.entries(stringMap(entry.optionalDependencies)),
  ];
}

/** `@s/a@npm:^1.0.0` -> name `@s/a`, range `npm:^1.0.0`. */
function splitDescriptor(descriptor: string): { name: string; range: string } | undefined {
  const at = descriptor.indexOf('@', 1);
  if (at === -1) return undefined;
  return { name: descriptor.slice(0, at), range: descriptor.slice(at + 1) };
}

/** Berry writes `npm:^1.0.0` where package.json and classic yarn write `^1.0.0`. */
function normalizeRange(range: string): string {
  const bare = range.startsWith('npm:') ? range.slice('npm:'.length) : range;
  return bare !== range && validRange(bare) !== null ? bare : range;
}

/** `/@s/a/1.0.0_x` (v5), `/@s/a@1.0.0(p@1)` (v6-v8), `@s/a@1.0.0(p@1)` (v9). */
function parsePnpmKey(key: string, legacy: boolean): { name: string; version: string } | undefined {
  const bare = (key.startsWith('/') ? key.slice(1) : key).replace(/\(.*$/, '');
  if (legacy) {
    const parts = bare.split('/');
    const scoped = parts[0]?.startsWith('@') ?? false;
    const name = scoped ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : parts[0];
    const version = (scoped ? parts[2] : parts[1])?.replace(/_.*$/, '');
    return name && version ? { name, version } : undefined;
  }
  const at = bare.lastIndexOf('@');
  if (at <= 0) return undefined;
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

/** Resolved version without the peer suffix; undefined for links and aliases. */
function pnpmVersion(value: string): string | undefined {
  const version = value.replace(/\(.*$/, '').replace(/_.*$/, '');
  if (/^(link|file):/.test(version) || version.startsWith('/') || version.includes('@')) {
    return undefined;
  }
  return version || undefined;
}

/** Node key of a dependency reference: a version, or an alias written as a package key. */
function pnpmDependencyKey(name: string, value: string, legacy: boolean): string | undefined {
  const version = pnpmVersion(value);
  if (version !== undefined) return `${name}@${version}`;
  if (/^(link|file):/.test(value)) return undefined;
  const id = parsePnpmKey(value, legacy && value.startsWith('/'));
  return id ? `${id.name}@${id.version}` : undefined;
}

type Split = { key: string; value?: string } | undefined;

function parseTree(text: string, split: (content: string) => Split): Tree {
  const root = Object.create(null) as Tree;
  const stack: { indent: number; node: Tree }[] = [{ indent: -1, node: root }];
  for (const raw of text.split(/\r?\n/)) {
    const content = raw.trim();
    if (content === '' || content.startsWith('#') || content.startsWith('-')) continue;
    const parsed = split(content);
    if (!parsed) continue;
    const indent = raw.length - raw.trimStart().length;
    let top = stack[stack.length - 1];
    while (top && stack.length > 1 && indent <= top.indent) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    if (!top) continue;
    if (parsed.value === undefined) {
      const child = Object.create(null) as Tree;
      top.node[parsed.key] = child;
      stack.push({ indent, node: child });
    } else {
      top.node[parsed.key] = parsed.value;
    }
  }
  return root;
}

/** One line of a YAML block map: `key: value`, `'quoted key': value` or `key:` opening a map. */
function splitYaml(content: string): Split {
  let key: string;
  let rest: string;
  const quote = content[0];
  if (quote === '"' || quote === "'") {
    const end = closingQuote(content, quote);
    if (end === -1) return undefined;
    key = unquote(content.slice(0, end + 1));
    rest = content.slice(end + 1).trim();
    if (!rest.startsWith(':')) return undefined;
    rest = rest.slice(1).trim();
  } else {
    const separator = content.indexOf(': ');
    if (separator === -1) {
      if (!content.endsWith(':')) return undefined;
      key = content.slice(0, -1);
      rest = '';
    } else {
      key = content.slice(0, separator);
      rest = content.slice(separator + 2).trim();
    }
  }
  return rest === '' ? { key } : { key, value: unquote(rest) };
}

/** One line of a classic yarn lockfile: `key value`, `"key" "value"` or `header:`. */
function splitYarnClassic(content: string): Split {
  if (content.endsWith(':')) return { key: content.slice(0, -1) };
  if (content.startsWith('"')) {
    const end = closingQuote(content, '"');
    if (end === -1) return undefined;
    return {
      key: unquote(content.slice(0, end + 1)),
      value: unquote(content.slice(end + 1).trim()),
    };
  }
  const separator = content.indexOf(' ');
  if (separator === -1) return undefined;
  return { key: content.slice(0, separator), value: unquote(content.slice(separator + 1).trim()) };
}

function closingQuote(content: string, quote: string): number {
  for (let index = 1; index < content.length; index++) {
    const char = content[index];
    if (quote === '"' && char === '\\') {
      index++;
    } else if (char === quote) {
      if (quote === "'" && content[index + 1] === "'") index++;
      else return index;
    }
  }
  return -1;
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if (quote !== value[value.length - 1]) return value;
  if (quote === "'") return value.slice(1, -1).replaceAll("''", "'");
  if (quote === '"') {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** `{node: '>=14', npm: '>=6'}` -> `{ node: '>=14', npm: '>=6' }`. */
function flowMap(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.replace(/^\{|\}$/g, '').split(',')) {
    const separator = part.indexOf(':');
    if (separator === -1) continue;
    const key = unquote(part.slice(0, separator).trim());
    const entry = unquote(part.slice(separator + 1).trim());
    if (key) result[key] = entry;
  }
  return result;
}

function sub(value: Tree | string | undefined): Tree | undefined {
  return typeof value === 'object' ? value : undefined;
}

function str(value: Tree | string | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringMap(value: Tree | string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(sub(value) ?? {})) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}
