import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_STUCK, waitForSite, withTimeout, type Page } from '../src/sharepoint/browser.js';
import { devServerCommand, devServerName } from '../src/sharepoint/debug.js';
import { fixturesSchema } from '../src/sharepoint/fixtures.js';
import {
  addToCanvas,
  hostOnPage,
  manifestProperties,
  patchManifests,
  readPageContext,
} from '../src/sharepoint/host.js';

const BACKSLASH = String.fromCharCode(92);
const WEB_PART = '7f0c1e2a-0000-4000-8000-000000000001';

/** How SharePoint writes the page data: JSON inside a single-quoted script string. */
function pageHtml(context: unknown): string {
  const literal = JSON.stringify(context)
    .split(BACKSLASH)
    .join(BACKSLASH + BACKSLASH)
    .split("'")
    .join(`${BACKSLASH}u0027`);
  return `<script>(function(g){ var a=1, spClientSidePageContext=JSON.parse('${literal}'); })(window);</script>`;
}

describe('web part properties in the debug manifests', () => {
  const body = `define([], function () { return [{"id":"${WEB_PART}","alias":"TeamCalendarWebPart","componentType":"WebPart","preconfiguredEntries":[{"title":{"default":"Video"},"properties":{"description":"TeamCalendar"}}]},{"id":"lib","alias":"Core","componentType":"Library"}]; });`;

  it('lays fixture properties over the preconfigured ones', () => {
    const patched = patchManifests(body, WEB_PART, { videoType: 'YouTube', items: [{ a: 1 }] });
    expect(patched.startsWith('define([], function () { return [{')).toBe(true);
    expect(patched.endsWith(']; });')).toBe(true);
    expect(manifestProperties(patched, WEB_PART)).toEqual({
      description: 'TeamCalendar',
      videoType: 'YouTube',
      items: [{ a: 1 }],
    });
    expect(manifestProperties(body, WEB_PART)).toEqual({ description: 'TeamCalendar' });
  });

  it('leaves other components and unknown ids alone', () => {
    expect(patchManifests(body, 'missing', { x: 1 })).toBe(body);
    expect(manifestProperties(body, 'lib')).toEqual({});
  });
});

describe('web part on a real page', () => {
  it('adds a new section above the existing ones', () => {
    const existing = JSON.stringify([
      { controlType: 4, id: 'text', position: { zoneIndex: 1, sectionIndex: 1 } },
      { controlType: 0, pageSettingsSlice: { isDefaultDescription: true } },
    ]);
    const canvas = JSON.parse(
      addToCanvas(existing, WEB_PART, 'inst-1', 'Footer', { a: 1 }),
    ) as Record<string, unknown>[];
    expect(canvas).toHaveLength(3);
    expect(canvas[0]).toMatchObject({
      controlType: 3,
      id: 'inst-1',
      webPartId: WEB_PART,
      position: { zoneIndex: 0, sectionIndex: 1, sectionFactor: 12 },
      webPartData: { id: WEB_PART, instanceId: 'inst-1', properties: { a: 1 } },
    });
  });

  it('merges properties into an instance the page already has', () => {
    const existing = JSON.stringify([
      {
        controlType: 3,
        id: 'old',
        webPartId: WEB_PART,
        webPartData: { properties: { a: 1, b: 2 } },
      },
    ]);
    const canvas = JSON.parse(addToCanvas(existing, WEB_PART, 'new', 'x', { b: 3 })) as {
      id: string;
      webPartData: { properties: unknown };
    }[];
    expect(canvas).toHaveLength(1);
    expect(canvas[0]?.id).toBe('old');
    expect(canvas[0]?.webPartData.properties).toEqual({ a: 1, b: 3 });
  });

  it('replaces an HTML canvas with the web part', () => {
    const canvas = JSON.parse(addToCanvas('<div></div>', WEB_PART, 'i', 't', {})) as unknown[];
    expect(canvas).toHaveLength(1);
  });

  it('rewrites the page data the HTML embeds and keeps the rest of the page', () => {
    const context = {
      user: { Title: "Dell'Orto", LoginName: 'i:0#.f|membership|x@contoso.com' },
      page: {
        DoesUserHaveEditPermission: true,
        Content: {
          CanvasContent1: JSON.stringify([{ controlType: 4, id: 't', innerHTML: '<p>"ciao"</p>' }]),
          LayoutWebpartsContent: null,
        },
      },
    };
    const html = pageHtml(context);
    expect(readPageContext(html)?.context).toEqual(context);
    const hosted = hostOnPage(html, WEB_PART, 'inst', 'Footer', { mode: "l'uno" });
    expect(hosted).toBeDefined();
    expect(hosted?.startsWith('<script>(function(g){ var a=1, spClientSidePageContext=')).toBe(
      true,
    );
    expect(hosted?.endsWith("'); })(window);</script>")).toBe(true);
    expect(hosted).not.toContain('<p>');
    const read = readPageContext(hosted ?? '')?.context as typeof context;
    expect(read.user).toEqual(context.user);
    const canvas = JSON.parse(read.page.Content.CanvasContent1) as {
      id: string;
      webPartData?: { properties: unknown };
      innerHTML?: string;
    }[];
    expect(canvas.map((control) => control.id)).toEqual(['inst', 't']);
    expect(canvas[0]?.webPartData?.properties).toEqual({ mode: "l'uno" });
    expect(canvas[1]?.innerHTML).toBe('<p>"ciao"</p>');
  });

  it('leaves pages without page data alone', () => {
    expect(hostOnPage('<html></html>', WEB_PART, 'i', 't', {})).toBeUndefined();
  });

  it('accepts properties and a page in the component fixture', () => {
    const fixtures = fixturesSchema.parse({
      components: {
        FooterWebPart: { page: 'news/SitePages/test-news-1.aspx', properties: { a: 1 } },
      },
    });
    expect(fixtures.components.FooterWebPart?.page).toBe('news/SitePages/test-news-1.aspx');
    expect(() =>
      fixturesSchema.parse({ components: { X: { page: 'SitePages/a.aspx?x=1' } } }),
    ).toThrow();
  });
});

