import type { Page } from './browser.js';

/**
 * Hosting a web part with chosen properties, without saving anything on the site: the browser's
 * copy of the debug manifests and of a modern page is changed as it arrives (DevTools `Fetch`).
 */

type Properties = Record<string, unknown>;

interface ManifestEntry {
  id: string;
  preconfiguredEntries?: { properties?: Properties }[];
}

/** Start and end of the manifest array in the dev server's `manifests.js`. */
function manifestArray(body: string): { start: number; end: number; entries: ManifestEntry[] } {
  const start = body.indexOf('[{"id"');
  for (
    let end = body.indexOf('}]', start);
    start >= 0 && end > 0;
    end = body.indexOf('}]', end + 1)
  ) {
    try {
      const entries = JSON.parse(body.slice(start, end + 2)) as ManifestEntry[];
      return { start, end: end + 2, entries };
    } catch {
      // The array ends at a later `}]`.
    }
  }
  return { start: -1, end: -1, entries: [] };
}

/** Properties of the component's first preconfigured entry (what the toolbox adds). */
export function manifestProperties(body: string, componentId: string): Properties {
  const entry = manifestArray(body).entries.find((item) => item.id === componentId);
  return { ...(entry?.preconfiguredEntries?.[0]?.properties ?? {}) };
}

/**
 * The dev server's `manifests.js` with `properties` laid over every preconfigured entry of the
 * component, so the workbench toolbox adds the web part with them. Unchanged when it is absent.
 */
export function patchManifests(body: string, componentId: string, properties: Properties): string {
  const { start, end, entries } = manifestArray(body);
  const entry = entries.find((item) => item.id === componentId);
  if (!entry) return body;
  entry.preconfiguredEntries = (entry.preconfiguredEntries ?? [{}]).map((preset) => ({
    ...preset,
    properties: { ...(preset.properties ?? {}), ...properties },
  }));
  return `${body.slice(0, start)}${JSON.stringify(entries)}${body.slice(end)}`;
}

/** One web part control of a modern page canvas (the JSON form of `CanvasContent1`). */
export function webPartControl(
  componentId: string,
  instanceId: string,
  title: string,
  properties: Properties,
  zoneIndex = 1,
): Record<string, unknown> {
  return {
    controlType: 3,
    id: instanceId,
    position: { zoneIndex, sectionIndex: 1, controlIndex: 1, sectionFactor: 12, layoutIndex: 1 },
    webPartId: componentId,
    emphasis: {},
    addedFromPersistedData: true,
    webPartData: {
      id: componentId,
      instanceId,
      title,
      description: '',
      serverProcessedContent: {
        htmlStrings: {},
        searchablePlainTexts: {},
        imageSources: {},
        links: {},
      },
      dataVersion: '1.0',
      properties,
    },
  };
}

/**
 * The page canvas with the web part on it: properties merged into an instance already there,
 * otherwise a new one-column section above the others. A canvas in the old HTML form (or none) is
 * replaced by the web part alone.
 */
export function addToCanvas(
  canvas: unknown,
  componentId: string,
  instanceId: string,
  title: string,
  properties: Properties,
): string {
  let controls: Record<string, unknown>[] = [];
  if (typeof canvas === 'string' && canvas.trim().startsWith('['))
    try {
      controls = JSON.parse(canvas) as Record<string, unknown>[];
    } catch {
      controls = [];
    }
  const present = controls.find((control) => control.webPartId === componentId);
  if (present) {
    const data = (present.webPartData ?? {}) as { properties?: Properties };
    present.webPartData = { ...data, properties: { ...(data.properties ?? {}), ...properties } };
    return JSON.stringify(controls);
  }
  const zones = controls
    .map((control) => (control.position as { zoneIndex?: number } | undefined)?.zoneIndex)
    .filter((zone): zone is number => typeof zone === 'number');
  const zone = zones.length ? Math.min(...zones) - 1 : 1;
  return JSON.stringify([
    webPartControl(componentId, instanceId, title, properties, zone),
    ...controls,
  ]);
}

const PAGE_CONTEXT = /spClientSidePageContext\s*=\s*JSON\.parse\('/;

/** Reads a single-quoted JavaScript string literal starting at `from`; `end` is the closing quote. */
function readLiteral(text: string, from: number): { value: string; end: number } | undefined {
  let value = '';
  const simple: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    v: '\v',
    '0': '\0',
  };
  for (let i = from; i < text.length; i++) {
    const char = text[i] ?? '';
    if (char === "'") return { value, end: i };
    if (char !== '\\') {
      value += char;
      continue;
    }
    const next = text[++i] ?? '';
    if (next === 'u' || next === 'x') {
      const size = next === 'u' ? 4 : 2;
      value += String.fromCharCode(parseInt(text.slice(i + 1, i + 1 + size), 16));
      i += size;
    } else if (next === '\r' || next === '\n') {
      if (next === '\r' && text[i + 1] === '\n') i++;
    } else value += simple[next] ?? next;
  }
  return undefined;
}

