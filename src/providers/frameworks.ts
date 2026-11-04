import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { loadData } from '../core/data.js';
import { finding, fix, msg } from '../core/findings.js';
import type { FrameworkData } from '../ops/data.js';
import { isTopLevel } from '../core/lockfile.js';
import type { Constraint, Finding, Project, StackInfo } from '../core/types.js';
import { majorOf, resolveVersion } from '../core/versions.js';
import type { StackProvider } from './types.js';

interface FrameworkSpec {
  id: string;
  /** Package whose version is the stack version. */
  anchor: string;
  /** Config files that confirm the stack even without the anchor installed. */
  files?: string[];
}

/** Version of a stack = version of its anchor package; Node limits come from its `engines`. */
function frameworkProvider(spec: FrameworkSpec, check?: StackProvider['check']): StackProvider {
  const provider: StackProvider = {
    id: spec.id,
    detect(ctx) {
      const resolved = resolveVersion(ctx.project, spec.anchor);
      const file = spec.files?.find((name) => existsSync(path.join(ctx.project.dir, name)));
      if (!resolved && !file) return undefined;
      const stack: StackInfo = {
        provider: spec.id,
        confidence: resolved ? 'high' : 'medium',
        evidence: [
          ...(resolved ? [`${spec.anchor} ${resolved.version} (${resolved.source})`] : []),
          ...(file ? [file] : []),
        ],
        details: {},
      };
      if (resolved) stack.version = resolved.version;
      return stack;
    },
    constraints(ctx) {
      const constraints: Constraint[] = [];
      const locked = ctx.project.lockfile?.packages.find(
        (pkg) => pkg.name === spec.anchor && isTopLevel(pkg),
      );
      const range = locked?.engines?.node;
      if (range && semver.validRange(range))
        constraints.push({
          kind: 'node',
          range,
          source: `${spec.anchor}@${locked.version} engines`,
        });
      // The framework matrix (data/frameworks.json, read from the registry) covers projects that
      // are not installed or locked yet, and the companion packages the framework peers on.
      const resolved = resolveVersion(ctx.project, spec.anchor);
      const major = resolved ? majorOf(resolved.version) : undefined;
      const entry =
        major === undefined
          ? undefined
          : loadData<FrameworkData>('frameworks.json').frameworks[spec.id]?.majors[String(major)];
      if (!entry || major === undefined) return constraints;
      const source = `${spec.id} ${major} (${spec.anchor}@${entry.version}, npm registry)`;
      if (!range && entry.node && semver.validRange(entry.node))
        constraints.push({ kind: 'node', range: entry.node, source });
      for (const [name, packageRange] of Object.entries(entry.packages))
        if (
          semver.validRange(packageRange) &&
          ctx.project.dependencies.some((dep) => dep.name === name)
        )
          constraints.push({ kind: 'package', name, range: packageRange, source });
      return constraints;
    },
  };
  if (check) provider.check = check;
  return provider;
}

export const reactProvider = frameworkProvider({ id: 'react', anchor: 'react' }, (ctx) => {
  const findings: Finding[] = [];
  const react = resolveVersion(ctx.project, 'react');
  const types = resolveVersion(ctx.project, '@types/react');
  if (react && types && majorOf(react.version) !== majorOf(types.version)) {
    findings.push(
      finding(
        'react/types-major',
        'warning',
        ctx.project,
        msg('react.typesMajor', { react: react.version, types: types.version }),
        {
          tags: ['react', 'typescript'],
        },
      ),
    );
  }
  return findings;
});

/** Tools that load TypeScript through its programmatic API, unavailable in TypeScript 7. */
const TS_API_CONSUMERS = [
  'typescript-eslint',
  '@typescript-eslint/parser',
  'ts-jest',
  '@angular/compiler-cli',
  'vue-tsc',
  'ts-node',
  'ts-loader',
];

