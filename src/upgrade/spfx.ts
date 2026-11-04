import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import type { ProjectReport } from '../analyze.js';
import { msg, removeDependency } from '../core/findings.js';
import { readJsonFile } from '../core/json.js';
import type { Edit, Project } from '../core/types.js';
import { minVersionOf, resolveVersion, satisfies } from '../core/versions.js';
import { migrateEslintForPlugin8 } from '../providers/frameworks.js';
import { corePackages, componentTypes } from '../providers/spfx/core.js';
import {
  expectedCompiler,
  findSpfxVersion,
  libraryTarget,
  spfxMatrix,
} from '../providers/spfx/matrix.js';
import { stripComments } from '../scan/sources.js';
import { jsonSet, nodeEdits, setPackage } from './edits.js';
import type { MigrationIssue } from './types.js';

export function spfxOwned(name: string): boolean {
  return (
    name.startsWith('@microsoft/sp-') ||
    name.startsWith('@microsoft/spfx-') ||
    name.startsWith('@microsoft/rush-stack-compiler-') ||
    [
      '@microsoft/decorators',
      '@microsoft/eslint-config-spfx',
      '@microsoft/eslint-plugin-spfx',
      'typescript',
      'react',
      'react-dom',
      '@types/react',
      '@types/react-dom',
      'gulp',
      '@rushstack/heft',
    ].includes(name)
  );
}

