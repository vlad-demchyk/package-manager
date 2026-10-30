import type {
  DependencySection,
  Edit,
  Finding,
  Fix,
  Message,
  Project,
  Risk,
  Severity,
} from './types.js';

export function msg(key: string, params?: Message['params']): Message {
  return params ? { key, params } : { key };
}

export function finding(
  ruleId: string,
  severity: Severity,
  project: Project | undefined,
  message: Message,
  options: { evidence?: string[]; fixes?: Fix[]; tags?: string[] } = {},
): Finding {
  const result: Finding = {
    ruleId,
    severity,
    message,
    evidence: options.evidence ?? [],
    fixes: options.fixes ?? [],
    tags: options.tags ?? [],
  };
  if (project) result.projectId = project.id;
  return result;
}

export function fix(id: string, title: Message, risk: Risk, edits: Edit[]): Fix {
  return { id, title, risk, edits, commands: [] };
}

/** Edit that sets a dependency version in the section where it is declared (or `fallback`). */
export function setDependency(
  project: Project,
  name: string,
  version: string,
  fallback: DependencySection = 'dependencies',
): Edit {
  const section = project.dependencies.find((dep) => dep.name === name)?.section ?? fallback;
  return { kind: 'json-set', file: project.manifestPath, path: [section, name], value: version };
}

export function removeDependency(project: Project, name: string): Edit[] {
  return project.dependencies
    .filter((dep) => dep.name === name)
    .map((dep) => ({
      kind: 'json-remove' as const,
      file: project.manifestPath,
      path: [dep.section, name],
    }));
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.projectId ?? '').localeCompare(b.projectId ?? '') ||
      a.ruleId.localeCompare(b.ruleId),
  );
}
