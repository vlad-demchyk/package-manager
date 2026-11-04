import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parseJsonc } from '../core/json.js';
import { t } from '../i18n/index.js';
import { journal } from '../ops/journal.js';
import {
  browserClient,
  openBrowser,
  waitForSite,
  DEFAULT_DEBUG_PORT,
} from '../sharepoint/browser.js';
import {
  checkComponent,
  devServerCommand,
  startDevServer,
  type ComponentResult,
} from '../sharepoint/debug.js';
import {
  FIXTURES_FILE,
  fixturesSchema,
  mergeRequirements,
  type Fixtures,
} from '../sharepoint/fixtures.js';
import {
  combineRequirements,
  requirementsFromRequests,
  scanRequirements,
  type DataRequirements,
} from '../sharepoint/requirements.js';
import {
  clean,
  readRecord,
  resolveItemRefs,
  seed,
  writeRecord,
  type SeedAction,
} from '../sharepoint/seed.js';
import { openSession, runAnalysis, type CommonOptions } from './context.js';
import { commonOptions, confirm } from './shared.js';

interface SiteOptions extends CommonOptions {
  site?: string;
  port?: string;
}

async function readFixtures(root: string): Promise<Fixtures> {
  const file = path.join(root, FIXTURES_FILE);
  if (!existsSync(file)) return fixturesSchema.parse({});
  const parsed = parseJsonc(await readFile(file, 'utf8'), file);
  if (!parsed.ok) throw new Error(parsed.error);
  const fixtures = fixturesSchema.parse(parsed.value);
  for (const entry of fixtures.files)
    if (entry.from !== undefined && entry.content === undefined)
      entry.content = await readFile(path.resolve(root, entry.from), 'utf8');
  return fixtures;
}

/** Requests recorded by the newest `sharepoint test` run, if any. */
async function lastTestRequests(
  root: string,
): Promise<{ run: string; found: DataRequirements } | undefined> {
  const dir = path.join(root, '.packman', 'validation');
  const runs = (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith('-sharepoint'))
    .sort();
  const run = runs.at(-1);
  if (!run || !existsSync(path.join(dir, run, 'summary.json'))) return undefined;
  const results = JSON.parse(await readFile(path.join(dir, run, 'summary.json'), 'utf8')) as {
    project: string;
    requests?: { method: string; url: string }[];
  }[];
  const requests = results.flatMap((result) =>
    (result.requests ?? []).map((request) => ({ project: result.project, ...request })),
  );
  return { run, found: requirementsFromRequests(requests) };
}

function siteOf(options: SiteOptions, fixtures: Fixtures): string {
  const site = (options.site ?? fixtures.site)?.replace(/\/$/, '');
  if (!site) throw new Error(t('sp.noSite', { file: FIXTURES_FILE }));
  return site;
}

async function signIn(site: string, port: string | undefined) {
  const page = await openBrowser(site, port ? Number(port) : DEFAULT_DEBUG_PORT);
  await waitForSite(page, site, 600_000, () => {
    console.log(pc.yellow(t('sp.signIn', { site })));
  });
  return page;
}

function printActions(actions: SeedAction[]): void {
  const colors: Record<SeedAction['outcome'], (text: string) => string> = {
    created: pc.green,
    removed: pc.green,
    planned: pc.cyan,
    exists: pc.dim,
    skipped: pc.yellow,
    failed: pc.red,
  };
  for (const action of actions)
    console.log(
      `  ${colors[action.outcome](action.outcome.padEnd(8))} ${action.kind.padEnd(6)} ${action.target}${action.detail ? pc.dim(` ${action.detail}`) : ''}`,
    );
}

