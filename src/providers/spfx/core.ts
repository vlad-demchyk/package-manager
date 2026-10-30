import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { loadData } from '../../core/data.js';
import { parseJsonc } from '../../core/json.js';
import type { DependencySection } from '../../core/types.js';

interface Deps {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface ScaffoldVersion {
  components: Partial<Record<ComponentType, Deps>>;
  toolchains: Partial<Record<'gulp' | 'heft', Deps>>;
  react?: Deps;
}

interface ScaffoldData {
  versions: Record<string, ScaffoldVersion>;
}

export type ComponentType =
  | 'webpart'
  | 'extension'
  | 'applicationCustomizer'
  | 'commandSet'
  | 'fieldCustomizer'
  | 'formCustomizer'
  | 'searchQueryModifier'
  | 'adaptiveCardExtension'
  | 'library';

const EXTENSION_TYPES: Record<string, ComponentType> = {
  ApplicationCustomizer: 'applicationCustomizer',
  ListViewCommandSet: 'commandSet',
  FieldCustomizer: 'fieldCustomizer',
  FormCustomizer: 'formCustomizer',
  SearchQueryModifier: 'searchQueryModifier',
};

/**
 * Packages of the official scaffold that a project can live without (helpers, lint, test, UI kits).
 * Everything else in the scaffold is required for the build or the runtime of that component type.
 */
const OPTIONAL = [
  /^@microsoft\/sp-(lodash-subset|office-ui-fabric-core|webpart-workbench|tslint-rules|dialog|component-base)$/,
  /^@types\/(chai|mocha)$/,
  /^@fluentui\/react$/,
  /^office-ui-fabric-react$/,
  /^@types\/react(-dom)?$/,
];
const LINT =
  /^(eslint|eslint-plugin-react-hooks|@rushstack\/eslint-config|@microsoft\/eslint-(config|plugin)-spfx|@typescript-eslint\/parser)$/;

export interface CorePackage {
  name: string;
  version: string;
  section: DependencySection;
  required: boolean;
}

/** Component types declared by the solution's `*.manifest.json` files. */
export async function componentTypes(projectDir: string): Promise<ComponentType[]> {
  const found = new Set<ComponentType>();
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full, depth + 1);
      } else if (entry.name.endsWith('.manifest.json')) {
        const parsed = parseJsonc<{ componentType?: string; extensionType?: string }>(
          await readFile(full, 'utf8').catch(() => ''),
        );
        if (!parsed.ok) continue;
        const { componentType, extensionType } = parsed.value;
        if (componentType === 'WebPart') found.add('webpart');
        else if (componentType === 'Library') found.add('library');
        else if (componentType === 'AdaptiveCardExtension') found.add('adaptiveCardExtension');
        else if (componentType === 'Extension') {
          found.add('extension');
          const type = extensionType ? EXTENSION_TYPES[extensionType] : undefined;
          if (type) found.add(type);
        }
      }
    }
  };
  const src = path.join(projectDir, 'src');
  if (existsSync(src)) await visit(src, 0);
  return [...found].sort();
}

function scaffoldFor(version: string): ScaffoldVersion | undefined {
  const versions = loadData<ScaffoldData>('spfx-scaffold.json').versions;
  if (versions[version]) return versions[version];
  // Patch releases missing from the data use the closest earlier release of the same line.
  const candidates = Object.keys(versions)
    .filter(
      (candidate) =>
        semver.lte(candidate, version) && semver.major(candidate) === semver.major(version),
    )
    .sort(semver.rcompare);
  const closest = candidates[0];
  return closest ? versions[closest] : undefined;
}

/**
 * Packages the official scaffold installs for this SPFx version, toolchain, component types and React usage.
 * Runtime versions of SPFx packages are normalized to the project's SPFx version (pre-release specs in the
 * generator data are replaced).
 */
export function corePackages(
  version: string,
  toolchain: 'gulp' | 'heft' | 'mixed' | 'unknown',
  types: ComponentType[],
  usesReact: boolean,
  hasLintConfig: boolean,
): CorePackage[] {
  const scaffold = scaffoldFor(version);
  if (!scaffold) return [];
  const sets: Deps[] = [];
  for (const type of types.length > 0 ? types : ['webpart' as const]) {
    const deps = scaffold.components[type];
    if (deps) sets.push(deps);
  }
  const chain = toolchain === 'heft' ? scaffold.toolchains.heft : scaffold.toolchains.gulp;
  if (chain) sets.push(chain);
  if (usesReact && scaffold.react) sets.push(scaffold.react);

  const result = new Map<string, CorePackage>();
  for (const deps of sets) {
    for (const section of ['dependencies', 'devDependencies'] as const) {
      for (const [name, spec] of Object.entries(deps[section])) {
        if (result.has(name)) continue;
        const normalized =
          name.startsWith('@microsoft/') && /^\d/.test(spec) && semver.prerelease(spec)
            ? version
            : spec;
        const required =
          !OPTIONAL.some((pattern) => pattern.test(name)) && (!LINT.test(name) || hasLintConfig);
        result.set(name, { name, version: normalized, section, required });
      }
    }
  }
  return [...result.values()];
}
