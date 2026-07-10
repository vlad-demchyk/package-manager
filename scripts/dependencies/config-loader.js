/**
 * Caricamento, generazione e verifica di package-manager/dependencies-config.js
 *
 * Estratto da update-configs.js per mantenere quel file focalizzato solo
 * sull'applicazione delle modifiche ai componenti.
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { compareVersions } = require("../utils/version-utils");
const { createReadlineInterface, askQuestion } = require("../cli/prompt");
const {
  generateDependenciesConfig,
  displayGeneratedDependencies,
  saveDependenciesConfig,
} = require("./generator");

// Copia il template dependencies-config.js (vuoto) nel progetto corrente.
function createEmptyDependenciesConfig(projectRoot) {
  // 1. FONTE PRINCIPALE (per sviluppo del manager)
  let templatePath = path.join(__dirname, "..", "..", "templates", "dependencies-config.js");

  // 2. FALLBACK (se l'utente ha rimosso il config)
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "@vlad-demchyk",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  // 3. FALLBACK ALTERNATIVO
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  const targetPath = path.join(projectRoot, "package-manager", "dependencies-config.js");

  try {
    const packageManagerDir = path.join(projectRoot, "package-manager");
    if (!fs.existsSync(packageManagerDir)) {
      fs.mkdirSync(packageManagerDir, { recursive: true });
    }

    if (!fs.existsSync(templatePath)) {
      logger.error(`Template non trovato in nessuno dei luoghi: ${templatePath}`);
      return false;
    }

    fs.copyFileSync(templatePath, targetPath);
    logger.log(`✅ Template copiato da: ${templatePath}`, "green");
    return true;
  } catch (error) {
    logger.error(`Errore creando template: ${error.message}`);
    return false;
  }
}

// Rileva e risolve duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES
// (stesso pacchetto elencato in entrambe le sezioni): vince la versione più alta,
// applicata a entrambe le sezioni.
function resolveDuplicateDependencies(conditionalDeps, conditionalDevDeps) {
  const resolvedConditionalDeps = { ...conditionalDeps };
  const resolvedConditionalDevDeps = { ...conditionalDevDeps };
  const duplicates = [];

  Object.keys(conditionalDeps).forEach((name) => {
    if (conditionalDevDeps[name]) {
      const depVersion =
        typeof conditionalDeps[name] === "string"
          ? conditionalDeps[name]
          : conditionalDeps[name]?.version || conditionalDeps[name];
      const devDepVersion =
        typeof conditionalDevDeps[name] === "string"
          ? conditionalDevDeps[name]
          : conditionalDevDeps[name]?.version || conditionalDevDeps[name];

      if (depVersion && devDepVersion) {
        const comparison = compareVersions(depVersion, devDepVersion);
        let highestVersion;
        let source;

        if (comparison >= 0) {
          highestVersion = depVersion;
          source = "CONDITIONAL_DEPENDENCIES";
        } else {
          highestVersion = devDepVersion;
          source = "CONDITIONAL_DEV_DEPENDENCIES";
        }

        resolvedConditionalDeps[name] = highestVersion;
        resolvedConditionalDevDeps[name] = highestVersion;

        duplicates.push({ name, depVersion, devDepVersion, resolvedVersion: highestVersion, source });
      }
    }
  });

  return {
    conditionalDeps: resolvedConditionalDeps,
    conditionalDevDeps: resolvedConditionalDevDeps,
    duplicates,
  };
}

const DEFAULT_DEPS_FUNCTIONS = {
  getBaseDependencies: () => ({}),
  getConditionalDependencies: () => ({}),
  getDevDependencies: () => ({}),
  getConditionalDevDependencies: () => ({}),
  getDeprecatedDependencies: () => [],
  getStandardScripts: () => ({}),
  getStandardTsConfig: () => ({}),
  getNodeEngines: () => ({}),
  getOverrides: () => ({}),
};

// Ricarica package-manager/dependencies-config.js da disco (bypassando la cache di
// require) e risolve eventuali duplicati tra conditional deps/devDeps.
function reloadDependenciesConfig(projectRoot, options = {}) {
  const { showDuplicates = false } = options;

  try {
    const configPath = path.join(projectRoot, "package-manager/dependencies-config");
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];

    const depsConfig = require(configPath);

    const conditionalDeps = depsConfig.getConditionalDependencies ? depsConfig.getConditionalDependencies() : {};
    const conditionalDevDeps = depsConfig.getConditionalDevDependencies
      ? depsConfig.getConditionalDevDependencies()
      : {};

    const resolved = resolveDuplicateDependencies(conditionalDeps, conditionalDevDeps);

    if (showDuplicates && resolved.duplicates.length > 0) {
      logger.warning(
        `⚠️  Trovati ${resolved.duplicates.length} duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES`
      );
      resolved.duplicates.forEach((dup) => {
        logger.log(
          `   ${dup.name}: ${dup.depVersion} (deps) vs ${dup.devDepVersion} (devDeps) → ${dup.resolvedVersion}`,
          "yellow"
        );
      });
      logger.log("   Usata versione più alta in entrambe le sezioni", "cyan");
    }

    logger.log("✅ Modulo dependencies-config ricaricato con successo!", "green");

    return {
      getBaseDependencies: depsConfig.getBaseDependencies,
      getConditionalDependencies: () => resolved.conditionalDeps,
      getDevDependencies: depsConfig.getDevDependencies,
      getConditionalDevDependencies: () => resolved.conditionalDevDeps,
      getDeprecatedDependencies: depsConfig.getDeprecatedDependencies,
      getStandardScripts: depsConfig.getStandardScripts,
      getStandardTsConfig: depsConfig.getStandardTsConfig,
      getNodeEngines: depsConfig.getNodeEngines,
      getOverrides: depsConfig.getOverrides || (() => ({})),
    };
  } catch (error) {
    logger.error(`Errore ricaricando modulo: ${error.message}`);
    return { ...DEFAULT_DEPS_FUNCTIONS };
  }
}

// Verifica se dependencies-config.js non contiene alcuna dipendenza reale
// (tutte le sezioni vuote o con valori placeholder).
function isDependenciesConfigEmpty(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, "package-manager", "dependencies-config.js");

  if (!fs.existsSync(configPath)) {
    return true;
  }

  try {
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];
    const config = require(configPath);

    const baseDepsEmpty =
      !config.BASE_DEPENDENCIES ||
      Object.keys(config.BASE_DEPENDENCIES).length === 0 ||
      Object.values(config.BASE_DEPENDENCIES).every(
        (val) => (typeof val === "string" && val.trim() === "") || val === null || val === undefined
      );

    const conditionalDepsEmpty =
      !config.CONDITIONAL_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEPENDENCIES).every(
        (val) => !val || (typeof val === "object" && (!val.version || val.version.trim() === ""))
      );

    const devDepsEmpty =
      !config.DEV_DEPENDENCIES ||
      Object.keys(config.DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.DEV_DEPENDENCIES).every(
        (val) => (typeof val === "string" && val.trim() === "") || val === null || val === undefined
      );

    const conditionalDevDepsEmpty =
      !config.CONDITIONAL_DEV_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEV_DEPENDENCIES).every(
        (val) => !val || (typeof val === "object" && (!val.version || val.version.trim() === ""))
      );

    const hasAnyDependencies = !baseDepsEmpty || !conditionalDepsEmpty || !devDepsEmpty || !conditionalDevDepsEmpty;

    return !hasAnyDependencies;
  } catch (error) {
    logger.log(`⚠️  Errore leggendo dependencies-config.js: ${error.message}`, "yellow");
    return true;
  }
}

/**
 * Garantisce che dependencies-config.js esista e contenga dipendenze reali,
 * proponendo (in modo interattivo) di copiare il template e/o generarlo
 * automaticamente dai progetti esistenti se manca o è vuoto.
 *
 * @returns {Promise<{proceed: boolean}>} proceed=false significa che il chiamante
 *   deve interrompere l'aggiornamento (utente ha annullato o errore).
 */
