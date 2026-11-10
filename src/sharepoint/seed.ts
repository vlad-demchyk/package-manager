import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fieldXml,
  itemBody,
  LIST_TEMPLATES,
  placeholderPng,
  type Fixtures,
  type ListFixture,
  type ScopeFixture,
} from './fixtures.js';
import { findList, seedContentTypes, seedPages } from './pages.js';

export type SpMethod = 'GET' | 'POST' | 'MERGE' | 'DELETE';

export interface SpResponse<T = unknown> {
  status: number;
  data: T;
}

/** SharePoint REST calls made as the signed-in user; paths are relative to the site URL. */
export interface SpClient {
  site: string;
  request<T = unknown>(
    method: SpMethod,
    apiPath: string,
    body?: unknown,
    binary?: Buffer,
  ): Promise<SpResponse<T>>;
  /** The same client for a subsite (`relative` below this site). */
  at?(relative: string): SpClient;
}

/** What a seed created, so `clean` removes exactly that and nothing a person added. */
export interface SeedRecord {
  site: string;
  lists: string[];
  fields: { list: string; name: string }[];
  items: { list: string; id: number }[];
  files: string[];
  folders: string[];
  contentTypes: { web: string; id: string; list?: string }[];
  pages: { web: string; list: string; id: number }[];
  /** Subsites: deleted whole when packman created them, otherwise cleaned by their own record. */
  webs: { url: string; created: boolean; record: SeedRecord }[];
}

export interface SeedAction {
  kind: 'list' | 'field' | 'item' | 'file' | 'folder' | 'web' | 'contentType' | 'page';
  target: string;
  outcome: 'created' | 'removed' | 'exists' | 'planned' | 'skipped' | 'failed';
  detail?: string;
}

const RECORD_FILE = path.join('.packman', 'sharepoint', 'seeded.json');

export function emptyRecord(site: string): SeedRecord {
  return {
    site,
    lists: [],
    fields: [],
    items: [],
    files: [],
    folders: [],
    contentTypes: [],
    pages: [],
    webs: [],
  };
}

/**
 * What `clean` would remove for a record, one line per object in the order it goes: subsites
 * packman created (whole), then per site pages, content types, items and columns in lists packman
 * did not create, its own lists, files and folders.
 */
export function recordEntries(record: SeedRecord, prefix = ''): string[] {
  const full = { ...emptyRecord(record.site), ...record };
  const own = new Set(full.lists);
  const out: string[] = [];
  for (const web of full.webs)
    if (web.created) out.push(`web ${prefix}${web.url}/ (whole subsite)`);
    else out.push(...recordEntries(web.record, `${prefix}${web.url}/`));
  for (const page of full.pages) out.push(`page ${prefix}${page.list}: item ${page.id}`);
  for (const ct of full.contentTypes)
    out.push(`contentType ${prefix}${ct.id}${ct.list ? ` (and its copy on ${ct.list})` : ''}`);
  for (const item of full.items.filter((entry) => !own.has(entry.list)))
    out.push(`item ${prefix}${item.list}: ${item.id}`);
  for (const field of full.fields.filter((entry) => !own.has(entry.list)))
    out.push(`field ${prefix}${field.list}.${field.name}`);
  for (const list of full.lists) out.push(`list ${prefix}${list} (with its items and columns)`);
  for (const file of full.files) out.push(`file ${prefix}${file}`);
  for (const folder of [...full.folders].reverse())
    out.push(`folder ${prefix}${folder} (only when empty)`);
  return out;
}

export async function readRecord(root: string, site: string): Promise<SeedRecord> {
  const file = path.join(root, RECORD_FILE);
  if (!existsSync(file)) return emptyRecord(site);
  const all = JSON.parse(await readFile(file, 'utf8')) as Record<string, SeedRecord>;
  // Records written before subsites and pages existed lack those keys.
  return { ...emptyRecord(site), ...all[site] };
}