export const typescriptProvider = frameworkProvider(
  { id: 'typescript', anchor: 'typescript', files: ['tsconfig.json'] },
  (ctx) => {
    const ts = resolveVersion(ctx.project, 'typescript');
    if (!ts || (majorOf(ts.version) ?? 0) < 7) return [];
    const consumers = TS_API_CONSUMERS.filter((name) =>
      ctx.project.dependencies.some((dep) => dep.name === name),
    );
    if (consumers.length === 0) return [];
    return [
      finding(
        'typescript/v7-api-consumers',
        'error',
        ctx.project,
        msg('typescript.v7Api', { version: ts.version }),
        {
          evidence: consumers,
          tags: ['typescript', 'compatibility'],
        },
      ),
    ];
  },
);

export const viteProvider = frameworkProvider({
  id: 'vite',
  anchor: 'vite',
  files: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
});
export const nextProvider = frameworkProvider({
  id: 'next',
  anchor: 'next',
  files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
});
export const angularProvider = frameworkProvider({
  id: 'angular',
  anchor: '@angular/core',
  files: ['angular.json'],
});
export const vueProvider = frameworkProvider({ id: 'vue', anchor: 'vue' });
export const electronProvider = frameworkProvider({ id: 'electron', anchor: 'electron' });
export const jestProvider = frameworkProvider({
  id: 'jest',
  anchor: 'jest',
  files: ['jest.config.js', 'jest.config.ts'],
});
export const vitestProvider = frameworkProvider({
  id: 'vitest',
  anchor: 'vitest',
  files: ['vitest.config.ts', 'vitest.config.js'],
});

export const eslintProvider = frameworkProvider(
  {
    id: 'eslint',
    anchor: 'eslint',
    files: ['eslint.config.js', 'eslint.config.mjs', '.eslintrc.js', '.eslintrc.json'],
  },
  async (ctx) => {
    const unknown = await unknownPluginRules(ctx.project);
    const eslint = resolveVersion(ctx.project, 'eslint');
    const legacy = [
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.cjs',
      '.eslintrc.yml',
      '.eslintrc',
    ].find((name) => existsSync(path.join(ctx.project.dir, name)));
    if (eslint && legacy && (majorOf(eslint.version) ?? 0) >= 10) {
      return [
        ...unknown,
        finding(
          'eslint/legacy-config-ignored',
          'error',
          ctx.project,
          msg('eslint.legacyIgnored', { version: eslint.version, file: legacy }),
          {
            tags: ['lint'],
          },
        ),
      ];
    }
    return unknown;
  },
);

const ESLINT_CONFIGS = [
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.mjs',
];

/**
 * Rules typescript-eslint removed and the rule that took over. `options: true` when the successor
 * accepts the same options; otherwise only the severity carries over.
 */
const SUCCESSORS: Record<string, { rule: string; options: boolean }> = {
  'ban-types': { rule: 'no-restricted-types', options: true },
  'no-var-requires': { rule: 'no-require-imports', options: true },
  'no-throw-literal': { rule: 'only-throw-error', options: false },
  'no-useless-template-literals': { rule: 'no-unnecessary-template-expression', options: false },
  'no-empty-interface': { rule: 'no-empty-object-type', options: false },
};

/** What `ban-types` banned by default; with `extendDefaults` the successor rules cover it. */
const BAN_TYPES_DEFAULTS = [
  'no-empty-object-type',
  'no-unsafe-function-type',
  'no-wrapper-object-types',
];

/**
 * Rules of `@typescript-eslint` a config sets that the installed plugin does not have, and
 * `no-unused-vars` without `caughtErrors` on plugin 8+, whose default moved from `none` to `all`.
 * ESLint reports each as a warning in every file, which SPFx `--ship` builds turn into a failed build
 * unless the gulpfile suppresses warnings. The installed rule set is read from the plugin's
 * `dist/rules` file names, without running it.
 */
