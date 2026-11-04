import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { packmanHome } from '../core/data.js';
import type { SpClient, SpMethod, SpResponse } from './seed.js';

/**
 * A Chromium browser driven over the DevTools protocol. packman never sees a password or token:
 * the person signs in to SharePoint in this browser, and REST calls run inside the signed-in page.
 * The profile lives in `~/.packman/browser` so the sign-in survives between runs.
 */
export interface Page {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  on(listener: (event: { method: string; params: Record<string, unknown> }) => void): () => void;
  url(): Promise<string>;
  close(): void;
}

export const DEFAULT_DEBUG_PORT = 9333;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function browserExecutable(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe',
          ),
          path.join(
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe',
          ),
          path.join(
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          ),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          ]
        : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return process.env.PACKMAN_BROWSER ?? candidates.find((file) => existsSync(file));
}

async function debuggerTargets(
  port: number,
): Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[] | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    return (await response.json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
  } catch {
    return undefined;
  }
}

/** Opens (or reuses) the packman browser on `url` and connects to its page. */
export async function openBrowser(url: string, port = DEFAULT_DEBUG_PORT): Promise<Page> {
  if (!(await debuggerTargets(port))) {
    const executable = browserExecutable();
    if (!executable)
      throw new Error('No Edge or Chrome found; set PACKMAN_BROWSER to a Chromium browser.');
    const child = spawn(
      executable,
      [
        `--user-data-dir=${path.join(packmanHome(), 'browser')}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--new-window',
        url,
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    for (let i = 0; i < 40 && !(await debuggerTargets(port)); i++) await sleep(250);
  }
  const targets = (await debuggerTargets(port)) ?? [];
  const target =
    targets.find((entry) => entry.type === 'page' && /^https?:/.test(entry.url)) ??
    targets.find((entry) => entry.type === 'page');
  if (!target) throw new Error(`No browser page on port ${port}.`);
  return connectPage(target.webSocketDebuggerUrl);
}

async function connectPage(socketUrl: string): Promise<Page> {
  const socket = new WebSocket(socketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      resolve();
    };
    socket.onerror = () => {
      reject(new Error('Cannot connect to the browser.'));
    };
  });
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners = new Set<(event: { method: string; params: Record<string, unknown> }) => void>();
  socket.onmessage = (message) => {
    const data = JSON.parse(String(message.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: Record<string, unknown>;
    };
    if (data.id !== undefined) {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) waiter?.reject(new Error(data.error.message));
      else waiter?.resolve(data.result);
    } else if (data.method)
      for (const listener of listeners)
        listener({ method: data.method, params: data.params ?? {} });
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await send<{
      result: { value: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  };
  return {
    send,
    evaluate,
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    url: () => evaluate<string>('location.href'),
    close: () => {
      socket.close();
    },
  };
}

/** Waits until the page is on the site, signed in; the person signs in meanwhile. */
export async function waitForSite(
  page: Page,
  site: string,
  timeoutMs = 300_000,
  onWait?: () => void,
): Promise<void> {
  const host = new URL(site).host.toLowerCase();
  const started = Date.now();
  let told = false;
  while (Date.now() - started < timeoutMs) {
    const current = await page.url().catch(() => '');
    if (current && new URL(current).host.toLowerCase() === host) {
      const signedIn = await page
        .evaluate<number>(
          `fetch(${JSON.stringify(`${site}/_api/web?$select=Id`)}, { headers: { accept: 'application/json' } }).then(r => r.status)`,
        )
        .catch(() => 0);
      if (signedIn === 200) return;
    }
    if (!told) {
      onWait?.();
      told = true;
    }
    await sleep(2000);
  }
  throw new Error(`Not signed in to ${site} within ${Math.round(timeoutMs / 1000)} s.`);
}

/** REST calls through the signed-in page, with the request digest SharePoint wants for writes. */
export function browserClient(page: Page, site: string): SpClient {
  const base = site.replace(/\/$/, '');
  return {
    site: base,
    request: <T>(
      method: SpMethod,
      apiPath: string,
      body?: unknown,
      binary?: Buffer,
    ): Promise<SpResponse<T>> => {
      const args = JSON.stringify({
        site: base,
        method,
        apiPath,
        body: body === undefined ? null : body,
        binary: binary ? binary.toString('base64') : null,
      });
      return page.evaluate<SpResponse<T>>(`(async (a) => {
        const accept = 'application/json;odata=nometadata';
        const headers = { accept };
        if (a.method !== 'GET') {
          const cache = window.__packmanDigest;
          if (!cache || cache.site !== a.site || cache.until < Date.now()) {
            const info = await (await fetch(a.site + '/_api/contextinfo', { method: 'POST', headers: { accept } })).json();
            window.__packmanDigest = { site: a.site, value: info.FormDigestValue, until: Date.now() + (info.FormDigestTimeoutSeconds - 60) * 1000 };
          }
          headers['X-RequestDigest'] = window.__packmanDigest.value;
        }
        if (a.method === 'MERGE' || a.method === 'DELETE') {
          headers['X-HTTP-Method'] = a.method;
          headers['IF-MATCH'] = '*';
        }
        let payload;
        if (a.binary !== null) payload = Uint8Array.from(atob(a.binary), (c) => c.charCodeAt(0));
        else if (a.body !== null) {
          headers['content-type'] = accept;
          payload = JSON.stringify(a.body);
        }
        const response = await fetch(a.site + a.apiPath, { method: a.method === 'GET' ? 'GET' : 'POST', headers, body: payload });
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { status: response.status, data };
      })(${args})`);
    },
  };
}
