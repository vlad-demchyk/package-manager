import { describe, expect, it } from 'vitest';
import { editJsonText, parseJsonc } from '../src/core/json.js';
import { packageNameFromLocation } from '../src/core/lockfile.js';
import { hasPrerelease, isExactSpec, minVersionOf } from '../src/core/versions.js';
import { en } from '../src/i18n/en.js';
import { it as itCatalogue } from '../src/i18n/it.js';
import { uk } from '../src/i18n/uk.js';
import { t } from '../src/i18n/index.js';
import { minimalRanges, recommendNode } from '../src/node/plan.js';
import { nodeLineStatus, nodeVulnerabilities } from '../src/node/releases.js';
import {
  codeSpecifiers,
  packageNameOf,
  stripComments,
  styleSpecifiers,
} from '../src/scan/sources.js';
import { TODAY } from './helpers.js';

describe('versions', () => {
  it('distinguishes exact versions from ranges', () => {
    expect(isExactSpec('17.0.1')).toBe(true);
    expect(isExactSpec('^17.0.1')).toBe(false);
    expect(isExactSpec('~5.3.3')).toBe(false);
    expect(isExactSpec('latest')).toBe(false);
  });

  it('finds the lowest version of a range and ignores non-registry specs', () => {
    expect(minVersionOf('^3.24.0')).toBe('3.24.0');
    expect(minVersionOf('>=18.17.1 <19.0.0')).toBe('18.17.1');
    expect(minVersionOf('file:../lib')).toBeUndefined();
    expect(minVersionOf('git+https://example.invalid/repo.git')).toBeUndefined();
  });

  it('detects pre-release specs', () => {
    expect(hasPrerelease('1.24.0-rc.0')).toBe(true);
    expect(hasPrerelease('1.24.0')).toBe(false);
  });
});

