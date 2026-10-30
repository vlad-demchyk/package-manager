import { existsSync } from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';
import type { PackmanConfig, ProfileConfig } from '../core/config.js';
import { finding, fix, msg } from '../core/findings.js';
import { readJsonFile } from '../core/json.js';
import type { DependencySection, Edit, Finding, Project } from '../core/types.js';
import { isExactSpec, minVersionOf, satisfies } from '../core/versions.js';
import type { ProjectContext } from '../providers/types.js';

/** Profiles that apply to a project, merged in declaration order (later profiles win). */
export function profileFor(
  config: PackmanConfig,
  projectId: string,
): { names: string[]; profile: ProfileConfig } | undefined {
  const matching = Object.entries(config.profiles).filter(([, profile]) =>
    picomatch(profile.projects)(projectId),
  );
  if (matching.length === 0) return undefined;
  const merged: ProfileConfig = {
    projects: [],
    dependencies: {},
    devDependencies: {},
    conditionalDevDependencies: {},
    deprecated: [],
    scripts: {},
    engines: {},
    overrides: {},
    tsconfig: {},
  };
  for (const [, profile] of matching) {
    Object.assign(merged.dependencies, profile.dependencies);
    Object.assign(merged.devDependencies, profile.devDependencies);
    Object.assign(merged.conditionalDevDependencies, profile.conditionalDevDependencies);
    merged.deprecated.push(...profile.deprecated);
    Object.assign(merged.scripts, profile.scripts);
    Object.assign(merged.engines, profile.engines);
    Object.assign(merged.overrides, profile.overrides);
    merged.tsconfig = deepMerge(merged.tsconfig, profile.tsconfig);
  }
  return { names: matching.map(([name]) => name), profile: merged };
}

/** True when a declared spec already matches the profile version (exact profile versions must be identical). */
export function specMatches(spec: string, wanted: string): boolean {
  if (spec === wanted) return true;
  if (isExactSpec(wanted)) return false;
  const min = minVersionOf(spec);
  return min !== undefined && satisfies(min, wanted);
}

function setIn(project: Project, section: DependencySection, name: string, version: string): Edit {
  return { kind: 'json-set', file: project.manifestPath, path: [section, name], value: version };
}

function removeFrom(project: Project, section: DependencySection, name: string): Edit {
  return { kind: 'json-remove', file: project.manifestPath, path: [section, name] };
}

interface Change {
  line: string;
  edits: Edit[];
}

