/* global process, console, Buffer, fetch, WebSocket, setTimeout */
// Checks the site in headless Chrome/Edge over the DevTools Protocol, no dependencies (Node 22+ with WebSocket).
// node presentation/tools/check-site.js [path to chrome.exe]
// Needs the local private word list: presentation/.private-words.txt or PACKMAN_SITE_PRIVATE_WORDS.
// Checks: publicity (no private names or user paths), English only (no Cyrillic), a clean console on every page,
// navigation over file://, search, the simulator (clicks and keyboard), both themes, 375px width without horizontal
// scroll; takes screenshots into presentation/screenshots/.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPrivateWords } from './private-words.js';

const pres = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(pres, 'screenshots');
mkdirSync(shots, { recursive: true });
const browser =
  process.argv[2] ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => existsSync(p)) ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGES = [
  'index',
  'guide',
  'simulator',
  'commands',
  'rules',
  'tui',
  'config',
  'troubleshooting',
  'changelog',
];
const url = (name) => pathToFileURL(path.join(pres, `${name}.html`)).href;

// 0. The site is public: no private names (client, real projects, user) and no user paths in
// presentation/** (except screenshots/, .build/ and the list itself). The list lives only in a local file
// outside git (tools/private-words.js); without it the check fails. base64 strings are decoded and checked too.
const privateWords = loadPrivateWords(pres);
const USER_PATHS = [['C:', 'Users'].join('\\'), ['C:', 'Users'].join('/')].map((p) =>
  p.toLowerCase(),
);
const SKIP_DIRS = new Set(['screenshots', '.build', 'node_modules']);
const BASE64 = /[A-Za-z0-9+/]{8,}={0,2}/g;
function privateHit(text) {
  const lower = text.toLowerCase();
  if (USER_PATHS.some((p) => lower.includes(p))) return true;
  return privateWords.patterns.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
// 0b. The site is English only: every file that goes to git from presentation/ (tracked plus untracked
// and not ignored: pages, sources, assets, styles, tools, .gitignore) contains no Cyrillic. The one
// exception is the documented TUI confirm key: packman also accepts the Ukrainian т (and так), as
// docs/commands.md says, so a standalone т or так is allowed.
const CYRILLIC = /[\u0400-\u04FF]/;
const CONFIRM_KEY = /(^|[^\u0400-\u04FF])(\u0442|\u0442\u0430\u043a)(?=[^\u0400-\u04FF]|$)/g;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf)$/i;
function scanCyrillic() {
  const out = execFileSync(
    'git',
    ['-C', pres, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '.'],
    { encoding: 'utf8' },
  );
  const files = [...new Set(out.split('\0').filter(Boolean))].filter(
    (rel) => !BINARY.test(rel) && existsSync(path.join(pres, rel)),
  );
  const hits = [];
  for (const rel of files)
    readFileSync(path.join(pres, rel), 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (CYRILLIC.test(line.replace(CONFIRM_KEY, '$1'))) hits.push(`${rel}:${i + 1}`);
      });
  return { files: files.length, hits };
}

function scanForbidden(dir, hits) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) scanForbidden(full, hits);
      continue;
    }
    if (path.resolve(full) === path.resolve(privateWords.file)) continue;
    if (!/\.(html|js|css|sh|md|json|svg|txt)$/i.test(entry.name)) continue;
    readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        const where = `${path.relative(pres, full)}:${i + 1}`;
        if (privateHit(line)) hits.push(where);
        for (const m of line.match(BASE64) ?? [])
          if (privateHit(Buffer.from(m, 'base64').toString('latin1')))
            hits.push(`${where} (base64)`);
      });
  }
  return hits;
}

