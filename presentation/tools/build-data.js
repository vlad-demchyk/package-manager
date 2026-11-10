/* global console, process */
// Generates presentation/assets/data.js from the sources of truth:
//   - command and option tree: commander from our own build (presentation/.build/dist);
//   - rules: docs/rules.md tables, checked against the ids in src/** (mismatches are printed);
//   - finding and fix titles: the src/i18n/en.ts catalogue (through the built en.js);
//   - live output: presentation/.build/out/*.txt (captured on the synthetic demo repository), paths replaced by placeholders;
//   - changelog: CHANGELOG.md;
//   - search index: headings with an id in presentation/*.html.
//
// Needs a local list of private names: presentation/.private-words.txt or PACKMAN_SITE_PRIVATE_WORDS.
// Run from the repository root:
//   npx tsc -p tsconfig.build.json --outDir presentation/.build/dist
//   node presentation/tools/build-data.js
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPrivateWords } from './private-words.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pres = path.resolve(here, '..');
const repo = path.resolve(pres, '..');
const build = path.join(pres, '.build');
const read = (file) => readFileSync(file, 'utf8');

// ---------- CLI ----------
const { buildProgram } = await import(pathToFileURL(path.join(build, 'dist/cli/main.js')).href);
const program = buildProgram();
const commands = [];
(function flatten(command, prefix) {
  for (const sub of command.commands) {
    const name = prefix ? `${prefix} ${sub.name()}` : sub.name();
    commands.push({
      name,
      aliases: sub.aliases(),
      description: sub.description(),
      group: sub.commands.length > 0,
      arguments: sub.registeredArguments.map((arg) => ({
        name: arg.name(),
        required: arg.required,
        variadic: arg.variadic,
        description: arg.description,
        default: arg.defaultValue,
      })),
      options: sub.options.map((opt) => ({
        flags: opt.flags,
        long: opt.long,
        short: opt.short ?? null,
        negate: opt.negate,
        description: opt.description,
        choices: opt.argChoices ?? null,
        default:
          opt.defaultValue === undefined || typeof opt.defaultValue === 'function'
            ? null
            : opt.defaultValue,
        value:
          opt.required || opt.optional
            ? (/<([^>]+)>|\[([^\]]+)\]/.exec(opt.flags)?.slice(1).find(Boolean) ?? 'value')
            : null,
        variadic: opt.variadic,
        mandatory: opt.mandatory,
      })),
    });
    flatten(sub, name);
  }
})(program, '');
const version = program.version();

// ---------- i18n ----------
const { en } = await import(pathToFileURL(path.join(build, 'dist/i18n/en.js')).href);

// ---------- sources ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const sources = walk(path.join(repo, 'src')).map((file) => ({ file, text: read(file) }));
const allText = sources.map((s) => s.text).join('\n');

// Finding ids in the code: the first argument of finding(...) and ruleId fields.
const codeRules = new Set();
for (const { text } of sources) {
  for (const m of text.matchAll(/finding\(\s*([^,]+),/g))
    for (const id of m[1].matchAll(/'([a-z][a-z0-9-]*\/[a-z0-9-]+)'/g)) codeRules.add(id[1]);
  for (const m of text.matchAll(/ruleId:\s*([^,\n]+)/g))
    for (const id of m[1].matchAll(/'([a-z][a-z0-9-]*\/[a-z0-9-]+)'/g)) codeRules.add(id[1]);
  for (const m of text.matchAll(/ruleId\s*===\s*'([a-z][a-z0-9-]*\/[a-z0-9-]+)'/g))
    codeRules.add(m[1]);
}

/** English title from the first msg('key') after the id appears in the code. */
function ruleTitle(id) {
  for (const { text } of sources) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(`'${id}'`, from);
      if (at < 0) break;
      const window = text.slice(at, at + 500);
      // push('profile/x', 'warning', 'profile.x', ...) and report('npm/x', 'info', 'npm.x', ...)
      const helper = /^'[^']+',\s*'[a-z]+',\s*'([\w.]+)'/.exec(window);
      const m = helper ?? /msg\(\s*(?:[\w.!]+\s*\?\s*)?'([\w.]+)'/.exec(window);
      if (m && en[m[1]]) return en[m[1]].replace(/\{(\w+)\}/g, '‹$1›');
      from = at + 1;
    }
  }
  return null;
}

