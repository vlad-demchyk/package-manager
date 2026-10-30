import { existsSync } from 'node:fs';
import path from 'node:path';
import semver from 'semver';
import { finding, fix, msg, removeDependency, setDependency } from '../../core/findings.js';
import { readJsonFile } from '../../core/json.js';
import { isTopLevel } from '../../core/lockfile.js';
import type { Constraint, Edit, Finding, StackInfo } from '../../core/types.js';
import { majorOf, resolveVersion } from '../../core/versions.js';
import type { ProjectContext, StackProvider } from '../types.js';
import { componentTypes, corePackages, type CorePackage } from './core.js';
import {
  expectedCompiler,
  findSpfxVersion,
  latestSpfx,
  libraryRangeFor,
  libraryTarget,
  spfxMatrix,
  type SpfxVersion,
} from './matrix.js';

const CORE = '@microsoft/sp-core-library';
const RSC_PREFIX = '@microsoft/rush-stack-compiler-';

interface YoRc {
  '@microsoft/generator-sharepoint'?: {
    version?: string;
    environment?: string;
    useGulp?: boolean;
  };
}

type Toolchain = 'gulp' | 'heft' | 'mixed' | 'unknown';

export const spfxProvider: StackProvider = {
  id: 'spfx',

  async detect(ctx) {
    const { project } = ctx;
    const core = resolveVersion(project, CORE);
    const yo = await readJsonFile<YoRc>(path.join(project.dir, '.yo-rc.json'));
    const generator = yo.ok ? yo.value['@microsoft/generator-sharepoint'] : undefined;
    const hasSpDeps = project.dependencies.some((dep) => dep.name.startsWith('@microsoft/sp-'));
    if (!core && !generator && !hasSpDeps) {
      return undefined;
    }

    const evidence: string[] = [];
    let version: string | undefined;
    if (core) {
      version = semver.coerce(core.version)?.version;
      evidence.push(`${CORE} ${core.version} (${core.source})`);
    }
    const generatorVersion = generatorBaseline(generator);
    if (generatorVersion) {
      evidence.push(`.yo-rc.json generator ${generatorVersion}`);
      version ??= generatorVersion;
    }

    const toolchain = detectToolchain(ctx);
    const stack: StackInfo = {
      provider: 'spfx',
      confidence: core ? 'high' : generatorVersion ? 'medium' : 'low',
      evidence,
      details: {
        toolchain,
        generator: generatorVersion,
        environment: generator?.environment,
        rawCore: core?.version,
      },
    };
    if (version) stack.version = version;
    return stack;
  },

  constraints(ctx, stack) {
    const entry = stack.version ? findSpfxVersion(stack.version) : undefined;
    if (!entry) return [];
    const source = `SPFx ${entry.version}`;
    const constraints: Constraint[] = [{ kind: 'node', range: entry.node, source }];
    if (entry.react) {
      constraints.push({ kind: 'package', name: 'react', range: entry.react, source, exact: true });
      constraints.push({
        kind: 'package',
        name: 'react-dom',
        range: entry.react,
        source,
        exact: true,
      });
    }
    return constraints;
  },

  async implicitlyUsed(ctx, stack) {
    // Everything the official scaffold installs is used by the build or the runtime, imported or not.
    const core = await projectCore(ctx, stack);
    return ['tslib', '@microsoft/sp-office-ui-fabric-core', ...core.map((pkg) => pkg.name)];
  },

  async virtualModules(ctx) {
    const config = await readJsonFile<{
      localizedResources?: Record<string, string>;
      externals?: Record<string, unknown>;
    }>(path.join(ctx.project.dir, 'config', 'config.json'));
    if (!config.ok) return [];
    return [
      ...Object.keys(config.value.localizedResources ?? {}),
      ...Object.keys(config.value.externals ?? {}),
    ];
  },

  async check(ctx, stack) {
    const findings: Finding[] = [];
    const { project } = ctx;
    const toolchain = (stack.details.toolchain ?? 'unknown') as Toolchain;
    const version = stack.version;
    if (!version) {
      findings.push(
        finding('spfx/version-unknown', 'warning', project, msg('spfx.versionUnknown')),
      );
      return findings;
    }
    const entry = findSpfxVersion(version);
    const generator = stack.details.generator;
    if (typeof generator === 'string' && generator !== version && stack.details.rawCore) {
      findings.push(
        finding(
          'spfx/yo-rc-mismatch',
          'info',
          project,
          msg('spfx.yoRcMismatch', { generator, version }),
          {
            evidence: stack.evidence,
            fixes: [
              fix('spfx/yo-rc-sync', msg('fix.syncYoRc', { version }), 'safe', [
                {
                  kind: 'json-set',
                  file: path.join(project.dir, '.yo-rc.json'),
                  path: ['@microsoft/generator-sharepoint', 'version'],
                  value: version,
                },
              ]),
            ],
            tags: ['spfx'],
          },
        ),
      );
    }
    if (!entry) {
      findings.push(
        finding(
          'spfx/version-not-in-matrix',
          'warning',
          project,
          msg('spfx.notInMatrix', { version }),
          {
            tags: ['spfx'],
          },
        ),
      );
      return findings;
    }
    if (entry.withdrawn) {
      findings.push(
        finding('spfx/withdrawn', 'error', project, msg('spfx.withdrawn', { version }), {
          tags: ['spfx'],
        }),
      );
    }

    findings.push(...checkPrerelease(ctx));
    findings.push(...checkTslint(ctx, entry));
    findings.push(...checkCore(ctx, entry, await projectCore(ctx, stack)));
    findings.push(...checkLockstep(ctx, entry));
    findings.push(...checkToolchain(ctx, entry, toolchain));
    findings.push(...checkCompiler(ctx, entry, toolchain));
    findings.push(...checkReact(ctx, entry));
    findings.push(...checkPnpLibraries(ctx, entry));
    findings.push(...checkPnpjs(ctx, entry));
    findings.push(...suggestUpgrade(ctx, entry, toolchain));
    return findings;
  },
};

