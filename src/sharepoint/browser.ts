import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { packmanHome } from '../core/data.js';
import type { SpClient, SpMethod, SpResponse } from './seed.js';

/**
 * A Chromium browser driven over the DevTools protocol. packman never sees a password or token:
 * the person signs in to SharePoint in this browser, and REST calls run inside the signed-in page.
 * The profile lives in `browser/` of the per-user packman folder (`packmanHome()`), so the sign-in
 * survives between runs.
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

/** Longest wait for one DevTools command (an `evaluate` includes the promise it awaits). */
export const COMMAND_TIMEOUT_MS = 120_000;

/** What a hung browser tells the person; restarting it keeps the sign-in (it is in the profile). */
export const BROWSER_STUCK =
  'The packman browser does not answer; close it (or end the msedge/chrome process using the packman profile) and run again.';

/** `promise`, or a rejection with `message` after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message));
      }, ms);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

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
  // A command the browser never answers (a request stuck in its network stack) must not hang
  // packman: it fails after COMMAND_TIMEOUT_MS with a message that says what to do.
  const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++next;
    const answer = new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(
      answer,
      COMMAND_TIMEOUT_MS,
      `${method}: no answer in ${COMMAND_TIMEOUT_MS / 1000} s. ${BROWSER_STUCK}`,
    ).finally(() => pending.delete(id));
  };
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
  probeMs = 15_000,
): Promise<void> {
  const host = new URL(site).host.toLowerCase();
  const started = Date.now();
  let told = false;
  // Whether the last probe got no answer at all: a stuck browser, not a missing sign-in.
  let stuck = false;
  const probe = <T>(promise: Promise<T>): Promise<T | undefined> => {
    const left = Math.max(1, Math.min(probeMs, timeoutMs - (Date.now() - started)));
    return withTimeout(promise, left, 'no answer').then(
      (value) => {
        stuck = false;
        return value;
      },
      (error: unknown) => {
        stuck = error instanceof Error && error.message === 'no answer';
        return undefined;
      },
    );
  };
  while (Date.now() - started < timeoutMs) {
    const current = (await probe(page.url())) ?? '';
    if (current && new URL(current).host.toLowerCase() === host) {
      const signedIn = await probe(
        page.evaluate<number>(
          `fetch(${JSON.stringify(`${site}/_api/web?$select=Id`)}, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(${probeMs}) }).then(r => r.status, (e) => (e && e.name === 'TimeoutError' ? -1 : 0))`,
        ),
      );
      if (signedIn === 200) return;
      // The page answered but its request never did: the browser's network is stuck.
      if (signedIn === -1) stuck = true;
    }
    if (!told && !stuck) {
      onWait?.();
      told = true;
    }
    if (Date.now() - started + 2000 >= timeoutMs) break;
    await sleep(2000);
  }
  if (stuck) throw new Error(`${site}: ${BROWSER_STUCK}`);
  throw new Error(`Not signed in to ${site} within ${Math.round(timeoutMs / 1000)} s.`);
}

/** REST calls through the signed-in page, with the request digest SharePoint wants for writes. */
export function browserClient(page: Page, site: string): SpClient {
  const base = site.replace(/\/$/, '');
  return {
    site: base,
    at: (relative: string) => browserClient(page, `${base}/${relative.replace(/^\/+|\/+$/g, '')}`),
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
