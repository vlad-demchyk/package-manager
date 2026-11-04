import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { migrateRule, removeRule } from '../src/providers/frameworks.js';
import { fakeNodes, makeWorkspace, TODAY } from './helpers.js';

/** The shape of the SPFx default .eslintrc.js, trimmed. */
const ESLINTRC = `require('@rushstack/eslint-config/patch/modern-module-resolution');
module.exports = {
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/adjacent-overload-signatures': 1,
        '@typescript-eslint/ban-types': [
          1,
          {
            'extendDefaults': false,
            'types': {
              'String': { 'message': 'Use \\'string\\' instead', 'fixWith': 'string' }
            }
          }
        ],
        '@typescript-eslint/no-unused-vars': [
          1,
          {
            'vars': 'all',
            'args': 'none'
          }
        ],
        '@typescript-eslint/no-var-requires': 'off'
      }
    }
  ]
};
`;

const INSTALLED = new Set([
  'adjacent-overload-signatures',
  'no-restricted-types',
  'no-empty-object-type',
  'no-unsafe-function-type',
  'no-wrapper-object-types',
  'no-require-imports',
  'no-unused-vars',
]);

/** Evaluates the config module the way ESLint loads it (without the patch require). */
const load = (text: string): { overrides: { rules: Record<string, unknown> }[] } => {
  const module = { exports: {} as never };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('module', text.split('\n').slice(1).join('\n')) as (m: object) => void;
  run(module);
  return module.exports;
};

describe('eslint rules the installed plugin does not have', () => {
  it('moves ban-types to no-restricted-types with the same types and renames simple rules', () => {
    const migrated = ['ban-types', 'no-var-requires'].reduce(
      (text, rule) => migrateRule(text, rule, INSTALLED),
      ESLINTRC,
    );
    const rules = load(migrated).overrides[0]?.rules ?? {};
    expect(rules['@typescript-eslint/ban-types']).toBeUndefined();
    expect(rules['@typescript-eslint/no-restricted-types']).toEqual([
      1,
      { types: { String: { message: "Use 'string' instead", fixWith: 'string' } } },
    ]);
    expect(rules['@typescript-eslint/no-require-imports']).toBe('off');
    // extendDefaults: false banned only the listed types, so nothing else is switched on.
    expect(rules['@typescript-eslint/no-wrapper-object-types']).toBeUndefined();
  });

  it('covers ban-types defaults with their successor rules when they were extended', () => {
    const text = ESLINTRC.replace("'extendDefaults': false,", '');
    const rules = load(migrateRule(text, 'ban-types', INSTALLED)).overrides[0]?.rules ?? {};
    expect(rules['@typescript-eslint/no-empty-object-type']).toBe(1);
    expect(rules['@typescript-eslint/no-unsafe-function-type']).toBe(1);
    expect(rules['@typescript-eslint/no-wrapper-object-types']).toBe(1);
  });

  it('removes a rule without successor and keeps the module valid', () => {
    const rules = load(removeRule(ESLINTRC, 'no-var-requires')).overrides[0]?.rules ?? {};
    expect(Object.keys(rules)).not.toContain('@typescript-eslint/no-var-requires');
  });

  async function findingsFor(gulpfile: string) {
    const plugin = 'app/node_modules/@typescript-eslint/eslint-plugin';
    const files: Record<string, string | object> = {
      'app/package.json': { name: 'app', devDependencies: { eslint: '8.57.1' } },
      'app/.eslintrc.js': ESLINTRC,
      'app/gulpfile.js': gulpfile,
      [`${plugin}/package.json`]: { name: '@typescript-eslint/eslint-plugin', version: '8.26.1' },
    };
    for (const rule of INSTALLED) files[`${plugin}/dist/rules/${rule}.js`] = '';
    const { root, cleanup } = await makeWorkspace(files);
    try {
      const config = configSchema.parse({});
      const report = await analyze(await discoverWorkspace(root, { config }), {
        config,
        offline: true,
        security: false,
        usage: false,
        today: TODAY,
        installedNodes: fakeNodes('22.19.0'),
      });
      return report.projects[0]?.findings ?? [];
    } finally {
      await cleanup();
    }
  }

  it('reports removed rules and the caughtErrors default, with fixes that load', async () => {
    const findings = await findingsFor("const build = require('@microsoft/sp-build-web');");
    const unknown = findings.find((item) => item.ruleId === 'eslint/unknown-rule');
    expect(unknown?.severity).toBe('error');
    expect(unknown?.evidence).toEqual([
      'ban-types -> no-restricted-types',
      'no-var-requires -> no-require-imports',
    ]);
    const caught = findings.find((item) => item.ruleId === 'eslint/caught-errors');
    const edit = caught?.fixes[0]?.edits[0];
    const content = edit && 'content' in edit ? edit.content : '';
    const rules = load(content).overrides[0]?.rules ?? {};
    expect(rules['@typescript-eslint/no-unused-vars']).toEqual([
      1,
      { caughtErrors: 'none', vars: 'all', args: 'none' },
    ]);
    // Either fix writes the file with every change, so applying both loses nothing.
    expect(rules['@typescript-eslint/no-restricted-types']).toBeDefined();
    expect(unknown?.fixes[0]?.edits[0]).toEqual(edit);
  });

  it('downgrades to a warning when the gulpfile suppresses warnings', async () => {
    const findings = await findingsFor('build.addSuppression(/Warning/gi);');
    expect(findings.find((item) => item.ruleId === 'eslint/unknown-rule')?.severity).toBe(
      'warning',
    );
  });
});