export async function writeRecord(root: string, record: SeedRecord): Promise<void> {
  const file = path.join(root, RECORD_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const all = existsSync(file)
    ? (JSON.parse(await readFile(file, 'utf8')) as Record<string, SeedRecord>)
    : {};
  all[record.site] = record;
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
}

/** OData string literal inside a URL. */
const odata = (value: string): string => encodeURIComponent(value.replace(/'/g, "''"));

function failed(response: SpResponse): string | undefined {
  if (response.status < 400) return undefined;
  const data = response.data as { 'odata.error'?: { message?: { value?: string } } } | string;
  const message =
    typeof data === 'object' ? data['odata.error']?.message?.value : data.slice(0, 200);
  return `HTTP ${response.status}${message ? `: ${message}` : ''}`;
}

/** Replaces `{List/Title}` in a query string with the id of that item (`?` when it is missing). */
export async function resolveItemRefs(client: SpClient, text: string): Promise<string> {
  let out = text;
  for (const match of text.matchAll(/\{([^/{}]+)\/([^{}]+)\}/g)) {
    const [token, list = '', title = ''] = match;
    const found = await client.request<{ value?: { Id: number }[] }>(
      'GET',
      `/_api/web/lists/getbytitle('${odata(list)}')/items?$select=Id&$filter=Title eq '${odata(title)}'&$top=1`,
    );
    out = out.replace(token, String(found.data.value?.[0]?.Id ?? '?'));
  }
  return out;
}

/** Entra object id of the signed-in user, from their SharePoint profile. */
async function signedInObjectId(client: SpClient): Promise<string | undefined> {
  const profile = await client.request<{
    UserProfileProperties?: { Key: string; Value: string }[];
  }>('GET', '/_api/SP.UserProfiles.PeopleManager/GetMyProperties?$select=UserProfileProperties');
  return (
    profile.data.UserProfileProperties?.find((entry) => entry.Key === 'msOnline-ObjectId')?.Value ||
    undefined
  );
}

/** Whether the site file already holds this text (JSON compared by value). */
async function sameText(client: SpClient, serverPath: string, content: Buffer): Promise<boolean> {
  const current = await client.request(
    'GET',
    `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(serverPath)}')/$value`,
  );
  const text = content.toString('utf8');
  if (typeof current.data === 'string') return current.data === text;
  try {
    return JSON.stringify(current.data) === JSON.stringify(JSON.parse(text));
  } catch {
    return false;
  }
}

/** An item's identity: Title for lists, the file name for libraries. */
function keyOf(item: Record<string, unknown>, list: ListFixture): string {
  const value =
    list.template === 'documents' || list.template === 'pictures' ? item.file : item.Title;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Lists that hold lookup targets go first. */
function orderForLookups(lists: ListFixture[]): ListFixture[] {
  const ordered: ListFixture[] = [];
  const visit = (list: ListFixture, trail: Set<string>): void => {
    if (ordered.includes(list) || trail.has(list.title)) return;
    trail.add(list.title);
    for (const field of list.fields) {
      const target = lists.find((entry) => entry.title === field.list);
      if (field.type === 'Lookup' && target) visit(target, trail);
    }
    ordered.push(list);
  };
  for (const list of lists) visit(list, new Set());
  return ordered;
}

/**
 * Creates the missing lists, columns, items and files of the fixtures. Existing lists, columns,
 * items (same Title or file name) and files a person made are left untouched. Without `apply`
 * nothing is written and every change is reported as `planned`.
 */
export async function seed(
  client: SpClient,
  fixtures: Fixtures,
  options: { apply: boolean; now?: Date; record: SeedRecord },
): Promise<SeedAction[]> {
  const actions = await seedScope(client, fixtures, options);
  for (const web of fixtures.webs) {
    const target = `${web.url}/`;
    const sub = client.at?.(web.url);
    if (!sub) {
      actions.push({ kind: 'web', target, outcome: 'failed', detail: 'no subsite client' });
      continue;
    }
    let entry = options.record.webs.find((item) => item.url === web.url);
    const probe = await sub.request('GET', '/_api/web?$select=Id');
    if (probe.status >= 400) {
      if (!options.apply) {
        actions.push({
          kind: 'web',
          target,
          outcome: 'planned',
          detail: `${web.template}, ${web.lists.length} lists, ${web.contentTypes.length} content types, ${web.pages.length} pages`,
        });
        continue;
      }
      const error = failed(
        await client.request('POST', '/_api/web/webinfos/add', {
          parameters: {
            Url: web.url,
            Title: web.title,
            Description: 'packman test data',
            Language: web.language,
            WebTemplate: web.template,
            UseUniquePermissions: false,
          },
        }),
      );
      if (error) {
        actions.push({ kind: 'web', target, outcome: 'failed', detail: error });
        continue;
      }
      entry = { url: web.url, created: true, record: emptyRecord(sub.site) };
      options.record.webs.push(entry);
      actions.push({ kind: 'web', target, outcome: 'created', detail: web.template });
    } else actions.push({ kind: 'web', target, outcome: 'exists' });
    if (!entry) {
      entry = { url: web.url, created: false, record: emptyRecord(sub.site) };
      options.record.webs.push(entry);
    }
    entry.record = { ...emptyRecord(sub.site), ...entry.record };
    const inner = await seedScope(sub, web, { ...options, record: entry.record });
    actions.push(...inner.map((action) => ({ ...action, target: `${target}${action.target}` })));
  }
  return actions;
}

/** Lists, files, content types and pages of one site or subsite. */
async function seedScope(
  client: SpClient,
  fixtures: ScopeFixture,
  options: { apply: boolean; now?: Date; record: SeedRecord },
): Promise<SeedAction[]> {
  const actions: SeedAction[] = [];
  const record = options.record;
  const now = options.now ?? new Date();
  const web = await client.request<{ ServerRelativeUrl: string }>(
    'GET',
    '/_api/web?$select=ServerRelativeUrl',
  );
  const webPath = web.data.ServerRelativeUrl.replace(/\/$/, '');
  const user = await client.request<{ Id: number }>('GET', '/_api/web/currentuser?$select=Id');
  const existing = await client.request<{ value: { Title: string; Id: string }[] }>(
    'GET',
    '/_api/web/lists?$select=Title,Id&$filter=Hidden eq false',
  );
  const listIds = new Map(existing.data.value.map((list) => [list.Title.toLowerCase(), list.Id]));
  const lookups = new Map<string, Map<string, number>>();
  const aadId = JSON.stringify([fixtures.lists, fixtures.pages]).includes('"@aad"')
    ? await signedInObjectId(client)
    : undefined;

  for (const list of orderForLookups(fixtures.lists)) {
    let id = listIds.get(list.title.toLowerCase());
    const createdHere = !id;
    if (!id) {
      if (!options.apply) {
        actions.push({
          kind: 'list',
          target: list.title,
          outcome: 'planned',
          detail: list.template,
        });
        for (const field of list.fields)
          actions.push({
            kind: 'field',
            target: `${list.title}.${field.name}`,
            outcome: 'planned',
            detail: field.type,
          });
        for (const item of list.items)
          actions.push({
            kind: 'item',
            target: `${list.title}: ${keyOf(item, list) || '?'}`,
            outcome: 'planned',
          });
        continue;
      }
      const created = await client.request<{ Id: string }>('POST', '/_api/web/lists', {
        Title: list.title,
        BaseTemplate: LIST_TEMPLATES[list.template],
        Description: 'packman test data',
        AllowContentTypes: true,
      });
      const error = failed(created);
      if (error) {
        actions.push({ kind: 'list', target: list.title, outcome: 'failed', detail: error });
        continue;
      }
      id = created.data.Id;
      listIds.set(list.title.toLowerCase(), id);
      record.lists.push(list.title);
      actions.push({ kind: 'list', target: list.title, outcome: 'created', detail: list.template });
    } else actions.push({ kind: 'list', target: list.title, outcome: 'exists' });

    const listPath = `/_api/web/lists(guid'${id}')`;
    const fields = await client.request<{ value: { InternalName: string; Title: string }[] }>(
      'GET',
      `${listPath}/fields?$select=InternalName,Title`,
    );
    const known = new Set(
      fields.data.value.flatMap((field) => [
        field.InternalName.toLowerCase(),
        field.Title.toLowerCase(),
      ]),
    );
    for (const field of list.fields) {
      const target = `${list.title}.${field.name}`;
      if (known.has(field.name.toLowerCase())) {
        actions.push({ kind: 'field', target, outcome: 'exists' });
        continue;
      }
      if (!options.apply) {
        actions.push({ kind: 'field', target, outcome: 'planned', detail: field.type });
        continue;
      }
      let schema: string;
      try {
        schema = fieldXml(field, field.list ? listIds.get(field.list.toLowerCase()) : undefined);
      } catch (error) {
        actions.push({
          kind: 'field',
          target,
          outcome: 'failed',
          detail: (error as Error).message,
        });
        continue;
      }
      const added = await client.request('POST', `${listPath}/fields/createfieldasxml`, {
        parameters: { SchemaXml: schema, Options: 8 },
      });
      const error = failed(added);
      if (error) actions.push({ kind: 'field', target, outcome: 'failed', detail: error });
      else {
        if (!createdHere) record.fields.push({ list: list.title, name: field.name });
        actions.push({ kind: 'field', target, outcome: 'created', detail: field.type });
      }
    }

    const library = list.template === 'documents' || list.template === 'pictures';
    const present = await client.request<{
      value: { Id: number; Title: string | null; FileLeafRef?: string }[];
    }>('GET', `${listPath}/items?$select=Id,Title${library ? ',FileLeafRef' : ''}&$top=5000`);
    const titles = new Map<string, number>();
    for (const row of present.data.value) {
      if (row.Title) titles.set(row.Title, row.Id);
      if (row.FileLeafRef) titles.set(row.FileLeafRef, row.Id);
    }
    lookups.set(list.title, titles);
    const root = library
      ? (
          await client.request<{ ServerRelativeUrl: string }>(
            'GET',
            `${listPath}/RootFolder?$select=ServerRelativeUrl`,
          )
        ).data.ServerRelativeUrl
      : '';
    for (const item of list.items) {
      const key = keyOf(item, list);
      const target = `${list.title}: ${key}`;
      if (!key) {
        actions.push({
          kind: 'item',
          target,
          outcome: 'failed',
          detail: library ? 'file missing' : 'Title missing',
        });
        continue;
      }
      if (titles.has(key)) {
        actions.push({ kind: 'item', target, outcome: 'exists' });
        continue;
      }
      if (!options.apply) {
        actions.push({ kind: 'item', target, outcome: 'planned' });
        continue;
      }
      let body: Record<string, unknown>;
      try {
        body = itemBody(list, item, {
          now,
          userId: user.data.Id,
          lookups,
          ...(aadId ? { aadId } : {}),
        });
      } catch (error) {
        actions.push({ kind: 'item', target, outcome: 'failed', detail: (error as Error).message });
        continue;
      }
      let itemId: number | undefined;
      let error: string | undefined;
      if (library) {
        const content =
          typeof item.content === 'string'
            ? Buffer.from(item.content, 'utf8')
            : placeholderPng(typeof item.placeholder === 'string' ? item.placeholder : '#808080');
        const upload = await client.request(
          'POST',
          `/_api/web/GetFolderByServerRelativePath(decodedurl='${odata(root)}')/Files/AddUsingPath(decodedurl='${odata(key)}',overwrite=true)`,
          undefined,
          content,
        );
        error = failed(upload);
        if (!error) {
          const row = await client.request<{ Id: number }>(
            'GET',
            `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(`${root}/${key}`)}')/ListItemAllFields?$select=Id`,
          );
          itemId = row.data.Id;
          if (Object.keys(body).length > 0)
            error = failed(await client.request('MERGE', `${listPath}/items(${itemId})`, body));
        }
      } else {
        const added = await client.request<{ Id?: number }>('POST', `${listPath}/items`, body);
        error = failed(added);
        itemId = added.data.Id;
      }
      if (itemId !== undefined) {
        record.items.push({ list: list.title, id: itemId });
        titles.set(key, itemId);
      }
      actions.push({
        kind: 'item',
        target,
        outcome: error ? 'failed' : 'created',
        ...(error ? { detail: error } : {}),
      });
    }
  }

  for (const file of fixtures.files) {
    const content =
      file.content !== undefined
        ? Buffer.from(
            typeof file.content === 'string'
              ? file.content
              : `${JSON.stringify(file.content, null, 2)}\n`,
            'utf8',
          )
        : file.placeholder
          ? placeholderPng(file.placeholder)
          : undefined;
    if (!content) {
      actions.push({ kind: 'file', target: file.path, outcome: 'skipped', detail: 'no content' });
      continue;
    }
    const full = `${webPath}/${file.path.replace(/^\/+/, '')}`;
    const folder = full.slice(0, full.lastIndexOf('/'));
    const name = full.slice(full.lastIndexOf('/') + 1);
    const current = await client.request(
      'GET',
      `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(full)}')?$select=Exists`,
    );
    const ours = record.files.includes(file.path);
    // A person's file is never replaced; packman's own file only when its text changed.
    if (
      current.status < 400 &&
      (!ours || file.content === undefined || (await sameText(client, full, content)))
    ) {
      actions.push({ kind: 'file', target: file.path, outcome: 'exists' });
      continue;
    }
    if (!options.apply) {
      actions.push({ kind: 'file', target: file.path, outcome: 'planned' });
      continue;
    }
    // Create every missing folder below the site, outermost first.
    const parts = folder.slice(webPath.length + 1).split('/');
    for (let depth = 1; depth <= parts.length; depth++) {
      const relative = parts.slice(0, depth).join('/');
      const probe = await client.request<{ Exists?: boolean }>(
        'GET',
        `/_api/web/GetFolderByServerRelativePath(decodedurl='${odata(`${webPath}/${relative}`)}')?$select=Exists`,
      );
      if (probe.status < 400 && probe.data.Exists) continue;
      const made = failed(
        await client.request(
          'POST',
          `/_api/web/folders/AddUsingPath(decodedurl='${odata(`${webPath}/${relative}`)}')`,
        ),
      );
      if (made) actions.push({ kind: 'folder', target: relative, outcome: 'failed', detail: made });
      else {
        record.folders.push(relative);
        actions.push({ kind: 'folder', target: relative, outcome: 'created' });
      }
    }
    const error = failed(
      await client.request(
        'POST',
        `/_api/web/GetFolderByServerRelativePath(decodedurl='${odata(folder)}')/Files/AddUsingPath(decodedurl='${odata(name)}',overwrite=true)`,
        undefined,
        content,
      ),
    );
    if (!error && !ours) record.files.push(file.path);
    actions.push({
      kind: 'file',
      target: file.path,
      outcome: error ? 'failed' : 'created',
      ...(error ? { detail: error } : {}),
    });
  }
  // Content types before pages: a page gets its content type when it is created.
  actions.push(
    ...(await seedContentTypes(client, fixtures.contentTypes, {
      apply: options.apply,
      web: '',
      record,
    })),
  );
  actions.push(
    ...(await seedPages(client, fixtures.pages, {
      apply: options.apply,
      web: '',
      context: { now, userId: user.data.Id, lookups, ...(aadId ? { aadId } : {}) },
      record,
    })),
  );
  return actions;
}

/** Removes what `seed` recorded: items and columns in lists a person owns, whole lists packman created, files and empty folders. */
export async function clean(client: SpClient, record: SeedRecord): Promise<SeedAction[]> {
  const actions: SeedAction[] = [];
  const web = await client.request<{ ServerRelativeUrl: string }>(
    'GET',
    '/_api/web?$select=ServerRelativeUrl',
  );
  const webPath = web.data.ServerRelativeUrl.replace(/\/$/, '');
  const result = (kind: SeedAction['kind'], target: string, response: SpResponse): void => {
    const error = response.status === 404 ? undefined : failed(response);
    actions.push({
      kind,
      target,
      outcome: error ? 'failed' : 'removed',
      ...(error ? { detail: error } : {}),
    });
  };
  // Subsites first: one packman created goes whole, with everything in it.
  for (const web of record.webs) {
    const sub = client.at?.(web.url);
    if (!sub) continue;
    if (web.created) result('web', `${web.url}/`, await sub.request('DELETE', '/_api/web'));
    else
      actions.push(
        ...(await clean(sub, web.record)).map((action) => ({
          ...action,
          target: `${web.url}/${action.target}`,
        })),
      );
  }
  for (const page of record.pages) {
    const list = await findList(client, page.list);
    if (list)
      result(
        'page',
        `${page.list}: ${page.id}`,
        await client.request('DELETE', `/_api/web/lists(guid'${list.id}')/items(${page.id})`),
      );
  }
  for (const ct of record.contentTypes) {
    // The library holds a child of the site content type; remove it before the site one.
    const list = ct.list ? await findList(client, ct.list) : undefined;
    if (list) {
      const onList = await client.request<{ value: { StringId: string }[] }>(
        'GET',
        `/_api/web/lists(guid'${list.id}')/contenttypes?$select=StringId`,
      );
      for (const child of onList.data.value.filter((entry) => entry.StringId.startsWith(ct.id)))
        await client.request(
          'DELETE',
          `/_api/web/lists(guid'${list.id}')/contenttypes('${odata(child.StringId)}')`,
        );
    }
    result(
      'contentType',
      ct.id,
      await client.request('DELETE', `/_api/web/contenttypes('${odata(ct.id)}')`),
    );
  }
  const ownLists = new Set(record.lists);
  for (const item of record.items.filter((entry) => !ownLists.has(entry.list)))
    result(
      'item',
      `${item.list}: ${item.id}`,
      await client.request(
        'DELETE',
        `/_api/web/lists/getbytitle('${odata(item.list)}')/items(${item.id})`,
      ),
    );
  for (const field of record.fields.filter((entry) => !ownLists.has(entry.list)))
    result(
      'field',
      `${field.list}.${field.name}`,
      await client.request(
        'DELETE',
        `/_api/web/lists/getbytitle('${odata(field.list)}')/fields/getbyinternalnameortitle('${odata(field.name)}')`,
      ),
    );
  for (const list of record.lists)
    result(
      'list',
      list,
      await client.request('DELETE', `/_api/web/lists/getbytitle('${odata(list)}')`),
    );
  for (const file of record.files)
    result(
      'file',
      file,
      await client.request(
        'DELETE',
        `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(`${webPath}/${file}`)}')`,
      ),
    );
  for (const folder of [...record.folders].reverse()) {
    const probe = await client.request<{ ItemCount?: number }>(
      'GET',
      `/_api/web/GetFolderByServerRelativePath(decodedurl='${odata(`${webPath}/${folder}`)}')?$select=ItemCount`,
    );
    if (probe.status < 400 && (probe.data.ItemCount ?? 0) === 0)
      result(
        'folder',
        folder,
        await client.request(
          'DELETE',
          `/_api/web/GetFolderByServerRelativePath(decodedurl='${odata(`${webPath}/${folder}`)}')`,
        ),
      );
    else actions.push({ kind: 'folder', target: folder, outcome: 'skipped', detail: 'not empty' });
  }
  return actions;
}
