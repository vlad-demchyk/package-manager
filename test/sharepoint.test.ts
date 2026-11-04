import { describe, expect, it } from 'vitest';
import { classify, parseManifests, verdict } from '../src/sharepoint/debug.js';
import {
  fieldXml,
  fixturesSchema,
  itemBody,
  mergeRequirements,
  placeholderPng,
  resolveDate,
  type Fixtures,
} from '../src/sharepoint/fixtures.js';
import { sampleOptions, sampleText } from '../src/sharepoint/properties.js';
import { requirementsFromRequests, scanRequirements } from '../src/sharepoint/requirements.js';
import {
  clean,
  emptyRecord,
  resolveItemRefs,
  seed,
  type SpClient,
  type SpMethod,
} from '../src/sharepoint/seed.js';
import { discoverWorkspace } from '../src/core/discovery.js';
import { configSchema } from '../src/core/config.js';
import { makeWorkspace } from './helpers.js';

const NOW = new Date('2026-11-04T10:30:00Z');

describe('data requirements', () => {
  it('reads lists, columns, writes, files and Graph calls from the source', async () => {
    const { root, cleanup } = await makeWorkspace({
      'app/package.json': { name: 'app', dependencies: { '@microsoft/sp-core-library': '1.21.1' } },
      'app/src/List.tsx': `
        const FIELDS = ["Id", "Title", "Valore"];
        export async function load(sp, graph) {
          const rows = await sp.web.lists.getByTitle("Numeri").items
            .select(...FIELDS)
            .filter(\`Visibile eq 1 and DataFine ge datetime'\${now}'\`)();
          await sp.web.lists.getByTitle("Preferiti").items.add({ Title: "x", IDUtente: 1 });
          const menu = await fetch(site + "/SiteAssets/configIntranet/menu.json");
          const me = await graph.me();
          return [rows, menu, me];
        }`,
    });
    try {
      const config = configSchema.parse({});
      const workspace = await discoverWorkspace(root, { config });
      const found = await scanRequirements(workspace.projects);
      const numeri = found.lists.find((list) => list.title === 'Numeri');
      expect(numeri?.fields).toEqual(['DataFine', 'Valore', 'Visibile']);
      expect(numeri?.booleans).toEqual(['Visibile']);
      expect(numeri?.dates).toEqual(['DataFine']);
      expect(numeri?.writes).toBe(false);
      const preferiti = found.lists.find((list) => list.title === 'Preferiti');
      expect(preferiti?.writes).toBe(true);
      expect(preferiti?.fields).toEqual(['IDUtente']);
      expect(found.files).toEqual([
        { path: 'SiteAssets/configIntranet/menu.json', usedBy: ['app'] },
      ]);
      expect(found.graph.map((entry) => entry.resource)).toEqual(['me']);
    } finally {
      await cleanup();
    }
  });

  it('reads the same from the requests of a test run', () => {
    const found = requirementsFromRequests([
      {
        project: 'app',
        method: 'GET',
        url: "https://t.sharepoint.com/sites/dev/_api/web/lists/getByTitle('Notifiche')/items?%24select=Id%2CTestoNotifica&%24filter=Notifica+eq+1+and+DataNotifica+le+%272026-11-04T10%3A00%3A00Z%27",
      },
      {
        project: 'app',
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/users/0000-1111/manager?$select=id',
      },
    ]);
    expect(found.lists[0]?.fields).toEqual(['TestoNotifica', 'Notifica', 'DataNotifica'].sort());
    expect(found.lists[0]?.booleans).toEqual(['Notifica']);
    expect(found.lists[0]?.dates).toEqual(['DataNotifica']);
    expect(found.graph.map((entry) => entry.resource)).toEqual(['users/{id}/manager']);
  });

  it('adds new columns with guessed types and keeps hand-edited ones', () => {
    const current = fixturesSchema.parse({
      lists: [
        { title: 'Numeri', fields: [{ name: 'Valore', type: 'Number' }], items: [{ Title: 'a' }] },
      ],
    });
    const merged = mergeRequirements(current, {
      lists: [
        {
          title: 'numeri',
          fields: ['Valore', 'Visibile', 'DataFine'],
          booleans: ['Visibile'],
          dates: ['DataFine'],
          writes: false,
          usedBy: ['app'],
        },
      ],
      files: [{ path: 'SiteAssets/a.json', usedBy: ['app'] }],
      graph: [],
      search: [],
    });
    expect(merged.lists[0]?.fields).toEqual([
      { name: 'Valore', type: 'Number' },
      { name: 'Visibile', type: 'Boolean' },
      { name: 'DataFine', type: 'DateTime' },
    ]);
    expect(merged.lists[0]?.items).toEqual([{ Title: 'a' }]);
    expect(merged.files).toEqual([{ path: 'SiteAssets/a.json', usedBy: ['app'] }]);
  });
});

