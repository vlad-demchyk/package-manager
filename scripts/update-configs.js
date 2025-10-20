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

// Funzione per creare un template vuoto dependencies-config.js
function createEmptyDependenciesConfig(projectRoot) {
  // Prima proviamo a trovare il template nella root del progetto
  let templatePath = path.join(projectRoot, "dependencies-config.js");

  // Se non c'è nella root, proviamo in node_modules
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  // Se non c'è nemmeno lì, usiamo il percorso relativo (per sviluppo)
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
    // Verifichiamo se esiste la cartella package-manager
    const packageManagerDir = path.join(projectRoot, "package-manager");
    if (!fs.existsSync(packageManagerDir)) {
      fs.mkdirSync(packageManagerDir, { recursive: true });
    }

    // Verifichiamo se esiste il template
    if (!fs.existsSync(templatePath)) {
      logger.error(`Template non trovato in nessuno dei luoghi: ${templatePath}`);
      return false;
    }

    // Copiamo il template
    fs.copyFileSync(templatePath, targetPath);
    logger.log(`✅ Template copiato da: ${templatePath}`, "green");
    return true;
  } catch (error) {
    logger.error(`Errore creando template: ${error.message}`);
    return false;
  }
}

// Funzione per ricaricare il modulo dependencies-config
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
      "✅ Modulo dependencies-config ricaricato con successo!",
      "green"
    );
    return true;
  } catch (error) {
    logger.error(`Errore ricaricando modulo: ${error.message}`);
    // Usiamo funzioni di default
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

// Funzione per mostrare le modifiche delle versioni
function showVersionChanges(componentDirs, finalBaseDeps, finalDevDeps, projectConfig) {
  logger.log("\n📊 Riepilogo modifiche versioni:", "cyan");
  
  const changes = {
    dependencies: {},
    devDependencies: {}
  };
  
  // Raccoglie le versioni attuali dal primo componente per il confronto
  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(process.cwd(), componentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      
      // Controlla dependencies
      Object.entries(finalBaseDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.dependencies?.[name];
        if (oldVersion && oldVersion !== newVersion) {
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: oldVersion, new: newVersion };
          }
        } else if (!oldVersion) {
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: null, new: newVersion };
          }
        }
      });
      
      // Controlla devDependencies
      Object.entries(finalDevDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.devDependencies?.[name];
        if (oldVersion && oldVersion !== newVersion) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = { old: oldVersion, new: newVersion };
          }
        } else if (!oldVersion) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = { old: null, new: newVersion };
          }
        }
      });
    }
  });
  
  // Mostra le modifiche dependencies
  if (Object.keys(changes.dependencies).length > 0) {
    logger.log("\nDependencies:", "yellow");
    Object.entries(changes.dependencies).forEach(([name, versions]) => {
      if (versions.old) {
        logger.log(`  ${name}: ${versions.old} → ${versions.new}`, "blue");
      } else {
        logger.log(`  ${name}: [NUOVO] → ${versions.new}`, "green");
      }
    });
  }
  
  // Mostra le modifiche devDependencies
  if (Object.keys(changes.devDependencies).length > 0) {
    logger.log("\nDevDependencies:", "yellow");
    Object.entries(changes.devDependencies).forEach(([name, versions]) => {
      if (versions.old) {
        logger.log(`  ${name}: ${versions.old} → ${versions.new}`, "blue");
      } else {
        logger.log(`  ${name}: [NUOVO] → ${versions.new}`, "green");
      }
    });
  }
  
  // Mostra lo stato tsconfig
  if (Object.keys(getStandardTsConfig()).length > 0) {
    logger.log("\ntsconfig.json sarà aggiornato", "yellow");
  }
  
  logger.log("");
}

