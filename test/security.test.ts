import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '../src/core/config.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import {
  fetchAdvisories,
  projectVulnerabilities,
  type Advisory,
} from '../src/security/advisories.js';
import { lockfile, makeWorkspace } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
});
const advisory: Advisory = {
  id: 1,
  url: 'https://example.invalid/advisory',
  title: 'test advisory',
  severity: 'high',
  vulnerable_versions: '<2.0.0',
};

describe('advisories', () => {
  it('keeps independent package snapshots available offline after switching workspaces', async () => {
    const workspace = await makeWorkspace({});
    cleanup = workspace.cleanup;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ first: [advisory] })));
    const first = new Map([['first', new Set(['1.0.0'])]]);
    const second = new Map([['second', new Set(['2.0.0'])]]);
    const options = { offline: false, cacheRoot: workspace.root, fetchImpl: request };
    expect((await fetchAdvisories(first, options)).status.source).toBe('network');
    request.mockResolvedValue(new Response('{}'));
    await fetchAdvisories(second, options);
    const cached = await fetchAdvisories(first, { ...options, offline: true });
    expect(cached.status).toMatchObject({ checked: true, source: 'cache' });
    expect(cached.advisories.get('first')).toEqual([advisory]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not downgrade runtime packages when an identical dev copy is visited first', async () => {
    const workspace = await makeWorkspace({
      'app/package.json': { name: 'app', dependencies: { vulnerable: '1.0.0' } },
      'app/package-lock.json': lockfile(
        'app',
        { vulnerable: '1.0.0' },
        {
          'node_modules/dev-tool/node_modules/vulnerable': { version: '1.0.0', dev: true },
          vulnerable: { version: '1.0.0', dev: false },
        },
      ),
    });
    cleanup = workspace.cleanup;
    const project = (await discoverWorkspace(workspace.root, { config: configSchema.parse({}) }))
      .projects[0];
    if (!project) throw new Error('project expected');
    expect(projectVulnerabilities(project, new Map([['vulnerable', [advisory]]]))).toEqual([
      {
        name: 'vulnerable',
        version: '1.0.0',
        advisories: [advisory],
        devOnly: false,
        direct: true,
      },
    ]);
  });
});
