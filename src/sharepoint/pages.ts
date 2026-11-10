import { randomUUID } from 'node:crypto';
import {
  fieldXml,
  itemBody,
  type ContentTypeFixture,
  type PageFixture,
  type ValueContext,
} from './fixtures.js';
import type { SeedAction, SpClient, SpResponse } from './seed.js';

/** Modern pages are files of this application in the pages library. */
const CLIENT_SIDE_APP = 'b6917cb1-93a0-4b97-a84d-7cf49975d4ec';
const PAGES_TEMPLATE = 119;

const odata = (value: string): string => encodeURIComponent(value.replace(/'/g, "''"));

/** Pauses between retries; tests pass a function that does not wait. */
export type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delays before each retry: SharePoint needs a few seconds after it creates a content type. */
export const RETRY_DELAYS = [2000, 5000, 10000];

/**
 * Repeats a request while SharePoint answers with one of `statuses` (a just-created object it does
 * not see yet, a short lock), waiting `RETRY_DELAYS` between tries. Returns the last response.
 */
export async function retrying<T>(
  call: () => Promise<SpResponse<T>>,
  statuses: number[],
  wait: Wait = sleep,
): Promise<SpResponse<T>> {
  let response = await call();
  for (const delay of RETRY_DELAYS) {
    if (!statuses.includes(response.status)) break;
    await wait(delay);
    response = await call();
  }
  return response;
}

export function failure(response: SpResponse): string | undefined {
  if (response.status < 400) return undefined;
  const data = response.data as
    { 'odata.error'?: { message?: { value?: string } } } | string | null;
  const message =
    data && typeof data === 'object'
      ? data['odata.error']?.message?.value
      : (data ?? '').slice(0, 200);
  return `HTTP ${response.status}${message ? `: ${message}` : ''}`;
}

/** A list by title, or the pages library by its template when `title` is the English "Site Pages". */
export async function findList(
  client: SpClient,
  title: string,
): Promise<{ id: string; root: string } | undefined> {
  const all = await client.request<{
    value: {
      Id: string;
      Title: string;
      BaseTemplate: number;
      RootFolder: { ServerRelativeUrl: string };
    }[];
  }>(
    'GET',
    '/_api/web/lists?$select=Id,Title,BaseTemplate,RootFolder/ServerRelativeUrl&$expand=RootFolder',
  );
  const lists = all.data.value;
  const match =
    lists.find((list) => list.Title.toLowerCase() === title.toLowerCase()) ??
    (/^site ?pages$/i.test(title)
      ? lists.find((list) => list.BaseTemplate === PAGES_TEMPLATE)
      : undefined);
  return match ? { id: match.Id, root: match.RootFolder.ServerRelativeUrl } : undefined;
}

/** Content types of the web by name, with their ids. */
async function webContentTypes(client: SpClient): Promise<Map<string, string>> {
  const found = await client.request<{ value: { Name: string; StringId: string }[] }>(
    'GET',
    '/_api/web/contenttypes?$select=Name,StringId',
  );
  return new Map(found.data.value.map((ct) => [ct.Name.toLowerCase(), ct.StringId]));
}

/**
 * Creates page (or list) content types that are missing, adds them to their library, and adds
 * their columns to the library. Existing content types and columns are left as they are.
 */
export async function seedContentTypes(
  client: SpClient,
  contentTypes: ContentTypeFixture[],
  options: {
    apply: boolean;
    web: string;
    record: { contentTypes: { web: string; id: string; list?: string }[] };
    wait?: Wait;
  },
): Promise<SeedAction[]> {
  const actions: SeedAction[] = [];
  if (contentTypes.length === 0) return actions;
  const known = await webContentTypes(client);
  for (const ct of contentTypes) {
    const target = `${options.web}${ct.name}`;
    const list = await findList(client, ct.list);
    let id = known.get(ct.name.toLowerCase());
    if (!id && !options.apply)
      actions.push({ kind: 'contentType', target, outcome: 'planned', detail: ct.list });
    else if (!id) {
      const candidate = `${ct.parent}00${randomUUID().replace(/-/g, '').toUpperCase()}`;
      const error = failure(
        await client.request('POST', '/_api/web/contenttypes', {
          Id: { StringValue: candidate },
          Name: ct.name,
          Group: 'packman test data',
        }),
      );
      if (error) actions.push({ kind: 'contentType', target, outcome: 'failed', detail: error });
      else {
        id = candidate;
        known.set(ct.name.toLowerCase(), id);
        options.record.contentTypes.push({ web: options.web, id, list: ct.list });
        actions.push({ kind: 'contentType', target, outcome: 'created' });
      }
    } else actions.push({ kind: 'contentType', target, outcome: 'exists' });
    if (!list) {
      actions.push({
        kind: 'contentType',
        target,
        outcome: options.apply ? 'failed' : 'planned',
        detail: `no list ${ct.list}`,
      });
      continue;
    }
    const listPath = `/_api/web/lists(guid'${list.id}')`;
    const onList = await client.request<{ value: { Name: string }[] }>(
      'GET',
      `${listPath}/contenttypes?$select=Name`,
    );
    // The columns go on the library either way: pages can hold values without the content type.
    const onLibrary = onList.data.value.some(
      (entry) => entry.Name.toLowerCase() === ct.name.toLowerCase(),
    );
    if (!onLibrary && !options.apply)
      actions.push({
        kind: 'contentType',
        target: `${target} -> ${ct.list}`,
        outcome: 'planned',
        detail: 'add to library',
      });
    else if (id && !onLibrary) {
      await client.request('MERGE', listPath, { ContentTypesEnabled: true });
      const contentTypeId = id;
      // A content type made a moment ago answers 500 here until SharePoint has it everywhere.
      const added = failure(
        await retrying(
          () =>
            client.request(
              'POST',
              `${listPath}/ContentTypes/AddAvailableContentType('${odata(contentTypeId)}')`,
            ),
          [500, 503],
          options.wait,
        ),
      );
      actions.push({
        kind: 'contentType',
        target: `${target} -> ${ct.list}`,
        outcome: added ? 'failed' : 'created',
        ...(added ? { detail: added } : {}),
      });
    }
    const fields = await client.request<{ value: { InternalName: string; Title: string }[] }>(
      'GET',
      `${listPath}/fields?$select=InternalName,Title`,
    );
    const have = new Set(
      fields.data.value.flatMap((field) => [
        field.InternalName.toLowerCase(),
        field.Title.toLowerCase(),
      ]),
    );
    for (const field of ct.fields) {
      const fieldTarget = `${options.web}${ct.list}.${field.name}`;
      if (have.has(field.name.toLowerCase())) continue;
      if (!options.apply) {
        actions.push({
          kind: 'field',
          target: fieldTarget,
          outcome: 'planned',
          detail: field.type,
        });
        continue;
      }
      const error = failure(
        await client.request('POST', `${listPath}/fields/createfieldasxml`, {
          parameters: { SchemaXml: fieldXml(field), Options: 8 },
        }),
      );
      have.add(field.name.toLowerCase());
      actions.push({
        kind: 'field',
        target: fieldTarget,
        outcome: error ? 'failed' : 'created',
        ...(error ? { detail: error } : {}),
      });
    }
  }
  return actions;
}

/**
 * Creates the missing modern pages (same file name), sets their content type and columns, promotes
 * news and publishes them. Pages a person made are never changed.
 */
export async function seedPages(
  client: SpClient,
  pages: PageFixture[],
  options: {
    apply: boolean;
    web: string;
    context: ValueContext;
    record: { pages: { web: string; list: string; id: number }[] };
    wait?: Wait;
  },
): Promise<SeedAction[]> {
  const actions: SeedAction[] = [];
  if (pages.length === 0) return actions;
  const contentTypes = await webContentTypes(client);
  for (const page of pages) {
    const target = `${options.web}${page.name}`;
    const list = await findList(client, page.list);
    if (!list) {
      actions.push({
        kind: 'page',
        target,
        outcome: options.apply ? 'failed' : 'planned',
        detail: `no list ${page.list}`,
      });
      continue;
    }
    const listPath = `/_api/web/lists(guid'${list.id}')`;
    const present = await client.request<{ value: { Id: number }[] }>(
      'GET',
      `${listPath}/items?$select=Id&$filter=FileLeafRef eq '${odata(page.name)}'`,
    );
    if (present.data.value.length > 0) {
      actions.push({ kind: 'page', target, outcome: 'exists' });
      continue;
    }
    if (!options.apply) {
      actions.push({
        kind: 'page',
        target,
        outcome: 'planned',
        detail: page.contentType ?? 'Site Page',
      });
      continue;
    }
    const fileUrl = `${list.root}/${page.name}`;
    const made = await client.request(
      'POST',
      `${listPath}/RootFolder/Files/AddTemplateFile(urlOfFile='${odata(fileUrl)}',templateFileType=3)`,
    );
    let error = failure(made);
    const item = error
      ? undefined
      : await client.request<{ Id: number }>(
          'GET',
          `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(fileUrl)}')/ListItemAllFields?$select=Id`,
        );
    const id = item?.data.Id;
    if (id !== undefined) {
      options.record.pages.push({ web: options.web, list: page.list, id });
      const ctId = page.contentType ? contentTypes.get(page.contentType.toLowerCase()) : undefined;
      const listCt = ctId
        ? (
            await client.request<{ value: { Name: string; StringId: string }[] }>(
              'GET',
              `${listPath}/contenttypes?$select=Name,StringId`,
            )
          ).data.value.find((entry) => entry.Name.toLowerCase() === page.contentType?.toLowerCase())
            ?.StringId
        : undefined;
      const values = itemBody(
        { title: page.list, template: 'generic', fields: [], items: [], usedBy: [], writes: false },
        page.fields,
        options.context,
      );
      // A new page is locked (HTTP 423) for changes until it is checked out to the signed-in user.
      error = await checkOut(client, fileUrl);
      if (!error)
        error = failure(
          await retrying(
            () =>
              client.request('MERGE', `${listPath}/items(${id})`, {
                Title: page.title,
                ClientSideApplicationId: CLIENT_SIDE_APP,
                PageLayoutType: 'Article',
                CanvasContent1: '<div></div>',
                ...(listCt ? { ContentTypeId: listCt } : {}),
                ...values,
              }),
            [423],
            options.wait,
          ),
        );
      // A plain MERGE answers 204 but leaves these page columns as they were; a form update while
      // the page is checked out sets them (the system update variant is refused on new sites).
      const pageValues = [
        ...(page.news ? [{ FieldName: 'PromotedState', FieldValue: '2' }] : []),
        ...(typeof values.Description === 'string'
          ? [{ FieldName: 'Description', FieldValue: values.Description }]
          : []),
      ];
      if (!error && pageValues.length) error = await formUpdate(client, listPath, id, pageValues);
      if (!error)
        error = failure(
          await client.request(
            'POST',
            `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(fileUrl)}')/CheckIn(comment='packman test data',checkintype=1)`,
          ),
        );
      if (page.contentType && !listCt)
        error ??= `content type ${page.contentType} is not on ${page.list}`;
      // A half-made page would count as existing next time; remove it so a rerun retries.
      if (error) {
        await client.request('DELETE', `${listPath}/items(${id})`);
        options.record.pages = options.record.pages.filter(
          (entry) => !(entry.id === id && entry.list === page.list),
        );
      }
    }
    actions.push({
      kind: 'page',
      target,
      outcome: error ? 'failed' : 'created',
      ...(error ? { detail: error } : {}),
    });
  }
  return actions;
}

/** `ValidateUpdateListItem`: answers 200 even when a column fails, so each value is checked. */
async function formUpdate(
  client: SpClient,
  listPath: string,
  id: number,
  formValues: { FieldName: string; FieldValue: string }[],
): Promise<string | undefined> {
  const response = await client.request<{
    value?: { FieldName: string; HasException: boolean; ErrorMessage: string | null }[];
  }>('POST', `${listPath}/items(${id})/ValidateUpdateListItem`, {
    formValues,
    bNewDocumentUpdate: false,
  });
  const error = failure(response);
  if (error) return error;
  const bad = (response.data.value ?? []).find((entry) => entry.HasException);
  return bad ? `${bad.FieldName}: ${bad.ErrorMessage ?? 'rejected'}` : undefined;
}

/** Checks a file out to the signed-in user unless it is checked out already. */
async function checkOut(client: SpClient, fileUrl: string): Promise<string | undefined> {
  const file = `/_api/web/GetFileByServerRelativePath(decodedurl='${odata(fileUrl)}')`;
  const state = await client.request<{ CheckOutType?: number }>(
    'GET',
    `${file}?$select=CheckOutType`,
  );
  // CheckOutType 2 is "none"; 0 (online) and 1 (offline) mean it is checked out already.
  if (state.status < 400 && state.data.CheckOutType !== 2) return undefined;
  return failure(await client.request('POST', `${file}/CheckOut()`));
}