// Funzione principale per aggiornare tutte le configurazioni
async function updateAllConfigs(scope = "all", components = []) {
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

      // Conferma salvataggio tsconfig
      if (generated.tsConfig && Object.keys(generated.tsConfig).length > 0) {
        logger.log("\nSTANDARD_TSCONFIG trovato dal componente con la versione TypeScript più alta:", "cyan");
        logger.log(JSON.stringify(generated.tsConfig, null, 2), "blue");
        
        const confirmTs = await askQuestion(
          rl,
          "Salvare questa configurazione TypeScript? (y/N): "
        );
        
        if (confirmTs !== "y" && confirmTs !== "yes") {
          delete generated.tsConfig;
          logger.log("Configurazione TypeScript non sarà salvata", "yellow");
        }
      }

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

  // Non aggiungere più tutte le dipendenze condizionali globalmente
  // Verranno processate per ogni componente individualmente
  const finalBaseDeps = { ...baseDeps };
  const finalDevDeps = { ...devDeps };

  // Ottieni configurazioni standard
  const standardScripts = getStandardScripts();
  const standardTsConfig = getStandardTsConfig();
  const nodeEngines = getNodeEngines();
  const deprecatedDeps = getDeprecatedDependencies();

  // Ottieni componenti con filtrazione
  const { getComponentDirectories } = require("./dependencies/analyzer");
  let componentDirs = getComponentDirectories(projectConfig);

  // Applica filtrazione basata su scope e components
  if (scope === "single" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => components.includes(dir));
  } else if (scope === "exclude" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => !components.includes(dir));
  }

  if (componentDirs.length === 0) {
    logger.log("❌ Nessun componente trovato", "red");
    return false;
  }

  logger.log(`📁 Trovati ${componentDirs.length} componenti:`, "blue");
  componentDirs.forEach((dir) => logger.log(`   - ${dir}`, "blue"));

  // Conferma aggiornamento tsconfig
  if (Object.keys(standardTsConfig).length > 0) {
    logger.log("\ntsconfig.json sarà aggiornato secondo STANDARD_TSCONFIG", "yellow");
    
    const rl = createReadlineInterface();
    const confirmTsUpdate = await askQuestion(
      rl,
      "Continuare l'aggiornamento tsconfig.json per tutti i componenti? (y/N): "
    );
    rl.close();
    
    if (confirmTsUpdate !== "y" && confirmTsUpdate !== "yes") {
      logger.log("Aggiornamento tsconfig.json saltato", "yellow");
      // Salta l'aggiornamento tsconfig
      Object.keys(standardTsConfig).forEach(key => delete standardTsConfig[key]);
    }
  }

  // Mostra il riepilogo delle modifiche delle versioni
  showVersionChanges(componentDirs, finalBaseDeps, finalDevDeps, projectConfig);

  let successCount = 0;
  let totalCount = componentDirs.length;

  componentDirs.forEach((componentDir) => {
    const fullPath = path.join(process.cwd(), componentDir);
    logger.log(`\n🔧 Elaborazione ${componentDir}...`, "magenta");

    // Analizza dipendenze condizionali per questo componente specifico
    const { analyzeDependencyUsage } = require("./dependencies/analyzer");
    const usedConditionalDeps = analyzeDependencyUsage(fullPath, conditionalDeps, projectConfig);
    const componentConditionalDeps = {};
    usedConditionalDeps.forEach(dep => {
      componentConditionalDeps[dep.name] = dep.version;
    });

    const packageSuccess = updatePackageJson(
      fullPath,
      projectConfig,
      finalBaseDeps,
      finalDevDeps,
      deprecatedDeps,
      standardScripts,
      nodeEngines,
      componentConditionalDeps
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
  } else {
    logger.log(
      "\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.",
      "yellow"
    );
  }

  // Pausa per permettere all'utente di leggere i risultati
  logger.log("\n🔙 Premi INVIO per tornare al menu principale...", "cyan");
  const rl = createReadlineInterface();
  await askQuestion(rl, "");
  rl.close();

  return successCount === totalCount;
}

// Avvio script
if (require.main === module) {
  updateAllConfigs().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  updateAllConfigs,
  showVersionChanges,
};