function generatorBaseline(
  generator: NonNullable<YoRc['@microsoft/generator-sharepoint']> | undefined,
): string | undefined {
  if (!generator) return undefined;
  if (generator.environment === 'onprem19') return '1.4.1';
  if (generator.environment === 'onprem') return '1.1.0';
  return generator.version ? (semver.coerce(generator.version)?.version ?? undefined) : undefined;
}

function detectToolchain(ctx: ProjectContext): Toolchain {
  const { project } = ctx;
  const has = (name: string): boolean => project.dependencies.some((dep) => dep.name === name);
  const heft =
    has('@rushstack/heft') ||
    has('@microsoft/spfx-web-build-rig') ||
    existsSync(path.join(project.dir, 'config', 'rig.json'));
  const gulp = has('@microsoft/sp-build-web') || existsSync(path.join(project.dir, 'gulpfile.js'));
  if (heft && gulp) return 'mixed';
  if (heft) return 'heft';
  if (gulp) return 'gulp';
  return 'unknown';
}

function checkPrerelease(ctx: ProjectContext): Finding[] {
  const { project } = ctx;
  const prerelease = project.dependencies.filter(
    (dep) => dep.name.startsWith('@microsoft/') && /-(?:rc|beta|alpha|dev|nightly)/i.test(dep.spec),
  );
  if (prerelease.length === 0) return [];
  return [
    finding(
      'spfx/prerelease-packages',
      'error',
      project,
      msg('spfx.prerelease', {
        packages: prerelease.map((dep) => `${dep.name}@${dep.spec}`).join(', '),
      }),
      { tags: ['spfx'] },
    ),
  ];
}

