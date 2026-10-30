#!/usr/bin/env node
'use strict';

// Launcher kept in plain ES5-compatible CommonJS so it starts on any Node the user has active
// (projects may pin Node 14/16/18). packman itself needs Node >= 22.12: when the active Node is
// older, the launcher looks for a newer installed one (nvm-windows, nvm, fnm, volta) and re-runs.

var path = require('path');
var fs = require('fs');
var childProcess = require('child_process');

var MIN = [22, 12, 0];
var entry = path.join(__dirname, '..', 'dist', 'cli', 'bin.js');

function parse(version) {
  var match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a, b) {
  for (var i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir).filter(function (name) {
      try {
        return fs.statSync(path.join(dir, name)).isDirectory();
      } catch (e) {
        return false;
      }
    });
  } catch (e) {
    return [];
  }
}

function candidates() {
  var env = process.env;
  var home = require('os').homedir();
  var win = process.platform === 'win32';
  var exe = win ? 'node.exe' : 'node';
  var found = [];
  function add(version, file) {
    var parsed = parse(version);
    if (parsed && fs.existsSync(file)) found.push({ version: parsed, file: file });
  }
  if (env.NVM_HOME) {
    listDirs(env.NVM_HOME).forEach(function (name) {
      add(name, path.join(env.NVM_HOME, name, exe));
    });
  }
  var nvmDir = env.NVM_DIR || path.join(home, '.nvm');
  listDirs(path.join(nvmDir, 'versions', 'node')).forEach(function (name) {
    add(name, path.join(nvmDir, 'versions', 'node', name, 'bin', 'node'));
  });
  [env.FNM_DIR, win && env.APPDATA ? path.join(env.APPDATA, 'fnm') : null, path.join(home, '.local', 'share', 'fnm')]
    .filter(Boolean)
    .forEach(function (dir) {
      var base = path.join(dir, 'node-versions');
      listDirs(base).forEach(function (name) {
        var install = path.join(base, name, 'installation');
        add(name, win ? path.join(install, exe) : path.join(install, 'bin', 'node'));
      });
    });
  var volta = env.VOLTA_HOME || (win && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Volta') : path.join(home, '.volta'));
  var voltaBase = path.join(volta, 'tools', 'image', 'node');
  listDirs(voltaBase).forEach(function (name) {
    add(name, win ? path.join(voltaBase, name, exe) : path.join(voltaBase, name, 'bin', 'node'));
  });
  return found
    .filter(function (item) {
      return compare(item.version, MIN) >= 0;
    })
    .sort(function (a, b) {
      return compare(b.version, a.version);
    });
}

if (!fs.existsSync(entry)) {
  console.error('packman is not built: run `npm run build` in ' + path.join(__dirname, '..'));
  process.exit(1);
}

var current = parse(process.version);
if (current && compare(current, MIN) >= 0) {
  // Hidden behind Function so that old Node versions can still parse this file.
  new Function('u', 'return import(u)')(require('url').pathToFileURL(entry).href).catch(function (error) {
    console.error(error);
    process.exit(1);
  });
} else {
  var best = candidates()[0];
  if (!best) {
    console.error(
      'packman requires Node >= ' + MIN.join('.') + ' (active: ' + process.version + ') and no newer installed Node was found.\n' +
        'Install one, e.g. `nvm install 24`, then run packman again. Your projects keep using their own Node versions.'
    );
    process.exit(1);
  }
  var result = childProcess.spawnSync(best.file, [entry].concat(process.argv.slice(2)), { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}