describe('fixture values', () => {
  it('builds column XML and item bodies', () => {
    expect(fieldXml({ name: 'Tipo', type: 'Choice', choices: ['A&B', 'C'] })).toBe(
      '<Field Type="Choice" DisplayName="Tipo" Name="Tipo" StaticName="Tipo" Format="Dropdown"><CHOICES><CHOICE>A&amp;B</CHOICE><CHOICE>C</CHOICE></CHOICES></Field>',
    );
    expect(() => fieldXml({ name: 'Ref', type: 'Lookup', list: 'X' })).toThrow(/target list/);
    expect(resolveDate('today+3d', NOW)).toBe('2026-11-07T00:00:00.000Z');
    expect(resolveDate('now-2h', NOW)).toBe('2026-11-04T08:30:00.000Z');
    expect(resolveDate('2026-01-01', NOW)).toBeUndefined();
    const list = fixturesSchema.parse({
      lists: [
        {
          title: 'Risposte',
          fields: [
            { name: 'Utente', type: 'User' },
            { name: 'Domanda', type: 'Lookup', list: 'Domande' },
          ],
        },
      ],
    }).lists[0];
    if (!list) throw new Error('no list');
    const body = itemBody(
      list,
      {
        Title: 'x',
        Utente: '@me',
        Domanda: { lookup: 'Q1' },
        IDUtente: '@me',
        Oggetto: '@aad',
        Quando: 'today',
        file: 'ignored',
      },
      {
        now: NOW,
        userId: 12,
        aadId: 'object-id',
        lookups: new Map([['Domande', new Map([['Q1', 7]])]]),
      },
    );
    expect(body).toEqual({
      Title: 'x',
      UtenteId: 12,
      DomandaId: 7,
      IDUtente: 12,
      Oggetto: 'object-id',
      Quando: '2026-11-04T00:00:00.000Z',
    });
  });

  it('types values a person would enter in property pane fields', () => {
    expect(sampleText('URL Sito SharePoint', '')).toBe('https://example.com/packman-test');
    expect(sampleText('Email contatto', '')).toBe('test@example.invalid');
    expect(sampleText('Numero elementi', '5')).toBe('3');
    expect(sampleText('Titolo', '')).toBe('packman test');
    // JSON settings are left alone: a random string would only test the parser.
    expect(sampleText('Colonne da visualizzare (JSON)', '')).toBeUndefined();
    expect(sampleText('Config', '[{"a":1}]')).toBeUndefined();
  });

  it('samples long option lists', () => {
    expect(sampleOptions(['a', 'b'])).toEqual(['a', 'b']);
    const minutes = Array.from({ length: 60 }, (_, i) => String(i));
    expect(sampleOptions(minutes)).toEqual(['0', '1', '30', '59']);
  });

  it('makes a valid PNG', () => {
    const png = placeholderPng('#336699', 4, 2);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(2);
  });
});