describe('dev server command', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const project = (tools: ('gulp' | 'heft')[], start?: string): string => {
    dir = mkdtempSync(path.join(tmpdir(), 'packman-serve-'));
    if (tools.includes('gulp')) {
      mkdirSync(path.join(dir, 'node_modules', 'gulp', 'bin'), { recursive: true });
      writeFileSync(path.join(dir, 'node_modules', 'gulp', 'bin', 'gulp.js'), '');
    }
    if (tools.includes('heft')) {
      mkdirSync(path.join(dir, 'node_modules', '@rushstack', 'heft', 'bin'), { recursive: true });
      writeFileSync(path.join(dir, 'node_modules', '@rushstack', 'heft', 'bin', 'heft'), '');
    }
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: start ? { start } : {} }),
    );
    return dir;
  };
  const name = (command: string[] | undefined) => (command ? devServerName(command) : undefined);

  it('serves gulp projects with gulp serve and Heft projects with heft start', () => {
    expect(name(devServerCommand(project(['gulp'])))).toBe('gulp serve');
    expect(devServerCommand(dir)?.slice(1)).toEqual(['serve', '--nobrowser']);
    rmSync(dir, { recursive: true, force: true });
    expect(name(devServerCommand(project(['heft'])))).toBe('heft start');
    expect(devServerCommand(dir)?.slice(1)).toEqual(['start', '--nobrowser']);
    rmSync(dir, { recursive: true, force: true });
    expect(devServerCommand(project([]))).toBeUndefined();
  });

  it('follows the start script when both are installed', () => {
    expect(name(devServerCommand(project(['gulp', 'heft'], 'heft start --clean')))).toBe(
      'heft start',
    );
    rmSync(dir, { recursive: true, force: true });
    expect(name(devServerCommand(project(['gulp', 'heft'], 'gulp serve')))).toBe('gulp serve');
  });
});

describe('browser that does not answer', () => {
  const site = 'https://t.sharepoint.com/sites/dev';
  const page = (url: () => Promise<string>, status: () => Promise<number>): Page => ({
    send: () => new Promise(() => undefined),
    evaluate: <T>() => status() as Promise<T>,
    on: () => () => undefined,
    url,
    close: () => undefined,
  });

  it('stops with a stuck-browser message instead of waiting forever', async () => {
    const never = () => new Promise<never>(() => undefined);
    await expect(waitForSite(page(never, never), site, 300, undefined, 50)).rejects.toThrow(
      BROWSER_STUCK,
    );
    // The page answers but its request times out inside the page.
    const ok = () => Promise.resolve(`${site}/SitePages/Home.aspx`);
    await expect(
      waitForSite(
        page(ok, () => Promise.resolve(-1)),
        site,
        300,
        undefined,
        50,
      ),
    ).rejects.toThrow(BROWSER_STUCK);
  });

  it('still reports a missing sign-in as such', async () => {
    const login = () => Promise.resolve('https://login.microsoftonline.com/x');
    await expect(
      waitForSite(
        page(login, () => Promise.resolve(403)),
        site,
        300,
        undefined,
        50,
      ),
    ).rejects.toThrow(`Not signed in to ${site}`);
  });

  it('returns once the site answers', async () => {
    const ok = () => Promise.resolve(`${site}/SitePages/Home.aspx`);
    await expect(
      waitForSite(
        page(ok, () => Promise.resolve(200)),
        site,
        300,
        undefined,
        50,
      ),
    ).resolves.toBeUndefined();
  });

  it('times out a single promise with the given message', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, 'late')).rejects.toThrow('late');
    await expect(withTimeout(Promise.resolve(1), 10, 'late')).resolves.toBe(1);
  });
});