/** All runtime packages equal the SPFx version; build tools follow buildToolsVersion. */
function checkLockstep(ctx: ProjectContext, entry: SpfxVersion): Finding[] {
  const { project } = ctx;
  const { exact, buildTools } = spfxMatrix().lockstep;
  const buildVersion = entry.buildToolsVersion ?? entry.version;
  const mismatched: { name: string; actual: string; expected: string }[] = [];

  for (const dep of project.dependencies) {
    const isRuntime = exact.includes(dep.name);
    const isBuild = buildTools.includes(dep.name);
    if (!isRuntime && !isBuild) continue;
    const expected = isRuntime ? entry.version : buildVersion;
    const resolved = resolveVersion(project, dep.name);
    const actual = resolved?.version ?? dep.spec;
    if (semver.coerce(actual)?.version !== expected || dep.spec !== expected) {
      mismatched.push({ name: dep.name, actual: dep.spec, expected });
    }
  }
  if (mismatched.length === 0) return [];

  const edits: Edit[] = mismatched.map((item) => setDependency(project, item.name, item.expected));
  const runtimeVsBuild = mismatched.some(
    (item) => semver.coerce(item.actual)?.version !== item.expected,
  );
  return [
    finding(
      runtimeVsBuild ? 'spfx/lockstep-mismatch' : 'spfx/lockstep-range',
      runtimeVsBuild ? 'error' : 'warning',
      project,
      msg(runtimeVsBuild ? 'spfx.lockstepMismatch' : 'spfx.lockstepRange', {
        version: entry.version,
        count: mismatched.length,
      }),
      {
        evidence: mismatched.map((item) => `${item.name}: ${item.actual} -> ${item.expected}`),
        fixes: [
          fix(
            'spfx/align-lockstep',
            msg('fix.alignSpfxPackages', { version: entry.version }),
            'review',
            edits,
          ),
        ],
        tags: ['spfx', 'alignment'],
      },
    ),
  ];
}

function checkToolchain(ctx: ProjectContext, entry: SpfxVersion, toolchain: Toolchain): Finding[] {
  const { project } = ctx;
  if (toolchain === 'mixed') {
    return [
      finding('spfx/toolchain-mixed', 'error', project, msg('spfx.toolchainMixed'), {
        tags: ['spfx'],
      }),
    ];
  }
  if (toolchain === 'gulp' && entry.gulpUnsupported) {
    return [
      finding(
        'spfx/gulp-unsupported',
        'error',
        project,
        msg('spfx.gulpUnsupported', { version: entry.version }),
        {
          tags: ['spfx'],
        },
      ),
    ];
  }
  if (toolchain === 'heft' && semver.lt(entry.version, '1.22.0')) {
    return [
      finding(
        'spfx/heft-too-early',
        'warning',
        project,
        msg('spfx.heftTooEarly', { version: entry.version }),
        {
          tags: ['spfx'],
        },
      ),
    ];
  }
  return [];
}

function checkCompiler(ctx: ProjectContext, entry: SpfxVersion, toolchain: Toolchain): Finding[] {
  const { project } = ctx;
  const findings: Finding[] = [];
  const expected = expectedCompiler(entry, toolchain);
  const compilers = spfxMatrix().compilers;
  const declaredRsc = project.dependencies.filter((dep) => dep.name.startsWith(RSC_PREFIX));
  const tsResolved = resolveVersion(project, 'typescript');

  if (expected.compiler.startsWith('rush-stack-compiler-')) {
    const expectedName = `@microsoft/${expected.compiler}`;
    const wrong = declaredRsc.filter((dep) => dep.name !== expectedName);
    const target = compilers[expected.compiler];
    if (wrong.length > 0 || (declaredRsc.length === 0 && toolchain === 'gulp')) {
      const edits: Edit[] = wrong.flatMap((dep) => removeDependency(project, dep.name));
      if (target)
        edits.push(setDependency(project, expectedName, target.version, 'devDependencies'));
      findings.push(
        finding(
          'spfx/compiler-mismatch',
          'error',
          project,
          msg('spfx.compilerMismatch', {
            version: entry.version,
            expected: expected.compiler,
            actual: wrong.map((dep) => dep.name.replace('@microsoft/', '')).join(', ') || '-',
          }),
          {
            evidence: declaredRsc.map((dep) => `${dep.name}@${dep.spec}`),
            fixes: target
              ? [
                  fix(
                    'spfx/replace-compiler',
                    msg('fix.replaceCompiler', { compiler: expected.compiler }),
                    'review',
                    edits,
                  ),
                ]
              : [],
            tags: ['spfx', 'typescript'],
          },
        ),
      );
    }
    // A compiler only runs its own TypeScript; a different `typescript` dependency is misleading.
    // Compare with the compiler actually declared: it decides which TypeScript really runs.
    const declaredCompiler = declaredRsc[0]
      ? compilers[declaredRsc[0].name.replace('@microsoft/', '')]
      : undefined;
    const compilerTs = (declaredCompiler ?? target)?.typescript;
    if (
      tsResolved &&
      compilerTs &&
      `${majorOf(tsResolved.version)}.${semver.coerce(tsResolved.version)?.minor}` !== compilerTs
    ) {
      findings.push(
        finding(
          'spfx/typescript-compiler-mismatch',
          'warning',
          project,
          msg('spfx.typescriptCompilerMismatch', { typescript: tsResolved.version, compilerTs }),
          { tags: ['spfx', 'typescript'] },
        ),
      );
    }
  } else if (expected.compiler === 'heft') {
    if (declaredRsc.length > 0) {
      findings.push(
        finding('spfx/compiler-with-heft', 'warning', project, msg('spfx.compilerWithHeft'), {
          evidence: declaredRsc.map((dep) => dep.name),
          fixes: [
            fix(
              'spfx/remove-compiler',
              msg('fix.removeCompiler'),
              'review',
              declaredRsc.flatMap((dep) => removeDependency(project, dep.name)),
            ),
          ],
          tags: ['spfx', 'typescript'],
        }),
      );
    }
    if (
      tsResolved &&
      !semver.satisfies(semver.coerce(tsResolved.version)?.version ?? '0.0.0', expected.typescript)
    ) {
      findings.push(
        finding(
          'spfx/typescript-mismatch',
          'warning',
          project,
          msg('spfx.typescriptMismatch', {
            actual: tsResolved.version,
            expected: expected.typescript,
          }),
          {
            fixes: [
              fix(
                'spfx/set-typescript',
                msg('fix.setVersion', { name: 'typescript', version: expected.typescript }),
                'review',
                [setDependency(project, 'typescript', expected.typescript, 'devDependencies')],
              ),
            ],
            tags: ['spfx', 'typescript'],
          },
        ),
      );
    }
  }
  return findings;
}