/** An in-memory SharePoint site with just the REST surface `seed` and `clean` use. */
function fakeSite(): SpClient & {
  lists: Map<
    string,
    { id: string; title: string; fields: Set<string>; items: Map<number, Record<string, unknown>> }
  >;
  files: Map<string, string>;
  calls: string[];
} {
  const lists = new Map<
    string,
    { id: string; title: string; fields: Set<string>; items: Map<number, Record<string, unknown>> }
  >();
  const files = new Map<string, string>();
  const folders = new Set<string>(['/sites/dev/SiteAssets']);
  const calls: string[] = [];
  let nextId = 1;
  const byId = (id: string) => [...lists.values()].find((list) => list.id === id);
  const byTitle = (title: string) =>
    lists.get(decodeURIComponent(title).replace(/''/g, "'").toLowerCase());
  const ok = <T>(data: T) => Promise.resolve({ status: 200, data });
  const notFound = () =>
    Promise.resolve({ status: 404, data: { 'odata.error': { message: { value: 'not found' } } } });
  return {
    site: 'https://t.sharepoint.com/sites/dev',
    lists,
    files,
    calls,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matches SpClient.request
    request<T>(method: SpMethod, apiPath: string, body?: unknown, binary?: Buffer) {
      if (method !== 'GET') calls.push(`${method} ${apiPath}`);
      const path = decodeURIComponent(apiPath).replace(/''/g, "'");
      let m: RegExpExecArray | null;
      const answer = (value: unknown) => ok(value) as Promise<{ status: number; data: T }>;
      const missing = () => notFound() as Promise<{ status: number; data: T }>;
      if (path.startsWith('/_api/web?')) return answer({ ServerRelativeUrl: '/sites/dev' });
      if (path.startsWith('/_api/web/currentuser')) return answer({ Id: 12 });
      if (path.startsWith('/_api/web/lists?'))
        return answer({
          value: [...lists.values()].map((list) => ({ Title: list.title, Id: list.id })),
        });
      if (method === 'POST' && path === '/_api/web/lists') {
        const title = (body as { Title: string }).Title;
        const list = {
          id: `guid-${nextId++}`,
          title,
          fields: new Set(['Title']),
          items: new Map(),
        };
        lists.set(title.toLowerCase(), list);
        return answer({ Id: list.id });
      }
      if ((m = /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields\?/.exec(path)))
        return answer({
          value: [...(byId(m[1] ?? '')?.fields ?? [])].map((name) => ({
            InternalName: name,
            Title: name,
          })),
        });
      if ((m = /^\/_api\/web\/lists\(guid'([^']+)'\)\/fields\/createfieldasxml/.exec(path))) {
        const name =
          /Name="([^"]+)"/.exec(
            (body as { parameters: { SchemaXml: string } }).parameters.SchemaXml,
          )?.[1] ?? '';
        byId(m[1] ?? '')?.fields.add(name);
        return answer({});
      }
      if ((m = /^\/_api\/web\/lists\(guid'([^']+)'\)\/items\?/.exec(path)))
        return answer({
          value: [...(byId(m[1] ?? '')?.items ?? new Map<number, Record<string, unknown>>())].map(
            ([id, item]) => ({ Id: id, Title: item.Title }),
          ),
        });
      if (method === 'POST' && (m = /^\/_api\/web\/lists\(guid'([^']+)'\)\/items$/.exec(path))) {
        const id = nextId++;
        byId(m[1] ?? '')?.items.set(id, body as Record<string, unknown>);
        return answer({ Id: id });
      }
      if (
        method === 'DELETE' &&
        (m = /^\/_api\/web\/lists\/getbytitle\('(.+)'\)\/items\((\d+)\)$/.exec(path))
      ) {
        byTitle(m[1] ?? '')?.items.delete(Number(m[2]));
        return answer(null);
      }
      if (
        method === 'DELETE' &&
        (m =
          /^\/_api\/web\/lists\/getbytitle\('(.+)'\)\/fields\/getbyinternalnameortitle\('(.+)'\)$/.exec(
            path,
          ))
      ) {
        byTitle(m[1] ?? '')?.fields.delete(m[2] ?? '');
        return answer(null);
      }
      if (method === 'DELETE' && (m = /^\/_api\/web\/lists\/getbytitle\('(.+)'\)$/.exec(path))) {
        lists.delete(decodeURIComponent(m[1] ?? '').toLowerCase());
        return answer(null);
      }
      if (
        (m = /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl='(.+)'\)\/\$value$/.exec(path))
      )
        return files.has(m[1] ?? '') ? answer(files.get(m[1] ?? '')) : missing();
      if ((m = /^\/_api\/web\/GetFileByServerRelativePath\(decodedurl='(.+)'\)/.exec(path))) {
        if (method === 'DELETE') files.delete(m[1] ?? '');
        return files.has(m[1] ?? '') || method === 'DELETE' ? answer({ Exists: true }) : missing();
      }
      if (
        (m =
          /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl='(.+)'\)\/Files\/AddUsingPath\(decodedurl='(.+)',overwrite=true\)$/.exec(
            path,
          ))
      ) {
        files.set(`${m[1]}/${m[2]}`, binary?.toString('utf8') ?? '');
        return answer({});
      }
      if ((m = /^\/_api\/web\/GetFolderByServerRelativePath\(decodedurl='(.+)'\)/.exec(path))) {
        const folder = m[1] ?? '';
        if (method === 'DELETE') folders.delete(folder);
        const count = [...files.keys()].filter((file) => file.startsWith(`${folder}/`)).length;
        return answer({ Exists: folders.has(folder), ItemCount: count });
      }
      if ((m = /^\/_api\/web\/folders\/AddUsingPath\(decodedurl='(.+)'\)$/.exec(path))) {
        folders.add(m[1] ?? '');
        return answer({});
      }
      throw new Error(`unexpected ${method} ${apiPath}`);
    },
  };
}

