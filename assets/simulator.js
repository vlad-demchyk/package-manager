/* global window, document, location, history, URLSearchParams */
/* packman command simulator: a TUI-like builder. Options come from PM_DATA.commands (commander),
   explanations from PM_NOTES, output from PM_DATA.outputs (captured live on the synthetic demo repository). */
(function () {
  'use strict';
  var D = window.PM_DATA;
  var N = window.PM_NOTES;
  var PM = window.PM;
  var host = document.getElementById('simulator');
  if (!host || !D || !PM) return;
  var esc = PM.esc;
  var md = PM.md;

  var ALL = [];
  PM.CATEGORIES.forEach(function (cat) {
    cat.commands.forEach(function (name) {
      if (PM.command(name)) ALL.push({ name: name, cat: cat.id });
    });
  });

  var state = {
    cat: 'analyze',
    cmd: 'check',
    mode: 'all',
    target: { single: N.modes.single.sample, group: N.modes.group.sample },
    opts: {},
    args: {},
  };

  function cmdData() {
    return PM.command(state.cmd);
  }
  function note() {
    return N.commands[state.cmd] || {};
  }
  function hasProject(c) {
    return c.options.some(function (o) {
      return o.long === '--project';
    });
  }
  function simOptions(c) {
    return c.options.filter(function (o) {
      return o.long !== '--project';
    });
  }
  function sampleFor(o) {
    var n = note();
    if (n.samples && n.samples[o.long]) return n.samples[o.long];
    if (o.choices) return o.default != null ? String(o.default) : o.choices[0];
    if (o.default != null && o.default !== false && o.default !== true) return String(o.default);
    if (o.long === '--exclude') return 'legacy-*';
    if (o.long === '--depth') return '2';
    return o.value || 'value';
  }
  function quote(v) {
    return /[\s*?{}]/.test(v) && !/^".*"$/.test(v) ? '"' + v + '"' : v;
  }

  // ---------- state in the hash ----------
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    var cmd = p.get('cmd');
    if (cmd && PM.command(cmd) && !PM.command(cmd).group) {
      state.cmd = cmd;
      ALL.forEach(function (x) {
        if (x.name === cmd) state.cat = x.cat;
      });
    }
    var mode = p.get('mode');
    if (mode === 'single' || mode === 'group' || mode === 'all') state.mode = mode;
    if (p.get('p') && state.mode !== 'all') state.target[state.mode] = p.get('p');
    state.opts = {};
    (p.get('o') || '')
      .split(',')
      .filter(Boolean)
      .forEach(function (pair) {
        var i = pair.indexOf(':');
        var long = i < 0 ? pair : pair.slice(0, i);
        state.opts[long] = { on: true, value: i < 0 ? null : pair.slice(i + 1) };
      });
  }
  function writeHash() {
    var p = new URLSearchParams();
    p.set('cmd', state.cmd);
    if (state.mode !== 'all') {
      p.set('mode', state.mode);
      p.set('p', state.target[state.mode]);
    }
    var o = Object.keys(state.opts)
      .filter(function (k) {
        return state.opts[k].on;
      })
      .map(function (k) {
        return state.opts[k].value != null ? k + ':' + state.opts[k].value : k;
      });
    if (o.length) p.set('o', o.join(','));
    try {
      history.replaceState(null, '', '#' + p.toString());
    } catch {
      /* storage unavailable: work without it */
    }
  }

  // ---------- command line ----------
  function buildLine() {
    var c = cmdData();
    var parts = ['packman', PM.displayName(c.name)];
    c.arguments.forEach(function (a) {
      var v = state.args[a.name];
      if (a.required) parts.push(v || (note().args && note().args[a.name]) || '<' + a.name + '>');
      else if (v && v !== '.') parts.push(quote(v));
    });
    if (hasProject(c) && state.mode !== 'all') parts.push('-p', quote(state.target[state.mode]));
    simOptions(c).forEach(function (o) {
      var s = state.opts[o.long];
      if (!s || !s.on) return;
      var flag = o.long;
      if (o.value && !o.negate) {
        var v = s.value != null && s.value !== '' ? s.value : sampleFor(o);
        parts.push(flag, o.variadic ? v : quote(v));
      } else parts.push(flag);
    });
    return parts.join(' ');
  }

  // ---------- live output choice ----------
  function matches(need) {
    return need.every(function (t) {
      if (t === '@single') return state.mode === 'single';
      if (t === '@group') return state.mode === 'group';
      if (t[0] === '!') return !(state.opts[t.slice(1)] && state.opts[t.slice(1)].on);
      var i = t.indexOf('=');
      var long = i < 0 ? t : t.slice(0, i);
      var s = state.opts[long];
      if (!s || !s.on) return false;
      if (i < 0) return true;
      var o = cmdData().options.filter(function (x) {
        return x.long === long;
      })[0];
      var v = s.value != null && s.value !== '' ? s.value : o ? sampleFor(o) : '';
      return v === t.slice(i + 1);
    });
  }
  function pickOutput() {
    var list = note().out || [];
    for (var i = 0; i < list.length; i++)
      if (matches(list[i].need) && D.outputs[list[i].key]) return D.outputs[list[i].key];
    return null;
  }

  // ---------- render ----------
  var els = {};
  function skeleton() {
    host.innerHTML =
      '<div class="sim">' +
      '<section class="tui" aria-label="Command builder">' +
      '<div class="tui-bar"><span><b>packman</b> simulator</span><span>' +
      esc(D.meta.version) +
      '</span></div>' +
      '<div class="tui-tabs" role="tablist" aria-label="Command groups" id="sim-cats"></div>' +
      '<div class="tui-section"><div class="tui-h" id="sim-cmds-h">Command</div>' +
      '<ul class="tui-list" id="sim-cmds" role="listbox" tabindex="0" aria-labelledby="sim-cmds-h"></ul></div>' +
      '<div class="tui-section"><div class="tui-h" id="sim-mode-h">Mode</div>' +
      '<div class="tui-radios" id="sim-mode" role="radiogroup" aria-labelledby="sim-mode-h"></div>' +
      '<div class="tui-arg" id="sim-target"></div></div>' +
      '<div class="tui-section" id="sim-args-wrap"><div class="tui-h">Arguments</div><div id="sim-args"></div></div>' +
      '<div class="tui-section"><div class="tui-h" id="sim-opts-h">Options</div><div id="sim-opts" role="group" aria-labelledby="sim-opts-h"></div></div>' +
      '<div class="tui-keys"><b>←→</b> groups · <b>↑↓</b> command · <b>Tab</b> next · <b>Space</b> option · <b>R</b> reset</div>' +
      '</section>' +
      '<div class="sim-out">' +
      '<div class="code" aria-live="polite"><div class="label"><span>Command line</span></div><pre><code class="cmdline" id="sim-line"></code></pre></div>' +
      '<section class="card explain" id="sim-explain" aria-live="polite"></section>' +
      '<section class="output" id="sim-output" aria-label="Sample output"></section>' +
      '</div></div>';
    [
      'sim-cats',
      'sim-cmds',
      'sim-mode',
      'sim-target',
      'sim-args',
      'sim-args-wrap',
      'sim-opts',
      'sim-line',
      'sim-explain',
      'sim-output',
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  function renderCats() {
    els['sim-cats'].innerHTML = PM.CATEGORIES.map(function (cat, i) {
      var on = cat.id === state.cat;
      return (
        '<button type="button" class="tui-tab" role="tab" id="cat-tab-' +
        cat.id +
        '" data-cat="' +
        cat.id +
        '" aria-selected="' +
        on +
        '" aria-controls="sim-cmds" tabindex="' +
        (on ? 0 : -1) +
        '">' +
        (i + 1) +
        ' ' +
        esc(cat.label) +
        '</button>'
      );
    }).join('');
  }
  function catCommands() {
    return ALL.filter(function (x) {
      return x.cat === state.cat;
    });
  }
  function renderCmds() {
    var list = catCommands();
    els['sim-cmds'].innerHTML = list
      .map(function (x) {
        var c = PM.command(x.name);
        var n = N.commands[x.name] || {};
        var on = x.name === state.cmd;
        return (
          '<li role="option" id="opt-' +
          PM.slug(x.name) +
          '" data-cmd="' +
          esc(x.name) +
          '" aria-selected="' +
          on +
          '"><span>' +
          esc(PM.displayName(x.name)) +
          '</span><span class="d">' +
          esc((n.summary || c.description).replace(/`/g, '').slice(0, 70)) +
          '</span></li>'
        );
      })
      .join('');
    els['sim-cmds'].setAttribute('aria-activedescendant', 'opt-' + PM.slug(state.cmd));
  }
  function renderMode() {
    var c = cmdData();
    var can = hasProject(c);
    var modes = ['all', 'single', 'group'];
    els['sim-mode'].innerHTML = modes
      .map(function (m) {
        var on = state.mode === m;
        return (
          '<button type="button" class="tui-radio" role="radio" data-mode="' +
          m +
          '" aria-checked="' +
          on +
          '" tabindex="' +
          (on ? 0 : -1) +
          '"' +
          (can || m === 'all' ? '' : ' disabled aria-disabled="true"') +
          '>' +
          esc(N.modes[m].label) +
          '</button>'
        );
      })
      .join('');
    if (can && state.mode !== 'all') {
      els['sim-target'].innerHTML =
        '<label for="sim-target-in">-p</label><input id="sim-target-in" type="text" value="' +
        esc(state.target[state.mode]) +
        '" aria-describedby="sim-mode-h">';
      els['sim-target'].hidden = false;
    } else {
      els['sim-target'].innerHTML = can
        ? ''
        : '<span class="d" style="color:var(--term-dim)">The command has no <code>-p</code>: it works on the whole workspace.</span>';
      els['sim-target'].hidden = can;
    }
  }
  function renderArgs() {
    var c = cmdData();
    if (!c.arguments.length) {
      els['sim-args-wrap'].hidden = true;
      return;
    }
    els['sim-args-wrap'].hidden = false;
    els['sim-args'].innerHTML = c.arguments
      .map(function (a) {
        var v =
          state.args[a.name] != null
            ? state.args[a.name]
            : a.required
              ? (note().args && note().args[a.name]) || ''
              : '';
        return (
          '<div class="tui-arg"><label for="arg-' +
          esc(a.name) +
          '">' +
          esc(a.name) +
          (a.required ? '' : ' (optional)') +
          '</label><input id="arg-' +
          esc(a.name) +
          '" data-arg="' +
          esc(a.name) +
          '" type="text" value="' +
          esc(v) +
          '" placeholder="' +
          esc(a.default != null ? a.default : '') +
          '"></div>'
        );
      })
      .join('');
  }
  function renderOpts() {
    var c = cmdData();
    var n = note();
    els['sim-opts'].innerHTML =
      simOptions(c)
        .map(function (o) {
          var s = state.opts[o.long] || {};
          var on = !!s.on;
          var noop = n.noop && n.noop.indexOf(o.long) >= 0;
          var id = 'o-' + PM.slug(o.long);
          var html =
            '<div class="tui-opt"><button type="button" class="tui-switch" role="switch" id="' +
            id +
            '" data-opt="' +
            esc(o.long) +
            '" aria-checked="' +
            on +
            '" aria-describedby="' +
            id +
            '-d">' +
            '<span>' +
            esc(o.flags) +
            '</span>' +
            (noop ? '<span class="noop">(no effect here)</span>' : '') +
            '</button>' +
            '<span class="visually-hidden" id="' +
            id +
            '-d">' +
            esc((PM.optionNote(state.cmd, o.long) || o.description).replace(/`/g, '')) +
            '</span>';
          if (on && o.value && !o.negate) {
            var v = s.value != null ? s.value : sampleFor(o);
            html += '<div class="tui-value"><label for="' + id + '-v">=</label>';
            if (o.choices) {
              html +=
                '<select id="' +
                id +
                '-v" data-val="' +
                esc(o.long) +
                '">' +
                o.choices
                  .map(function (ch) {
                    return '<option' + (ch === v ? ' selected' : '') + '>' + esc(ch) + '</option>';
                  })
                  .join('') +
                '</select>';
            } else
              html +=
                '<input id="' +
                id +
                '-v" data-val="' +
                esc(o.long) +
                '" type="text" value="' +
                esc(v) +
                '">';
            html += '</div>';
          }
          return html + '</div>';
        })
        .join('') || '<span style="color:var(--term-dim)">No options.</span>';
  }

  function list(items) {
    return (
      '<ul>' +
      items
        .map(function (x) {
          return '<li>' + md(x) + '</li>';
        })
        .join('') +
      '</ul>'
    );
  }
  function renderRight() {
    var c = cmdData();
    var n = note();
    var line = buildLine();
    els['sim-line'].innerHTML = '<span class="prompt">$</span> ' + esc(line);
    var on = function (l) {
      return state.opts[l] && state.opts[l].on;
    };
    var hasApply = c.options.some(function (o) {
      return o.long === '--apply';
    });
    var hasWrite = c.options.some(function (o) {
      return o.long === '--write';
    });
    var notes = [];
    if (hasApply && !on('--apply'))
      notes.push([
        '',
        'Dry run: the command shows a diff and writes nothing. Turn on `--apply` to write.',
      ]);
    if (hasApply && on('--apply'))
      notes.push([
        'warn',
        'Writing is on: every changed file is backed up to `.packman/backups/<time>/` and the operation goes to the journal.' +
          (on('--yes')
            ? ''
            : ' It asks `[y/N]` before writing; without an interactive terminal the answer is always "no", so add `-y` in CI.'),
      ]);
    if (hasWrite && !on('--write'))
      notes.push(['', 'Without `--write` the result is only printed.']);
    if (
      !hasApply &&
      /yes|does not ask/.test(n.confirm || '') &&
      !/^nothing/.test((n.writes || [''])[0])
    )
      notes.push([
        'warn',
        'The command changes files without `--apply`.' +
          (/does not ask/.test(n.confirm)
            ? ' It does not ask for confirmation.'
            : on('--yes')
              ? ' Confirmation is turned off by `-y`.'
              : ' It asks `[y/N]` first.'),
      ]);
    if (state.mode === 'single') notes.push(['', N.modes.single.hint]);
    if (state.mode === 'group') notes.push(['', N.modes.group.hint]);
    if (on('--relock') && on('--no-relock'))
      notes.push([
        'warn',
        '`--relock` and `--no-relock` set the same field: the last one on the line wins.',
      ]);
    if (state.cmd === 'upgrade' && on('--json') && on('--apply'))
      notes.push([
        'danger',
        'packman rejects `--json` together with `--apply`: JSON is read-only.',
      ]);
    if (state.cmd === 'store link' && !on('--group') && !on('--of'))
      notes.push([
        'danger',
        'Without `--group` or `--of` the command exits with code 1: "Pass --group <key> or --of <project>."',
      ]);
    if (state.cmd === 'align' && !on('--base') && !on('--package'))
      notes.push(['danger', 'Needs `--base` (with `--to`) or `--package`, otherwise exit code 1.']);

    var chosen = simOptions(c).filter(function (o) {
      return on(o.long);
    });
    var html =
      '<h3>' +
      esc('packman ' + PM.displayName(c.name)) +
      '</h3><p>' +
      md(n.summary || c.description) +
      '</p>';
    html +=
      '<dl class="facts">' +
      (n.reads ? '<dt>Reads</dt><dd>' + list(n.reads) + '</dd>' : '') +
      (n.writes ? '<dt>Writes</dt><dd>' + list(n.writes) + '</dd>' : '') +
      (n.confirm ? '<dt>Asks</dt><dd>' + md(n.confirm) + '</dd>' : '') +
      (n.exit ? '<dt>Exit code</dt><dd>' + md(n.exit) + '</dd>' : '') +
      '</dl>';
    html += notes
      .map(function (x) {
        return '<div class="callout ' + x[0] + '"><p>' + md(x[1]) + '</p></div>';
      })
      .join('');
    if (chosen.length || (state.mode !== 'all' && hasProject(c))) {
      html += '<h3 style="margin-top:14px">Selected options</h3><ul class="opts">';
      if (state.mode !== 'all' && hasProject(c))
        html +=
          '<li><code>-p ' +
          esc(state.target[state.mode]) +
          '</code>: ' +
          md(N.common['--project']) +
          '</li>';
      chosen.forEach(function (o) {
        var noop = n.noop && n.noop.indexOf(o.long) >= 0;
        html +=
          '<li><code>' +
          esc(o.long) +
          '</code>: ' +
          md(PM.optionNote(state.cmd, o.long) || o.description) +
          (noop ? ' <span class="tag warn">no effect here</span>' : '') +
          '</li>';
      });
      html += '</ul>';
    }
    els['sim-explain'].innerHTML = html;

    var out = pickOutput();
    var o;
    if (out) {
      var exact = out.cmd === line;
      o =
        '<p>' +
        (exact
          ? '<span class="tag live">captured live</span>'
          : '<span class="tag live">captured live</span> <span class="tag">closest run</span>') +
        ' <span class="count">synthetic demo repository, paths replaced</span></p>' +
        '<div class="code"><div class="label"><span>$ ' +
        esc(out.cmd) +
        (out.exit != null ? ' · exit code ' + out.exit : '') +
        '</span></div><pre tabindex="0"><code>' +
        PM.colorize(out.text) +
        '</code></pre></div>';
    } else if (n.sample) {
      o =
        '<p><span class="tag warn">illustration from code</span> <span class="count">not captured live: the command changes files, runs npm or needs a SharePoint site; site names are neutral examples</span></p>' +
        '<div class="code"><div class="label"><span>$ ' +
        esc(line) +
        '</span></div><pre tabindex="0"><code>' +
        PM.colorize(n.sample.join('\n')) +
        '</code></pre></div>';
    } else {
      o =
        '<p class="callout">No live output for this command: it changes files, is interactive or needs the network or a site, and only read-only runs were captured.</p>';
    }
    els['sim-output'].innerHTML = '<h3 style="margin:0 0 6px">Sample output</h3>' + o;
    PM.enhanceCode(els['sim-output']);
    PM.enhanceCode(els['sim-line'].closest('.code').parentNode);
    writeHash();
  }
  function renderAll() {
    renderCats();
    renderCmds();
    renderMode();
    renderArgs();
    renderOpts();
    renderRight();
  }

  function selectCmd(name, keepFocus) {
    if (state.cmd !== name) {
      state.cmd = name;
      state.opts = {};
      state.args = {};
      if (!hasProject(cmdData())) state.mode = 'all';
    }
    renderCmds();
    renderMode();
    renderArgs();
    renderOpts();
    renderRight();
    if (keepFocus) els['sim-cmds'].focus();
  }

  // ---------- events ----------
  function bind() {
    els['sim-cats'].addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (!b) return;
      setCat(b.getAttribute('data-cat'), false);
    });
    els['sim-cats'].addEventListener('keydown', function (e) {
      var ids = PM.CATEGORIES.map(function (c) {
        return c.id;
      });
      var i = ids.indexOf(state.cat);
      var n = null;
      if (e.key === 'ArrowRight') n = ids[(i + 1) % ids.length];
      else if (e.key === 'ArrowLeft') n = ids[(i - 1 + ids.length) % ids.length];
      else if (e.key === 'Home') n = ids[0];
      else if (e.key === 'End') n = ids[ids.length - 1];
      if (n) {
        e.preventDefault();
        setCat(n, true);
      }
    });
    els['sim-cmds'].addEventListener('click', function (e) {
      var li = e.target.closest('[data-cmd]');
      if (li) selectCmd(li.getAttribute('data-cmd'), true);
    });
    els['sim-cmds'].addEventListener('keydown', function (e) {
      var list = catCommands().map(function (x) {
        return x.name;
      });
      var i = list.indexOf(state.cmd);
      var n = null;
      if (e.key === 'ArrowDown' || e.key === 'j') n = list[Math.min(list.length - 1, i + 1)];
      else if (e.key === 'ArrowUp' || e.key === 'k') n = list[Math.max(0, i - 1)];
      else if (e.key === 'Home') n = list[0];
      else if (e.key === 'End') n = list[list.length - 1];
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        var ids = PM.CATEGORIES.map(function (c) {
          return c.id;
        });
        var ci = ids.indexOf(state.cat);
        e.preventDefault();
        setCat(ids[(ci + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length], false);
        els['sim-cmds'].focus();
        return;
      }
      if (n) {
        e.preventDefault();
        selectCmd(n, true);
        var el = document.getElementById('opt-' + PM.slug(n));
        if (el) el.scrollIntoView({ block: 'nearest' });
      }
    });
    els['sim-mode'].addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (!b || b.disabled) return;
      setMode(b.getAttribute('data-mode'));
    });
    els['sim-mode'].addEventListener('keydown', function (e) {
      if (!hasProject(cmdData())) return;
      var modes = ['all', 'single', 'group'];
      var i = modes.indexOf(state.mode);
      var n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = modes[(i + 1) % 3];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = modes[(i + 2) % 3];
      if (n) {
        e.preventDefault();
        setMode(n);
        els['sim-mode'].querySelector('[data-mode="' + n + '"]').focus();
      }
    });
    host.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id === 'sim-target-in') state.target[state.mode] = t.value;
      else if (t.hasAttribute('data-arg')) state.args[t.getAttribute('data-arg')] = t.value;
      else if (t.hasAttribute('data-val')) {
        var s = state.opts[t.getAttribute('data-val')];
        if (s) s.value = t.value;
      } else return;
      renderRight();
    });
    els['sim-opts'].addEventListener('click', function (e) {
      var b = e.target.closest('[data-opt]');
      if (!b) return;
      var long = b.getAttribute('data-opt');
      var s = state.opts[long] || (state.opts[long] = { on: false, value: null });
      s.on = !s.on;
      if (s.on && s.value == null) {
        var opt = simOptions(cmdData()).filter(function (x) {
          return x.long === long;
        })[0];
        if (opt && opt.value && !opt.negate) s.value = sampleFor(opt);
      }
      // --relock / --no-relock and --sync-locks pairs: one of the two.
      var twin = long === '--relock' ? '--no-relock' : long === '--no-relock' ? '--relock' : null;
      if (s.on && twin && state.opts[twin]) state.opts[twin].on = false;
      renderOpts();
      renderRight();
      var again = document.getElementById(b.id);
      if (again) again.focus();
      var val = s.on && document.getElementById(b.id + '-v');
      if (val && e.detail === 0) {
        /* keyboard: focus stays on the toggle */
      }
    });
    host.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (
        (e.key === 'r' || e.key === 'R') &&
        tag !== 'input' &&
        tag !== 'select' &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        state.opts = {};
        state.args = {};
        state.mode = 'all';
        renderAll();
      }
    });
  }
  function setCat(id, focusTab) {
    state.cat = id;
    var first = catCommands()[0];
    if (
      first &&
      !catCommands().some(function (x) {
        return x.name === state.cmd;
      })
    ) {
      state.cmd = first.name;
      state.opts = {};
      state.args = {};
      if (!hasProject(cmdData())) state.mode = 'all';
    }
    renderAll();
    if (focusTab) document.getElementById('cat-tab-' + id).focus();
  }
  function setMode(m) {
    state.mode = m;
    renderMode();
    renderRight();
  }

  readHash();
  skeleton();
  renderAll();
  bind();
  window.addEventListener('hashchange', function () {
    var before = location.hash;
    readHash();
    renderAll();
    if (location.hash !== before) return;
  });
})();
