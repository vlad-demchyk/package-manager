#!/usr/bin/env node

/**
 * Unused dependencies analyzer and cleaner
 * - Uses npx depcheck --json to detect unused deps per component
 * - Adds safety whitelist based on config files and package.json scripts
 * - Supports --yes, --dry-run, --json, --single, --exclude
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("../utils/logger");
const crypto = require("crypto");
const { builtinModules } = require("module");

const projectRoot = process.cwd();
let projectConfig = {};
try {
  projectConfig = require(path.join(projectRoot, "package-manager/project-config"));
} catch (_) {
  projectConfig = {
    files: { packageJson: "package.json" },
    components: {
      filterByPrefix: { enabled: false, prefix: "" },
      filterByStructure: { enabled: false, requiredFiles: ["package.json"], requiredFolders: ["src"] },
      filterByList: { enabled: false, folders: [] },
      filterByRegex: { enabled: false, pattern: { test: () => true } },
    },
  };
}

function isWindows() {
  return process.platform === "win32";
}

function getNpmCommand() {
  try {
    if (projectConfig.commands && projectConfig.commands.npm) {
      return isWindows() ? projectConfig.commands.npm.windows : projectConfig.commands.npm.unix;
    }
  } catch (_) {}
  return isWindows() ? "npm.cmd" : "npm";
}

function listComponents() {
  const items = fs.readdirSync(projectRoot);
  return items.filter((item) => {
    const fullPath = path.join(projectRoot, item);
    if (!fs.statSync(fullPath).isDirectory()) return false;

    if (projectConfig.components?.filterByPrefix?.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) return false;
    }

    if (projectConfig.components?.filterByStructure?.enabled) {
      const requiredFiles = projectConfig.components.filterByStructure.requiredFiles || [];
      const requiredFolders = projectConfig.components.filterByStructure.requiredFolders || [];
      for (const f of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, f))) return false;
      }
      for (const d of requiredFolders) {
        const p = path.join(fullPath, d);
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) return false;
      }
    }

    if (projectConfig.components?.filterByList?.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) return false;
    }

    if (projectConfig.components?.filterByRegex?.enabled) {
      const rx = projectConfig.components.filterByRegex.pattern;
      if (rx && typeof rx.test === "function" && !rx.test(item)) return false;
    }

    return fs.existsSync(path.join(fullPath, projectConfig.files?.packageJson || "package.json"));
  });
}

function loadPkgJson(dir) {
  const pkgPath = path.join(dir, "package.json");
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function detectConfigFiles(dir) {
  const candidates = [
    "webpack.config.js",
    "webpack.config.cjs",
    "vite.config.js",
    "vite.config.ts",
    "rollup.config.js",
    "babel.config.js",
    ".babelrc",
    "jest.config.js",
    "karma.conf.js",
    "tsconfig.json",
    "vue.config.js",
    "next.config.js",
    "nuxt.config.js",
    "gulpfile.js",
    "postcss.config.js",
    "tailwind.config.js",
    ".eslintrc",
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    "eslint.config.js",
    "eslint.config.cjs",
    ".prettierrc",
    ".prettierrc.js",
    // SPFx specific
    path.join("config", "package-solution.json"),
  ];
  const present = new Set();
  for (const f of candidates) {
    const p = path.isAbsolute(f) ? f : path.join(dir, f);
    if (fs.existsSync(p)) present.add(f);
  }
  return present;
}

function buildWhitelist(dir, pkg) {
  const keep = new Set();
  const cfgs = detectConfigFiles(dir);

  // Config-driven keeps
  if (cfgs.has("webpack.config.js") || cfgs.has("webpack.config.cjs")) {
    keep.add("webpack");
    keep.add("webpack-cli");
  }
  if (["vite.config.js", "vite.config.ts"].some((f) => cfgs.has(f))) {
    keep.add("vite");
  }
  if (cfgs.has("babel.config.js") || cfgs.has(".babelrc")) {
    keep.add("@babel/core");
    keep.add("babel-loader");
  }
  if (cfgs.has("jest.config.js")) keep.add("jest");
  if (cfgs.has("karma.conf.js")) keep.add("karma");
  if (cfgs.has("tsconfig.json")) { keep.add("typescript"); keep.add("tslib"); }
  if (cfgs.has("vue.config.js")) keep.add("@vue/cli-service");
  if (cfgs.has("next.config.js")) keep.add("next");
  if (cfgs.has("nuxt.config.js")) keep.add("nuxt");
  if (cfgs.has("gulpfile.js")) keep.add("gulp");
  if (cfgs.has("postcss.config.js")) keep.add("postcss");
  if (cfgs.has("tailwind.config.js")) keep.add("tailwindcss");
  // ESLint ecosystem
  if (
    cfgs.has(".eslintrc") ||
    cfgs.has(".eslintrc.json") ||
    cfgs.has(".eslintrc.js") ||
    cfgs.has(".eslintrc.cjs") ||
    cfgs.has("eslint.config.js") ||
    cfgs.has("eslint.config.cjs")
  ) {
    keep.add("eslint");
    const all = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    Object.keys(all).forEach((name) => {
      if (/^@microsoft\/eslint-/.test(name)) keep.add(name);
      if (/^eslint-/.test(name)) keep.add(name);
    });
  }

  // Script-based keeps
  const scripts = (pkg && pkg.scripts) || {};
  const scriptText = Object.values(scripts).join(" \n ");
  const map = [
    [/(react-scripts)/, ["react-scripts"]],
    [/(vite\b)/, ["vite"]],
    [/(webpack\b)/, ["webpack", "webpack-cli"]],
    [/(jest\b)/, ["jest"]],
    [/(ts-node\b)/, ["ts-node", "typescript"]],
    [/(next\b)/, ["next"]],
    [/(nuxt\b)/, ["nuxt"]],
    [/(vue-cli-service)/, ["@vue/cli-service"]],
    [/(gulp\b)/, ["gulp"]],
  ];
  for (const [rx, pkgs] of map) {
    if (rx.test(scriptText)) pkgs.forEach((p) => keep.add(p));
  }

  // Keep all @types/* packages (type-only), regardless of dep/devDep placement
  const allForTypes = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  Object.keys(allForTypes).forEach((name) => {
    if (/^@types\//.test(name)) keep.add(name);
  });

  // SPFx detection: presence of config/package-solution.json → keep @microsoft/sp-* and rush stack compiler
  if ([...cfgs].some((f) => f.endsWith(path.join("config", "package-solution.json")))) {
    const all = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    Object.keys(all).forEach((name) => {
      if (/^@microsoft\/sp-/.test(name)) keep.add(name);
    });
    Object.keys(pkg?.devDependencies || {}).forEach((name) => {
      if (/^@microsoft\/rush-stack-compiler-/.test(name)) keep.add(name);
    });
  }

  // If webpack present, keep all *-loader packages
  if (keep.has("webpack")) {
    const allDeps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    Object.keys(allDeps).forEach((name) => {
      if (/loader$/.test(name)) keep.add(name);
    });
  }

  // Keep peer and optional deps
  Object.keys(pkg?.peerDependencies || {}).forEach((d) => keep.add(d));
  Object.keys(pkg?.optionalDependencies || {}).forEach((d) => keep.add(d));

  return keep;
}

async function runDepcheck(componentDir, pkgForInternal) {
  // Prefer internal lightweight validator first for determinism and speed
  try {
    const internal = await runInternalScan(componentDir, pkgForInternal);
    if (internal && (internal.dependencies.length > 0 || internal.devDependencies.length > 0 || Object.keys(internal.missing || {}).length > 0)) {
      return internal;
    }
  } catch (_) {}

  const cmd = isWindows() ? "npx.cmd" : "npx";
  const args = `${cmd} --yes depcheck --json`;
  try {
    const out = execSync(args, { cwd: componentDir, stdio: ["ignore", "pipe", "pipe"] });
    const txt = out.toString("utf8");
    return JSON.parse(txt);
  } catch (e) {
    // Fallback: try programmatic depcheck if available
    try {
      // Lazy require to avoid hard dependency
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const depcheck = require("depcheck");
      const result = await execDepcheckProgrammatic(depcheck, componentDir);
      return result;
    } catch (_) {
      return { dependencies: [], devDependencies: [], missing: {}, invalidFiles: {}, invalidDirs: {} };
    }
  }
}

function execDepcheckProgrammatic(depcheck, componentDir) {
  const options = {
    ignoreDirs: ["node_modules", "build", "dist", "out", ".next", ".nuxt"],
    ignoreMatches: [
      "eslint*",
      "prettier*",
      "@types/*",
    ],
  };
  return new Promise((resolve) => {
    try {
      depcheck(componentDir, options, (unused) => {
        const payload = {
          dependencies: unused.dependencies || [],
          devDependencies: unused.devDependencies || [],
          missing: unused.missing || {},
          invalidFiles: unused.invalidFiles || {},
          invalidDirs: unused.invalidDirs || {},
        };
        resolve(payload);
      });
    } catch (_) {
      resolve({ dependencies: [], devDependencies: [], missing: {}, invalidFiles: {}, invalidDirs: {} });
    }
  });
}

function partitionCandidates(pkg, unused, keepSet) {
  const deps = new Set(Object.keys(pkg.dependencies || {}));
  const devDeps = new Set(Object.keys(pkg.devDependencies || {}));
  const unusedDeps = (unused.dependencies || []).filter((d) => deps.has(d));
  const unusedDevDeps = (unused.devDependencies || []).filter((d) => devDeps.has(d));

  const candidatesDeps = unusedDeps.filter((d) => !keepSet.has(d));
  const candidatesDevDeps = unusedDevDeps.filter((d) => !keepSet.has(d));

  return { unusedDeps, unusedDevDeps, candidatesDeps, candidatesDevDeps };
}

function uninstallPackages(componentDir, deps, devDeps, dryRun) {
  const nodeModulesPath = path.join(componentDir, "node_modules");
  const hasNodeModules = fs.existsSync(nodeModulesPath);

  if (!hasNodeModules) {
    logger.log("📦 node_modules non trovato, rimozione solo da package.json", "yellow");
    removeFromPackageJson(componentDir, deps, devDeps, dryRun);
    return;
  }

  const npmCmd = getNpmCommand();
  const commands = [];
  if (deps.length > 0) commands.push(`${npmCmd} uninstall ${deps.join(" ")}`);
  if (devDeps.length > 0) commands.push(`${npmCmd} uninstall -D ${devDeps.join(" ")}`);

  for (const c of commands) {
    if (dryRun) {
      logger.log(`DRY-RUN: ${c}`, "yellow");
    } else {
      try {
        logger.log(`🔄 ${c}`, "blue");
        execSync(c, { cwd: componentDir, stdio: "inherit" });
      } catch (e) {
        logger.error(`Errore disinstallazione: ${e.message}`);
      }
    }
  }
}

function removeFromPackageJson(componentDir, deps, devDeps, dryRun) {
  const packageJsonPath = path.join(componentDir, "package.json");
  const packageLockPath = path.join(componentDir, "package-lock.json");

  if (!fs.existsSync(packageJsonPath)) {
    logger.error("package.json non trovato");
    return;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    let updated = false;

    // Rimuovi da dependencies
    if (packageJson.dependencies) {
      deps.forEach((dep) => {
        if (packageJson.dependencies[dep]) {
          delete packageJson.dependencies[dep];
          updated = true;
          if (dryRun) {
            logger.log(`DRY-RUN: rimosso ${dep} da dependencies`, "yellow");
          } else {
            logger.log(`🗑️  Rimosso ${dep} da dependencies`, "green");
          }
        }
      });
    }

    // Rimuovi da devDependencies
    if (packageJson.devDependencies) {
      devDeps.forEach((dep) => {
        if (packageJson.devDependencies[dep]) {
          delete packageJson.devDependencies[dep];
          updated = true;
          if (dryRun) {
            logger.log(`DRY-RUN: rimosso ${dep} da devDependencies`, "yellow");
          } else {
            logger.log(`🗑️  Rimosso ${dep} da devDependencies`, "green");
          }
        }
      });
    }

    if (updated && !dryRun) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf8");
      
      // Rimuovi package-lock.json se esiste
      if (fs.existsSync(packageLockPath)) {
        fs.unlinkSync(packageLockPath);
        logger.log("🗑️  Rimosso package-lock.json", "green");
      }
    }
  } catch (e) {
    logger.error(`Errore aggiornando package.json: ${e.message}`);
  }
}

async function handleComponent(componentName, options) {
  const dir = path.join(projectRoot, componentName);
  const pkg = loadPkgJson(dir);
  if (!pkg) {
    logger.warning(`package.json non trovato per ${componentName}`);
    return { component: componentName, skipped: true };
  }

  logger.section(`Analisi: ${componentName}`);

  const keepSet = buildWhitelist(dir, pkg);
  const unused = await runDepcheck(dir);
  const { unusedDeps, unusedDevDeps, candidatesDeps, candidatesDevDeps } = partitionCandidates(
    pkg,
    unused,
    keepSet
  );

  // Prefer post-filtered output
  const candidates = { deps: candidatesDeps, devDeps: candidatesDevDeps };

  if (candidates.deps.length === 0 && candidates.devDeps.length === 0) {
    logger.success("Componente pulito: nessuna dipendenza non utilizzata");
  } else {
    logger.list(candidates.deps, "Unused dependencies (after filters)");
    logger.list(candidates.devDeps, "Unused devDependencies (after filters)");
  }
  // Optional verbose info about ignored-by-whitelist
  try {
    if (logger.isVerbose && logger.isVerbose()) {
      const ignoredDeps = unusedDeps.filter((d) => keepSet.has(d));
      const ignoredDevDeps = unusedDevDeps.filter((d) => keepSet.has(d));
      if (ignoredDeps.length > 0) logger.list(ignoredDeps, "Ignored by whitelist (dependencies)");
      if (ignoredDevDeps.length > 0) logger.list(ignoredDevDeps, "Ignored by whitelist (devDependencies)");
    }
  } catch (_) {}
  // Missing dependencies output intentionally suppressed for cleaner UX

  if (options.clean || options.yes) {
    const dryRun = !!options.dryRun;
    if (candidates.deps.length === 0 && candidates.devDeps.length === 0) {
      logger.success("Nessun candidato alla rimozione");
    } else {
      logger.warning("Rimozione pacchetti non utilizzati (post-filtri)");
      uninstallPackages(dir, candidates.deps, candidates.devDeps, dryRun);
    }
  }

  return {
    component: componentName,
    keep: Array.from(keepSet),
    unused,
    candidates,
  };
}

function parseArgs(argv) {
  const out = {
    single: null,
    exclude: [],
    clean: false,
    yes: false,
    dryRun: false,
    json: false,
    includeDev: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--single" && i + 1 < argv.length) {
      out.single = argv[++i];
    } else if (a === "--exclude") {
      const list = [];
      for (let j = i + 1; j < argv.length; j++) {
        if (argv[j].startsWith("--")) break;
        list.push(argv[j]);
      }
      out.exclude = list;
      i += list.length;
    } else if (a === "clean") {
      out.clean = true;
    } else if (a === "--yes") {
      out.yes = true;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--include-dev") {
      out.includeDev = true;
    } else if (a === "--no-dev") {
      out.includeDev = false;
    }
  }
  return out;
}

async function parseAndExecuteCommand(argv, onComplete) {
  const opts = parseArgs(argv || []);

  let components = listComponents();

  if (opts.single) {
    components = components.filter((c) => c === opts.single);
  } else if (opts.exclude && opts.exclude.length > 0) {
    components = components.filter((c) => !opts.exclude.includes(c));
  }

  if (components.length === 0) {
    logger.warning("Nessun componente da analizzare");
    if (typeof onComplete === "function") onComplete();
    return true;
  }

  const results = [];
  for (const comp of components) {
    const res = await handleComponent(comp, opts);
    results.push(res);
  }

  if (opts.json) {
    const payload = { results };
    try {
      process.stdout.write(JSON.stringify(payload, null, 2));
    } catch (_) {}
  }

  if (typeof onComplete === "function") onComplete();
  return true;
}

module.exports = { parseAndExecuteCommand };

// -------------------------
// Internal scanner
// -------------------------

function listSourceFiles(dir) {
  const exts = [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".vue",
    ".json",
  ];
  const ignoreDirs = new Set(["node_modules", "dist", "build", "out", ".next", ".nuxt"]);
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const items = fs.readdirSync(cur);
    for (const it of items) {
      const p = path.join(cur, it);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        if (ignoreDirs.has(it)) continue;
        stack.push(p);
      } else {
        const ext = path.extname(it).toLowerCase();
        if (exts.includes(ext)) files.push(p);
      }
    }
  }
  return files;
}

function extractImportsFromContent(content) {
  const matches = new Set();
  const push = (m) => {
    if (!m) return;
    const name = m.trim().replace(/['"`]/g, "");
    if (!name) return;
    // Only root package (strip subpath)
    const root = name.split("/")[0].startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
    matches.add(root);
  };

  const patterns = [
    /import\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
    /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\bdefine\(\s*\[([^\]]+)\]/g,
  ];

  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(content))) {
      if (rx === patterns[3]) {
        // AMD array
        const arr = m[1].split(",").map((s) => s.trim().replace(/['"`]/g, ""));
        arr.forEach(push);
      } else {
        push(m[1]);
      }
    }
  }
  return Array.from(matches);
}

function isLocalPath(spec) {
  return spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("../");
}

function isNodeCoreModule(spec) {
  if (!spec) return false;
  if (spec.startsWith("node:")) return true;
  const name = spec.includes("/") && !spec.startsWith("@") ? spec.split("/")[0] : spec;
  return Array.isArray(builtinModules) && builtinModules.includes(name);
}

async function runInternalScan(componentDir, pkg) {
  const used = new Set();
  const missing = {};
  const files = listSourceFiles(componentDir);
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf8");
      const imports = extractImportsFromContent(content);
      for (const imp of imports) {
        if (!imp || isLocalPath(imp)) continue;
        used.add(imp);
      }
    } catch (_) {}
  }

  const pkgJson = pkg || loadPkgJson(componentDir) || { dependencies: {}, devDependencies: {} };
  const allDeps = new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {}),
  ]);

  // Missing: referenced but not in deps/devDeps
  for (const name of used) {
    if (!allDeps.has(name) && !isNodeCoreModule(name)) {
      if (!missing[name]) missing[name] = [];
      // Not tracking file list here for perf; could add later
    }
  }

  // Unused: in deps/devDeps but not used in code (naive, config handled via whitelist later)
  const usedList = Array.from(used);
  const unusedDeps = Object.keys(pkgJson.dependencies || {}).filter((d) => !used.has(d));
  const unusedDevDeps = Object.keys(pkgJson.devDependencies || {}).filter((d) => !used.has(d));

  return {
    dependencies: unusedDeps,
    devDependencies: unusedDevDeps,
    missing,
    invalidFiles: {},
    invalidDirs: {},
  };
}


