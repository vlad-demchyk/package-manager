import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../core/json.js';
import type { Project } from '../core/types.js';
import { stripComments } from './sources.js';

/** Config files whose presence implies tooling packages (ported from the 2.x depcheck whitelist). */
const CONFIG_IMPLIES: [RegExp, string[]][] = [
  [/^webpack\.config\.[cm]?[jt]s$/, ['webpack', 'webpack-cli']],
  [/^vite\.config\.[cm]?[jt]s$/, ['vite']],
  [/^(babel\.config\.[cm]?js|\.babelrc(\.json)?)$/, ['@babel/core', 'babel-loader']],
  [/^jest\.config\.[cm]?[jt]s$/, ['jest']],
  [/^karma\.conf\.[cm]?js$/, ['karma']],
  [/^tsconfig(\..+)?\.json$/, ['typescript', 'tslib']],
  [/^vue\.config\.[cm]?js$/, ['@vue/cli-service']],
  [/^next\.config\.[cm]?[jt]s$/, ['next']],
  [/^nuxt\.config\.[cm]?[jt]s$/, ['nuxt']],
  [/^gulpfile\.[cm]?js$/, ['gulp']],
  [/^postcss\.config\.[cm]?js$/, ['postcss']],
  [/^tailwind\.config\.[cm]?[jt]s$/, ['tailwindcss']],
  [/^(\.eslintrc(\.[cm]?js|\.json|\.ya?ml)?|eslint\.config\.[cm]?[jt]s)$/, ['eslint']],
  [/^(\.prettierrc(\.[cm]?js|\.json|\.ya?ml)?|prettier\.config\.[cm]?js)$/, ['prettier']],
];

/** Packages that are used by their mere presence once a tool is configured. */
const PLUGIN_PATTERNS: [string, RegExp][] = [
  [
    'eslint',
    /^(@[^/]+\/)?eslint-(config|plugin)(-|$)|^@typescript-eslint\/|^@microsoft\/eslint-|^@rushstack\/eslint-/,
  ],
  ['prettier', /^prettier-plugin-|^@[^/]+\/prettier-plugin/],
  ['webpack', /-loader$|-webpack-plugin$/],
  ['@babel/core', /^@babel\/(preset|plugin)-|^babel-(preset|plugin)-/],
  ['jest', /^(jest-|ts-jest$|babel-jest$|@jest\/)/],
  ['postcss', /^(postcss-|autoprefixer$)/],
];

/** Text config files scanned for package names (JSON configs are invisible to the import scan). */
const CONFIG_TEXT =
  /^(tsconfig.*\.json|\.babelrc(\.json)?|\.eslintrc(\.json|\.ya?ml)?|\.prettierrc(\.json|\.ya?ml)?|jest\.config\.json|\.mocharc.*|\.swcrc|babel\.config\.json)$/;

export interface ImplicitUsage {
  packages: Set<string>;
  /** Why each package counts as used, for evidence lines. */
  reasons: Map<string, string>;
}

/**
 * Packages a project uses without importing them from source: tools implied by config files,
 * executables called from npm scripts, plugins of configured tools, type packages, peers.
 */
export async function implicitUsage(project: Project): Promise<ImplicitUsage> {
  const usage: ImplicitUsage = { packages: new Set(), reasons: new Map() };
  const mark = (name: string, reason: string): void => {
    if (!usage.packages.has(name)) {
      usage.packages.add(name);
      usage.reasons.set(name, reason);
    }
  };
  const declared = project.dependencies.map((dep) => dep.name);

  const files = await listConfigFiles(project.dir);
  for (const file of files) {
    for (const [pattern, implied] of CONFIG_IMPLIES) {
      if (!pattern.test(path.basename(file))) continue;
      for (const name of implied) mark(name, `config ${path.basename(file)}`);
    }
  }
  // Packages named by string in build and lint configs (`loader: 'babel-loader'` in gulpfile.js,
  // `extends` in .eslintrc, tsconfig `types`): the tool loads them, so they are used. Comments are
  // stripped first, so a commented-out loader does not keep its package.
  for (const [name, file] of await configReferenceMap(project.dir))
    if (declared.includes(name)) mark(name, `referenced in ${path.relative(project.dir, file)}`);

  for (const [tool, pattern] of PLUGIN_PATTERNS) {
    if (!usage.packages.has(tool) && !declared.includes(tool)) continue;
    for (const name of declared) if (pattern.test(name)) mark(name, `${tool} plugin`);
  }

  const scripts = Object.values(project.manifest.scripts ?? {}).join('\n');
  for (const name of declared) {
    const bins = await binNames(project, name);
    const hit = bins.find((bin) =>
      new RegExp(`(^|[\\s;&|(/"'])${escapeRegExp(bin)}($|[\\s;&|)"'])`, 'm').test(scripts),
    );
    if (hit) mark(name, `script uses ${hit}`);
  }

  for (const dep of project.dependencies) {
    if (dep.name.startsWith('@types/')) mark(dep.name, 'type definitions');
    if (dep.section === 'peerDependencies' || dep.section === 'optionalDependencies')
      mark(dep.name, dep.section);
  }
  return usage;
}

