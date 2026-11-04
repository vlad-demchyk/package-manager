import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { parseJsonc } from '../core/json.js';
import type { Project } from '../core/types.js';
import type { InstalledNode } from '../node/toolchain.js';
import type { Page } from './browser.js';
import { exploreProperties, type PropertyRun } from './properties.js';

/** A component the dev server announces in its debug manifests. */
export interface DebugComponent {
  id: string;
  alias: string;
  type: 'WebPart' | 'Extension';
}

/** What happened in the page while a component loaded. */
export interface PageEvents {
  exceptions: string[];
  console: string[];
  responses: { url: string; status: number }[];
  failed: string[];
  /** SharePoint REST, Graph and SiteAssets requests, for `requirements`. */
  requests: { method: string; url: string }[];
}

export type IssueKind = 'load' | 'runtime' | 'data' | 'host' | 'known';

export interface Issue {
  kind: IssueKind;
  text: string;
}

export interface ComponentResult {
  project: string;
  component: DebugComponent;
  /** Bundles served by the project's dev server. */
  bundles: number;
  rendered: boolean;
  status: 'ok' | 'needs-data' | 'failed';
  issues: Issue[];
  requests: { method: string; url: string }[];
  screenshot?: string;
  text?: string;
  /** Property pane run, with `sharepoint test --properties`. */
  properties?: PropertyRun;
}

/** The DevTools event fields this module reads. */
interface CdpParams {
  type?: string;
  args?: { value?: unknown; description?: string }[];
  exceptionDetails?: { text?: string; exception?: { description?: string } };
  request?: { method: string; url: string };
  response?: { url: string; status: number };
  canceled?: boolean;
  errorText?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sorts what the page reported into what the component can be blamed for:
 * - load: its bundle or a dependency did not arrive (404 from the dev server, chunk errors);
 * - runtime: an exception raised from its own bundle;
 * - data: a list, column or file the dev site lacks (SharePoint 404 / "does not exist");
 * - host: everything else the workbench itself logs.
 */
export function classify(events: PageEvents, origin: string, known: string[] = []): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const push = (found: IssueKind, text: string): void => {
    const kind = known.some((entry) => text.includes(entry)) ? 'known' : found;
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, text: text.slice(0, 400) });
  };
  const missing = /does not exist|non esiste|не існує|File Not Found|404/i;
  for (const response of events.responses) {
    if (response.status < 400) continue;
    if (response.url.startsWith(origin)) push('load', `${response.status} ${response.url}`);
    else if (/\/_api\/|\/SiteAssets\//i.test(response.url) && response.status === 404)
      push('data', `${response.status} ${decodeURIComponent(response.url).replace(/\?.*$/, '')}`);
    else if (/graph\.microsoft\.com/i.test(response.url))
      push('data', `${response.status} ${response.url.replace(/\?.*$/, '')}`);
  }
  for (const text of [...events.exceptions, ...events.console]) {
    // Telemetry of PnP property controls fails wherever its endpoint is blocked; not the component.
    if (/PnPTelemetry/.test(text)) push('host', text);
    else if (
      /ChunkLoadError|Loading chunk|Failed to load component|Could not load|SPLoaderError|Cannot find module/i.test(
        text,
      )
    )
      push('load', text);
    else if (text.includes(origin) && !missing.test(text)) push('runtime', text);
    else if (missing.test(text) && /_api|elenco|list|SiteAssets|HTTP/i.test(text))
      push('data', text);
    else push('host', text);
  }
  return issues;
}

export function verdict(issues: Issue[], rendered: boolean): ComponentResult['status'] {
  if (!rendered || issues.some((issue) => issue.kind === 'load' || issue.kind === 'runtime'))
    return 'failed';
  return issues.some((issue) => issue.kind === 'data') ? 'needs-data' : 'ok';
}

/** Components and their webpack manifest list from the dev server's `manifests.js`. */
export function parseManifests(body: string): DebugComponent[] {
  const start = body.indexOf('[{"id"');
  for (
    let end = body.indexOf('}]', start);
    start >= 0 && end > 0;
    end = body.indexOf('}]', end + 1)
  ) {
    try {
      const all = JSON.parse(body.slice(start, end + 2)) as {
        id: string;
        alias: string;
        componentType: string;
      }[];
      return all
        .filter((entry) => entry.componentType === 'WebPart' || entry.componentType === 'Extension')
        .map((entry) => ({
          id: entry.id,
          alias: entry.alias,
          type: entry.componentType as DebugComponent['type'],
        }));
    } catch {
      // The array ends at a later `}]`.
    }
  }
  return [];
}

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    // The dev certificate is trusted by the browser, not necessarily by Node; only localhost is read.
    const request = https.get(url, { rejectUnauthorized: false, timeout: 5000 }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString()));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    request.on('error', () => {
      resolve({ status: 0, body: '' });
    });
    request.on('timeout', () => request.destroy());
  });
}