export async function spfxMigration(
  entry: ProjectReport,
  baseline: ProjectReport,
  version: string,
  node: string,
  pins: Record<string, string>,
): Promise<{ edits: Edit[]; issues: MigrationIssue[] }> {
  const project = entry.project;
  const edits: Edit[] = [];
  const issues: MigrationIssue[] = [];
  const target = findSpfxVersion(version);
  if (!target)
    return {
      edits,
      issues: [
        {
          code: 'unknown-spfx',
          level: 'blocker',
          message: msg('upgrade.unknownSpfx', { version }),
        },
      ],
    };
  const baselineToolchain = baseline.stacks.find((stack) => stack.provider === 'spfx')?.details
    .toolchain;
  const chain =
    target.toolchain === 'gulp' ||
    (baselineToolchain === 'gulp' && target.gulpVariant && !target.gulpUnsupported)
      ? 'gulp'
      : 'heft';
  const currentChain = entry.stacks.find((stack) => stack.provider === 'spfx')?.details.toolchain;
  const usesReact =
    entry.imports.includes('react') ||
    project.dependencies.some((dep) => dep.name === 'react' || dep.name === 'react-dom');
  const components = await componentTypes(project.dir);
  const scaffold = corePackages(version, chain, components, usesReact, true);
  const specs = new Map(scaffold.map((pkg) => [pkg.name, pkg]));
  for (const dep of project.dependencies) {
    if (dep.section === 'peerDependencies') continue;
    if (target.lint === 'eslint' && ['tslint', '@microsoft/sp-tslint-rules'].includes(dep.name)) {
      edits.push(...removeDependency(project, dep.name));
      continue;
    }
    if (
      dep.name.startsWith('@microsoft/rush-stack-compiler-') ||
      (chain === 'heft' &&
        [
          'gulp',
          'gulp-sass',
          'ajv',
          '@microsoft/sp-build-web',
          '@microsoft/sp-build-core-tasks',
        ].includes(dep.name))
    ) {
      edits.push(...removeDependency(project, dep.name));
      continue;
    }
    if (
      dep.name.startsWith('@microsoft/sp-') ||
      dep.name === '@microsoft/decorators' ||
      dep.name.startsWith('@microsoft/spfx-') ||
      dep.name.startsWith('@microsoft/eslint-')
    ) {
      const expected = specs.get(dep.name);
      const value = expected
        ? exactScaffoldSpec(baseline.project, expected.name, expected.version, pins)
        : version;
      edits.push(
        ...setPackage(
          project,
          dep.name,
          value,
          expected?.section === 'devDependencies'
            ? 'devDependencies'
            : dep.section === 'devDependencies'
              ? 'devDependencies'
              : 'dependencies',
        ),
      );
    }
  }
  for (const pkg of scaffold) {
    if (
      !pkg.required &&
      !project.dependencies.some((dep) => dep.name === pkg.name) &&
      !(usesReact && /^@types\/react(?:-dom)?$/.test(pkg.name))
    )
      continue;
    const value =
      pkg.name === 'react' || pkg.name === 'react-dom'
        ? (target.react ?? pkg.version)
        : exactScaffoldSpec(baseline.project, pkg.name, pkg.version, pins);
    edits.push(
      ...setPackage(
        project,
        pkg.name,
        value,
        pkg.section === 'devDependencies' ? 'devDependencies' : 'dependencies',
      ),
    );
  }
  if (usesReact && target.react)
    for (const name of ['react', 'react-dom'])
      edits.push(...setPackage(project, name, target.react, 'dependencies'));
  for (const name of [
    '@rushstack/eslint-config',
    '@typescript-eslint/parser',
    '@typescript-eslint/eslint-plugin',
    '@typescript-eslint/utils',
  ])
    if (pins[name]) edits.push(...setPackage(project, name, pins[name], 'devDependencies'));
  const compiler = expectedCompiler(target, chain);
  const tsconfig = await readJsonFile<{ compilerOptions?: Record<string, unknown> }>(
    path.join(project.dir, 'tsconfig.json'),
  );
  const tsVersion = pins.typescript ?? scaffold.find((pkg) => pkg.name === 'typescript')?.version;
  const obsolete = [
    'suppressImplicitAnyIndexErrors',
    'suppressExcessPropertyErrors',
    'keyofStringsOnly',
    'noStrictGenericChecks',
    'importsNotUsedAsValues',
    'preserveValueImports',
    'charset',
  ];
  if (
    tsconfig.ok &&
    tsVersion &&
    semver.coerce(tsVersion) &&
    semver.gte(semver.coerce(tsVersion) ?? '0.0.0', '5.0.0') &&
    obsolete.some((name) => tsconfig.value.compilerOptions?.[name] !== undefined)
  ) {
    if (semver.gte(semver.coerce(tsVersion) ?? '0.0.0', '5.5.0'))
      for (const name of obsolete)
        edits.push({
          kind: 'json-remove',
          file: path.join(project.dir, 'tsconfig.json'),
          path: ['compilerOptions', name],
        });
    else
      edits.push(
        jsonSet(project, 'tsconfig.json', ['compilerOptions', 'ignoreDeprecations'], '5.0'),
      );
  }
  if (chain === 'gulp' && compiler.compiler.startsWith('rush-stack-compiler-')) {
    const name = `@microsoft/${compiler.compiler}`;
    const data = spfxMatrix().compilers[compiler.compiler];
    if (data) edits.push(...setPackage(project, name, data.version, 'devDependencies'));
    edits.push(
      jsonSet(
        project,
        'tsconfig.json',
        ['extends'],
        `./node_modules/${name}/includes/tsconfig-web.json`,
      ),
    );
  }
  if (chain === 'heft') {
    edits.push(...(await heftEdits(project, currentChain !== 'heft', issues, version)));
  }
  if (target.lint === 'eslint') {
    if (existsSync(path.join(project.dir, 'tslint.json')))
      edits.push({ kind: 'file-delete', file: path.join(project.dir, 'tslint.json') });
    const flatLint = (semver.coerce(pins.eslint ?? target.eslint ?? '0')?.major ?? 0) >= 9;
    if (flatLint) edits.push(...(await flatLintEdits(project, issues)));
    else if (
      !['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json'].some((file) =>
        existsSync(path.join(project.dir, file)),
      )
    )
      edits.push({
        kind: 'file-write',
        file: path.join(project.dir, '.eslintrc.cjs'),
        content:
          'require("@rushstack/eslint-config/patch/modern-module-resolution");\nmodule.exports = { extends: ["@microsoft/eslint-config-spfx/lib/profiles/default"], parserOptions: { tsconfigRootDir: __dirname } };\n',
      });
    // Kept legacy configs move with typescript-eslint 8: removed rules go to their successors and
    // no-unused-vars keeps catch bindings unchecked, or every file warns and --ship builds fail.
    const plugin = pins['@typescript-eslint/eslint-plugin'];
    if (!flatLint && plugin && (semver.coerce(plugin)?.major ?? 0) >= 8)
      for (const name of ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json']) {
        const file = path.join(project.dir, name);
        if (!existsSync(file)) continue;
        const text = await readFile(file, 'utf8');
        const content = migrateEslintForPlugin8(text);
        if (content !== text) edits.push({ kind: 'file-write', file, content });
      }
  }
  if (!project.manifest.scripts?.build && chain === 'gulp')
    edits.push(jsonSet(project, 'package.json', ['scripts', 'build'], 'gulp bundle'));
  edits.push(...(await nodeEdits(project, node)));
  edits.push(
    jsonSet(project, '.yo-rc.json', ['@microsoft/generator-sharepoint', 'version'], version),
  );
  edits.push(
    jsonSet(
      project,
      '.yo-rc.json',
      ['@microsoft/generator-sharepoint', 'useGulp'],
      chain === 'gulp',
    ),
  );

  const environment = entry.stacks.find((stack) => stack.provider === 'spfx')?.details.environment;
  if (
    typeof environment === 'string' &&
    environment !== 'spo' &&
    !target.sharepoint.includes(environment)
  )
    issues.push({
      code: 'platform',
      level: 'blocker',
      message: msg('upgrade.platform', { environment, version }),
    });
  for (const library of spfxMatrix().libraries) {
    const dep = project.dependencies.find((item) => item.name === library.package);
    if (!dep) continue;
    const wanted = pins[library.package] ?? resolveVersion(project, library.package)?.version;
    const built = wanted ? libraryTarget(library.package, wanted) : undefined;
    if (
      !built ||
      semver.major(built) !== semver.major(version) ||
      semver.minor(built) !== semver.minor(version)
    )
      issues.push({
        code: 'controls',
        level: 'blocker',
        message: msg('upgrade.controls', {
          name: library.package,
          version: wanted ?? dep.spec,
          built: built ?? '?',
          target: version,
        }),
      });
  }
  const sources = await sourceTexts(project.dir);
  if (
    target.react &&
    semver.major(target.react) >= 18 &&
    sources.some(({ text }) =>
      /\b(?:ReactDom|ReactDOM)\s*\.\s*(?:render|unmountComponentAtNode)\s*\(|import\s*\{[^}]*\b(?:render|unmountComponentAtNode)\b[^}]*\}\s*from\s*['"]react-dom['"]/.test(
        text,
      ),
    )
  ) {
    issues.push({
      code: 'react-api',
      level: 'blocker',
      message: msg('upgrade.reactApi', { version: target.react }),
    });
  }
  const pnp = resolveVersion(project, '@pnp/sp');
  const desiredPnp = pins['@pnp/sp'];
  if (pnp && desiredPnp && semver.major(pnp.version) !== semver.major(desiredPnp)) {
    issues.push({
      code: 'pnp-major',
      level: 'review',
      message: msg('upgrade.pnpMajor', { from: pnp.version, to: desiredPnp }),
    });
  }
  const graph4 = pins['@pnp/graph'] && semver.major(pins['@pnp/graph']) >= 4;
  const removedPnp = sources.filter(
    ({ text }) =>
      /\bget(?:All|Paged)\s*(?:<[^>]+>)?\s*\(|@pnp\/(?:sp\/items\/get-all|common|odata)/.test(
        text,
      ) ||
      (graph4 && /@pnp\/graph/.test(text) && /\.\s*paged\s*(?:<[^>]+>)?\s*\(/.test(text)),
  );
  if (desiredPnp && semver.major(desiredPnp) >= 4 && removedPnp.length > 0) {
    issues.push({
      code: 'pnp-api',
      level: 'blocker',
      message: msg('upgrade.pnpApi'),
      files: removedPnp.map((source) => path.relative(project.dir, source.file)),
    });
    // `for await` over PnPjs queries fails with TS2495 below ES2018 unless iteration is downlevelled.
    const options = tsconfig.ok ? tsconfig.value.compilerOptions : undefined;
    const tsTarget = typeof options?.target === 'string' ? options.target.toLowerCase() : undefined;
    if (
      tsTarget &&
      ['es3', 'es5', 'es6', 'es2015', 'es2016', 'es2017'].includes(tsTarget) &&
      options?.downlevelIteration !== true
    )
      issues.push({
        code: 'pnp-async-target',
        level: 'review',
        message: msg('upgrade.pnpAsyncTarget', { target: String(options?.target) }),
        files: ['tsconfig.json'],
      });
  }
  return { edits, issues };
}

async function flatLintEdits(project: Project, issues: MigrationIssue[]): Promise<Edit[]> {
  const edits: Edit[] = [];
  const canonical =
    'require(@rushstack/eslint-config/patch/modern-module-resolution)module.exports={extends:[@microsoft/eslint-config-spfx/lib/profiles/default],parserOptions:{tsconfigRootDir:__dirname}}';
  for (const name of ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json']) {
    const file = path.join(project.dir, name);
    if (!existsSync(file)) continue;
    const text = stripComments(await readFile(file, 'utf8'))
      .replace(/['"]use strict['"];?/g, '')
      .replace(/[\s'";]/g, '')
      .replace(/,([}\]])/g, '$1');
    if (text === canonical) edits.push({ kind: 'file-delete', file });
    else
      issues.push({
        code: 'custom-eslint',
        level: 'blocker',
        message: msg('upgrade.customEslint', { file: name }),
        files: [name],
      });
  }
  if (
    !['eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs'].some((name) =>
      existsSync(path.join(project.dir, name)),
    )
  )
    edits.push({
      kind: 'file-write',
      file: path.join(project.dir, 'eslint.config.cjs'),
      content:
        "const spfxProfile = require('@microsoft/eslint-config-spfx/lib/flat-profiles/default');\nmodule.exports = [...spfxProfile, { files: ['**/*.ts', '**/*.tsx'], languageOptions: { parserOptions: { tsconfigRootDir: __dirname, project: './tsconfig.json' } } }];\n",
    });
  return edits;
}

function exactScaffoldSpec(
  baseline: Project,
  name: string,
  spec: string,
  pins: Record<string, string>,
): string {
  if (pins[name] && satisfies(pins[name], spec)) return pins[name];
  const resolved = resolveVersion(baseline, name)?.version;
  return resolved && satisfies(resolved, spec) ? resolved : (minVersionOf(spec) ?? spec);
}

async function heftEdits(
  project: Project,
  switching: boolean,
  issues: MigrationIssue[],
  version: string,
): Promise<Edit[]> {
  const edits: Edit[] = [
    jsonSet(
      project,
      'tsconfig.json',
      ['extends'],
      './node_modules/@microsoft/spfx-web-build-rig/profiles/default/tsconfig-base.json',
    ),
    jsonSet(project, 'config/rig.json', ['rigPackageName'], '@microsoft/spfx-web-build-rig'),
    jsonSet(
      project,
      'config/sass.json',
      ['$schema'],
      'https://developer.microsoft.com/json-schemas/heft/v0/heft-sass-plugin.schema.json',
    ),
    jsonSet(
      project,
      'config/sass.json',
      ['extends'],
      '@microsoft/spfx-web-build-rig/profiles/default/config/sass.json',
    ),
    jsonSet(
      project,
      'config/typescript.json',
      ['extends'],
      '@microsoft/spfx-web-build-rig/profiles/default/config/typescript.json',
    ),
    jsonSet(
      project,
      'config/typescript.json',
      ['staticAssetsToCopy', 'fileExtensions'],
      ['.resx', '.jpg', '.png', '.woff', '.eot', '.ttf', '.svg', '.gif'],
    ),
    jsonSet(
      project,
      'config/typescript.json',
      ['staticAssetsToCopy', 'includeGlobs'],
      ['webparts/*/loc/*.js'],
    ),
  ];
  if (semver.gte(version, '1.24.0'))
    edits.push(
      jsonSet(
        project,
        'tsconfig.json',
        ['watchOptions', 'excludeDirectories'],
        ['**/teams', '**/temp/copilot'],
      ),
    );
  if (!switching) return edits;
  const gulpfile = path.join(project.dir, 'gulpfile.js');
  if (existsSync(gulpfile)) {
    const text = stripComments(await readFile(gulpfile, 'utf8'));
    const canonical = text
      .replace(/['"]use strict['"];?/g, '')
      .replace(/(?:const|let|var)\s+build\s*=\s*require\(['"]@microsoft\/sp-build-web['"]\);?/g, '')
      .replace(/build\.initialize\(require\(['"]gulp['"]\)\);?/g, '')
      .replace(/\s/g, '');
    if (canonical)
      issues.push({
        code: 'custom-gulp',
        level: 'blocker',
        message: msg('upgrade.customGulp', { file: 'gulpfile.js' }),
      });
    else edits.push({ kind: 'file-delete', file: gulpfile });
  }
  for (const [name, command] of Object.entries(project.manifest.scripts ?? {})) {
    if (!/\bgulp\b/.test(command)) continue;
    const converted = command
      .split(/\s*&&\s*/)
      .map((part) => {
        const match = /^gulp (bundle|clean|test|serve|package-solution)( --ship)?$/.exec(part);
        if (!match) return part;
        const actions: Record<string, string> = {
          bundle: 'build',
          clean: 'clean',
          test: 'test',
          serve: 'start',
          'package-solution': 'package-solution',
        };
        return `heft ${actions[match[1] ?? ''] ?? ''}${match[2] ? ' --production' : ''}`;
      })
      .join(' && ');
    if (/\bgulp\b/.test(converted))
      issues.push({
        code: 'custom-script',
        level: 'blocker',
        message: msg('upgrade.customScript', { name, command }),
      });
    else edits.push(jsonSet(project, 'package.json', ['scripts', name], converted));
  }
  if (!project.manifest.scripts?.build)
    edits.push(jsonSet(project, 'package.json', ['scripts', 'build'], 'heft build'));
  for (const name of ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json']) {
    const file = path.join(project.dir, name);
    if (!existsSync(file)) continue;
    const before = await readFile(file, 'utf8');
    const after = before.replace(
      /@microsoft\/spfx\/(import-requires-chunk-name|pair-react-dom-render-unmount)/g,
      '@rushstack/$1',
    );
    if (after !== before) edits.push({ kind: 'file-write', file, content: after });
  }
  const sass = await readJsonFile<Record<string, unknown>>(
    path.join(project.dir, 'config/sass.json'),
  );
  if (sass.ok && Object.keys(sass.value).some((key) => !['$schema', 'extends'].includes(key)))
    issues.push({ code: 'custom-sass', level: 'blocker', message: msg('upgrade.customSass') });
  return edits;
}

async function sourceTexts(dir: string): Promise<{ file: string; text: string }[]> {
  const { readdir } = await import('node:fs/promises');
  const result: { file: string; text: string }[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') await visit(full);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
        result.push({ file: full, text: stripComments(await readFile(full, 'utf8')) });
    }
  };
  await visit(path.join(dir, 'src'));
  return result;
}