async function unknownPluginRules(project: Project): Promise<Finding[]> {
  const pluginDir = path.join(project.dir, 'node_modules', '@typescript-eslint', 'eslint-plugin');
  const rulesDir = path.join(pluginDir, 'dist', 'rules');
  if (!existsSync(rulesDir)) return [];
  const available = new Set(
    (await readdir(rulesDir))
      .filter((name) => name.endsWith('.js'))
      .map((name) => name.slice(0, -3)),
  );
  const version = (
    JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8')) as { version?: string }
  ).version;
  const gulpfile = path.join(project.dir, 'gulpfile.js');
  // `build.addSuppression(/Warning/gi)` hides lint warnings from the build result.
  const suppressed =
    existsSync(gulpfile) &&
    /addSuppression\(\s*\/Warning\//i.test(await readFile(gulpfile, 'utf8'));
  const severity = suppressed ? 'warning' : 'error';
  const findings: Finding[] = [];
  const major = Number.parseInt(version ?? '0', 10);
  for (const name of ESLINT_CONFIGS) {
    const file = path.join(project.dir, name);
    if (!existsSync(file)) continue;
    const text = await readFile(file, 'utf8');
    const missing = [
      ...new Set(
        [...text.matchAll(/['"]@typescript-eslint\/([a-z0-9-]+)['"]\s*:/g)].map((m) => m[1] ?? ''),
      ),
    ].filter((rule) => rule && !available.has(rule));
    const migrated = missing.reduce((current, rule) => migrateRule(current, rule, available), text);
    const caught = major >= 8 && keepCaughtErrors(text) !== text;
    // Both fixes write the whole file, so each carries every change: applying one or both gives
    // the same file.
    const content = caught ? keepCaughtErrors(migrated) : migrated;
    const write = [{ kind: 'file-write' as const, file, content }];
    if (missing.length > 0)
      findings.push(
        finding(
          'eslint/unknown-rule',
          severity,
          project,
          msg(suppressed ? 'eslint.unknownRuleSuppressed' : 'eslint.unknownRule', {
            count: missing.length,
            file: name,
            version: version ?? '?',
          }),
          {
            evidence: missing.map((rule) => {
              const next = SUCCESSORS[rule];
              return next && available.has(next.rule)
                ? `${rule} -> ${next.rule}`
                : `${rule} (removed)`;
            }),
            fixes: [
              fix('eslint/migrate-rules', msg('fix.migrateRules', { file: name }), 'review', write),
            ],
            tags: ['lint', 'compatibility'],
          },
        ),
      );
    if (caught)
      findings.push(
        finding(
          'eslint/caught-errors',
          severity,
          project,
          msg('eslint.caughtErrors', { file: name, version: version ?? '?' }),
          {
            fixes: [
              fix(
                'eslint/keep-caught-errors',
                msg('fix.keepCaughtErrors', { file: name }),
                missing.length > 0 ? 'review' : 'safe',
                write,
              ),
            ],
            tags: ['lint', 'compatibility'],
          },
        ),
      );
  }
  return findings;
}

/**
 * Adds `caughtErrors: 'none'` to the options of `@typescript-eslint/no-unused-vars`, which plugin 8
 * otherwise checks with `all`; unchanged when the rule has no options object or already sets it.
 */
function keepCaughtErrors(text: string): string {
  const span = propertySpan(text, 'no-unused-vars');
  if (!span) return text;
  const options = text.slice(span.valueStart, span.end);
  if (!options.includes('{') || /caughtErrors/.test(options)) return text;
  const brace = text.indexOf('{', span.valueStart);
  const indent = /\n([ \t]*)\S/.exec(text.slice(brace))?.[1] ?? '  ';
  const quote = /['"]vars['"]/.exec(options)?.[0]?.[0] ?? "'";
  return `${text.slice(0, brace + 1)}\n${indent}${quote}caughtErrors${quote}: ${quote}none${quote},${text.slice(brace + 1)}`;
}
interface PropertySpan {
  /** Start of the key's opening quote. */
  start: number;
  valueStart: number;
  /** End of the value, before any trailing comma. */
  end: number;
}

/** Location of `'@typescript-eslint/<rule>': value` (a scalar or a bracketed array/object). */
function propertySpan(text: string, rule: string): PropertySpan | undefined {
  const match = new RegExp(`(['"])@typescript-eslint/${rule}\\1\\s*:`).exec(text);
  if (!match) return undefined;
  let end = match.index + match[0].length;
  while (/\s/.test(text[end] ?? '')) end++;
  const valueStart = end;
  const open = text[end];
  if (open === '[' || open === '{') {
    let depth = 0;
    let quote: string | undefined;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === '\\') end++;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
  } else {
    while (end < text.length && !/[,\n}]/.test(text[end] ?? '')) end++;
  }
  return { start: match.index, valueStart, end };
}

/**
 * Moves a removed rule to its successor: the key is renamed, options are kept when the successor
 * takes the same ones (`ban-types` loses `extendDefaults`, which then adds the rules covering its
 * defaults), otherwise only the severity is kept. Without a successor the property is removed.
 */
export function migrateRule(text: string, rule: string, available: ReadonlySet<string>): string {
  const span = propertySpan(text, rule);
  const successor = SUCCESSORS[rule];
  if (!span || !successor || !available.has(successor.rule)) return removeRule(text, rule);
  const quote = text[span.start] ?? "'";
  const value = text.slice(span.valueStart, span.end);
  const severity = value.startsWith('[')
    ? (/^\[\s*([^,\]\s]+)/.exec(value)?.[1] ?? '1')
    : value.trim();
  let next = successor.options ? value : severity;
  const extra: string[] = [];
  if (rule === 'ban-types') {
    const extend = /(['"]?)extendDefaults\1\s*:\s*(true|false)\s*,?\s*/.exec(next);
    if (!extend || extend[2] === 'true')
      for (const covered of BAN_TYPES_DEFAULTS)
        if (available.has(covered))
          extra.push(`${quote}@typescript-eslint/${covered}${quote}: ${severity}`);
    if (extend) next = next.replace(extend[0], '');
  }
  const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
  const indent = text.slice(lineStart, span.start);
  const additions = extra.map((line) => `,\n${indent}${line}`).join('');
  return `${text.slice(0, span.start)}${quote}@typescript-eslint/${successor.rule}${quote}: ${next}${additions}${text.slice(span.end)}`;
}

/** Removes one `'@typescript-eslint/<rule>': value` property with its comma and its own line. */
export function removeRule(text: string, rule: string): string {
  const span = propertySpan(text, rule);
  if (!span) return text;
  let { start, end } = span;
  if (text[end] === ',') end++;
  else {
    // Last property: drop the comma that preceded it instead.
    const before = text.slice(0, start).search(/,\s*$/);
    if (before !== -1) start = before;
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = text.indexOf('\n', end);
  const alone =
    text.slice(lineStart, start).trim() === '' &&
    text.slice(end, lineEnd === -1 ? text.length : lineEnd).trim() === '';
  return alone
    ? text.slice(0, lineStart) + text.slice(lineEnd === -1 ? text.length : lineEnd + 1)
    : text.slice(0, start) + text.slice(end);
}

/** Rules typescript-eslint 8 no longer has; migrated before installation, when no plugin is on disk. */
const REMOVED_IN_8 = ['ban-types', 'no-throw-literal', 'no-useless-template-literals'];

/**
 * A legacy ESLint config moved to typescript-eslint 8 without the installed plugin to read: the rules
 * 8 removed go to their successors and `no-unused-vars` keeps catch bindings unchecked. After
 * installation `eslint/unknown-rule` checks the config against the plugin actually installed.
 */
export function migrateEslintForPlugin8(text: string): string {
  const successors = new Set([
    ...REMOVED_IN_8.map((rule) => SUCCESSORS[rule]?.rule ?? ''),
    ...BAN_TYPES_DEFAULTS,
  ]);
  const migrated = REMOVED_IN_8.filter((rule) => propertySpan(text, rule)).reduce(
    (current, rule) => migrateRule(current, rule, successors),
    text,
  );
  return keepCaughtErrors(migrated);
}
