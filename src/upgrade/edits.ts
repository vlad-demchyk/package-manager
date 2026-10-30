import path from 'node:path';
import type { Edit, Project } from '../core/types.js';
import { DEPENDENCY_SECTIONS } from '../core/types.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export function setPackage(
  project: Project,
  name: string,
  version: string,
  section: 'dependencies' | 'devDependencies',
): Edit[] {
  return [
    ...DEPENDENCY_SECTIONS.filter(
      (other) =>
        other !== section &&
        other !== 'peerDependencies' &&
        project.manifest[other]?.[name] !== undefined,
    ).map((other): Edit => ({
      kind: 'json-remove',
      file: project.manifestPath,
      path: [other, name],
    })),
    { kind: 'json-set', file: project.manifestPath, path: [section, name], value: version },
  ];
}
export function jsonSet(
  project: Project,
  file: string,
  key: (string | number)[],
  value: unknown,
): Edit {
  return { kind: 'json-set', file: path.join(project.dir, file), path: key, value };
}

export async function nodeEdits(project: Project, version: string): Promise<Edit[]> {
  const edits: Edit[] = [
    jsonSet(project, 'package.json', ['engines', 'node'], version),
    { kind: 'file-write', file: path.join(project.dir, '.nvmrc'), content: `${version}\n` },
  ];
  if (existsSync(path.join(project.dir, '.node-version')))
    edits.push({
      kind: 'file-write',
      file: path.join(project.dir, '.node-version'),
      content: `${version}\n`,
    });
  if (project.manifest.volta?.node)
    edits.push(jsonSet(project, 'package.json', ['volta', 'node'], version));
  const engines = project.manifest.devEngines;
  if (engines && typeof engines === 'object' && 'runtime' in engines) {
    const runtimes: unknown[] = Array.isArray(engines.runtime)
      ? engines.runtime
      : [engines.runtime];
    runtimes.forEach((runtime, index) => {
      if (runtime && typeof runtime === 'object' && 'name' in runtime && runtime.name === 'node')
        edits.push(
          jsonSet(
            project,
            'package.json',
            Array.isArray(engines.runtime)
              ? ['devEngines', 'runtime', index, 'version']
              : ['devEngines', 'runtime', 'version'],
            version,
          ),
        );
    });
  }
  const toolVersions = path.join(project.dir, '.tool-versions');
  if (existsSync(toolVersions)) {
    const before = await readFile(toolVersions, 'utf8');
    const after = before.replace(/^(\s*node(?:js)?\s+)\S+/gm, `$1${version}`);
    if (after !== before) edits.push({ kind: 'file-write', file: toolVersions, content: after });
  }
  return edits;
}