async function ensureDependenciesConfigReady(projectRoot, projectConfig) {
  const dependenciesConfigPath = path.join(projectRoot, "package-manager", "dependencies-config.js");

  // 1. Se il file non esiste, copia il template
  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.log("⚠️  dependencies-config.js non trovato!", "yellow");
    logger.log("📋 Copiando template vuoto...", "cyan");

    if (!createEmptyDependenciesConfig(projectRoot)) {
      logger.log("❌ Errore copiando template", "red");
      return { proceed: false };
    }

    logger.log("✅ Template copiato!", "green");

    if (isDependenciesConfigEmpty(projectRoot)) {
      const result = await runGenerateFlow(projectRoot, projectConfig, {
        emptyMessage: "⚠️  dependencies-config.js è vuoto (template)!",
      });
      if (!result.proceed) return result;
    } else {
      logger.log("📝 Ora puoi riempire manualmente il file:", "cyan");
      logger.log("   package-manager/dependencies-config.js", "blue");
      logger.log("");
      logger.log("💡 Sezioni disponibili:", "cyan");
      logger.log("   1. BASE_DEPENDENCIES (sempre aggiunte)", "blue");
      logger.log("   2. CONDITIONAL_DEPENDENCIES (aggiunte se utilizzate)", "blue");
      logger.log("   3. DEV_DEPENDENCIES (sempre come devDependencies)", "blue");
      logger.log("   4. DEPRECATED_DEPENDENCIES (rimosse)", "blue");
      logger.log("");
    }
  }

  // 2. Verifica se è vuota usando la funzione dedicata (anche per file preesistenti)
  if (isDependenciesConfigEmpty(projectRoot)) {
    const result = await runGenerateFlow(projectRoot, projectConfig, {
      emptyMessage: "⚠️  dependencies-config.js è vuoto!",
    });
    if (!result.proceed) return result;
  } else {
    logger.log("✅ dependencies-config.js trovato e configurato!", "green");
    logger.log("🚀 Procedo con l'aggiornamento automatico...", "cyan");
  }

  return { proceed: true };
}