/** Executable names of a package: from its installed package.json, else the unscoped package name. */
async function binNames(project: Project, name: string): Promise<string[]> {
  const fallback = name.split('/').pop() ?? name;
  const manifest = await readJsonFile<{ bin?: string | Record<string, string> }>(
    path.join(project.dir, 'node_modules', name, 'package.json'),
  );
  if (!manifest.ok || manifest.value.bin === undefined) return [fallback];
  return typeof manifest.value.bin === 'string'
    ? [fallback]
    : [...Object.keys(manifest.value.bin), fallback];
}

async function listConfigFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const base of [dir, path.join(dir, 'config')]) {
    if (!existsSync(base)) continue;
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isFile()) result.push(path.join(base, entry.name));
  }
  return result;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** JS config files whose string literals name packages loaded by tools (parsers, plugins, presets). */
const JS_CONFIG =
  /^(\.eslintrc\.[cm]?js|eslint\.config\.[cm]?[jt]s|gulpfile\.[cm]?js|babel\.config\.[cm]?js|jest\.config\.[cm]?[jt]s|webpack(?:\.[\w-]+)?\.config\.[cm]?[jt]s|postcss\.config\.[cm]?js|\.prettierrc\.[cm]?js|vite\.config\.[cm]?[jt]s)$/;
/** Keys whose values name packages that tools load: ESLint, Babel, Jest, TypeScript, webpack. */
const PACKAGE_KEYS =
  /["']?\b(parser|extends|plugins|presets|preset|types|loader|testEnvironment|transform)\b["']?\s*:\s*(\[[^\]]*\]|\{[^}]*\}|["'`][^"'`]+["'`])/g;
const REQUIRE = /\b(?:require(?:\.resolve)?\s*\(|import\s*\(|from\s+)\s*["'`]([^"'`]+)["'`]/g;
const QUOTED = /["'`]([^"'`]+)["'`]/g;

/** `@scope/name/sub/path` or `name/sub` -> package name; local paths and URLs -> undefined. */
function toPackageName(spec: string): string | undefined {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || /^[a-z]+:/i.test(spec))
    return undefined;
  const parts = spec.split('/');
  const name = spec.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0];
  return name && /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) ? name : undefined;
}

/**
 * Packages referenced by config files: `require()`/`import` and the values of keys tools use to load
 * packages (`parser: '@typescript-eslint/parser'`, `extends: [...]`, `plugins`, `presets`, `types`).
 * Tools resolve them from the project directory, so a linked project needs them.
 * Callers keep only the names that exist as installed packages.
 */
export async function configReferences(projectDir: string): Promise<string[]> {
  return [...(await configReferenceMap(projectDir)).keys()].sort();
}

/** Package name -> the first config file that references it. */
export async function configReferenceMap(projectDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const file of await listConfigFiles(projectDir)) {
    const base = path.basename(file);
    const isConfigJson = base.endsWith('.json') && path.basename(path.dirname(file)) === 'config';
    const isJs = JS_CONFIG.test(base);
    if (!isJs && !CONFIG_TEXT.test(base) && !isConfigJson) continue;
    const raw = await readFile(file, 'utf8').catch(() => '');
    const text = isJs ? stripComments(raw) : raw;
    const add = (spec: string): void => {
      const name = toPackageName(spec.trim());
      if (name && !names.has(name)) names.set(name, file);
    };
    for (const match of text.matchAll(REQUIRE)) add(match[1] ?? '');
    for (const match of text.matchAll(PACKAGE_KEYS)) {
      for (const quoted of (match[2] ?? '').matchAll(QUOTED)) {
        const value = quoted[1] ?? '';
        // `types: ["webpack-env"]` in tsconfig means @types/webpack-env.
        add(match[1] === 'types' && !value.startsWith('@') ? `@types/${value}` : value);
      }
    }
  }
  return names;
}
