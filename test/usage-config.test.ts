import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { fakeNodes, lockfile, makeWorkspace, TODAY, type FileTree } from './helpers.js';

const GULPFILE_WITH_LOADER = `'use strict';
const path = require('path');
const build = require('@microsoft/sp-build-web');
build.configureWebpack.mergeConfig({
  additionalConfiguration: (config) => {
    config.module.rules.push({
      test: /\\.js$/,
      include: path.join(__dirname, 'node_modules', '@pnp'),
      use: { loader: 'babel-loader' },
    });
    return config;
  },
});
build.initialize(require('gulp'));
`;
const GULPFILE_COMMENTED = `'use strict';
const build = require('@microsoft/sp-build-web');
// use: { loader: 'babel-loader' } was removed when the ES5 bundle went away
/* config.module.rules.push({ use: { loader: 'babel-loader' } }); */
build.initialize(require('gulp'));
`;

function project(name: string, gulpfile: string, extraFiles: FileTree = {}): FileTree {
  const dependencies = { '@microsoft/sp-core-library': '1.18.2', '@pnp/sp': '3.20.1' };
  const devDependencies = {
    '@microsoft/sp-build-web': '1.18.2',
    '@microsoft/rush-stack-compiler-4.7': '0.1.0',
    typescript: '4.7.4',
    gulp: '4.0.2',
    'babel-loader': '8.4.1',
    '@babel/core': '7.26.0',
    'ts-jest': '29.1.0',
  };
  return {
    [`${name}/package.json`]: { name, dependencies, devDependencies },
    [`${name}/package-lock.json`]: lockfile(name, {}, { ...dependencies, ...devDependencies }),
    [`${name}/gulpfile.js`]: gulpfile,
    [`${name}/tsconfig.json`]: {
      extends: './node_modules/@microsoft/rush-stack-compiler-4.7/includes/tsconfig-web.json',
    },
    [`${name}/src/index.ts`]: 'import "@pnp/sp/webs";\nexport const x = 1;\n',
    ...extraFiles,
  };
}

async function unusedDev(files: FileTree, id: string): Promise<string[]> {
  const { root, cleanup } = await makeWorkspace(files);
  try {
    const config = configSchema.parse({});
    const report = await analyze(await discoverWorkspace(root, { config }), {
      config,
      today: TODAY,
      security: false,
      offline: true,
      installedNodes: fakeNodes('18.20.8'),
    });
    const entry = report.projects.find((item) => item.project.id === id);
    return (
      entry?.findings
        .filter((item) => item.ruleId === 'npm/unused-dev-dependency')
        .flatMap((item) => item.evidence.map((line) => line.split('@')[0] ?? line))
        .filter((name) => name.length > 0) ?? []
    );
  } finally {
    await cleanup();
  }
}

describe('packages named by build configs count as used', () => {
  it('keeps babel-loader referenced as `loader` in gulpfile.js', async () => {
    const unused = await unusedDev(project('footer', GULPFILE_WITH_LOADER), 'footer');
    expect(unused).not.toContain('babel-loader');
    // Nothing references ts-jest: it is still reported.
    expect(unused).toContain('ts-jest');
  });

  it('ignores references that only appear in comments', async () => {
    const unused = await unusedDev(project('footer', GULPFILE_COMMENTED), 'footer');
    expect(unused).toContain('babel-loader');
  });

  it('reads webpack.*.config.js and jest.config.ts string references too', async () => {
    const unused = await unusedDev(
      project('footer', GULPFILE_COMMENTED, {
        'footer/webpack.extend.config.js':
          "module.exports = { module: { rules: [{ test: /\\.js$/, use: { loader: 'babel-loader' } }] } };\n",
        'footer/jest.config.ts': "export default { transform: { '^.+\\\\.ts$': 'ts-jest' } };\n",
      }),
      'footer',
    );
    expect(unused).not.toContain('babel-loader');
    expect(unused).not.toContain('ts-jest');
  });
});

/** Runtime dependencies `npm/unused-dependency` reports for one project. */
async function unusedRuntime(files: FileTree, id: string): Promise<string[]> {
  const { root, cleanup } = await makeWorkspace(files);
  try {
    const config = configSchema.parse({});
    const report = await analyze(await discoverWorkspace(root, { config }), {
      config,
      today: TODAY,
      security: false,
      offline: true,
      installedNodes: fakeNodes('18.20.8'),
    });
    const entry = report.projects.find((item) => item.project.id === id);
    return (
      entry?.findings
        .filter((item) => item.ruleId === 'npm/unused-dependency')
        .flatMap((item) => item.evidence.map((line) => /^(@?[^@]+)@/.exec(line)?.[1] ?? line)) ?? []
    );
  } finally {
    await cleanup();
  }
}

function spfxProject(name: string, spfxConfig: object): FileTree {
  const dependencies = {
    '@microsoft/sp-core-library': '1.18.2',
    '@pnp/spfx-property-controls': '3.14.0',
    '@pnp/spfx-controls-react': '3.21.0',
    jquery: '3.7.1',
    'left-pad': '1.3.0',
  };
  return {
    [`${name}/package.json`]: { name, dependencies },
    [`${name}/package-lock.json`]: lockfile(name, {}, dependencies),
    [`${name}/config/config.json`]: spfxConfig,
    [`${name}/src/index.ts`]:
      'import * as strings from "GalleryWebPartStrings";\nexport { strings };\n',
  };
}

describe('SPFx config/config.json references count as used (PMT10)', () => {
  it('keeps packages named by localizedResources and externals, still reports the rest', async () => {
    const unused = await unusedRuntime(
      spfxProject('gallery', {
        $schema: 'https://developer.microsoft.com/json-schemas/spfx-build/config.2.0.schema.json',
        version: '2.0',
        bundles: {
          'gallery-web-part': {
            components: [
              {
                entrypoint: './lib/webparts/gallery/GalleryWebPart.js',
                manifest: './src/webparts/gallery/GalleryWebPart.manifest.json',
              },
            ],
          },
        },
        externals: { jquery: 'node_modules/jquery/dist/jquery.min.js' },
        localizedResources: {
          GalleryWebPartStrings: 'lib/webparts/gallery/loc/{locale}.js',
          PropertyControlStrings: 'node_modules/@pnp/spfx-property-controls/lib/loc/{locale}.js',
          ControlStrings: 'node_modules\\@pnp\\spfx-controls-react\\lib\\loc\\{locale}.js',
        },
      }),
      'gallery',
    );
    expect(unused).not.toContain('@pnp/spfx-property-controls');
    expect(unused).not.toContain('@pnp/spfx-controls-react');
    expect(unused).not.toContain('jquery');
    expect(unused).toContain('left-pad');
  });

  it('counts an externals key that maps to a CDN URL', async () => {
    const unused = await unusedRuntime(
      spfxProject('cdn', {
        version: '2.0',
        bundles: {},
        externals: {
          jquery: { path: 'https://code.jquery.com/jquery-3.7.1.min.js', globalName: 'jQuery' },
        },
        localizedResources: {},
      }),
      'cdn',
    );
    expect(unused).not.toContain('jquery');
    expect(unused).toContain('@pnp/spfx-property-controls');
  });
});