// Flusso interattivo "genera dependencies-config.js dai progetti esistenti".
async function runGenerateFlow(projectRoot, projectConfig, { emptyMessage }) {
  logger.log(emptyMessage, "yellow");
  logger.log("💡 Vuoi generare automaticamente dai progetti esistenti?", "cyan");

  const rl = createReadlineInterface();
  const answer = await askQuestion(rl, "Generare? (y/N): ");

  if (answer !== "y" && answer !== "yes") {
    logger.log("❌ Generazione annullata", "yellow");
    rl.close();
    return { proceed: false };
  }

  const generated = generateDependenciesConfig(projectConfig);
  displayGeneratedDependencies(generated, projectConfig);

  if (generated.standardTsConfig && Object.keys(generated.standardTsConfig).length > 0) {
    logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
    logger.log(`   Versione TypeScript: ${generated.tsVersion}`, "blue");
    if (generated.standardTsConfig.compilerOptions) {
      const opts = generated.standardTsConfig.compilerOptions;
      logger.log(`   Target: ${opts.target || "es2018"}`, "blue");
      logger.log(`   Module: ${opts.module || "commonjs"}`, "blue");
      logger.log(`   Strict: ${opts.strict || true}`, "blue");
    }

    const tsAnswer = await askQuestion(rl, "Salvare questa configurazione TypeScript? (y/N): ");
    if (tsAnswer !== "y" && tsAnswer !== "yes") {
      generated.standardTsConfig = {};
      logger.log("Configurazione TypeScript non sarà salvata", "yellow");
    }
  }

  const saveAnswer = await askQuestion(rl, "Salvare questa configurazione? (y/N): ");
  if (saveAnswer !== "y" && saveAnswer !== "yes") {
    logger.log("❌ Generazione annullata", "yellow");
    rl.close();
    return { proceed: false };
  }

  saveDependenciesConfig(generated, projectConfig);
  logger.log("✅ Configurazione salvata!", "green");

  // Non mostriamo i duplicati durante l'aggiornamento (silent mode)
  reloadDependenciesConfig(projectRoot, { showDuplicates: false });

  const updateAnswer = await askQuestion(
    rl,
    "Procedere con l'aggiornamento per tutti i componenti? (y/N): "
  );
  rl.close();

  if (updateAnswer !== "y" && updateAnswer !== "yes") {
    logger.log("🔄 Ritorno al menu principale...", "cyan");
    return { proceed: false };
  }

  logger.log("🚀 Procedo con l'aggiornamento...", "cyan");
  return { proceed: true };
}

module.exports = {
  createEmptyDependenciesConfig,
  resolveDuplicateDependencies,
  reloadDependenciesConfig,
  isDependenciesConfigEmpty,
  ensureDependenciesConfigReady,
};