describe('json', () => {
  it('parses JSON with comments and trailing commas', () => {
    const result = parseJsonc<{ a: number }>('{ // comment\n "a": 1, }');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('reports invalid JSON instead of throwing', () => {
    expect(parseJsonc('{ "a": ').ok).toBe(false);
  });

  it('edits values while preserving formatting, comments and key order', () => {
    const text =
      '{\n    "name": "x",\n    // keep me\n    "dependencies": {\n        "b": "^1.0.0",\n        "a": "2.0.0"\n    }\n}\n';
    const edited = editJsonText(text, [
      { path: ['dependencies', 'b'], value: '1.2.3' },
      { path: ['dependencies', 'a'], value: undefined },
    ]);
    expect(edited).toContain('// keep me');
    expect(edited).toContain('        "b": "1.2.3"');
    expect(edited).not.toContain('"a"');
    expect(edited.indexOf('"name"')).toBeLessThan(edited.indexOf('"dependencies"'));
  });
});

describe('lockfile', () => {
  it('derives package names from nested locations', () => {
    expect(packageNameFromLocation('node_modules/react')).toBe('react');
    expect(packageNameFromLocation('node_modules/a/node_modules/@pnp/sp')).toBe('@pnp/sp');
    expect(packageNameFromLocation('packages/lib')).toBeUndefined();
  });
});

describe('source scan', () => {
  it('strips comments but keeps URLs inside strings', () => {
    const code =
      "const u = 'https://contoso.example/a'; // trailing\n/* block */ import x from 'react';";
    const stripped = stripComments(code);
    expect(stripped).toContain('https://contoso.example/a');
    expect(stripped).not.toContain('trailing');
    expect(stripped).not.toContain('block');
  });

  it('keeps regex literals with slashes and still drops comments', () => {
    const code = stripComments(
      "const re = /https?:\\/\\//; // trailing\nconst re2 = /[^/]+\\//g;\nconst r = a / b; /* block */ const sp = 'x'; // tail",
    );
    expect(code).toContain('/https?:\\/\\//');
    expect(code).toContain('/[^/]+\\//g');
    expect(code).toContain('a / b;');
    expect(code).toContain("const sp = 'x';");
    expect(code).not.toContain('trailing');
    expect(code).not.toContain('block');
    expect(code).not.toContain('tail');
  });

  it('treats a slash after return, typeof, case, in and of as a regex literal', () => {
    const code = stripComments(
      [
        'function f() { return /a\\/b/.test(s); } // c1',
        'const t = typeof /x\\//; // c2',
        'switch (k) { case /y\\//: break; } // c3',
        'for (const m of /z\\//g) {} // c4',
        'if (p in /w\\//) {} // c5',
        'const half = total / 2; // c6',
        'const noreturn = myreturn / 2; // c7',
      ].join('\n'),
    );
    expect(code).toContain('return /a\\/b/.test(s);');
    expect(code).toContain('typeof /x\\//;');
    expect(code).toContain('case /y\\//:');
    expect(code).toContain('of /z\\//g)');
    expect(code).toContain('in /w\\//)');
    expect(code).toContain('total / 2;');
    expect(code).toContain('myreturn / 2;');
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(code).not.toContain(`c${n}`);
  });

  it('extracts static, dynamic, re-export and require specifiers', () => {
    const code = stripComments(`
      import * as React from 'react';
      import type { IProps } from './IProps';
      import 'side-effect-only';
      export { a } from '@pnp/sp/webs';
      const m = await import(/* webpackChunkName: 'x' */ '@microsoft/sp-http');
      const fs = require('node:fs');
    `);
    const names = codeSpecifiers(code).map(packageNameOf).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining(['react', 'side-effect-only', '@pnp/sp', '@microsoft/sp-http']),
    );
    expect(names).not.toContain('fs');
  });

  it('does not confuse react with react-dom', () => {
    expect(packageNameOf('react-dom/client')).toBe('react-dom');
    expect(packageNameOf('react')).toBe('react');
  });

  it('reads package imports from Sass only for ~ and pkg: prefixes', () => {
    expect(
      styleSpecifiers("@import '~@fluentui/react/dist/sass/References.scss'; @import 'local';"),
    ).toEqual(['@fluentui/react/dist/sass/References.scss']);
    expect(styleSpecifiers("@use 'pkg:@fluentui/react/dist/sass/References.scss';")).toEqual([
      '@fluentui/react/dist/sass/References.scss',
    ]);
  });
});

describe('node data', () => {
  it('knows the support phase of a line', () => {
    expect(nodeLineStatus('18.20.8', TODAY).phase).toBe('eol');
    expect(nodeLineStatus('22.14.0', TODAY).phase).toBe('maintenance-lts');
    expect(nodeLineStatus('26.13.0', TODAY).phase).toBe('active-lts');
  });

  it('lists vulnerabilities fixed in later releases of the same line', () => {
    const old = nodeVulnerabilities('22.14.0');
    const latest = nodeVulnerabilities('22.23.4');
    expect(old.length).toBeGreaterThan(latest.length);
    expect(old.some((vuln) => vuln.patched?.includes('22.23.4'))).toBe(true);
  });

  it('recommends the newest supported release, falling back to EOL lines when the stack needs them', () => {
    expect(recommendNode(['>=22.14.0 <23.0.0'], TODAY)).toBe('22.23.4');
    expect(recommendNode(['>=18.17.1 <19.0.0'], TODAY)).toBe('18.20.8');
    expect(
      recommendNode(
        ['>=22.14.0 <23.0.0 || >=24.0.0 <25.0.0 || >=26.0.0 <27.0.0'],
        TODAY,
      )?.startsWith('26.'),
    ).toBe(true);
  });

  it('keeps only the narrowest ranges in messages', () => {
    expect(minimalRanges(['>=22.14.0 <23.0.0', '>=0.10.0', '>= 8.3'])).toEqual([
      '>=22.14.0 <23.0.0',
    ]);
  });
});

describe('i18n', () => {
  const placeholders = (text: string): string[] =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

  it('keeps the same placeholders in every language', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(uk[key]), `uk ${key}`).toEqual(placeholders(en[key]));
      expect(placeholders(itCatalogue[key]), `it ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('interpolates parameters and falls back to the key', () => {
    expect(t('fix.setVersion', { name: 'react', version: '17.0.1' }, 'en')).toBe(
      'Set react to 17.0.1',
    );
    expect(t('missing.key', undefined, 'uk')).toBe('missing.key');
  });
});
