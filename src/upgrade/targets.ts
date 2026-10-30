import semver from 'semver';
import type { ProjectReport } from '../analyze.js';
import { primaryStack } from '../policy/groups.js';

export const STACK_ANCHORS: Record<string, string> = {
  spfx: '@microsoft/sp-core-library',
  angular: '@angular/core',
  next: 'next',
  electron: 'electron',
  vue: 'vue',
  vite: 'vite',
  react: 'react',
  typescript: 'typescript',
  eslint: 'eslint',
  jest: 'jest',
  vitest: 'vitest',
};

export function migrationStack(entry: ProjectReport): string {
  return primaryStack(entry.stacks)?.provider ?? 'node';
}

export function stackVersion(
  entry: ProjectReport,
  stack = migrationStack(entry),
): string | undefined {
  return stack === 'node'
    ? entry.node.selected?.version
    : entry.stacks.find((item) => item.provider === stack)?.version;
}

/** The baseline is an existing project, never a release selected from the registry. */
export function newestProject(entries: ProjectReport[], stack: string): ProjectReport | undefined {
  return entries
    .filter((entry) => migrationStack(entry) === stack && semver.valid(stackVersion(entry, stack)))
    .sort(
      (a, b) =>
        semver.rcompare(stackVersion(a, stack) ?? '0.0.0', stackVersion(b, stack) ?? '0.0.0') ||
        a.project.id.localeCompare(b.project.id),
    )[0];
}
