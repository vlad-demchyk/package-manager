import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../core/types.js';

/** A SharePoint list or library a component reads or writes, as found in its source. */
export interface ListRequirement {
  title: string;
  /** Columns named in $select, .select(), $filter and $orderby next to the list access. */
  fields: string[];
  /** Columns compared with `eq 1`/`eq true`: probably Yes/No. */
  booleans: string[];
  /** Columns compared with dates: probably Date and Time. */
  dates: string[];
  writes: boolean;
  usedBy: string[];
}

/** Everything the components of a workspace need from SharePoint and Microsoft 365 at run time. */
export interface DataRequirements {
  lists: ListRequirement[];
  /** Site-relative files the code loads, e.g. `SiteAssets/configIntranet/menuHeader.json`. */
  files: { path: string; usedBy: string[] }[];
  /** Microsoft Graph resources (`me`, `users`, `groups/{id}/members`). */
  graph: { resource: string; usedBy: string[] }[];
  /** Projects that query the SharePoint search API (managed properties need the search schema). */
  search: string[];
}

/** Columns every list or library already has; they never need provisioning. */
const BUILT_IN = new Set(
  [
    'Id',
    'ID',
    'GUID',
    'Title',
    'Created',
    'Modified',
    'Author',
    'Editor',
    'AuthorId',
    'EditorId',
    'File',
    'FileRef',
    'FileLeafRef',
    'FileDirRef',
    'Attachments',
    'AttachmentFiles',
    'ContentType',
    'ContentTypeId',
    'ParentList',
    'OData__ModerationStatus',
    'PromotedState',
    'BannerImageUrl',
    'CanvasContent1',
    'Description',
    'LayoutWebpartsContent',
    'TaxCatchAll',
    'ServerRedirectedEmbedUrl',
    'UniqueId',
  ].map((name) => name.toLowerCase()),
);

/** Pages libraries exist on every modern site; their columns come from content types, not from a seed. */
export const PAGES_LIBRARIES = new Set([
  'site pages',
  'pagine del sito',
  'sitepages',
  'websiteseiten',
]);

