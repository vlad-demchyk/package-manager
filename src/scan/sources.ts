import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { ALWAYS_IGNORED_DIRS } from '../core/config.js';
import { loadData } from '../core/data.js';

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
]);
const STYLE_EXTENSIONS = new Set(['.scss', '.sass', '.less', '.css']);
/** SPFx and build outputs that would hide unused dependencies if scanned. */
const EXTRA_IGNORED = new Set(['sharepoint', 'out', 'build', '.storybook-out']);
const IGNORED = new Set([...ALWAYS_IGNORED_DIRS, ...EXTRA_IGNORED]);
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const MAX_FILES = 5000;

export interface SourceScan {
  /** Bare package names referenced by code, with one example file each. */
  imports: Map<string, string>;
  /** Network usage signals: pattern id -> example file. */
  network: Map<string, string>;
  filesScanned: number;
  truncated: boolean;
}

interface NetworkData {
  codePatterns: { id: string; regex: string }[];
}

/** `ignore`: globs relative to the project directory excluded from the scan (e.g. `test/**`). */
export async function scanSources(projectDir: string, ignore: string[] = []): Promise<SourceScan> {
  const patterns = loadData<NetworkData>('network.json').codePatterns.map((pattern) => ({
    id: pattern.id,
    regex: new RegExp(pattern.regex),
  }));
  const scan: SourceScan = {
    imports: new Map(),
    network: new Map(),
    filesScanned: 0,
    truncated: false,
  };
  const isIgnored = ignore.length > 0 ? picomatch(ignore, { dot: true }) : () => false;
  const collected: string[] = [];
  await collectFiles(projectDir, collected);
  const files = collected.filter(
    (file) => !isIgnored(path.relative(projectDir, file).split(path.sep).join('/')),
  );
  if (files.length > MAX_FILES) {
    scan.truncated = true;
    files.length = MAX_FILES;
  }

  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const rel = path.relative(projectDir, file).split(path.sep).join('/');
    const ext = path.extname(file);
    const code = stripComments(text);
    const specifiers = STYLE_EXTENSIONS.has(ext) ? styleSpecifiers(code) : codeSpecifiers(code);
    for (const specifier of specifiers) {
      const name = packageNameOf(specifier);
      if (name && !scan.imports.has(name)) scan.imports.set(name, rel);
    }
    if (CODE_EXTENSIONS.has(ext)) {
      for (const { id, regex } of patterns) {
        if (!scan.network.has(id) && regex.test(code)) scan.network.set(id, rel);
      }
    }
    scan.filesScanned++;
  }
  return scan;
}

async function collectFiles(dir: string, out: string[]): Promise<void> {
  if (out.length > MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name) && !entry.name.startsWith('.')) await collectFiles(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (
        (CODE_EXTENSIONS.has(ext) && !entry.name.endsWith('.d.ts')) ||
        STYLE_EXTENSIONS.has(ext)
      ) {
        out.push(full);
      }
    }
  }
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?["']([^"'\n]+)["']/g,
  /\bexport\s+(?:type\s+)?[\w*{}\s,$]*\s+from\s+["']([^"'\n]+)["']/g,
  /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?["']([^"'\n]+)["']\s*\)/g,
  /\brequire(?:\.resolve)?\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
];

export function codeSpecifiers(code: string): string[] {
  const result: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) result.push(match[1]);
    }
  }
  return result;
}

export function styleSpecifiers(code: string): string[] {
  const result: string[] = [];
  for (const match of code.matchAll(/@(?:import|use|forward)\s+(?:url\()?["']([^"'\n]+)["']/g)) {
    const spec = match[1];
    if (!spec) continue;
    // Only `~pkg/...` and `pkg:pkg/...` refer to packages; bare names are local partials in Sass.
    if (spec.startsWith('~')) result.push(spec.slice(1));
    else if (spec.startsWith('pkg:')) result.push(spec.slice(4));
  }
  return result;
}

/** `@scope/name/sub` -> `@scope/name`; relative, absolute, builtins and URLs -> undefined. */
export function packageNameOf(specifier: string): string | undefined {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[a-z]+:\/\//i.test(specifier)
  ) {
    return undefined;
  }
  if (BUILTINS.has(specifier) || specifier.startsWith('node:')) return undefined;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0];
  if (!name || BUILTINS.has(name) || !/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) return undefined;
  return name;
}

/** Removes JS comments while keeping string and template literals intact. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let quote: string | undefined;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i++;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