export async function servePort(project: Project): Promise<number> {
  const file = path.join(project.dir, 'config', 'serve.json');
  if (!existsSync(file)) return 4321;
  const parsed = parseJsonc<{ port?: number }>(await readFile(file, 'utf8'), file);
  return parsed.ok ? (parsed.value.port ?? 4321) : 4321;
}

/**
 * How the project serves its debug build: `gulp serve` (SPFx up to 1.21 and gulp-based 1.22) or
 * `heft start` (Heft toolchain, SPFx 1.22+); both serve the same manifests on the serve.json port.
 */
export function devServerCommand(dir: string): string[] | undefined {
  const gulp = path.join(dir, 'node_modules', 'gulp', 'bin', 'gulp.js');
  if (existsSync(gulp)) return [gulp, 'serve', '--nobrowser'];
  const heft = path.join(dir, 'node_modules', '@rushstack', 'heft', 'bin', 'heft');
  if (existsSync(heft)) return [heft, 'start', '--nobrowser'];
  return undefined;
}

export interface DevServer {
  manifestsUrl: string;
  components: DebugComponent[];
  stop(): Promise<void>;
}

/** Starts `gulp serve --nobrowser` with the project's Node and waits for its debug manifests. */
export async function startDevServer(
  project: Project,
  node: InstalledNode,
  logFile: string,
): Promise<DevServer> {
  const port = await servePort(project);
  const origin = `https://localhost:${port}`;
  if ((await get(`${origin}/temp/build/manifests.js`)).status !== 0)
    throw new Error(`port ${port} is already in use; stop the other dev server first`);
  const command = devServerCommand(project.dir);
  if (!command) throw new Error('no gulp or heft in node_modules');
  const env = {
    ...process.env,
    PATH: `${path.dirname(node.executable)}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  const log = createWriteStream(logFile);
  log.on('error', () => undefined);
  const child: ChildProcess = spawn(node.executable, command, {
    cwd: project.dir,
    env,
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  const state = { exited: false };
  child.on('close', () => {
    state.exited = true;
    log.end();
  });
  const stop = async (): Promise<void> => {
    if (!state.exited && child.pid !== undefined) {
      if (process.platform === 'win32')
        try {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          // Already gone.
        }
      else child.kill('SIGTERM');
    }
    for (let i = 0; i < 30 && (await get(`${origin}/temp/build/manifests.js`)).status !== 0; i++)
      await sleep(1000);
  };
  for (let i = 0; i < 100 && !state.exited; i++) {
    await sleep(3000);
    for (const manifestsUrl of [
      `${origin}/temp/build/manifests.js`,
      `${origin}/temp/manifests.js`,
    ]) {
      const response = await get(manifestsUrl);
      if (response.status === 200)
        return { manifestsUrl, components: parseManifests(response.body), stop };
    }
  }
  await stop();
  throw new Error(
    state.exited
      ? `gulp serve exited, see ${logFile}`
      : `gulp serve did not start in 300 s, see ${logFile}`,
  );
}

async function clickWhenPresent(
  page: Page,
  selectorScript: string,
  seconds: number,
): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    const clicked = await page
      .evaluate<boolean>(
        `(() => { const el = ${selectorScript}; if (el) { el.click(); return true; } return false; })()`,
      )
      .catch(() => false);
    if (clicked) return true;
    await sleep(1000);
  }
  return false;
}

const DEBUG_BUTTON = `[...document.querySelectorAll('button')].find(b => /Load debug scripts|Carica script di debug|Завантажити сценарії налагодження|debug/i.test(b.textContent) && !/Don't|Non caricare|Не /i.test(b.textContent))`;

/**
 * Loads one component from the dev server into SharePoint: a web part into the hosted workbench
 * (added from the toolbox), an application customizer onto `extensionPage`. Nothing is saved on
 * the site; the components themselves may still read and write their lists.
 */
export async function checkComponent(
  page: Page,
  options: {
    project: string;
    site: string;
    extensionPage: string;
    manifestsUrl: string;
    component: DebugComponent;
    screenshot: string;
    /** Extra query string (without `?`), e.g. `iditem=4`. */
    query?: string;
    known?: string[];
    /** Drive every property pane control after the web part renders. */
    properties?: boolean;
  },
): Promise<ComponentResult> {
  const origin = new URL(options.manifestsUrl).origin;
  // Leave the previous page first, so its late requests and errors are not counted here, and
  // start every workbench empty: it keeps the canvas of earlier runs in sessionStorage.
  await page.send('Page.navigate', { url: 'about:blank' });
  await page.send('Page.enable');
  const { identifier } = await page.send<{ identifier: string }>(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: "try { sessionStorage.removeItem('sp_webpart_workbench_state'); } catch (e) {}",
    },
  );
  await sleep(500);
  const extra = options.query ? `&${options.query}` : '';
  const events: PageEvents = {
    exceptions: [],
    console: [],
    responses: [],
    failed: [],
    requests: [],
  };
  const off = page.on((event) => {
    const params = event.params as CdpParams;
    if (event.method === 'Runtime.exceptionThrown')
      events.exceptions.push(
        params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? '',
      );
    else if (event.method === 'Runtime.consoleAPICalled' && params.type === 'error')
      events.console.push(
        (params.args ?? [])
          .map((arg) =>
            typeof arg.value === 'string'
              ? arg.value
              : (arg.description ?? JSON.stringify(arg.value ?? '')),
          )
          .join(' '),
      );
    else if (
      event.method === 'Network.requestWillBeSent' &&
      params.request &&
      /\/_api\/|graph\.microsoft\.com|\/SiteAssets\//i.test(params.request.url)
    )
      events.requests.push({ method: params.request.method, url: params.request.url });
    else if (event.method === 'Network.responseReceived' && params.response)
      events.responses.push({ url: params.response.url, status: params.response.status });
    else if (event.method === 'Network.loadingFailed' && !params.canceled)
      events.failed.push(params.errorText ?? '');
  });
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  const { component } = options;
  let rendered = false;
  let base: PageEvents | undefined;
  let properties: PropertyRun | undefined;
  let text = '';
  try {
    if (component.type === 'WebPart') {
      await page.send('Page.navigate', {
        url: `${options.site}/_layouts/15/workbench.aspx?debug=true&noredir=true&debugManifestsFile=${options.manifestsUrl}${extra}`,
      });
      await sleep(3000);
      await clickWhenPresent(page, DEBUG_BUTTON, 15);
      await clickWhenPresent(
        page,
        `document.querySelector('[data-automation-id=toolboxHint-webPart]')`,
        30,
      );
      if (
        await clickWhenPresent(
          page,
          `document.querySelector('[data-automation-id="${component.id}_0"]')`,
          20,
        )
      ) {
        await sleep(12_000);
        text = await page.evaluate<string>(
          `(document.querySelector('[data-automation-id=CanvasZone]') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 300)`,
        );
        rendered = true;
      }
    } else {
      const actions = JSON.stringify({
        [component.id]: { location: 'ClientSideExtension.ApplicationCustomizer', properties: {} },
      });
      await page.send('Page.navigate', {
        url: `${options.extensionPage}?debugManifestsFile=${options.manifestsUrl}&loadSPFX=true&customActions=${encodeURIComponent(actions)}${extra}`,
      });
      await sleep(3000);
      await clickWhenPresent(page, DEBUG_BUTTON, 15);
      await sleep(15_000);
      text = await page.evaluate<string>('document.title');
      rendered = events.responses.some(
        (response) =>
          response.url.startsWith(origin) &&
          !response.url.includes('manifests.js') &&
          /\.js(\?|$)/.test(response.url) &&
          response.status === 200,
      );
    }
    const shot = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await mkdir(path.dirname(options.screenshot), { recursive: true });
    await writeFile(options.screenshot, Buffer.from(shot.data, 'base64'));
    if (options.properties && rendered && component.type === 'WebPart') {
      // The default render is judged on its own; property changes get their own steps.
      base = {
        ...events,
        exceptions: [...events.exceptions],
        console: [...events.console],
        responses: [...events.responses],
      };
      properties = await exploreProperties(page, {
        events,
        origin,
        known: options.known ?? [],
        screenshot: async (name) => {
          const file = options.screenshot.replace(/\.png$/, `-property-${name}.png`);
          const image = await page.send<{ data: string }>('Page.captureScreenshot', {
            format: 'png',
          });
          await writeFile(file, Buffer.from(image.data, 'base64'));
          return file;
        },
      });
    }
  } finally {
    off();
    await page
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      .catch(() => undefined);
  }
  const issues = classify(base ?? events, origin, options.known);
  return {
    project: options.project,
    component,
    bundles: events.responses.filter(
      (response) => response.url.startsWith(origin) && response.status === 200,
    ).length,
    rendered,
    status: verdict(issues, rendered),
    issues,
    requests: events.requests,
    screenshot: options.screenshot,
    text,
    ...(properties ? { properties } : {}),
  };
}