export function registerSharePoint(program: Command): void {
  const sharepoint = program
    .command('sharepoint')
    .alias('sp')
    .description('SharePoint test data and debug runs for SPFx projects');

  commonOptions(
    sharepoint
      .command('requirements')
      .description('lists, columns, files and Graph data the components use'),
  )
    .option('--json', 'print as JSON')
    .option('--write', `add what is missing to ${FIXTURES_FILE}`)
    .option('--no-from-test', 'ignore the requests recorded by the last `sharepoint test`')
    .action(
      async (
        root: string,
        options: CommonOptions & { json?: boolean; write?: boolean; fromTest?: boolean },
      ) => {
        const session = await openSession(root, options);
        let found = await scanRequirements(session.workspace.projects);
        const tested =
          options.fromTest === false ? undefined : await lastTestRequests(session.root);
        if (tested) {
          found = combineRequirements(found, tested.found);
          if (!options.json) console.log(pc.dim(t('sp.fromTest', { run: tested.run })));
        }
        if (options.json) {
          process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
          return;
        }
        for (const list of found.lists)
          console.log(
            `${pc.bold(list.title)}${list.writes ? pc.yellow(' (writes)') : ''} ${pc.dim(list.usedBy.join(', '))}\n  ${list.fields.join(', ') || '-'}`,
          );
        for (const file of found.files)
          console.log(`${pc.bold(file.path)} ${pc.dim(file.usedBy.join(', '))}`);
        for (const entry of found.graph)
          console.log(`graph ${pc.bold(entry.resource)} ${pc.dim(entry.usedBy.join(', '))}`);
        if (found.search.length) console.log(`search ${pc.dim(found.search.join(', '))}`);
        if (options.write) {
          const merged = mergeRequirements(await readFixtures(session.root), found);
          await writeFile(
            path.join(session.root, FIXTURES_FILE),
            `${JSON.stringify(merged, null, 2)}\n`,
            'utf8',
          );
          console.log(pc.green(t('sp.written', { file: FIXTURES_FILE })));
        }
      },
    );

  commonOptions(
    sharepoint
      .command('seed')
      .description(
        `create the lists, columns, items and files of ${FIXTURES_FILE} (dry run unless --apply)`,
      ),
  )
    .option('--site <url>', 'dev site URL (default: "site" in the fixtures)')
    .option('--apply', 'write to the site')
    .option('-y, --yes', 'do not ask for confirmation')
    .option('--port <n>', 'browser debugging port')
    .action(async (root: string, options: SiteOptions & { apply?: boolean; yes?: boolean }) => {
      const absRoot = path.resolve(root);
      const fixtures = await readFixtures(absRoot);
      const site = siteOf(options, fixtures);
      const page = await signIn(site, options.port);
      try {
        const client = browserClient(page, site);
        const record = await readRecord(absRoot, site);
        const plan = await seed(client, fixtures, { apply: false, record: { ...record } });
        printActions(plan.filter((action) => action.outcome !== 'exists'));
        const changes = plan.filter((action) => action.outcome === 'planned').length;
        if (!options.apply || changes === 0) {
          console.log(changes === 0 ? t('sp.upToDate') : pc.dim(t('sp.dryRun')));
          return;
        }
        if (!options.yes && !(await confirm(t('sp.confirmSeed', { count: changes, site })))) {
          console.log(t('cli.aborted'));
          return;
        }
        const actions = await seed(client, fixtures, { apply: true, record });
        await writeRecord(absRoot, record);
        printActions(actions.filter((action) => action.outcome !== 'exists'));
        const failures = actions.filter((action) => action.outcome === 'failed').length;
        if (failures) process.exitCode = 1;
        await journal(absRoot, {
          command: 'sharepoint seed',
          projects: [],
          result: failures ? 'failed' : 'ok',
          detail: `${site}: ${actions.filter((action) => action.outcome === 'created').length} created, ${failures} failed`,
        });
      } finally {
        page.close();
      }
    });

  commonOptions(sharepoint.command('clean').description('remove what seed created on the site'))
    .option('--site <url>', 'dev site URL (default: "site" in the fixtures)')
    .option('-y, --yes', 'do not ask for confirmation')
    .option('--port <n>', 'browser debugging port')
    .action(async (root: string, options: SiteOptions & { yes?: boolean }) => {
      const absRoot = path.resolve(root);
      const site = siteOf(options, await readFixtures(absRoot));
      const record = await readRecord(absRoot, site);
      const count =
        record.lists.length + record.items.length + record.fields.length + record.files.length;
      if (count === 0) {
        console.log(t('clean.nothing'));
        return;
      }
      console.log(
        `${record.lists.length} lists, ${record.items.length} items, ${record.fields.length} columns, ${record.files.length} files`,
      );
      if (!options.yes && !(await confirm(t('sp.confirmClean', { site })))) {
        console.log(t('cli.aborted'));
        return;
      }
      const page = await signIn(site, options.port);
      try {
        const actions = await clean(browserClient(page, site), record);
        printActions(actions);
        const failures = actions.filter((action) => action.outcome === 'failed').length;
        if (failures === 0)
          await writeRecord(absRoot, {
            ...record,
            lists: [],
            fields: [],
            items: [],
            files: [],
            folders: [],
          });
        else process.exitCode = 1;
        await journal(absRoot, {
          command: 'sharepoint clean',
          projects: [],
          result: failures ? 'failed' : 'ok',
          detail: site,
        });
      } finally {
        page.close();
      }
    });

  commonOptions(
    sharepoint
      .command('test')
      .description('load every SPFx component from its dev server into a SharePoint dev site'),
  )
    .option('--site <url>', 'dev site URL (default: "site" in the fixtures)')
    .option('--page <url>', 'modern page for application customizers (default: the site home page)')
    .option('--port <n>', 'browser debugging port')
    .option('--json', 'print the results as JSON')
    .option('--properties', 'also drive every property pane control of each web part')
    .action(
      async (
        root: string,
        options: SiteOptions & { page?: string; json?: boolean; properties?: boolean },
      ) => {
        const session = await openSession(root, options);
        const fixtures = await readFixtures(session.root);
        const site = siteOf(options, fixtures);
        const report = await runAnalysis(session, { ...options, security: false, usage: false });
        const entries = report.projects.filter((entry) =>
          entry.stacks.some((stack) => stack.provider === 'spfx'),
        );
        const page = await signIn(site, options.port);
        const runDir = path.join(
          session.root,
          '.packman',
          'validation',
          `${new Date().toISOString().replace(/[:.]/g, '-')}-sharepoint`,
        );
        await mkdir(runDir, { recursive: true });
        const results: (
          ComponentResult | { project: string; status: 'skipped' | 'failed'; reason: string }
        )[] = [];
        try {
          const extensionPage =
            options.page ??
            `${site}/${(await browserClient(page, site).request<{ WelcomePage: string }>('GET', '/_api/web?$select=WelcomePage')).data.WelcomePage}`;
          for (const entry of entries) {
            const id = entry.project.id;
            if (!devServerCommand(entry.project.dir)) {
              results.push({ project: id, status: 'skipped', reason: t('sp.noGulp') });
              continue;
            }
            if (!entry.node.selected) {
              results.push({
                project: id,
                status: 'skipped',
                reason: t('node.notInstalled', {
                  ranges: entry.node.effective.join(' & '),
                  recommended: entry.node.recommended ?? '-',
                }),
              });
              continue;
            }
            if (!options.json) console.log(pc.bold(`\n> ${id}`));
            const slug = id.replace(/[^\w.-]+/g, '_');
            let server;
            try {
              server = await startDevServer(
                entry.project,
                entry.node.selected,
                path.join(runDir, `${slug}-serve.log`),
              );
            } catch (error) {
              results.push({ project: id, status: 'failed', reason: (error as Error).message });
              if (!options.json) console.log(pc.red(`  ${(error as Error).message}`));
              continue;
            }
            try {
              for (const component of server.components) {
                const settings = fixtures.components[component.alias];
                const query = settings?.query
                  ? await resolveItemRefs(browserClient(page, site), settings.query)
                  : undefined;
                const result = await checkComponent(page, {
                  ...(query ? { query } : {}),
                  known: settings?.known ?? [],
                  properties: options.properties ?? false,
                  project: id,
                  site,
                  extensionPage,
                  manifestsUrl: server.manifestsUrl,
                  component,
                  screenshot: path.join(runDir, `${slug}-${component.alias}.png`),
                });
                results.push(result);
                if (!options.json) {
                  const color =
                    result.status === 'ok'
                      ? pc.green
                      : result.status === 'needs-data'
                        ? pc.yellow
                        : pc.red;
                  console.log(
                    `  ${color(result.status.padEnd(10))} ${component.alias} ${pc.dim(`${result.bundles} bundles`)}`,
                  );
                  for (const issue of result.issues.filter((item) => item.kind !== 'host'))
                    console.log(`    ${pc.dim(issue.kind.padEnd(7))} ${issue.text.split('\n')[0]}`);
                  if (result.properties) {
                    const bad = result.properties.steps.filter(
                      (entry) =>
                        entry.crashed ||
                        entry.issues.some(
                          (issue) => issue.kind === 'runtime' || issue.kind === 'load',
                        ),
                    );
                    if (!result.properties.opened) process.exitCode = 1;
                    const color = bad.length || !result.properties.opened ? pc.red : pc.green;
                    console.log(
                      `    ${color(t(result.properties.opened ? 'sp.propertySteps' : 'sp.propertyPaneClosed', { steps: result.properties.steps.length, controls: result.properties.controls, failed: bad.length }))}${result.properties.truncated ? pc.yellow(' (truncated)') : ''}`,
                    );
                    for (const entry of bad)
                      console.log(
                        `      ${entry.control} = ${entry.value}: ${entry.crashed ? 'crashed' : (entry.issues.find((issue) => issue.kind !== 'data')?.text.split('\n')[0] ?? '')}`,
                      );
                    if (result.properties.skipped.length)
                      console.log(
                        pc.dim(
                          `      ${t('sp.propertySkipped', { controls: result.properties.skipped.join(', ') })}`,
                        ),
                      );
                  }
                }
              }
            } finally {
              await server.stop();
            }
          }
        } finally {
          page.close();
        }
        await writeFile(
          path.join(runDir, 'summary.json'),
          `${JSON.stringify(results, null, 2)}\n`,
          'utf8',
        );
        const failed = results.filter((result) => result.status === 'failed').length;
        if (failed) process.exitCode = 1;
        await journal(session.root, {
          command: 'sharepoint test',
          projects: entries.map((entry) => entry.project.id),
          result: failed ? 'failed' : 'ok',
          detail: `${site}: ${results.filter((result) => result.status === 'ok').length} ok, ${results.filter((result) => result.status === 'needs-data').length} need data, ${failed} failed`,
        });
        if (options.json) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
        else console.log(pc.dim(`\n${path.relative(session.root, runDir)}`));
      },
    );
}
