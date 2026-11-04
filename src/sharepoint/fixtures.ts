import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import type { DataRequirements } from './requirements.js';

/** Workspace file with the test data a SharePoint dev site needs; edited by hand after `requirements --write`. */
export const FIXTURES_FILE = 'packman.sharepoint.json';

export const FIELD_TYPES = [
  'Text',
  'Note',
  'Number',
  'Boolean',
  'DateTime',
  'Choice',
  'MultiChoice',
  'URL',
  'User',
  'Lookup',
] as const;

/** SharePoint list templates by their friendly name. */
export const LIST_TEMPLATES = { generic: 100, documents: 101, events: 106, pictures: 109 } as const;

const fieldSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][\w]*$/),
  type: z.enum(FIELD_TYPES).default('Text'),
  choices: z.array(z.string()).optional(),
  /** Lookup target list title. */
  list: z.string().optional(),
});

const listSchema = z.object({
  title: z.string().min(1),
  template: z.enum(['generic', 'documents', 'events', 'pictures']).default('generic'),
  fields: z.array(fieldSchema).default([]),
  /**
   * Items to add. Values: plain JSON, `"@me"` for a User column, `{ "lookup": "<Title>" }` for a
   * Lookup column, `"@me"` in a number column for the signed-in user's site id, `"@aad"` for
   * their Entra object id, dates as ISO strings or `today`, `today+3d`, `now-2h`. Library items need
   * `"file"` (name) and `"placeholder"` (a color for a generated PNG) or `"content"` (text).
   */
  items: z.array(z.record(z.string(), z.unknown())).default([]),
  usedBy: z.array(z.string()).default([]),
  writes: z.boolean().default(false),
});

const fileSchema = z.object({
  /** Site-relative path, e.g. `SiteAssets/configIntranet/menuHeader.json`. */
  path: z.string().min(1),
  /** JSON value (written formatted) or text. */
  content: z.unknown().optional(),
  /** Workspace-relative file to upload instead of `content`, e.g. a sample menu in a project. */
  from: z.string().optional(),
  /** Color of a generated PNG, for image files without content. */
  placeholder: z.string().optional(),
  usedBy: z.array(z.string()).default([]),
});