// ---------- rules ----------
function cells(line) {
  const parts = [];
  let cur = '';
  for (let i = 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  return parts;
}
const rulesMd = read(path.join(repo, 'docs/rules.md'));
const rules = [];
const fixOnly = [];
let section = '';
let header = null;
for (const line of rulesMd.split(/\r?\n/)) {
  if (line.startsWith('## ')) {
    section = line.slice(3).trim();
    header = null;
    continue;
  }
  if (!line.startsWith('|')) {
    header = null;
    continue;
  }
  const row = cells(line);
  if (!header) {
    header = row.map((h) => h.toLowerCase());
    continue;
  }
  if (/^-+$/.test(row[0])) continue;
  const get = (name) => row[header.indexOf(name)] ?? '';
  const fixesText = get('fixes') || get('risk') || '';
  const fixes = [
    ...(get('fixes') || '').matchAll(
      /`([a-z][a-z0-9-]*\/[a-z0-9<>-]+)`\s*\((safe|review|breaking)/g,
    ),
  ].map((m) => ({ id: m[1], risk: m[2], title: ruleTitle(m[1]) }));
  if (header[0] === 'rule') {
    const id = get('rule').replace(/`/g, '');
    rules.push({
      id,
      section,
      severity: get('severity'),
      trigger: get('trigger'),
      fixesText,
      fixes,
      title: ruleTitle(id.split(' ')[0]),
      inCode: codeRules.has(id) || allText.includes(`'${id}'`),
    });
  } else if (header[0] === 'fix' || header[0] === 'fix id') {
    fixOnly.push({ id: row[0].replace(/`/g, ''), cells: row.slice(1), section });
  }
}
const docIds = new Set(rules.map((r) => r.id));
const missingInDocs = [...codeRules].filter((id) => !docIds.has(id)).sort();
const missingInCode = rules.filter((r) => !r.inCode).map((r) => r.id);

