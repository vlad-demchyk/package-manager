import { describe, expect, it } from 'vitest';
import { nonNegativeInt } from '../src/cli/shared.js';
import * as packman from '../src/index.js';

describe('CLI number options', () => {
  it('accepts whole numbers and rejects anything else', () => {
    expect(nonNegativeInt('0')).toBe(0);
    expect(nonNegativeInt(' 12 ')).toBe(12);
    for (const value of ['abc', '-1', '2.5', '', '3x'])
      expect(() => nonNegativeInt(value)).toThrow('not a whole number');
  });
});

describe('public API', () => {
  it('exports the documented runtime functions and nothing by accident', () => {
    expect(Object.keys(packman).sort()).toEqual([
      'ConfigError',
      'PROVIDERS',
      'alignPackage',
      'alignToProject',
      'analyze',
      'applyPreviews',
      'collectEdits',
      'configSchema',
      'dataStatus',
      'diffProjects',
      'discoverWorkspace',
      'linkGroup',
      'loadConfig',
      'loadProject',
      'outdated',
      'planStore',
      'planUpgrade',
      'previewEdits',
      'readLinks',
      'readLockfile',
      'unlinkProjects',
      'updateData',
      'versionMatrix',
    ]);
    for (const value of Object.values(packman)) expect(value).toBeDefined();
  });
});
