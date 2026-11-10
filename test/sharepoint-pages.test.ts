import { describe, expect, it } from 'vitest';
import { fixturesSchema } from '../src/sharepoint/fixtures.js';
import { retrying, RETRY_DELAYS, seedContentTypes, seedPages } from '../src/sharepoint/pages.js';
import type { SpClient, SpMethod, SpResponse } from '../src/sharepoint/seed.js';

const NOW = new Date('2026-11-04T10:30:00Z');
const LIBRARY = { Id: 'lib-1', Title: 'Pagine del sito', BaseTemplate: 119 };
const ROOT = '/sites/dev/SitePages';

interface Script {
  /** Status of each AddAvailableContentType call, in order (then 200). */
  addContentType?: number[];
  /** CheckOutType of a new page: 2 none, 0 checked out already. */
  checkOutType?: number;
  /** Page content types on the library. */
  onLibrary?: string[];
  /** Columns `ValidateUpdateListItem` rejects. */
  rejectColumns?: string[];
}

/** The REST surface `seedContentTypes` and `seedPages` use, with scripted answers. */
function fakeWeb(
  script: Script = {},
): SpClient & { calls: string[]; checkedOut: boolean; forms: unknown[] } {
  const addContentType = [...(script.addContentType ?? [])];
  const onLibrary = [...(script.onLibrary ?? [])];
  const calls: string[] = [];
  const pages: string[] = [];
  const ok = (data: unknown): SpResponse => ({ status: 200, data });
  const error = (status: number): SpResponse => ({
    status,
    data: { 'odata.error': { message: { value: `status ${status}` } } },
  });
  const web = {
    site: 'https://t.sharepoint.com/sites/dev',
    calls,
    checkedOut: false,
    forms: [] as unknown[],
    request<T>(method: SpMethod, apiPath: string, body?: unknown): Promise<SpResponse<T>> {
      const path = decodeURIComponent(apiPath).replace(/''/g, "'");
      if (method !== 'GET') calls.push(`${method} ${path.replace(/\(guid'lib-1'\)/, '')}`);
      const answer = (response: SpResponse) => Promise.resolve(response as SpResponse<T>);
      if (path.startsWith('/_api/web/contenttypes?'))
        return answer(ok({ value: [{ Name: 'Notizia', StringId: '0x0101009D00AA' }] }));
      if (path.startsWith('/_api/web/lists?'))
        return answer(ok({ value: [{ ...LIBRARY, RootFolder: { ServerRelativeUrl: ROOT } }] }));
      if (path.includes('/contenttypes?'))
        return answer(
          ok({ value: onLibrary.map((name) => ({ Name: name, StringId: `${name}-on-list` })) }),
        );
      if (path.includes('/AddAvailableContentType(')) {
        const status = addContentType.shift() ?? 200;
        if (status < 400) onLibrary.push('Notizia');
        return answer(status < 400 ? ok({}) : error(status));
      }
      if (path.includes('/fields?')) return answer(ok({ value: [] }));
      if (path.includes('/fields/createfieldasxml')) return answer(ok({}));
      if (path.includes('/items?$select=Id&$filter=FileLeafRef'))
        return answer(
          ok({ value: pages.filter((name) => path.includes(`'${name}'`)).map(() => ({ Id: 1 })) }),
        );
      if (path.includes('/AddTemplateFile(')) {
        pages.push(/urlOfFile='[^']*\/([^/']+)'/.exec(path)?.[1] ?? '');
        return answer(ok({}));
      }
      if (path.endsWith('/ListItemAllFields?$select=Id')) return answer(ok({ Id: 7 }));
      if (path.endsWith('?$select=CheckOutType'))
        return answer(ok({ CheckOutType: web.checkedOut ? 0 : (script.checkOutType ?? 2) }));
      if (path.endsWith('/CheckOut()')) {
        web.checkedOut = true;
        return answer(ok({}));
      }
      if (method === 'MERGE' && path.endsWith('/items(7)')) {
        const status = web.checkedOut || script.checkOutType === 0 ? 200 : 423;
        return answer(status === 200 ? ok({}) : error(status));
      }
      if (method === 'MERGE') return answer(ok({}));
      if (path.endsWith('/items(7)/ValidateUpdateListItem')) {
        const { formValues } = body as { formValues: { FieldName: string; FieldValue: string }[] };
        web.forms.push(formValues);
        return answer(
          ok({
            value: formValues.map(({ FieldName }) => {
              const rejected = script.rejectColumns?.includes(FieldName) ?? false;
              return { FieldName, HasException: rejected, ErrorMessage: rejected ? 'no' : null };
            }),
          }),
        );
      }
      if (path.includes('/CheckIn(')) return answer(ok({}));
      if (method === 'DELETE') return answer(ok({}));
      throw new Error(`unexpected ${method} ${apiPath}`);
    },
  };
  return web;
}

const FIXTURES = fixturesSchema.parse({
  contentTypes: [
    {
      name: 'Notizia',
      list: 'Pagine del sito',
      fields: [{ name: 'Categoria', type: 'Text' }],
    },
  ],
  pages: [
    {
      name: 'test-news-1.aspx',
      title: 'Notizia 1',
      contentType: 'Notizia',
      news: true,
      list: 'Pagine del sito',
      fields: { Categoria: 'Interna', Description: 'Notizia di prova' },
    },
  ],
});

const noWait = (waited: number[]) => (ms: number) => {
  waited.push(ms);
  return Promise.resolve();
};

describe('retrying', () => {
  it('repeats only on the listed statuses and stops after the last delay', async () => {
    const waited: number[] = [];
    let tries = 0;
    const always = await retrying(
      () => Promise.resolve({ status: 500, data: ++tries }),
      [500],
      noWait(waited),
    );
    expect(always.status).toBe(500);
    expect(tries).toBe(RETRY_DELAYS.length + 1);
    expect(waited).toEqual(RETRY_DELAYS);

    tries = 0;
    const other = await retrying(
      () => Promise.resolve({ status: 404, data: ++tries }),
      [500],
      noWait([]),
    );
    expect(other.status).toBe(404);
    expect(tries).toBe(1);
  });
});

describe('page content types', () => {
  it('plans adding a content type to the library without writing', async () => {
    const web = fakeWeb();
    const actions = await seedContentTypes(web, FIXTURES.contentTypes, {
      apply: false,
      web: '',
      record: { contentTypes: [] },
    });
    expect(web.calls).toEqual([]);
    expect(actions).toEqual([
      { kind: 'contentType', target: 'Notizia', outcome: 'exists' },
      {
        kind: 'contentType',
        target: 'Notizia -> Pagine del sito',
        outcome: 'planned',
        detail: 'add to library',
      },
      { kind: 'field', target: 'Pagine del sito.Categoria', outcome: 'planned', detail: 'Text' },
    ]);
  });

  it('retries adding a just-created content type while SharePoint answers 500', async () => {
    const web = fakeWeb({ addContentType: [500, 500] });
    const waited: number[] = [];
    const actions = await seedContentTypes(web, FIXTURES.contentTypes, {
      apply: true,
      web: '',
      record: { contentTypes: [] },
      wait: noWait(waited),
    });
    expect(waited).toEqual(RETRY_DELAYS.slice(0, 2));
    expect(web.calls.filter((call) => call.includes('AddAvailableContentType'))).toHaveLength(3);
    expect(actions.filter((action) => action.outcome === 'failed')).toEqual([]);
    expect(actions).toContainEqual({
      kind: 'contentType',
      target: 'Notizia -> Pagine del sito',
      outcome: 'created',
    });
  });

  it('reports a content type that never becomes available', async () => {
    const web = fakeWeb({ addContentType: [500, 500, 500, 500] });
    const actions = await seedContentTypes(web, FIXTURES.contentTypes, {
      apply: true,
      web: '',
      record: { contentTypes: [] },
      wait: noWait([]),
    });
    expect(actions).toContainEqual({
      kind: 'contentType',
      target: 'Notizia -> Pagine del sito',
      outcome: 'failed',
      detail: 'HTTP 500: status 500',
    });
  });
});

describe('pages', () => {
  const context = { now: NOW, userId: 12, lookups: new Map<string, Map<string, number>>() };

  it('checks a new page out before setting its columns, then checks it in', async () => {
    const web = fakeWeb({ onLibrary: ['Notizia'] });
    const record = { pages: [] as { web: string; list: string; id: number }[] };
    const actions = await seedPages(web, FIXTURES.pages, {
      apply: true,
      web: '',
      context,
      record,
      wait: noWait([]),
    });
    expect(actions).toEqual([{ kind: 'page', target: 'test-news-1.aspx', outcome: 'created' }]);
    const operation = (call: string) =>
      /(AddTemplateFile|CheckOut|CheckIn|ValidateUpdateListItem|MERGE \/_api\/web\/lists\/items)/.exec(
        call,
      )?.[1];
    expect(web.calls.map(operation)).toEqual([
      'AddTemplateFile',
      'CheckOut',
      'MERGE /_api/web/lists/items',
      'ValidateUpdateListItem',
      'CheckIn',
    ]);
    // A MERGE leaves the news flag and the description unset; the form update sets them.
    expect(web.forms).toEqual([
      [
        { FieldName: 'PromotedState', FieldValue: '2' },
        { FieldName: 'Description', FieldValue: 'Notizia di prova' },
      ],
    ]);
    expect(record.pages).toEqual([{ web: '', list: 'Pagine del sito', id: 7 }]);
  });

  it('removes a page whose news flag SharePoint rejects', async () => {
    const web = fakeWeb({ onLibrary: ['Notizia'], rejectColumns: ['PromotedState'] });
    const record = { pages: [] as { web: string; list: string; id: number }[] };
    const actions = await seedPages(web, FIXTURES.pages, {
      apply: true,
      web: '',
      context,
      record,
      wait: noWait([]),
    });
    expect(actions).toEqual([
      { kind: 'page', target: 'test-news-1.aspx', outcome: 'failed', detail: 'PromotedState: no' },
    ]);
    expect(web.calls.some((call) => call.includes('/CheckIn('))).toBe(false);
    expect(web.calls).toContain('DELETE /_api/web/lists/items(7)');
    expect(record.pages).toEqual([]);
  });

  it('does not check out a page that is checked out already', async () => {
    const web = fakeWeb({ onLibrary: ['Notizia'], checkOutType: 0 });
    const actions = await seedPages(web, FIXTURES.pages, {
      apply: true,
      web: '',
      context,
      record: { pages: [] },
      wait: noWait([]),
    });
    expect(actions[0]?.outcome).toBe('created');
    expect(web.calls.some((call) => call.endsWith('/CheckOut()'))).toBe(false);
  });

  it('plans a missing page and finds it next time', async () => {
    const web = fakeWeb({ onLibrary: ['Notizia'] });
    const dry = await seedPages(web, FIXTURES.pages, {
      apply: false,
      web: 'HR/',
      context,
      record: { pages: [] },
    });
    expect(web.calls).toEqual([]);
    expect(dry).toEqual([
      { kind: 'page', target: 'HR/test-news-1.aspx', outcome: 'planned', detail: 'Notizia' },
    ]);
    await seedPages(web, FIXTURES.pages, {
      apply: true,
      web: 'HR/',
      context,
      record: { pages: [] },
      wait: noWait([]),
    });
    const again = await seedPages(web, FIXTURES.pages, {
      apply: false,
      web: 'HR/',
      context,
      record: { pages: [] },
    });
    expect(again).toEqual([{ kind: 'page', target: 'HR/test-news-1.aspx', outcome: 'exists' }]);
  });
});