function checkReact(ctx: ProjectContext, entry: SpfxVersion): Finding[] {
  const { project } = ctx;
  if (!entry.react) return [];
  const findings: Finding[] = [];
  const mismatched: string[] = [];
  const edits: Edit[] = [];
  for (const name of ['react', 'react-dom']) {
    const dep = project.dependencies.find((item) => item.name === name);
    if (!dep) continue;
    const resolved = resolveVersion(project, name);
    if (dep.spec !== entry.react || (resolved && resolved.version !== entry.react)) {
      mismatched.push(
        `${name}: ${dep.spec}${resolved && resolved.source !== 'manifest' ? ` (${resolved.version} ${resolved.source})` : ''}`,
      );
      edits.push(setDependency(project, name, entry.react));
    }
  }
  if (mismatched.length > 0) {
    findings.push(
      finding(
        'spfx/react-mismatch',
        'error',
        project,
        msg('spfx.reactMismatch', { version: entry.version, react: entry.react }),
        {
          evidence: mismatched,
          fixes: [
            fix('spfx/pin-react', msg('fix.pinReact', { react: entry.react }), 'review', edits),
          ],
          tags: ['spfx', 'react'],
        },
      ),
    );
  }
  const typesEdits: Edit[] = [];
  const typesEvidence: string[] = [];
  for (const [name, expected] of [
    ['@types/react', entry.typesReact],
    ['@types/react-dom', entry.typesReactDom],
  ] as const) {
    const dep = project.dependencies.find((item) => item.name === name);
    if (!dep || !expected) continue;
    if (majorOf(dep.spec) !== majorOf(expected)) {
      typesEvidence.push(`${name}: ${dep.spec} -> ${expected}`);
      typesEdits.push(setDependency(project, name, expected, 'devDependencies'));
    }
  }
  if (typesEdits.length > 0) {
    findings.push(
      finding(
        'spfx/types-react-mismatch',
        'warning',
        project,
        msg('spfx.typesReactMismatch', { version: entry.version }),
        {
          evidence: typesEvidence,
          fixes: [fix('spfx/align-types-react', msg('fix.alignTypesReact'), 'safe', typesEdits)],
          tags: ['spfx', 'react'],
        },
      ),
    );
  }
  return findings;
}