const FIXTURES: Fixtures = fixturesSchema.parse({
  lists: [
    {
      title: 'Domande',
      fields: [{ name: 'Ordine', type: 'Number' }],
      items: [{ Title: 'Q1', Ordine: 1 }],
    },
    {
      title: 'Risposte',
      fields: [{ name: 'Domanda', type: 'Lookup', list: 'Domande' }],
      items: [{ Title: 'R1', Domanda: { lookup: 'Q1' } }],
    },
    { title: 'Esistente', fields: [{ name: 'Nuova', type: 'Text' }], items: [{ Title: 'mio' }] },
  ],
  files: [{ path: 'SiteAssets/config/menu.json', content: { voci: [] } }],
});

describe('seed and clean', () => {
  it('creates once, then finds everything in place, and plans without writing', async () => {
    const site = fakeSite();
    site.lists.set('esistente', {
      id: 'guid-person',
      title: 'Esistente',
      fields: new Set(['Title']),
      items: new Map([[900, { Title: 'di una persona' }]]),
    });
    const dry = await seed(site, FIXTURES, {
      apply: false,
      now: NOW,
      record: emptyRecord(site.site),
    });
    expect(site.calls).toEqual([]);
    expect(dry.filter((action) => action.outcome === 'planned')).toHaveLength(9);
    const record = emptyRecord(site.site);
    const applied = await seed(site, FIXTURES, { apply: true, now: NOW, record });
    expect(applied.filter((action) => action.outcome === 'failed')).toEqual([]);
    expect(site.lists.get('risposte')?.items.get(4)).toEqual({ Title: 'R1', DomandaId: 2 });
    expect(record.lists).toEqual(['Domande', 'Risposte']);
    expect(record.fields).toEqual([{ list: 'Esistente', name: 'Nuova' }]);
    expect(site.files.get('/sites/dev/SiteAssets/config/menu.json')).toBe('{\n  "voci": []\n}\n');
    const again = await seed(site, FIXTURES, { apply: false, now: NOW, record });
    expect(again.filter((action) => action.outcome !== 'exists')).toEqual([]);
  });

  it('removes only what the seed created', async () => {
    const site = fakeSite();
    site.lists.set('esistente', {
      id: 'guid-person',
      title: 'Esistente',
      fields: new Set(['Title']),
      items: new Map([[900, { Title: 'di una persona' }]]),
    });
    const record = emptyRecord(site.site);
    await seed(site, FIXTURES, { apply: true, now: NOW, record });
    const actions = await clean(site, record);
    expect(actions.filter((action) => action.outcome === 'failed')).toEqual([]);
    expect([...site.lists.keys()]).toEqual(['esistente']);
    expect([...(site.lists.get('esistente')?.items.values() ?? [])]).toEqual([
      { Title: 'di una persona' },
    ]);
    expect(site.lists.get('esistente')?.fields.has('Nuova')).toBe(false);
    expect(site.files.size).toBe(0);
  });
});