const componentSchema = z.object({
  /**
   * Query string for the page the component loads on, e.g. `iditem={Eventi/[test] Evento}`:
   * `{List/Title}` becomes the id of that item.
   */
  query: z.string().optional(),
  /** Problems known not to come from the packages, matched by text; reported, never failing. */
  known: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export const fixturesSchema = z.object({
  /** Dev site the data belongs to. Never a production site: components write to these lists. */
  site: z.url().optional(),
  lists: z.array(listSchema).default([]),
  files: z.array(fileSchema).default([]),
  /** Per component alias (e.g. `EventoWebPart`): how `sharepoint test` hosts it. */
  components: z.record(z.string(), componentSchema).default({}),
});

export type Fixtures = z.infer<typeof fixturesSchema>;
export type ListFixture = Fixtures['lists'][number];
export type FieldFixture = ListFixture['fields'][number];
export type FileFixture = Fixtures['files'][number];

/**
 * Adds what the source needs and the fixtures miss: new lists, new columns, new files. Existing
 * entries keep their hand-edited types, items and contents; `usedBy` and `writes` are refreshed.
 */
export function mergeRequirements(current: Fixtures, found: DataRequirements): Fixtures {
  const lists = current.lists.map((list) => ({ ...list, fields: [...list.fields] }));
  for (const need of found.lists) {
    let list = lists.find((entry) => entry.title.toLowerCase() === need.title.toLowerCase());
    if (!list) {
      list = {
        title: need.title,
        template: 'generic',
        fields: [],
        items: [],
        usedBy: [],
        writes: false,
      };
      lists.push(list);
    }
    list.usedBy = need.usedBy;
    list.writes = need.writes;
    for (const name of need.fields) {
      if (list.fields.some((field) => field.name.toLowerCase() === name.toLowerCase())) continue;
      const type = need.booleans.includes(name)
        ? 'Boolean'
        : need.dates.includes(name)
          ? 'DateTime'
          : 'Text';
      list.fields.push({ name, type });
    }
  }
  const files = current.files.map((file) => ({ ...file }));
  for (const need of found.files) {
    const file = files.find((entry) => entry.path.toLowerCase() === need.path.toLowerCase());
    if (file) file.usedBy = need.usedBy;
    else files.push({ path: need.path, usedBy: need.usedBy });
  }
  return { ...current, lists, files };
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** CAML for `fields/createfieldasxml`; a Lookup needs the target list id. */
export function fieldXml(field: FieldFixture, lookupListId?: string): string {
  const name = escapeXml(field.name);
  const base = `DisplayName="${name}" Name="${name}" StaticName="${name}"`;
  const choices = (field.choices ?? [])
    .map((choice) => `<CHOICE>${escapeXml(choice)}</CHOICE>`)
    .join('');
  switch (field.type) {
    case 'Note':
      return `<Field Type="Note" ${base} NumLines="6" RichText="FALSE" />`;
    case 'DateTime':
      return `<Field Type="DateTime" ${base} Format="DateTime" />`;
    case 'Choice':
      return `<Field Type="Choice" ${base} Format="Dropdown"><CHOICES>${choices}</CHOICES></Field>`;
    case 'MultiChoice':
      return `<Field Type="MultiChoice" ${base}><CHOICES>${choices}</CHOICES></Field>`;
    case 'User':
      return `<Field Type="User" ${base} UserSelectionMode="PeopleOnly" />`;
    case 'Lookup':
      if (!lookupListId) throw new Error(`lookup column ${field.name} needs a target list`);
      return `<Field Type="Lookup" ${base} List="{${lookupListId}}" ShowField="Title" />`;
    default:
      return `<Field Type="${field.type}" ${base} />`;
  }
}

const RELATIVE_DATE = /^(today|now)(?:([+-]\d+)([dhm]))?$/i;

/** `today+3d` style dates, relative to `now`; `today` is midnight UTC. Other values pass through. */
export function resolveDate(value: string, now: Date): string | undefined {
  const match = RELATIVE_DATE.exec(value.trim());
  if (!match) return undefined;
  const base = new Date(now);
  if (match[1]?.toLowerCase() === 'today') base.setUTCHours(0, 0, 0, 0);
  const amount = Number(match[2] ?? 0);
  const unit = match[3]?.toLowerCase();
  const ms = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
  return new Date(base.getTime() + amount * ms).toISOString();
}

export interface ValueContext {
  now: Date;
  userId: number;
  /** Entra object id of the signed-in user, when an item asks for `@aad`. */
  aadId?: string;
  /** Lookup target list -> item title -> item id. */
  lookups: Map<string, Map<string, number>>;
}

/**
 * Turns a fixture item into a REST body: User and Lookup columns write `<Name>Id`, relative dates
 * become ISO, library-only keys (`file`, `placeholder`, `content`) are dropped.
 */
export function itemBody(
  list: ListFixture,
  item: Record<string, unknown>,
  context: ValueContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(item)) {
    if (key === 'file' || key === 'placeholder' || key === 'content') continue;
    const field = list.fields.find((entry) => entry.name === key);
    if (field?.type === 'User') {
      body[`${key}Id`] = raw === '@me' ? context.userId : raw;
      continue;
    }
    if (field?.type === 'Lookup') {
      const title =
        raw && typeof raw === 'object' && 'lookup' in raw ? String(raw.lookup) : undefined;
      const id = title === undefined ? raw : context.lookups.get(field.list ?? '')?.get(title);
      if (id === undefined)
        throw new Error(`${list.title}.${key}: no ${field.list} item "${title}"`);
      body[`${key}Id`] = id;
      continue;
    }
    if (raw === '@me') body[key] = context.userId;
    else if (raw === '@aad') {
      if (!context.aadId)
        throw new Error(`${list.title}.${key}: the signed-in user's object id is unknown`);
      body[key] = context.aadId;
    } else if (typeof raw === 'string') body[key] = resolveDate(raw, context.now) ?? raw;
    else body[key] = raw;
  }
  return body;
}

/** A small single-color PNG, so picture libraries get real images without shipping binaries. */
export function placeholderPng(color: string, width = 320, height = 200): Buffer {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1] ?? '808080';
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r ?? 0, g ?? 0, b ?? 0], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