function checkPnpLibraries(ctx: ProjectContext, entry: SpfxVersion): Finding[] {
  const { project } = ctx;
  const findings: Finding[] = [];
  for (const library of spfxMatrix().libraries) {
    const resolved = resolveVersion(project, library.package);
    if (!resolved) continue;
    const target = libraryTarget(library.package, resolved.version);
    if (!target) continue;
    const builtFor = semver.coerce(target);
    const projectVersion = semver.coerce(entry.version);
    if (
      !builtFor ||
      !projectVersion ||
      (builtFor.major === projectVersion.major && builtFor.minor === projectVersion.minor)
    ) {
      continue;
    }
    const newer = semver.gt(builtFor, projectVersion);
    const suggested = libraryRangeFor(library.package, entry.version);
    findings.push(
      finding(
        'spfx/library-target-mismatch',
        newer ? 'error' : 'warning',
        project,
        msg(newer ? 'spfx.libraryNewer' : 'spfx.libraryOlder', {
          library: library.package,
          version: resolved.version,
          target,
          spfx: entry.version,
          suggested: suggested ?? '-',
        }),
        { tags: ['spfx', 'pnp'] },
      ),
    );
  }
  return findings;
}

function checkPnpjs(ctx: ProjectContext, entry: SpfxVersion): Finding[] {
  const { project } = ctx;
  const resolved = resolveVersion(project, '@pnp/sp');
  if (!resolved) return [];
  const major = majorOf(resolved.version);
  const row = spfxMatrix().pnpjs.find((item) => item.major === major);
  if (!row || semver.satisfies(entry.version, row.spfx)) return [];
  const recommended = spfxMatrix().pnpjs.find((item) => semver.satisfies(entry.version, item.spfx));
  return [
    finding(
      'spfx/pnpjs-major',
      'warning',
      project,
      msg('spfx.pnpjsMajor', {
        major: major ?? '?',
        spfx: entry.version,
        recommended: recommended?.major ?? '-',
      }),
      { evidence: [row.note], tags: ['spfx', 'pnp'] },
    ),
  ];
}

/** Proposes the nearest upgrade that keeps the toolchain, and the latest overall. */
function suggestUpgrade(ctx: ProjectContext, entry: SpfxVersion, toolchain: Toolchain): Finding[] {
  const { project } = ctx;
  const latest = latestSpfx();
  if (!latest || semver.gte(entry.version, latest.version)) return [];
  const sameToolchain = latestSpfx((item) =>
    toolchain === 'heft' ? item.toolchain === 'heft' : item.toolchain === 'gulp',
  );
  const steps: string[] = [];
  if (
    sameToolchain &&
    semver.gt(sameToolchain.version, entry.version) &&
    sameToolchain.version !== latest.version
  ) {
    steps.push(describeStep(entry, sameToolchain));
  }
  steps.push(describeStep(entry, latest));
  return [
    finding(
      'spfx/upgrade-available',
      'info',
      project,
      msg('spfx.upgradeAvailable', { version: entry.version, latest: latest.version }),
      {
        evidence: steps,
        tags: ['spfx', 'upgrade'],
      },
    ),
  ];
}

function describeStep(from: SpfxVersion, to: SpfxVersion): string {
  const changes = [`SPFx ${to.version}`, `Node ${to.node}`];
  if (to.react !== from.react) changes.push(`React ${from.react ?? '-'} -> ${to.react ?? '-'}`);
  if (to.toolchain !== from.toolchain) changes.push(`${from.toolchain} -> ${to.toolchain}`);
  if (to.compiler !== from.compiler) changes.push(`${from.compiler} -> ${to.compiler}`);
  if (to.eslint && to.eslint !== from.eslint) changes.push(`ESLint ${to.eslint}`);
  return changes.join('; ');
}

const coreCache = new WeakMap<object, Promise<CorePackage[]>>();

/** Scaffold packages for the project's SPFx version, toolchain, component types and React usage. */
function projectCore(ctx: ProjectContext, stack: StackInfo): Promise<CorePackage[]> {
  const cached = coreCache.get(ctx.project);
  if (cached) return cached;
  const promise = (async () => {
    if (!stack.version) return [];
    const types = await componentTypes(ctx.project.dir);
    stack.details.components = types.join(',') || undefined;
    const scan = await ctx.sources();
    const usesReact =
      scan.imports.has('react') || ctx.project.dependencies.some((dep) => dep.name === 'react');
    const hasLintConfig = [
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.cjs',
      'eslint.config.js',
      'eslint.config.mjs',
    ].some((file) => existsSync(path.join(ctx.project.dir, file)));
    const toolchain = (stack.details.toolchain ?? 'unknown') as Toolchain;
    return corePackages(stack.version, toolchain, types, usesReact, hasLintConfig);
  })();
  coreCache.set(ctx.project, promise);
  return promise;
}