const profile = mkdtempSync(path.join(os.tmpdir(), 'pm-check-'));
const port = 9555 + Math.floor(Math.random() * 300);
const proc = spawn(
  browser,
  [
    `--headless=new`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--disable-gpu',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {
    // the browser is still starting
  }
  await sleep(200);
}
if (!target) throw new Error('the browser did not start');
console.log('browser:', browser, 'port', port);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
const listeners = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown')
    errors.push(
      `exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
    );
  if (
    msg.method === 'Runtime.consoleAPICalled' &&
    (msg.params.type === 'error' || msg.params.type === 'warning')
  )
    errors.push(
      `console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`,
    );
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error')
    errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  for (const l of listeners) l(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const load = async (href) => {
  const done = new Promise((r) =>
    listeners.push(function h(m) {
      if (m.method === 'Page.loadEventFired') {
        listeners.splice(listeners.indexOf(h), 1);
        r();
      }
    }),
  );
  await send('Page.navigate', { url: href });
  await Promise.race([done, sleep(8000)]);
  await sleep(250);
};
const viewport = (width, height = 900, mobile = false) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const scheme = (value) =>
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shot = async (file, full = false) => {
  await evaluate('window.scrollTo(0, 0)');
  await sleep(150);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full,
  });
  writeFileSync(path.join(shots, file), Buffer.from(data, 'base64'));
};
const key = async (k, code = k, keyCode = 0) => {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: k,
    code,
    windowsVirtualKeyCode: keyCode,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: k,
    code,
    windowsVirtualKeyCode: keyCode,
  });
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

if (privateWords.error) check('publicity: private word list', false, privateWords.error);
else {
  const forbidden = scanForbidden(pres, []);
  check(
    'publicity: no private names or user paths',
    forbidden.length === 0,
    forbidden.slice(0, 10).join(' | '),
  );
}

{
  const cyr = scanCyrillic();
  check(
    `English only: no Cyrillic in ${cyr.files} committable files (except the confirm key)`,
    cyr.files > 0 && cyr.hits.length === 0,
    `${cyr.hits.length} lines: ${cyr.hits.slice(0, 10).join(' | ')}`,
  );
}

try {
  // 1. Every page: console, 375px, both themes.
  for (const name of PAGES) {
    for (const [w, mode] of [
      [1280, 'light'],
      [375, 'dark'],
    ]) {
      await viewport(w, 900, w < 500);
      await scheme(mode);
      errors.length = 0;
      await load(url(name));
      const m = await evaluate(
        `({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bg: getComputedStyle(document.body).backgroundColor, title: document.title, h1: !!document.querySelector('h1') })`,
      );
      check(`${name} ${w}px ${mode}: console`, errors.length === 0, errors.join(' | '));
      check(`${name} ${w}px ${mode}: no horizontal scroll`, m.sw <= m.cw, `${m.sw} > ${m.cw}`);
      const darkBg = /rgb\((1[0-9]|2[0-9]), /.test(m.bg);
      check(`${name} ${w}px ${mode}: theme background`, mode === 'dark' ? darkBg : !darkBg, m.bg);
      if (w === 1280 && mode === 'light')
        check(
          `${name}: title "${m.title}"`,
          m.title.split(/\s+/).length >= 2 && m.title.split(/\s+/).length <= 4 && m.h1,
        );
    }
  }

  // 2. Navigation between pages over file://.
  await viewport(1280);
  await scheme('light');
  await load(url('index'));
  await evaluate(`document.querySelector('.main-nav a[href="rules.html"]').click()`);
  await sleep(700);
  const loc = await evaluate('location.href');
  check('navigation index -> rules over file://', loc.endsWith('/rules.html'), loc);
  const current = await evaluate(
    `document.querySelector('.main-nav a[aria-current="page"]').textContent`,
  );
  check('active menu item', current === 'Rules', current);

  // 3. Rules: search and filter.
  const total = await evaluate(`document.querySelectorAll('.rule').length`);
  await evaluate(
    `(() => { const q = document.getElementById('rules-q'); q.value = 'lockfile'; q.dispatchEvent(new Event('input')); })()`,
  );
  const filtered = await evaluate(`document.querySelectorAll('.rule').length`);
  check(
    'rules: search narrows the list',
    filtered > 0 && filtered < total,
    `${filtered} of ${total}`,
  );
  await evaluate(
    `(() => { const q = document.getElementById('rules-q'); q.value = ''; q.dispatchEvent(new Event('input')); document.querySelector('[data-prefix="spfx/"]').click(); })()`,
  );
  const spfx = await evaluate(
    `[...document.querySelectorAll('.rule-id')].every(e => e.textContent.startsWith('spfx/')) && document.querySelectorAll('.rule').length`,
  );
  check('rules: spfx/ filter', spfx > 0, String(spfx));
  await evaluate(
    `document.querySelector('[data-prefix="all"]').click(); document.querySelector('[data-sev="info"]').click()`,
  );
  const noInfo = await evaluate(
    `[...document.querySelectorAll('.rule .badge.sev-info')].length === [...document.querySelectorAll('.rule')].filter(r => r.querySelector('.sev-info') && !r.querySelector('.sev-error,.sev-warning,.sev-critical')).length`,
  );
  check('rules: severity filter', noInfo);
  await evaluate(`document.querySelector('[data-sev="info"]').click()`);
  await viewport(1280, 1000);
  await shot('rules.png');

  // 4. Site search.
  await key('/', 'Slash', 191);
  await sleep(200);
  const open = await evaluate(`document.getElementById('search-dialog').open`);
  check('search: / opens the dialog', open);
  await send('Input.insertText', { text: 'relock' });
  await sleep(200);
  const hits = await evaluate(`document.querySelectorAll('#search-results [role=option]').length`);
  check('search: results for relock', hits > 0, String(hits));
  await key('Enter', 'Enter', 13);
  await sleep(800);
  check(
    'search: Enter opens the result',
    /commands\.html|guide\.html|troubleshooting\.html/.test(await evaluate('location.href')),
    await evaluate('location.href'),
  );

  // 5. Simulator: clicks and keyboard.
  errors.length = 0;
  await load(url('simulator'));
  const line0 = await evaluate(`document.getElementById('sim-line').textContent`);
  check('simulator: start command', line0.trim() === '$ packman check', line0);
  await evaluate(`document.querySelector('[data-cat="change"]').click()`);
  await evaluate(`document.querySelector('[data-cmd="fix"]').click()`);
  await evaluate(`document.querySelector('[data-mode="single"]').click()`);
  await evaluate(`document.querySelector('[data-opt="--rule"]').click()`);
  const line1 = await evaluate(`document.getElementById('sim-line').textContent`);
  check(
    'simulator: fix -p apps/news-feed --rule',
    line1.includes('packman fix -p apps/news-feed --rule npm/range-spec'),
    line1,
  );
  const live = await evaluate(
    `document.querySelector('#sim-output .tag.live') !== null && document.querySelector('#sim-output pre').textContent.includes('news-feed')`,
  );
  check('simulator: live output for fix -p --rule', live);
  await evaluate(`document.querySelector('[data-opt="--apply"]').click()`);
  const warn = await evaluate(
    `document.getElementById('sim-explain').textContent.includes('[y/N]')`,
  );
  check('simulator: --apply explains the confirmation', warn);
  const hash = await evaluate('location.hash');
  check(
    'simulator: state in the hash',
    hash.includes('cmd=fix') && hash.includes('mode=single'),
    hash,
  );
  // Keyboard: focus the list, arrow down.
  await evaluate(`document.getElementById('sim-cmds').focus()`);
  await key('ArrowDown', 'ArrowDown', 40);
  const afterDown = await evaluate(
    `document.querySelector('#sim-cmds [aria-selected="true"]').dataset.cmd`,
  );
  check('simulator: ↓ selects the next command', afterDown === 'align', afterDown);
  await key('ArrowRight', 'ArrowRight', 39);
  const cat = await evaluate(
    `document.querySelector('#sim-cats [aria-selected="true"]').dataset.cat`,
  );
  check('simulator: → next group', cat === 'install', cat);
  await evaluate(
    `document.querySelector('[data-cat="store"]').click(); document.querySelector('[data-cmd="store plan"]').click(); document.querySelector('[data-opt="--union"]').click()`,
  );
  const union = await evaluate(`document.querySelector('#sim-output pre').textContent`);
  check('simulator: store plan --union shows the plan', union.includes('u-'), union.slice(0, 60));
  // Toggle from the keyboard (Space on a switch button).
  await evaluate(`document.querySelector('[data-opt="--json"]').focus()`);
  await key(' ', 'Space', 32);
  await sleep(100);
  const jsonOn = await evaluate(
    `document.querySelector('[data-opt="--json"]').getAttribute('aria-checked')`,
  );
  check('simulator: Space turns an option on', jsonOn === 'true', jsonOn);
  check('simulator: console', errors.length === 0, errors.join(' | '));
  await load(url('simulator') + '#cmd=fix&mode=single&p=apps/news-feed&o=--rule:npm/range-spec');
  await viewport(1400, 1100);
  await shot('simulator.png');
  await scheme('dark');
  await shot('simulator-dark.png');
  await scheme('light');

  // 6. Theme toggle.
  await load(url('index'));
  await evaluate(
    `document.getElementById('theme-toggle').click(); document.getElementById('theme-toggle').click()`,
  );
  const theme = await evaluate(
    `document.documentElement.dataset.theme + '|' + getComputedStyle(document.body).backgroundColor`,
  );
  check('theme: toggle system -> light -> dark', theme.startsWith('dark|rgb(17'), theme);
  await evaluate(`document.getElementById('theme-toggle').click()`);
  await viewport(1280, 900);
  await shot('home.png');
  await viewport(375, 812, true);
  await shot('home-375.png');
  await load(url('simulator'));
  await shot('simulator-375.png');
} finally {
  ws.close();
  proc.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // the profile is still held by the browser
  }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
