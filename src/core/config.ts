import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readJsonFile } from './json.js';

export const CONFIG_FILE = 'packman.config.json';

/** Folders never treated as projects nor scanned for sources. */
export const ALWAYS_IGNORED_DIRS = [
  'node_modules',
  '.git',
  '.packman',
  'dist',
  'lib',
  'lib-amd',
  'lib-commonjs',
  'lib-dts',
  'lib-esm',
  'temp',
  'release',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
];

const groupSchema = z.object({
  name: z.string().min(1),
  /** Glob patterns on project ids. */
  projects: z.array(z.string()).min(1),
  /** Node version (exact or range) the group is built with. */
  node: z.string().optional(),
  /** Versions every project of the group must use, e.g. `{ "react": "17.0.1" }`. */
  pins: z.record(z.string(), z.string()).default({}),
});

/**
 * Dependency profile, the 3.0 form of the 2.x `dependencies-config.js`.
 * - `dependencies`: version enforced when the package is present or imported (2.x BASE and CONDITIONAL).
 * - `devDependencies`: always present with this version (2.x DEV).
 * - `conditionalDevDependencies`: version enforced when present or imported (2.x CONDITIONAL_DEV).
 * - `deprecated`: removed from every section. `scripts`, `engines`, `overrides`: set as given.
 * - `tsconfig`: merged leaf by leaf into tsconfig.json (2.x replaced whole top-level keys).
 */
const profileSchema = z.object({
  projects: z.array(z.string()).min(1),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  conditionalDevDependencies: z.record(z.string(), z.string()).default({}),
  deprecated: z.array(z.string()).default([]),
  scripts: z.record(z.string(), z.string()).default({}),
  engines: z.record(z.string(), z.string()).default({}),
  overrides: z.record(z.string(), z.unknown()).default({}),
  tsconfig: z.record(z.string(), z.unknown()).default({}),
});

export type ProfileConfig = z.infer<typeof profileSchema>;

export const configSchema = z.object({
  $schema: z.string().optional(),
  language: z.enum(['auto', 'en', 'it', 'uk']).default('auto'),
  projects: z
    .object({
      include: z.array(z.string()).default(['**']),
      exclude: z.array(z.string()).default([]),
      maxDepth: z.number().int().min(0).max(12).default(4),
      includeRoot: z.boolean().default(false),
      /** Files or folders every project must contain (2.x filterByStructure), e.g. `["src", "tsconfig.json"]`. */
      requiredFiles: z.array(z.string()).default([]),
      /** Regular expression on the project id (2.x filterByRegex). */
      match: z.string().optional(),
    })
    .default({ include: ['**'], exclude: [], maxDepth: 4, includeRoot: false, requiredFiles: [] }),
  profiles: z.record(z.string(), profileSchema).default({}),
  policy: z
    .object({
      /** Exact versions are expected everywhere (`^`/`~` reported). */
      exactVersions: z.boolean().default(true),
      groups: z.array(groupSchema).default([]),
    })
    .default({ exactVersions: true, groups: [] }),
  checks: z
    .object({
      disabled: z.array(z.string()).default([]),
      /** Packages that must never be reported as unused. */
      ignoreUnused: z.array(z.string()).default([]),
      /** Globs, relative to each project, excluded from the source scan. */
      ignorePaths: z.array(z.string()).default([]),
    })
    .default({ disabled: [], ignoreUnused: [], ignorePaths: [] }),
  store: z
    .object({
      enabled: z.boolean().default(false),
      dir: z.string().default('.packman/store'),
    })
    .default({ enabled: false, dir: '.packman/store' }),
});

export type PackmanConfig = z.infer<typeof configSchema>;
export type GroupConfig = z.infer<typeof groupSchema>;

export interface LoadedConfig {
  config: PackmanConfig;
  /** Absent when running with defaults. */
  file?: string;
}

export async function loadConfig(root: string): Promise<LoadedConfig> {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) {
    return { config: configSchema.parse({}) };
  }
  const raw = await readJsonFile(file);
  if (!raw.ok) {
    throw new ConfigError(raw.error);
  }
  const parsed = configSchema.safeParse(raw.value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`${file}: ${issues}`);
  }
  return { config: parsed.data, file };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}