/** Required scaffold packages that the project does not declare: build or runtime breaks without them. */
function checkCore(ctx: ProjectContext, entry: SpfxVersion, core: CorePackage[]): Finding[] {
  const { project } = ctx;
  const declared = new Set(project.dependencies.map((dep) => dep.name));
  // Compilers and TypeScript are covered by the compiler rules; reporting them here would double count.
  const candidates = core.filter(
    (pkg) =>
      pkg.required &&
      !declared.has(pkg.name) &&
      !pkg.name.startsWith(RSC_PREFIX) &&
      pkg.name !== 'typescript',
  );
  const inTree = new Set(
    (project.lockfile?.packages ?? []).filter((pkg) => isTopLevel(pkg)).map((pkg) => pkg.name),
  );
  for (const name of Object.keys(project.installed)) inTree.add(name);
  const findings: Finding[] = [];
  // Without a lockfile or node_modules the tree is unknown: absence cannot be proven.
  if (inTree.size === 0 && candidates.length > 0) {
    return [
      finding(
        'spfx/core-unverified',
        'warning',
        project,
        msg('spfx.coreUnverified', { count: candidates.length, version: entry.version }),
        {
          evidence: candidates.map((pkg) => `${pkg.name}@${pkg.version} (${pkg.section})`),
          fixes: [
            fix(
              'spfx/declare-core',
              msg('fix.addCore', { version: entry.version }),
              'review',
              candidates.map((pkg) => setDependency(project, pkg.name, pkg.version, pkg.section)),
            ),
          ],
          tags: ['spfx', 'correctness'],
        },
      ),
    ];
  }
  const transitive = candidates.filter((pkg) => inTree.has(pkg.name));
  const missing = candidates.filter((pkg) => !inTree.has(pkg.name));
  if (transitive.length > 0) {
    findings.push(
      finding(
        'spfx/core-transitive',
        'warning',
        project,
        msg('spfx.coreTransitive', { count: transitive.length, version: entry.version }),
        {
          evidence: transitive.map((pkg) => `${pkg.name}@${pkg.version} (${pkg.section})`),
          fixes: [
            fix(
              'spfx/declare-core',
              msg('fix.addCore', { version: entry.version }),
              'safe',
              transitive.map((pkg) => setDependency(project, pkg.name, pkg.version, pkg.section)),
            ),
          ],
          tags: ['spfx', 'correctness'],
        },
      ),
    );
  }
  if (missing.length === 0) return findings;
  return [
    ...findings,
    finding(
      'spfx/core-missing',
      'error',
      project,
      msg('spfx.coreMissing', { count: missing.length, version: entry.version }),
      {
        evidence: missing.map((pkg) => `${pkg.name}@${pkg.version} (${pkg.section})`),
        fixes: [
          fix(
            'spfx/add-core',
            msg('fix.addCore', { version: entry.version }),
            'review',
            missing.map((pkg) => setDependency(project, pkg.name, pkg.version, pkg.section)),
          ),
        ],
        tags: ['spfx', 'correctness'],
      },
    ),
  ];
}

/** tslint.json is a leftover once the SPFx version lints with ESLint (1.15+); 2.x deleted it unconditionally. */
function checkTslint(ctx: ProjectContext, entry: SpfxVersion): Finding[] {
  const file = path.join(ctx.project.dir, 'tslint.json');
  if (entry.lint !== 'eslint' || !existsSync(file)) return [];
  return [
    finding(
      'spfx/tslint-leftover',
      'info',
      ctx.project,
      msg('spfx.tslintLeftover', { version: entry.version }),
      {
        evidence: ['tslint.json'],
        fixes: [
          fix('spfx/delete-tslint', msg('fix.deleteFile', { file: 'tslint.json' }), 'review', [
            { kind: 'file-delete', file },
          ]),
        ],
        tags: ['spfx', 'lint'],
      },
    ),
  ];
}
