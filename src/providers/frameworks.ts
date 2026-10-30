import { existsSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { finding, msg } from '../core/findings.js';
import { isTopLevel } from '../core/lockfile.js';
import type { Constraint, Finding, StackInfo } from '../core/types.js';
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
      const locked = ctx.project.lockfile?.packages.find(
        (pkg) => pkg.name === spec.anchor && isTopLevel(pkg),
      );
      const range = locked?.engines?.node;
      return range && semver.validRange(range)
        ? [
            {
              kind: 'node',
              range,
              source: `${spec.anchor}@${locked.version} engines`,
            } satisfies Constraint,
          ]
        : [];
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
  (ctx) => {
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
    return [];
  },
);
