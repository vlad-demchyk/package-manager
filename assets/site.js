/* global window, document, location, localStorage, navigator, setTimeout, URLSearchParams, IntersectionObserver */
/* packman: shared site behaviour (theme, menu, page contents, search, copy buttons, reference rendering). */
(function () {
  'use strict';
  var D = window.PM_DATA || {
    commands: [],
    rules: [],
    outputs: {},
    changelog: [],
    index: [],
    meta: {},
  };
  var N = window.PM_NOTES || { common: {}, commands: {} };

  /** Command categories, shared by the reference and the simulator. */
  var CATEGORIES = [
    {
      id: 'analyze',
      label: 'Analyze',
      commands: ['check', 'list', 'groups', 'versions', 'outdated', 'audit', 'node', 'spfx'],
    },
    {
      id: 'change',
      label: 'Change',
      commands: [
        'fix',
        'align',
        'upgrade',
        'profile apply',
        'profile generate',
        'init',
        'ignore add',
        'ignore remove',
        'ignore list',
      ],
    },
    { id: 'install', label: 'Install', commands: ['install', 'clean', 'relock'] },
    {
      id: 'store',
      label: 'Store',
      commands: [
        'store plan',
        'store link',
        'store unlink',
        'store status',
        'store verify',
        'store prune',
        'hooks install',
        'hooks uninstall',
      ],
    },
    {
      id: 'sp',
      label: 'SharePoint',
      commands: [
        'sharepoint requirements',
        'sharepoint seed',
        'sharepoint clean',
        'sharepoint test',
      ],
    },
    { id: 'service', label: 'Service', commands: ['tui', 'log', 'data status', 'data update'] },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Minimal inline markdown: `code` and **bold**. */
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function slug(s) {
    return String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  /** Display name of a command: `sharepoint` has the shorter alias `sp`. */
  function displayName(name) {
    return name.replace(/^sharepoint\b/, 'sp');
  }
  function command(name) {
    for (var i = 0; i < D.commands.length; i++)
      if (D.commands[i].name === name) return D.commands[i];
    return null;
  }
  function optionNote(cmdName, long) {
    var c = N.commands[cmdName];
    if (c && c.options && c.options[long]) return c.options[long];
    return N.common[long] || null;
  }
  /** Terminal output highlighting by packman line prefixes. */
  function colorize(text) {
    return text
      .split('\n')
      .map(function (line) {
        var e = esc(line);
        if (/^\+/.test(line)) return '<span class="c-green">' + e + '</span>';
        if (/^-(?!-)/.test(line)) return '<span class="c-red">' + e + '</span>';
        if (/^\s*(x |!! )/.test(line) || /blocker|failed|stale|drift/.test(line))
          return '<span class="c-red">' + e + '</span>';
        if (/^\s*! /.test(line) || /Dry run|blockers require|Aborted|\[y\/N\]/.test(line))
          return '<span class="c-yellow">' + e + '</span>';
        if (/^\s*i /.test(line)) return '<span class="c-cyan">' + e + '</span>';
        if (/^\s*-> |^ok\b|^\s+ok\s/.test(line)) return '<span class="c-green">' + e + '</span>';
        if (/^\s*(≠|=) /.test(line))
          return e
            .replace(/^(\s*)(≠)/, '$1<span class="c-yellow">$2</span>')
            .replace(/^(\s*)(=)/, '$1<span class="c-green">$2</span>');
        if (/^ {4,}/.test(line) && !/^\s+[-+]/.test(line))
          return '<span class="c-dim">' + e + '</span>';
        if (
          /^(packman report|Version groups|Installed Node versions|Repository migration plan)/.test(
            line,
          )
        )
          return '<span class="c-bold">' + e + '</span>';
        return e;
      })
      .join('\n');
  }

  // ---------- theme ----------
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme-toggle');
  var THEMES = ['system', 'light', 'dark'];
  var THEME_LABEL = { system: 'system', light: 'light', dark: 'dark' };
  function currentTheme() {
    return root.getAttribute('data-theme') || 'system';
  }
  function setTheme(t) {
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    try {
      if (t === 'system') localStorage.removeItem('pm-theme');
      else localStorage.setItem('pm-theme', t);
    } catch {
      /* storage unavailable: work without it */
    }
    if (themeBtn) {
      themeBtn.setAttribute('aria-label', 'Theme: ' + THEME_LABEL[t] + '. Click to change');
      themeBtn.title = 'Theme: ' + THEME_LABEL[t];
    }
  }
  if (themeBtn) {
    setTheme(currentTheme());
    themeBtn.addEventListener('click', function () {
      setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]);
    });
  }

  // ---------- menu ----------
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('main-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.focus();
      }
    });
  }

  var gen = document.getElementById('gen-date');
  if (gen && D.meta) gen.textContent = 'data from ' + (D.meta.generated || '-');

  // ---------- code blocks: copy and live output ----------
  function enhanceCode(scope) {
    var blocks = (scope || document).querySelectorAll('.code[data-output]');
    Array.prototype.forEach.call(blocks, function (block) {
      var out = D.outputs[block.getAttribute('data-output')];
      if (!out || block.querySelector('pre')) return;
      block.innerHTML =
        '<div class="label"><span>$ ' +
        esc(out.cmd) +
        (out.exit != null ? ' · exit code ' + out.exit : '') +
        ' · captured live</span></div>' +
        '<pre tabindex="0" aria-label="Output of ' +
        esc(out.cmd) +
        '"><code>' +
        colorize(out.text) +
        '</code></pre>';
    });
    var all = (scope || document).querySelectorAll('.code');
    Array.prototype.forEach.call(all, function (block) {
      if (block.querySelector('.copy')) return;
      var pre = block.querySelector('pre');
      if (!pre) return;
      var label = block.querySelector('.label');
      if (!label) {
        label = document.createElement('div');
        label.className = 'label';
        label.innerHTML = '<span>' + esc(block.getAttribute('data-lang') || 'bash') + '</span>';
        block.insertBefore(label, pre);
      }
      if (!pre.hasAttribute('tabindex') && pre.scrollWidth > pre.clientWidth)
        pre.setAttribute('tabindex', '0');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy';
      btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        var text = pre.innerText.replace(/^\$ /gm, '');
        var done = function () {
          btn.textContent = 'Copied';
          setTimeout(function () {
            btn.textContent = 'Copy';
          }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            done();
          } catch {
            /* storage unavailable: work without it */
          }
          ta.remove();
        }
      });
      label.appendChild(btn);
    });
  }

  // ---------- page contents ----------
  function buildToc() {
    var list = document.getElementById('toc-list');
    if (!list) return;
    var main = document.getElementById('main');
    var depth = main.getAttribute('data-toc') || 'h2,h3';
    var heads = main.querySelectorAll(
      depth
        .split(',')
        .map(function (h) {
          return h + '[id]';
        })
        .join(','),
    );
    list.innerHTML = '';
    var links = [];
    Array.prototype.forEach.call(heads, function (h) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.getAttribute('data-toc-label') || h.textContent;
      if (h.tagName === 'H3') a.className = 'sub';
      li.appendChild(a);
      list.appendChild(li);
      links.push({ a: a, h: h });
    });
    if (!links.length) {
      var toc = list.closest('.toc');
      if (toc) toc.hidden = true;
      return;
    }
    if ('IntersectionObserver' in window) {
      var visible = new Map();
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            visible.set(e.target, e.isIntersecting);
          });
          var active = null;
          for (var i = 0; i < links.length; i++)
            if (visible.get(links[i].h)) {
              active = links[i];
              break;
            }
          if (!active) return;
          links.forEach(function (l) {
            l.a.classList.toggle('active', l === active);
            if (l === active) l.a.setAttribute('aria-current', 'location');
            else l.a.removeAttribute('aria-current');
          });
        },
        { rootMargin: '-60px 0px -60% 0px' },
      );
      links.forEach(function (l) {
        io.observe(l.h);
      });
    }
  }

  // ---------- search ----------
  var searchIndex = null;
  function buildIndex() {
    if (searchIndex) return searchIndex;
    var items = (D.index || []).slice();
    D.commands.forEach(function (c) {
      if (c.group) return;
      var note = N.commands[c.name] || {};
      items.push({
        t: 'packman ' + displayName(c.name),
        p: 'Commands',
        u: 'commands.html#cmd-' + slug(c.name),
        k:
          (note.summary || c.description) +
          ' ' +
          c.options
            .map(function (o) {
              return o.flags;
            })
            .join(' '),
      });
      c.options.forEach(function (o) {
        var tip = optionNote(c.name, o.long);
        items.push({
          t: displayName(c.name) + ' ' + o.flags,
          p: 'Option',
          u: 'commands.html#cmd-' + slug(c.name),
          k: (tip || '') + ' ' + o.description,
        });
      });
    });
    D.rules.forEach(function (r) {
      items.push({
        t: r.id,
        p: 'Rule · ' + r.severity,
        u: 'rules.html#rule-' + slug(r.id),
        k:
          (r.title || '') +
          ' ' +
          r.trigger +
          ' ' +
          r.fixes
            .map(function (f) {
              return f.id;
            })
            .join(' '),
      });
    });
    searchIndex = items.map(function (it) {
      return {
        it: it,
        title: it.t.toLowerCase(),
        body: (it.t + ' ' + it.k + ' ' + it.p).toLowerCase(),
      };
    });
    return searchIndex;
  }
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var res = [];
    buildIndex().forEach(function (e) {
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        if (e.body.indexOf(words[i]) < 0) return;
        if (e.title.indexOf(words[i]) >= 0) score += e.title.indexOf(words[i]) === 0 ? 6 : 3;
        else score += 1;
      }
      if (e.title === q.toLowerCase()) score += 20;
      res.push({ e: e, s: score });
    });
    res.sort(function (a, b) {
      return b.s - a.s;
    });
    return res.slice(0, 40).map(function (r) {
      return r.e.it;
    });
  }
  var dialog = document.getElementById('search-dialog');
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var cursor = 0;
  function renderResults() {
    var list = search(input.value);
    cursor = 0;
    if (!input.value.trim()) {
      results.innerHTML =
        '<li class="search-empty">For example: <code>--apply</code>, <code>lockfile-drift</code>, <code>store</code>, <code>relock</code>.</li>';
      return;
    }
    if (!list.length) {
      results.innerHTML = '<li class="search-empty">Nothing found.</li>';
      return;
    }
    results.innerHTML = list
      .map(function (it, i) {
        return (
          '<li role="presentation"><a role="option" id="sr-' +
          i +
          '" href="' +
          esc(it.u) +
          '"' +
          (i === 0 ? ' aria-selected="true"' : '') +
          '>' +
          '<span class="where">' +
          esc(it.p) +
          '</span><br>' +
          esc(it.t) +
          (it.k ? '<span class="snip">' + esc(it.k.slice(0, 160)) + '</span>' : '') +
          '</a></li>'
        );
      })
      .join('');
    input.setAttribute('aria-activedescendant', 'sr-0');
  }
  function moveCursor(d) {
    var opts = results.querySelectorAll('[role="option"]');
    if (!opts.length) return;
    opts[cursor].removeAttribute('aria-selected');
    cursor = (cursor + d + opts.length) % opts.length;
    opts[cursor].setAttribute('aria-selected', 'true');
    opts[cursor].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', opts[cursor].id);
  }
  function openSearch() {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    input.value = '';
    renderResults();
    input.focus();
  }
  function closeSearch() {
    if (dialog && dialog.open) dialog.close();
  }
  if (dialog) {
    document.querySelectorAll('[data-open-search]').forEach(function (b) {
      b.addEventListener('click', openSearch);
    });
    dialog.querySelector('[data-close-search]').addEventListener('click', closeSearch);
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) closeSearch();
    });
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveCursor(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveCursor(-1);
      } else if (e.key === 'Enter') {
        var sel = results.querySelector('[aria-selected="true"]');
        if (sel) {
          e.preventDefault();
          closeSearch();
          window.location.href = sel.getAttribute('href');
        }
      }
    });
    results.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeSearch();
    });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        openSearch();
      }
    });
  }

  // ---------- Commands page ----------
  function renderCommands() {
    var host = document.getElementById('commands-list');
    if (!host) return;
    var html = '';
    CATEGORIES.forEach(function (cat) {
      html += '<h2 id="cat-' + cat.id + '">' + esc(cat.label) + '</h2>';
      cat.commands.forEach(function (name) {
        var c = command(name);
        if (!c) {
          html +=
            '<p class="callout warn">Command <code>' +
            esc(name) +
            '</code> is not in the current CLI.</p>';
          return;
        }
        var note = N.commands[name] || {};
        var args = c.arguments
          .map(function (a) {
            return (
              (a.required ? '<' : '[') +
              a.name +
              (a.variadic ? '...' : '') +
              (a.required ? '>' : ']')
            );
          })
          .join(' ');
        html +=
          '<section class="card" style="margin:14px 0" aria-labelledby="cmd-' + slug(name) + '">';
        html +=
          '<h3 id="cmd-' +
          slug(name) +
          '" style="margin-top:0"><code>packman ' +
          esc(displayName(name)) +
          '</code></h3>';
        html += '<p>' + md(note.summary || c.description) + '</p>';
        html +=
          '<p class="count">In code: <em>' +
          esc(c.description) +
          '</em>' +
          (c.aliases && c.aliases.length ? '' : '') +
          '</p>';
        html +=
          '<div class="code"><pre><code>packman ' +
          esc(displayName(name)) +
          (args ? ' ' + esc(args) : '') +
          (c.options.length ? ' [options]' : '') +
          '</code></pre></div>';
        html += '<dl class="facts">';
        if (note.reads)
          html +=
            '<dt>Reads</dt><dd><ul>' +
            note.reads
              .map(function (x) {
                return '<li>' + md(x) + '</li>';
              })
              .join('') +
            '</ul></dd>';
        if (note.writes)
          html +=
            '<dt>Writes</dt><dd><ul>' +
            note.writes
              .map(function (x) {
                return '<li>' + md(x) + '</li>';
              })
              .join('') +
            '</ul></dd>';
        if (note.confirm) html += '<dt>Asks</dt><dd>' + md(note.confirm) + '</dd>';
        if (note.exit) html += '<dt>Exit code</dt><dd>' + md(note.exit) + '</dd>';
        html += '</dl>';
        if (c.arguments.length) {
          html +=
            '<p><strong>Arguments:</strong> ' +
            c.arguments
              .map(function (a) {
                return (
                  '<code>' +
                  esc(a.name) +
                  '</code> ' +
                  esc(a.description || '') +
                  (a.default != null ? ' (default <code>' + esc(a.default) + '</code>)' : '')
                );
              })
              .join('; ') +
            '</p>';
        }
        if (c.options.length) {
          html +=
            '<div class="table-wrap"><table><thead><tr><th scope="col">Option</th><th scope="col">What it does</th><th scope="col">Default</th></tr></thead><tbody>';
          c.options.forEach(function (o) {
            var tip = optionNote(name, o.long);
            var noop = note.noop && note.noop.indexOf(o.long) >= 0;
            html +=
              '<tr><td><code>' +
              esc(o.flags) +
              '</code></td><td>' +
              (tip ? md(tip) : esc(o.description)) +
              (noop
                ? ' <span class="tag warn" title="The command accepts the option but turns this part of the analysis off itself">no effect here</span>'
                : '') +
              (o.choices
                ? '<br><span class="count">Values: ' +
                  o.choices
                    .map(function (x) {
                      return '<code>' + esc(x) + '</code>';
                    })
                    .join(' ') +
                  '</span>'
                : '') +
              '<br><span class="count">' +
              esc(o.description) +
              '</span></td><td>' +
              (o.default != null && o.default !== false
                ? '<code>' + esc(o.default) + '</code>'
                : '-') +
              '</td></tr>';
          });
          html += '</tbody></table></div>';
        }
        html +=
          '<p><a class="sim-link" href="simulator.html#cmd=' +
          encodeURIComponent(name) +
          '">Open in the simulator</a></p>';
        html += '</section>';
      });
    });
    host.innerHTML = html;
  }

  // ---------- Rules page ----------
  var SEV_LABEL = { critical: 'critical', error: 'error', warning: 'warning', info: 'info' };
  var SECTION_UK = {
    npm: 'npm (every project)',
    'Usage scan': 'Usage scan',
    'SharePoint Framework': 'SharePoint Framework',
    'Frameworks and tools': 'Frameworks and tools',
    Node: 'Node',
    Security: 'Security',
    'Groups, policy and target': 'Groups, policy and target',
    Profiles: 'Profiles',
    'Shared store': 'Shared store',
    'Fix ids without a finding': 'Fix ids without a finding',
  };
  function sevBadges(s) {
    return (
      s
        .split(/[^a-z]+/)
        .filter(function (x) {
          return SEV_LABEL[x];
        })
        .map(function (x) {
          return '<span class="badge sev-' + x + '">' + SEV_LABEL[x] + '</span>';
        })
        .join(' ') || '<span class="badge">' + esc(s) + '</span>'
    );
  }
  function renderRules() {
    var host = document.getElementById('rules-list');
    if (!host) return;
    var q = document.getElementById('rules-q');
    var chipsHost = document.getElementById('rules-prefix');
    var sevHost = document.getElementById('rules-sev');
    var countEl = document.getElementById('rules-count');
    var prefixes = [];
    D.rules.forEach(function (r) {
      var p = r.id.split('/')[0] + '/';
      if (prefixes.indexOf(p) < 0) prefixes.push(p);
    });
    var state = {
      prefix: 'all',
      sev: { critical: true, error: true, warning: true, info: true },
      q: '',
    };
    try {
      var hashQ = new URLSearchParams(location.search).get('q');
      if (hashQ) state.q = hashQ;
    } catch {
      /* storage unavailable: work without it */
    }
    q.value = state.q;
    chipsHost.innerHTML = ['all']
      .concat(prefixes)
      .map(function (p) {
        return (
          '<button type="button" class="chip" data-prefix="' +
          esc(p) +
          '" aria-pressed="' +
          (p === 'all') +
          '">' +
          (p === 'all' ? 'all' : esc(p)) +
          '</button>'
        );
      })
      .join('');
    sevHost.innerHTML = Object.keys(SEV_LABEL)
      .map(function (s) {
        return (
          '<button type="button" class="chip" data-sev="' +
          s +
          '" aria-pressed="true"><span class="sev-' +
          s +
          '">●</span> ' +
          SEV_LABEL[s] +
          '</button>'
        );
      })
      .join('');
    function draw() {
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      var shown = 0;
      var html = '';
      var section = '';
      D.rules.forEach(function (r) {
        if (state.prefix !== 'all' && r.id.indexOf(state.prefix) !== 0) return;
        var sevs = r.severity.split(/[^a-z]+/).filter(function (x) {
          return SEV_LABEL[x];
        });
        if (
          sevs.length &&
          !sevs.some(function (s) {
            return state.sev[s];
          })
        )
          return;
        var hay = (
          r.id +
          ' ' +
          (r.title || '') +
          ' ' +
          r.trigger +
          ' ' +
          r.fixesText
        ).toLowerCase();
        for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return;
        if (r.section !== section) {
          section = r.section;
          html +=
            '<h2 class="rule-section-title" id="sec-' +
            slug(section) +
            '">' +
            esc(SECTION_UK[section] || section) +
            '</h2>';
        }
        shown++;
        html +=
          '<article class="rule" id="rule-' +
          slug(r.id) +
          '" aria-labelledby="rt-' +
          slug(r.id) +
          '">' +
          '<div class="rule-head"><span class="rule-id" id="rt-' +
          slug(r.id) +
          '">' +
          esc(r.id) +
          '</span>' +
          sevBadges(r.severity) +
          '</div>' +
          (r.title ? '<p class="rule-title">' + esc(r.title) + '</p>' : '') +
          '<p class="rule-trigger"><strong>When:</strong> <span>' +
          md(r.trigger) +
          '</span></p>' +
          (r.fixes.length
            ? '<ul class="rule-fixes">' +
              r.fixes
                .map(function (f) {
                  return (
                    '<li><code>' +
                    esc(f.id) +
                    '</code> <span class="badge risk-' +
                    f.risk +
                    '">' +
                    f.risk +
                    '</span>' +
                    (f.title ? ' ' + esc(f.title) : '') +
                    '</li>'
                  );
                })
                .join('') +
              '</ul><p class="rule-trigger"><span>' +
              md(r.fixesText) +
              '</span></p>'
            : '<p class="rule-trigger"><strong>Fix:</strong> <span>' +
              md(r.fixesText || 'none') +
              '</span></p>') +
          '<div class="code"><pre><code>packman fix --rule ' +
          esc(r.id) +
          (r.fixes.some(function (f) {
            return f.risk !== 'safe';
          })
            ? ' --risk ' +
              (r.fixes.some(function (f) {
                return f.risk === 'breaking';
              })
                ? 'breaking'
                : 'review')
            : '') +
          '</code></pre></div>' +
          '</article>';
      });
      host.innerHTML = html || '<p class="callout">No rules match this filter.</p>';
      countEl.textContent = 'Showing ' + shown + ' of ' + D.rules.length;
      enhanceCode(host);
      buildToc();
    }
    q.addEventListener('input', function () {
      state.q = q.value;
      draw();
    });
    chipsHost.addEventListener('click', function (e) {
      var b = e.target.closest('[data-prefix]');
      if (!b) return;
      state.prefix = b.getAttribute('data-prefix');
      chipsHost.querySelectorAll('[data-prefix]').forEach(function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      draw();
    });
    sevHost.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sev]');
      if (!b) return;
      var s = b.getAttribute('data-sev');
      state.sev[s] = !state.sev[s];
      b.setAttribute('aria-pressed', String(state.sev[s]));
      draw();
    });
    draw();
    var fixHost = document.getElementById('fix-only');
    if (fixHost && D.fixOnly) {
      fixHost.innerHTML =
        '<div class="table-wrap"><table><thead><tr><th scope="col">Fix id</th><th scope="col">Risk</th><th scope="col">Source</th></tr></thead><tbody>' +
        D.fixOnly
          .map(function (f) {
            return (
              '<tr><td><code>' +
              esc(f.id) +
              '</code></td><td>' +
              md(f.cells[0] || '') +
              '</td><td>' +
              md(f.cells[1] || '') +
              '</td></tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    }
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  // ---------- Changelog page ----------
  function renderChangelog() {
    var host = document.getElementById('changelog-list');
    if (!host) return;
    host.innerHTML = D.changelog
      .map(function (r) {
        return (
          '<section class="release"><h2 id="rel-' +
          slug(r.title) +
          '">' +
          esc(r.title) +
          '</h2>' +
          r.groups
            .map(function (g) {
              return (
                (g.title
                  ? '<h3 id="rel-' + slug(r.title + '-' + g.title) + '">' + esc(g.title) + '</h3>'
                  : '') +
                '<ul>' +
                g.items
                  .map(function (i) {
                    return '<li>' + md(i) + '</li>';
                  })
                  .join('') +
                '</ul>'
              );
            })
            .join('') +
          '</section>'
        );
      })
      .join('');
  }

  // ---------- tabs (ARIA tabs) ----------
  function initTabs(scope) {
    (scope || document).querySelectorAll('[role="tablist"][data-tabs]').forEach(function (list) {
      var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
      function select(tab, focus) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
      }
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () {
          select(t);
        });
        t.addEventListener('keydown', function (e) {
          var k = e.key;
          var n = null;
          if (k === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
          else if (k === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (k === 'Home') n = tabs[0];
          else if (k === 'End') n = tabs[tabs.length - 1];
          else if (/^[1-9]$/.test(k) && tabs[Number(k) - 1]) n = tabs[Number(k) - 1];
          if (n) {
            e.preventDefault();
            select(n, true);
          }
        });
      });
      select(
        tabs.filter(function (t) {
          return t.getAttribute('aria-selected') === 'true';
        })[0] || tabs[0],
      );
    });
  }

  window.PM = {
    esc: esc,
    md: md,
    slug: slug,
    colorize: colorize,
    displayName: displayName,
    command: command,
    optionNote: optionNote,
    enhanceCode: enhanceCode,
    CATEGORIES: CATEGORIES,
  };

  renderCommands();
  renderChangelog();
  enhanceCode();
  initTabs();
  renderRules();
  buildToc();
})();
