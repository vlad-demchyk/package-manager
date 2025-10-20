#!/usr/bin/env node

/**
 * Script cross-platform per aggiornare package.json e tsconfig.json
 * basato sulle dipendenze del calendario per tutti i componenti
 * Versione modulare con configurazione esterna
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// Import shared logger
const logger = require("./utils/logger");

// Функція для створення пустого темплейту dependencies-config.js
function createEmptyDependenciesConfig(projectRoot) {
  // Спочатку пробуємо знайти темплейт в корені проекту
  let templatePath = path.join(projectRoot, "dependencies-config.js");

  // Якщо немає в корені, пробуємо в node_modules
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  // Якщо і там немає, використовуємо відносний шлях (для розробки)
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "dependencies-config.js"
    );
  }

  const targetPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  try {
    // Перевіряємо чи існує папка package-manager
    const packageManagerDir = path.join(projectRoot, "package-manager");
    if (!fs.existsSync(packageManagerDir)) {
      fs.mkdirSync(packageManagerDir, { recursive: true });
    }

    // Перевіряємо чи існує темплейт
    if (!fs.existsSync(templatePath)) {
      logger.error(`Темплейт не знайдено в жодному з місць: ${templatePath}`);
      return false;
    }

    // Копіюємо темплейт
    fs.copyFileSync(templatePath, targetPath);
    logger.log(`✅ Темплейт скопійовано з: ${templatePath}`, "green");
    return true;
  } catch (error) {
    logger.error(`Помилка створення темплейту: ${error.message}`);
    return false;
  }
}

// Функція для перезавантаження модуля dependencies-config
function reloadDependenciesConfig(projectRoot) {
  try {
    delete require.cache[
      require.resolve(
        path.join(projectRoot, "package-manager/dependencies-config")
      )
    ];
    const depsConfig = require(path.join(
      projectRoot,
      "package-manager/dependencies-config"
    ));
    getBaseDependencies = depsConfig.getBaseDependencies;
    getConditionalDependencies = depsConfig.getConditionalDependencies;
    getDevDependencies = depsConfig.getDevDependencies;
    getDeprecatedDependencies = depsConfig.getDeprecatedDependencies;
    getStandardScripts = depsConfig.getStandardScripts;
    getStandardTsConfig = depsConfig.getStandardTsConfig;
    getNodeEngines = depsConfig.getNodeEngines;
    logger.log(
      "✅ Модуль dependencies-config успішно перезавантажено!",
      "green"
    );
    return true;
  } catch (error) {
    logger.error(`Помилка перезавантаження модуля: ${error.message}`);
    // Використовуємо функції за замовчуванням
    getBaseDependencies = () => ({});
    getConditionalDependencies = () => ({});
    getDevDependencies = () => ({});
    getDeprecatedDependencies = () => [];
    getStandardScripts = () => ({});
    getStandardTsConfig = () => ({});
    getNodeEngines = () => ({});
    return false;
  }
}

// Import moduli riorganizzati
const {
  generateDependenciesConfig,
  displayGeneratedDependencies,
  saveDependenciesConfig,
} = require("./dependencies/generator");
const { getUsedDependencies } = require("./dependencies/analyzer");
const {
  updatePackageJson,
  updateTsConfig,
  removeTslintJson,
} = require("./dependencies/updater");

// Carica configurazione progetto dinamicamente
const projectRoot = process.cwd();
const projectConfig = require(path.join(
  projectRoot,
  "package-manager/project-config"
));

// Import configurazione dipendenze dinamicamente (con fallback se non esiste)
let getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines;

try {
  const depsConfig = require(path.join(
    projectRoot,
    "package-manager/dependencies-config"
  ));
  getBaseDependencies = depsConfig.getBaseDependencies;
  getConditionalDependencies = depsConfig.getConditionalDependencies;
  getDevDependencies = depsConfig.getDevDependencies;
  getDeprecatedDependencies = depsConfig.getDeprecatedDependencies;
  getStandardScripts = depsConfig.getStandardScripts;
  getStandardTsConfig = depsConfig.getStandardTsConfig;
  getNodeEngines = depsConfig.getNodeEngines;
} catch (error) {
  // Se il file non esiste, usa funzioni vuote
  getBaseDependencies = () => ({});
  getConditionalDependencies = () => ({});
  getDevDependencies = () => ({});
  getDeprecatedDependencies = () => [];
  getStandardScripts = () => ({});
  getStandardTsConfig = () => ({});
  getNodeEngines = () => ({});
}

// Funzione per creare readline interface
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}

// Funzione per fare domande all'utente
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Funzione principale per aggiornare tutte le configurazioni
async function updateAllConfigs() {
  logger.log("🚀 Avvio aggiornamento configurazioni componenti...", "cyan");

  const dependenciesConfigPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  // 1. Se il file non esiste, copia il template
  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.log("⚠️  dependencies-config.js non trovato!", "yellow");
    logger.log("📋 Copiando template vuoto...", "cyan");

    if (createEmptyDependenciesConfig(projectRoot)) {
      logger.log("✅ Template copiato!", "green");
      logger.log("📝 Ora puoi riempire manualmente il file:", "cyan");
      logger.log("   package-manager/dependencies-config.js", "blue");
      logger.log("");
      logger.log("💡 Sezioni disponibili:", "cyan");
      logger.log("   1. BASE_DEPENDENCIES (sempre aggiunte)", "blue");
      logger.log(
        "   2. CONDITIONAL_DEPENDENCIES (aggiunte se utilizzate)",
        "blue"
      );
      logger.log(
        "   3. DEV_DEPENDENCIES (sempre come devDependencies)",
        "blue"
      );
      logger.log("   4. DEPRECATED_DEPENDENCIES (rimosse)", "blue");
      logger.log("");
    } else {
      logger.log("❌ Errore copiando template", "red");
      return false;
    }
  }

  // 2. Carica la configurazione
  reloadDependenciesConfig(projectRoot);

  // 3. Verifica se è vuota
  const baseDeps = getBaseDependencies();
  const conditionalDeps = getConditionalDependencies();
  const devDeps = getDevDependencies();

  if (
    Object.keys(baseDeps).length === 0 &&
    Object.keys(conditionalDeps).length === 0 &&
    Object.keys(devDeps).length === 0
  ) {
    logger.log("⚠️  dependencies-config.js è vuoto!", "yellow");
    logger.log(
      "💡 Vuoi generare automaticamente dai progetti esistenti?",
      "cyan"
    );

    const rl = createReadlineInterface();
    const answer = await askQuestion(rl, "Generare? (y/N): ");

    if (answer === "y" || answer === "yes") {
      const generated = generateDependenciesConfig(projectConfig);
      displayGeneratedDependencies(generated, projectConfig);

      const confirm = await askQuestion(
        rl,
        "Salvare questa configurazione? (y/N): "
      );

      if (confirm === "y" || confirm === "yes") {
        saveDependenciesConfig(generated, projectConfig);
        logger.log("✅ Configurazione salvata!", "green");
        reloadDependenciesConfig(projectRoot);

        // Chiedi se vuole procedere con l'aggiornamento
        const proceed = await askQuestion(
          rl,
          "Procedere con l'aggiornamento dei pacchetti? (y/N): "
        );
        rl.close();

        if (proceed !== "y" && proceed !== "yes") {
          logger.log("🔄 Ritorno al menu principale...", "cyan");
          return false;
        }
      } else {
        logger.log("❌ Generazione annullata", "yellow");
        rl.close();
        return false;
      }
    } else {
      logger.log("❌ Configurazione richiesta per continuare", "yellow");
      rl.close();
      return false;
    }
  } else {
    // 4. Se il file è già configurato, procedi automaticamente
    logger.log("✅ dependencies-config.js trovato e configurato!", "green");
    logger.log("🚀 Procedo con l'aggiornamento automatico...", "cyan");
  }

  // Ottieni le dipendenze utilizzate
  const usedDeps = getUsedDependencies(conditionalDeps, projectConfig);
  const finalBaseDeps = { ...baseDeps };
  const finalDevDeps = { ...devDeps };

  // Aggiungi dipendenze condizionali utilizzate
  Object.entries(usedDeps).forEach(([name, config]) => {
    finalBaseDeps[name] = config.version;
  });

  // Ottieni configurazioni standard
  const standardScripts = getStandardScripts();
  const standardTsConfig = getStandardTsConfig();
  const nodeEngines = getNodeEngines();
  const deprecatedDeps = getDeprecatedDependencies();

  // Ottieni componenti
  const { getComponentDirectories } = require("./dependencies/analyzer");
  const componentDirs = getComponentDirectories(projectConfig);

  if (componentDirs.length === 0) {
    logger.log("❌ Nessun componente trovato", "red");
    return false;
  }

  logger.log(`📁 Trovati ${componentDirs.length} componenti:`, "blue");
  componentDirs.forEach((dir) => logger.log(`   - ${dir}`, "blue"));

  let successCount = 0;
  let totalCount = componentDirs.length;

  componentDirs.forEach((componentDir) => {
    const fullPath = path.join(process.cwd(), componentDir);
    logger.log(`\n🔧 Elaborazione ${componentDir}...`, "magenta");

    const packageSuccess = updatePackageJson(
      fullPath,
      projectConfig,
      finalBaseDeps,
      finalDevDeps,
      deprecatedDeps,
      standardScripts,
      nodeEngines
    );
    const tsConfigSuccess = updateTsConfig(
      fullPath,
      projectConfig,
      standardTsConfig
    );
    const tslintSuccess = removeTslintJson(fullPath, projectConfig);

    if (packageSuccess && tsConfigSuccess && tslintSuccess) {
      successCount++;
    }
  });

  logger.log(`\n📊 Risultato:`, "cyan");
  logger.log(
    `   ✅ Aggiornati con successo: ${successCount}/${totalCount}`,
    "green"
  );
  logger.log(
    `   ❌ Errori: ${totalCount - successCount}/${totalCount}`,
    totalCount - successCount > 0 ? "red" : "green"
  );

  if (successCount === totalCount) {
    logger.log(
      "\n🎉 Tutte le configurazioni aggiornate con successo!",
      "green"
    );
    return true;
  } else {
    logger.log(
      "\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.",
      "yellow"
    );
    return false;
  }
}

// Avvio script
if (require.main === module) {
  updateAllConfigs().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  updateAllConfigs,
};