// ---------- outputs ----------
// capture-outputs.sh writes .build/out/<key>.txt, commands.tsv (key and arguments) and workspace.txt
// (the demo repository path). That path and the user folder are replaced by placeholders.
const outDir = path.join(build, 'out');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function workspacePatterns(file) {
  if (!existsSync(file)) return [];
  const forms = new Set();
  for (const line of read(file).split(/\r?\n/).filter(Boolean)) {
    const win = line.replace(/\//g, '\\');
    forms.add(win.replace(/\\/g, '\\\\')); // in JSON output
    forms.add(win);
    forms.add(line.replace(/\\/g, '/'));
  }
  return [...forms]
    .sort((x, y) => y.length - x.length)
    .map((form) => new RegExp(escapeRe(form), 'gi'));
}
const WORKSPACES = workspacePatterns(path.join(outDir, 'workspace.txt'));
const USERDIR = /[A-Z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/"\s]+/gi;
// The site is public: private names (CHANGELOG, output) become "example". The list lives only in a
// local file outside git (tools/private-words.js); without it generation stops.
const privateWords = loadPrivateWords(pres);
if (privateWords.error) {
  console.error(`! ${privateWords.error}`);
  console.error(
    '! without the private names list data.js is not safe to publish; generation stopped',
  );
  process.exit(1);
}
const redact = (text) =>
  privateWords.patterns.reduce((acc, re) => acc.replace(re, 'example'), text);
function sanitize(text) {
  for (const re of WORKSPACES)
    text = text.replace(re, (m) => {
      if (m.includes('\\\\')) return 'C:\\\\repo\\\\site-demo';
      return m.includes('\\') ? 'C:\\repo\\site-demo' : '/c/repo/site-demo';
    });
  return redact(text.replace(USERDIR, '%USERPROFILE%'))
    .replace(/https:\/\/[\w-]+\.sharepoint\.com/g, 'https://contoso.sharepoint.com')
    .replace(/\s+$/, '');
}
const outputs = {};
const listFile = path.join(outDir, 'commands.tsv');
const OUTPUTS = existsSync(listFile)
  ? read(listFile)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split('\t'))
  : [];
if (!OUTPUTS.length) console.warn('! no .build/out/commands.tsv: run capture-outputs.sh');
const LIMIT = 60;
for (const [key, cmd] of OUTPUTS) {
  const file = `${key}.txt`;
  const full = path.join(outDir, file);
  if (!existsSync(full)) {
    console.warn(`! no output ${file}`);
    continue;
  }
  const lines = sanitize(read(full)).split(/\r?\n/);
  const exitLine = lines.at(-1)?.startsWith('exit ') ? lines.pop() : undefined;
  const truncated = lines.length > LIMIT ? lines.length - LIMIT : 0;
  outputs[key] = {
    cmd: `packman ${cmd}`,
    exit: exitLine ? Number(exitLine.slice(5)) : null,
    text: lines.slice(0, LIMIT).join('\n') + (truncated ? `\n… (+${truncated} lines)` : ''),
  };
}

// ---------- changelog ----------
const changelog = [];
let release = null;
let group = null;
for (const line of read(path.join(repo, 'CHANGELOG.md')).split(/\r?\n/)) {
  if (line.startsWith('## ')) {
    release = { title: line.slice(3).trim(), groups: [] };
    group = { title: '', items: [] };
    release.groups.push(group);
    changelog.push(release);
  } else if (line.startsWith('### ') && release) {
    group = { title: line.slice(4).trim(), items: [] };
    release.groups.push(group);
  } else if (/^- /.test(line) && group) group.items.push(line.slice(2).trim());
  else if (/^\s{2,}\S/.test(line) && group?.items.length)
    group.items[group.items.length - 1] += ` ${line.trim()}`;
  else if (line.trim() && !line.startsWith('#') && group && release) group.items.push(line.trim());
}
for (const r of changelog) {
  r.groups = r.groups.filter((g) => g.items.length);
  for (const g of r.groups) g.items = g.items.map(redact);
}

// ---------- search index ----------
const pages = {
  'index.html': 'Home',
  'guide.html': 'Guide',
  'simulator.html': 'Simulator',
  'commands.html': 'Commands',
  'rules.html': 'Rules',
  'tui.html': 'TUI',
  'config.html': 'Configuration',
  'troubleshooting.html': 'Troubleshooting',
  'changelog.html': 'Changelog',
};
const strip = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const index = [];
for (const [file, title] of Object.entries(pages)) {
  const full = path.join(pres, file);
  if (!existsSync(full)) continue;
  const html = read(full);
  index.push({ t: title, p: title, u: file, k: '' });
  for (const m of html.matchAll(
    /<(h2|h3)[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>([\s\S]{0,600})/g,
  )) {
    index.push({ t: strip(m[3]), p: title, u: `${file}#${m[2]}`, k: strip(m[4]).slice(0, 220) });
  }
}

const data = {
  meta: {
    version,
    branch: 'feat/packman-3',
    generated: new Date().toISOString().slice(0, 10),
    workspace:
      'C:\\repo\\site-demo (synthetic demo repository: SPFx 1.18.2 and 1.21.1, a React library, two Vite apps in the store)',
  },
  commands,
  rules,
  fixOnly,
  outputs,
  changelog,
  index,
};
const banner = `/* global window */
// Generated by presentation/tools/build-data.js ${data.meta.generated}. Do not edit by hand:
// commands from commander (src/cli/**), rules from docs/rules.md checked against src/**, output from the synthetic demo repository.
`;
// Prettier from the repository devDependencies: the generated file passes `npm run format:check`.
const prettier = await import('prettier');
const dataFile = path.join(pres, 'assets/data.js');
const dataCode = `${banner}window.PM_DATA = ${JSON.stringify(data, null, 1)};\n`;
writeFileSync(
  dataFile,
  await prettier.format(dataCode, {
    ...((await prettier.resolveConfig(dataFile)) ?? {}),
    filepath: dataFile,
  }),
  'utf8',
);

console.log(
  `commands: ${commands.length}, rules: ${rules.length}, without a title: ${rules.filter((r) => !r.title).length}`,
);
console.log(`outputs: ${Object.keys(outputs).length}, search entries: ${index.length}`);
console.log(`in the code but not in docs/rules.md: ${missingInDocs.join(', ') || '-'}`);
console.log(`in docs/rules.md but not found in the code: ${missingInCode.join(', ') || '-'}`);
