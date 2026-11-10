/* global console */
// Builds presentation/*.html from the fragments in presentation/src/*.html and a shared template
// (header with navigation, page contents, footer). Every page is self-contained and opens from file://.
// Run: node presentation/tools/build-pages.js  (then build-data.js to refresh the search index)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prettier = await import('prettier');
const pres = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(pres, '..', 'package.json'), 'utf8'));

export const NAV = [
  ['index.html', 'Home'],
  ['guide.html', 'Guide'],
  ['simulator.html', 'Simulator'],
  ['commands.html', 'Commands'],
  ['rules.html', 'Rules'],
  ['tui.html', 'TUI'],
  ['config.html', 'Configuration'],
  ['troubleshooting.html', 'Troubleshooting'],
  ['changelog.html', 'Changelog'],
];

const icon = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  theme:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

function page(file, meta, body) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('\n        ');
  const layout = meta.layout ?? 'toc';
  const scripts = ['assets/data.js', 'assets/notes.js', 'assets/site.js', ...(meta.scripts ?? [])]
    .map((src) => `<script src="${src}"></script>`)
    .join('\n  ');
  const toc =
    layout === 'toc'
      ? `<nav class="toc" aria-label="Page sections"><details open><summary class="visually-hidden">Sections</summary><h2>On this page</h2><ol id="toc-list"></ol></details></nav>\n    `
      : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${meta.title}</title>
  <meta name="description" content="${meta.description}">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231f6f43'/%3E%3Ctext x='16' y='22' font-family='monospace' font-size='16' font-weight='700' text-anchor='middle' fill='white'%3Epm%3C/text%3E%3C/svg%3E">
  <script>try{var t=localStorage.getItem('pm-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
  <link rel="stylesheet" href="assets/site.css">
</head>
<body data-page="${file.replace('.html', '')}">
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">pm</span>packman <small>${pkg.version}</small></a>
      <button class="icon-btn menu-btn" type="button" aria-expanded="false" aria-controls="main-nav" aria-label="Menu">${icon.menu}</button>
      <nav class="main-nav" id="main-nav" aria-label="Site sections">
        ${nav}
      </nav>
      <div class="header-tools">
        <button class="icon-btn search-btn" type="button" data-open-search aria-haspopup="dialog">${icon.search}<span class="label">Search</span><kbd>/</kbd></button>
        <button class="icon-btn" type="button" id="theme-toggle" aria-label="Theme: system" title="Switch theme">${icon.theme}</button>
      </div>
    </div>
  </header>
  <div class="page${layout === 'toc' ? ' with-toc' : ''}${meta.wide ? ' wide' : ''}">
    ${toc}<main id="main" class="content" tabindex="-1">
${body.trim()}
    </main>
  </div>
  <footer class="site-footer">
    <div class="footer-inner">
      <span>packman ${pkg.version} · branch <code>feat/packman-3</code> · license ${pkg.license}</span>
      <span>Generated from the code (<code>src/cli/**</code>, <code>docs/rules.md</code>) · <span id="gen-date"></span></span>
    </div>
  </footer>
  <dialog class="search" id="search-dialog" aria-label="Site search">
    <div class="search-head">
      <label class="visually-hidden" for="search-input">Search for</label>
      <input id="search-input" type="search" placeholder="Command, option, rule, message..." autocomplete="off" role="combobox" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list">
      <button class="icon-btn" type="button" data-close-search aria-label="Close search">Esc</button>
    </div>
    <ul class="search-results" id="search-results" role="listbox" aria-label="Results"></ul>
  </dialog>
  ${scripts}
</body>
</html>
`;
}

const srcDir = path.join(pres, 'src');
for (const name of readdirSync(srcDir).filter((f) => f.endsWith('.html'))) {
  const text = readFileSync(path.join(srcDir, name), 'utf8');
  const match = /^<!--\s*([\s\S]*?)-->\s*/.exec(text);
  if (!match) throw new Error(`${name}: missing metadata block`);
  const meta = JSON.parse(match[1]);
  const words = meta.title.split(/\s+/).length;
  if (words < 2 || words > 4) throw new Error(`${name}: title must be 2-4 words`);
  const file = path.join(pres, name);
  // Prettier from the repository devDependencies: pages pass `npm run format:check`.
  const html = await prettier.format(page(name, meta, text.slice(match[0].length)), {
    ...((await prettier.resolveConfig(file)) ?? {}),
    filepath: file,
  });
  writeFileSync(file, html, 'utf8');
  console.log(`${name}: ${meta.title}`);
}