const SOURCE = /\.(tsx?|jsx?)$/;
const LIST_ACCESS = /getByTitle\(\s*(?:["'`]([^"'`$]+)["'`]|\\?'([^'\\]+)\\?')\s*\)/gi;
const LITERAL = /["'`]([^"'`]*)["'`]/g;
const ASSET = /(SiteAssets\/[\w\-./ ]+?\.(?:json|css|svg|png|jpe?g|txt|html))/g;
const GRAPH = /\.api\(\s*["'`]\/?([a-zA-Z]+)(?:\/(\$?\{?[^"'`/?]*\}?))?(?:\/([a-zA-Z]+))?/g;
const COMPARISON = /([A-Za-z_][\w]*)\s+(eq|ne|le|ge|lt|gt)\s+([^\s)]+)/g;
const WINDOW = 900;
/** PnPjs Graph: graph.me, graph.users.getById(x).photo, graph.groups.getById(x).members. */
const PNP_GRAPH =
  /\b\w*graph\w*\.(me|users|groups)\b(\.getById\([^)]*\))?(?:\.(manager|members|photo|memberOf))?/gi;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  await walk(dir);
  return out.sort();
}

/** Column names inside a select/filter/orderby text, without expansions (`Author/Title` -> `Author`). */
function columnsOf(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((part) => part.replace(/^\$\w+=/, '').split('/')[0] ?? '')
    .filter(
      (name) =>
        /^[A-Za-z_][\w]*$/.test(name) &&
        !/^(and|or|not|asc|desc|eq|ne|le|ge|lt|gt|null|true|false|datetime)$/i.test(name),
    );
}

/** The statement that follows a list access: up to its `;`, the next list access or a fixed window. */
function statementAfter(text: string, from: number): string {
  const rest = text.slice(from, from + WINDOW);
  const ends = [rest.slice(1).search(/getByTitle\(/i), rest.search(/;\s*(\n|$)/)]
    .filter((at) => at >= 0)
    .map((at) => at + 1);
  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

/** String items of `NAME = [...]` in the same file, for `.select(...NAME)`. */
function constantArray(text: string, name: string): string[] {
  const match = new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`).exec(text);
  return [...(match?.[1] ?? '').matchAll(LITERAL)].map((literal) => literal[1] ?? '');
}

function scanList(statement: string, file: string): Omit<ListRequirement, 'title' | 'usedBy'> {
  const fields = new Set<string>();
  const booleans = new Set<string>();
  const dates = new Set<string>();
  for (const call of statement.matchAll(/\.(select|orderBy|expand)\(([^)]*)\)/g)) {
    const args = call[2] ?? '';
    const literals = [...args.matchAll(LITERAL)].map((literal) => literal[1] ?? '');
    for (const spread of args.matchAll(/\.\.\.(?:[\w$]+\.)*([\w$]+)/g))
      literals.push(...constantArray(file, spread[1] ?? ''));
    if (call[1] !== 'expand')
      for (const literal of literals) for (const name of columnsOf(literal)) fields.add(name);
  }
  // In a filter only the left side of a comparison is a column; the right side is a value.
  for (const call of statement.matchAll(/\.filter\(\s*([`'"])([\s\S]*?)\1\s*\)/g))
    for (const comparison of (call[2] ?? '').matchAll(COMPARISON)) fields.add(comparison[1] ?? '');
  // Columns written by items.add({...}) and update({...}).
  for (const call of statement.matchAll(/\.(?:add|update)\(\s*\{([^}]*)\}/g))
    for (const key of (call[1] ?? '').matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*:/g))
      fields.add(key[1] ?? '');
  for (const param of statement.matchAll(/\$(select|filter|orderby|expand)=([^&"'`]+)/gi))
    for (const name of columnsOf(decodeURIComponent((param[2] ?? '').replace(/\+/g, ' '))))
      if (param[1]?.toLowerCase() !== 'expand') fields.add(name);
  for (const comparison of statement.matchAll(COMPARISON)) {
    const [, name = '', , value = ''] = comparison;
    if (/^(1|0|true|false)$/i.test(value)) booleans.add(name);
    if (/datetime|\d{4}-\d\d-\d\d|\$\{/i.test(value) && /data|date|fine|inizio/i.test(name))
      dates.add(name);
  }
  const keep = (name: string): boolean => !BUILT_IN.has(name.toLowerCase());
  return {
    fields: [...fields].filter(keep).sort(),
    booleans: [...booleans].filter(keep).sort(),
    dates: [...dates].filter(keep).sort(),
    writes:
      /\.items\.add\(|\.add\(\s*\{|\.update\(\s*\{|\.delete\(\)|\.recycle\(\)|X-HTTP-Method|method:\s*["']POST/.test(
        statement,
      ),
  };
}

type Found = Omit<ListRequirement, 'title' | 'usedBy'>;

function addList(
  lists: Map<string, ListRequirement>,
  title: string,
  found: Found,
  projects: string[],
): void {
  const key = title.toLowerCase();
  const entry = lists.get(key) ?? {
    title,
    fields: [],
    booleans: [],
    dates: [],
    writes: false,
    usedBy: [],
  };
  entry.fields = [...new Set([...entry.fields, ...found.fields])].sort();
  entry.booleans = [...new Set([...entry.booleans, ...found.booleans])].sort();
  entry.dates = [...new Set([...entry.dates, ...found.dates])].sort();
  entry.writes ||= found.writes;
  entry.usedBy = [...new Set([...entry.usedBy, ...projects])].sort();
  lists.set(key, entry);
}

const addUse = (map: Map<string, Set<string>>, key: string, projects: string[]): void => {
  const set = map.get(key) ?? new Set<string>();
  for (const project of projects) set.add(project);
  map.set(key, set);
};

function finish(
  lists: Map<string, ListRequirement>,
  files: Map<string, Set<string>>,
  graph: Map<string, Set<string>>,
  search: Set<string>,
): DataRequirements {
  const sortedUse = (set: Set<string>): string[] => [...set].sort();
  return {
    lists: [...lists.values()].sort((a, b) => a.title.localeCompare(b.title)),
    files: [...files]
      .map(([file, used]) => ({ path: file, usedBy: sortedUse(used) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    graph: [...graph]
      .map(([resource, used]) => ({ resource, usedBy: sortedUse(used) }))
      .sort((a, b) => a.resource.localeCompare(b.resource)),
    search: [...search].sort(),
  };
}

/** Reads the components' source and lists the SharePoint data they need. */
export async function scanRequirements(projects: Project[]): Promise<DataRequirements> {
  const lists = new Map<string, ListRequirement>();
  const files = new Map<string, Set<string>>();
  const graph = new Map<string, Set<string>>();
  const search = new Set<string>();
  for (const project of projects) {
    const used = [project.id];
    for (const file of await sourceFiles(path.join(project.dir, 'src'))) {
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(LIST_ACCESS)) {
        const title = (match[1] ?? match[2] ?? '').trim();
        if (!title || PAGES_LIBRARIES.has(title.toLowerCase())) continue;
        addList(lists, title, scanList(statementAfter(text, match.index), text), used);
      }
      for (const match of text.matchAll(ASSET)) addUse(files, match[1] ?? '', used);
      for (const match of text.matchAll(PNP_GRAPH)) {
        const [, root = '', byId, child] = match;
        addUse(graph, [root, byId ? '{id}' : undefined, child].filter(Boolean).join('/'), used);
      }
      for (const match of text.matchAll(GRAPH)) {
        const [, root = '', id, child] = match;
        const resource = [root, id ? (id.startsWith('$') ? '{id}' : id) : undefined, child]
          .filter(Boolean)
          .join('/');
        addUse(graph, resource, used);
      }
      if (/_api\/search\/|SearchQueryBuilder|sp\.search\(/i.test(text)) search.add(project.id);
    }
  }
  return finish(lists, files, graph, search);
}

/**
 * The same requirements read from the REST calls components made in a `sharepoint test` run. The
 * URLs carry the real $select/$filter, including columns the source builds at run time.
 */
export function requirementsFromRequests(
  requests: { project: string; method?: string; url: string }[],
): DataRequirements {
  const lists = new Map<string, ListRequirement>();
  const files = new Map<string, Set<string>>();
  const graph = new Map<string, Set<string>>();
  const search = new Set<string>();
  for (const request of requests) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      continue;
    }
    const used = [request.project];
    const pathname = decodeURIComponent(url.pathname);
    if (url.host === 'graph.microsoft.com') {
      const parts = pathname.split('/').filter(Boolean).slice(1);
      const resource = parts
        .map((part, index) => (index === 1 && parts[0] !== 'me' ? '{id}' : part))
        .filter((part) => !part.startsWith('$'))
        .join('/');
      if (resource) addUse(graph, resource, used);
      continue;
    }
    if (/\/_api\/search\//i.test(pathname)) search.add(request.project);
    const asset = /\/(SiteAssets\/.+\.\w+)$/i.exec(pathname);
    if (asset?.[1] && !pathname.includes('/_api/')) addUse(files, asset[1], used);
    const fileByUrl = /SiteAssets\/[^'"]+\.\w+/i.exec(decodeURIComponent(url.search));
    if (pathname.includes('getFileByUrl') && fileByUrl) addUse(files, fileByUrl[0], used);
    const list = /\/_api\/web\/lists\/getByTitle\('([^']+)'\)/i.exec(pathname);
    if (!list?.[1] || PAGES_LIBRARIES.has(list[1].toLowerCase())) continue;
    const query = (name: string): string => url.searchParams.get(name) ?? '';
    const filter = query('$filter');
    const found: Found = {
      fields: [
        ...columnsOf(query('$select')),
        ...columnsOf(query('$orderby')),
        ...[...filter.matchAll(COMPARISON)].map((comparison) => comparison[1] ?? ''),
      ].filter((name) => name && !BUILT_IN.has(name.toLowerCase())),
      booleans: [...filter.matchAll(COMPARISON)]
        .filter((c) => /^(1|0|true|false)$/i.test(c[3] ?? ''))
        .map((c) => c[1] ?? ''),
      dates: [...filter.matchAll(COMPARISON)]
        .filter((c) => /datetime|\d{4}-\d\d-\d\d/i.test(c[3] ?? ''))
        .map((c) => c[1] ?? ''),
      writes: request.method !== undefined && request.method !== 'GET',
    };
    addList(lists, list[1], found, used);
  }
  return finish(lists, files, graph, search);
}

/** Union of two requirement sets (source scan and test run). */
export function combineRequirements(a: DataRequirements, b: DataRequirements): DataRequirements {
  const lists = new Map<string, ListRequirement>();
  for (const list of [...a.lists, ...b.lists]) addList(lists, list.title, list, list.usedBy);
  const files = new Map<string, Set<string>>();
  for (const file of [...a.files, ...b.files]) addUse(files, file.path, file.usedBy);
  const graph = new Map<string, Set<string>>();
  for (const entry of [...a.graph, ...b.graph]) addUse(graph, entry.resource, entry.usedBy);
  return finish(lists, files, graph, new Set([...a.search, ...b.search]));
}