/** Compares a project with its profile; every difference becomes a finding with a fix. */
export async function profileFindings(ctx: ProjectContext): Promise<Finding[]> {
  const { project, config } = ctx;
  const match = profileFor(config, project.id);
  if (!match) return [];
  const { profile, names } = match;
  const scan = await ctx.sources();
  const declared = (name: string, section: DependencySection): string | undefined =>
    project.manifest[section]?.[name];
  const used = (name: string): boolean => scan.imports.has(name);

  const versions: Change[] = [];
  const misplaced: Change[] = [];
  const added: Change[] = [];

  const enforce = (
    entries: Record<string, string>,
    canonical: 'dependencies' | 'devDependencies',
    always: boolean,
  ): void => {
    const opposite = canonical === 'dependencies' ? 'devDependencies' : 'dependencies';
    for (const [name, wanted] of Object.entries(entries)) {
      const inCanonical = declared(name, canonical);
      const inOpposite = declared(name, opposite);
      if (inCanonical !== undefined) {
        if (!specMatches(inCanonical, wanted)) {
          versions.push({
            line: `${name}: ${inCanonical} -> ${wanted}`,
            edits: [setIn(project, canonical, name, wanted)],
          });
        }
        if (inOpposite !== undefined) {
          misplaced.push({
            line: `${name}: also in ${opposite}`,
            edits: [removeFrom(project, opposite, name)],
          });
        }
      } else if (inOpposite !== undefined) {
        misplaced.push({
          line: `${name}: ${opposite} -> ${canonical} (${wanted})`,
          edits: [removeFrom(project, opposite, name), setIn(project, canonical, name, wanted)],
        });
      } else if (always || used(name)) {
        added.push({
          line: `${name}@${wanted} (${canonical}${always ? '' : ', imported'})`,
          edits: [setIn(project, canonical, name, wanted)],
        });
      }
    }
  };
  enforce(profile.dependencies, 'dependencies', false);
  enforce(profile.devDependencies, 'devDependencies', true);
  enforce(profile.conditionalDevDependencies, 'devDependencies', false);

  const findings: Finding[] = [];
  const push = (
    ruleId: string,
    severity: Finding['severity'],
    key: string,
    changes: Change[],
    risk: 'safe' | 'review',
  ): void => {
    if (changes.length === 0) return;
    findings.push(
      finding(
        ruleId,
        severity,
        project,
        msg(key, { count: changes.length, profile: names.join(' + ') }),
        {
          evidence: changes.map((change) => change.line),
          fixes: [
            fix(
              ruleId,
              msg('fix.applyProfile', { profile: names.join(' + ') }),
              risk,
              changes.flatMap((change) => change.edits),
            ),
          ],
          tags: ['profile', 'alignment'],
        },
      ),
    );
  };
  push('profile/versions', 'warning', 'profile.versions', versions, 'review');
  push('profile/misplaced', 'warning', 'profile.misplaced', misplaced, 'review');
  push('profile/missing', 'warning', 'profile.missing', added, 'review');

  const deprecated = [...new Set(profile.deprecated)].flatMap((name) =>
    (['dependencies', 'devDependencies', 'optionalDependencies'] as const)
      .filter((section) => declared(name, section) !== undefined)
      .map((section) => ({
        line: `${name} (${section})`,
        edits: [removeFrom(project, section, name)],
      })),
  );
  push('profile/deprecated', 'warning', 'profile.deprecated', deprecated, 'review');

  const scripts = Object.entries(profile.scripts)
    .filter(([name, command]) => project.manifest.scripts?.[name] !== command)
    .map(([name, command]) => ({
      line: `${name}: ${project.manifest.scripts?.[name] ?? '-'} -> ${command}`,
      edits: [
        {
          kind: 'json-set' as const,
          file: project.manifestPath,
          path: ['scripts', name],
          value: command,
        },
      ],
    }));
  push('profile/scripts', 'info', 'profile.scripts', scripts, 'safe');

  const engines = Object.entries(profile.engines)
    .filter(([name, range]) => project.manifest.engines?.[name] !== range)
    .map(([name, range]) => ({
      line: `engines.${name}: ${project.manifest.engines?.[name] ?? '-'} -> ${range}`,
      edits: [
        {
          kind: 'json-set' as const,
          file: project.manifestPath,
          path: ['engines', name],
          value: range,
        },
      ],
    }));
  push('profile/engines', 'warning', 'profile.engines', engines, 'safe');

  const currentOverrides: Record<string, unknown> = project.manifest.overrides ?? {};
  const overrides = Object.entries(profile.overrides)
    .filter(([name, value]) => JSON.stringify(currentOverrides[name]) !== JSON.stringify(value))
    .map(([name, value]) => ({
      line: `overrides.${name}: ${JSON.stringify(currentOverrides[name] ?? null)} -> ${JSON.stringify(value)}`,
      edits: [
        { kind: 'json-set' as const, file: project.manifestPath, path: ['overrides', name], value },
      ],
    }));
  push('profile/overrides', 'warning', 'profile.overrides', overrides, 'review');

  findings.push(...(await tsconfigFindings(project, profile.tsconfig, names)));
  return findings;
}

async function tsconfigFindings(
  project: Project,
  wanted: Record<string, unknown>,
  names: string[],
): Promise<Finding[]> {
  if (Object.keys(wanted).length === 0) return [];
  const file = path.join(project.dir, 'tsconfig.json');
  if (!existsSync(file)) return [];
  const current = await readJsonFile<Record<string, unknown>>(file);
  if (!current.ok) {
    return [
      finding('profile/tsconfig-invalid', 'warning', project, msg('profile.tsconfigInvalid'), {
        evidence: [current.error],
        tags: ['profile'],
      }),
    ];
  }
  const changes = leaves(wanted)
    .filter(
      ({ path: keyPath, value }) =>
        JSON.stringify(getAt(current.value, keyPath)) !== JSON.stringify(value),
    )
    .map(({ path: keyPath, value }) => ({
      line: `${keyPath.join('.')}: ${JSON.stringify(getAt(current.value, keyPath) ?? null)} -> ${JSON.stringify(value)}`,
      edit: { kind: 'json-set' as const, file, path: keyPath, value },
    }));
  if (changes.length === 0) return [];
  return [
    finding(
      'profile/tsconfig',
      'info',
      project,
      msg('profile.tsconfig', { count: changes.length, profile: names.join(' + ') }),
      {
        evidence: changes.map((change) => change.line),
        fixes: [
          fix(
            'profile/tsconfig',
            msg('fix.applyProfile', { profile: names.join(' + ') }),
            'safe',
            changes.map((change) => change.edit),
          ),
        ],
        tags: ['profile', 'typescript'],
      },
    ),
  ];
}

/** Flattens nested objects to leaf paths; arrays are leaves. */
export function leaves(
  value: Record<string, unknown>,
  prefix: string[] = [],
): { path: string[]; value: unknown }[] {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? leaves(child as Record<string, unknown>, [...prefix, key])
      : [{ path: [...prefix, key], value: child }],
  );
}

function getAt(value: unknown, keyPath: string[]): unknown {
  let current: unknown = value;
  for (const key of keyPath) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function deepMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key];
    result[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
        ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return result;
}