describe('debug run results', () => {
  const origin = 'https://localhost:4321';
  it('blames the component only for its own bundles and errors', () => {
    const issues = classify(
      {
        exceptions: [
          'Uncaught (in promise)',
          `TypeError: x is null\n    at ${origin}/dist/app.js:1:2`,
        ],
        console: ["Errore: L'elenco 'Eventi' non esiste nel sito"],
        responses: [
          { url: `${origin}/dist/app.js`, status: 200 },
          { url: `${origin}/dist/chunk.js`, status: 404 },
          {
            url: "https://t.sharepoint.com/_api/web/lists/getByTitle('Eventi')/items?$select=Id",
            status: 404,
          },
        ],
        failed: [],
        requests: [],
      },
      origin,
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['load', 'data', 'host', 'runtime', 'data']);
    expect(verdict(issues, true)).toBe('failed');
    expect(
      verdict(
        issues.filter((issue) => issue.kind === 'data' || issue.kind === 'host'),
        true,
      ),
    ).toBe('needs-data');
    expect(verdict([], true)).toBe('ok');
    const telemetry = classify(
      {
        exceptions: [
          `TypeError: Failed to fetch\n    at PnPTelemetry.x (${origin}/dist/chunk.js:1:1)`,
        ],
        console: [],
        responses: [],
        failed: [],
        requests: [],
      },
      origin,
    );
    expect(telemetry.map((issue) => issue.kind)).toEqual(['host']);
    expect(verdict([], false)).toBe('failed');
  });

  it('reports documented problems as known without failing the component', () => {
    const issues = classify(
      {
        exceptions: [
          `TypeError: Cannot read properties of null (reading 'value')\n    at ${origin}/dist/footer.js:5:1`,
        ],
        console: [],
        responses: [],
        failed: [],
        requests: [],
      },
      origin,
      ["Cannot read properties of null (reading 'value')"],
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['known']);
    expect(verdict(issues, true)).toBe('ok');
  });

  it('puts item ids into a page query', async () => {
    const site = fakeSite();
    const record = emptyRecord(site.site);
    await seed(site, FIXTURES, { apply: true, now: NOW, record });
    const lookup: SpClient = {
      site: site.site,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- matches SpClient.request
      request: <T>(_method: SpMethod, apiPath: string) => {
        const title = /Title eq '(.+)'&/.exec(decodeURIComponent(apiPath))?.[1];
        const id = [
          ...(site.lists.get('domande')?.items ?? new Map<number, Record<string, unknown>>()),
        ].find(([, item]) => item.Title === title)?.[0];
        return Promise.resolve({
          status: 200,
          data: { value: id === undefined ? [] : [{ Id: id }] } as T,
        });
      },
    };
    expect(await resolveItemRefs(lookup, 'iditem={Domande/Q1}&x={Domande/none}')).toBe(
      'iditem=2&x=?',
    );
  });

  it('finds the components in the dev server manifests', () => {
    const body = `var x = 1; define([], function () { return [{"id":"a-1","alias":"AppWebPart","componentType":"WebPart","loaderConfig":{"scriptResources":{"x":{"paths":["y"]}}}},{"id":"lib","alias":"SPCore","componentType":"Library"}]; });`;
    expect(parseManifests(body)).toEqual([{ id: 'a-1', alias: 'AppWebPart', type: 'WebPart' }]);
  });
});