/** A single-quoted JavaScript string literal body that is also safe inside `<script>`. */
function writeLiteral(value: string): string {
  return value.replace(/[\\'\n\r\u2028\u2029<]/g, (char) =>
    char === '\\'
      ? '\\\\'
      : char === "'"
        ? "\\'"
        : `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

interface PageContext {
  page?: { Content?: { CanvasContent1?: unknown } };
}

/** The page data a modern page embeds (`spClientSidePageContext = JSON.parse('...')`). */
export function readPageContext(
  html: string,
): { context: PageContext; from: number; end: number } | undefined {
  const match = PAGE_CONTEXT.exec(html);
  if (!match) return undefined;
  const from = match.index + match[0].length;
  const literal = readLiteral(html, from);
  if (!literal) return undefined;
  try {
    return { context: JSON.parse(literal.value) as PageContext, from, end: literal.end };
  } catch {
    return undefined;
  }
}

/**
 * A modern page's HTML with the web part added to the canvas it embeds. Undefined when the page
 * has no such data.
 */
export function hostOnPage(
  html: string,
  componentId: string,
  instanceId: string,
  title: string,
  properties: Properties,
): string | undefined {
  const found = readPageContext(html);
  if (!found?.context.page) return undefined;
  const { context, from, end } = found;
  const content = context.page?.Content ?? {};
  context.page = {
    ...context.page,
    Content: {
      ...content,
      CanvasContent1: addToCanvas(
        content.CanvasContent1,
        componentId,
        instanceId,
        title,
        properties,
      ),
    },
  };
  return `${html.slice(0, from)}${writeLiteral(JSON.stringify(context))}${html.slice(end)}`;
}

interface PausedRequest {
  requestId: string;
  request: { url: string };
  resourceType?: string;
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
}

/** One response to change: which requests, and the new body (undefined keeps it). */
export interface ResponsePatch {
  /** DevTools URL pattern, `*` as wildcard. */
  urlPattern: string;
  resourceType?: 'Document' | 'Script';
  patch(body: string, url: string): string | undefined;
}

/**
 * Changes matching responses as the browser receives them, until the returned function is called.
 * Service workers are bypassed so pages come from the network and pass through here.
 */
export async function interceptResponses(
  page: Page,
  patches: ResponsePatch[],
): Promise<{ stop: () => Promise<void>; patched: string[] }> {
  const patched: string[] = [];
  if (patches.length === 0) return { stop: () => Promise.resolve(), patched };
  const wildcard = (pattern: string): RegExp =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const rules = patches.map((rule) => ({ ...rule, test: wildcard(rule.urlPattern) }));
  const handle = async (paused: PausedRequest): Promise<void> => {
    const rule = rules.find(
      (entry) =>
        entry.test.test(paused.request.url) &&
        (!entry.resourceType || entry.resourceType === paused.resourceType),
    );
    const status = paused.responseStatusCode ?? 0;
    let body: string | undefined;
    if (rule && status >= 200 && status < 300) {
      const raw = await page.send<{ body: string; base64Encoded: boolean }>(
        'Fetch.getResponseBody',
        { requestId: paused.requestId },
      );
      const text = raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body;
      body = rule.patch(text, paused.request.url);
    }
    if (body === undefined) {
      await page.send('Fetch.continueRequest', { requestId: paused.requestId });
      return;
    }
    patched.push(paused.request.url);
    await page.send('Fetch.fulfillRequest', {
      requestId: paused.requestId,
      responseCode: status,
      responseHeaders: (paused.responseHeaders ?? []).filter(
        (header) => !/^(content-length|content-encoding)$/i.test(header.name),
      ),
      body: Buffer.from(body, 'utf8').toString('base64'),
    });
  };
  const off = page.on((event) => {
    if (event.method !== 'Fetch.requestPaused') return;
    const paused = event.params as unknown as PausedRequest;
    handle(paused).catch(() =>
      page.send('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => undefined),
    );
  });
  await page.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => undefined);
  await page.send('Fetch.enable', {
    patterns: rules.map((rule) => ({
      urlPattern: rule.urlPattern,
      ...(rule.resourceType ? { resourceType: rule.resourceType } : {}),
      requestStage: 'Response',
    })),
  });
  return {
    patched,
    stop: async () => {
      off();
      await page.send('Fetch.disable').catch(() => undefined);
      await page.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => undefined);
    },
  };
}
