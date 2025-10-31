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
  // 1. FONTE PRINCIPALE (per sviluppo del manager)
  let templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "dependencies-config.js"
  );

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
      logger.error(
        `Template non trovato in nessuno dei luoghi: ${templatePath}`
      );
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
    const configPath = path.join(
      projectRoot,
      "package-manager/dependencies-config"
    );
    const resolvedPath = require.resolve(configPath);

    // Clear cache to ensure fresh loading
    delete require.cache[resolvedPath];

    const depsConfig = require(configPath);
    getBaseDependencies = depsConfig.getBaseDependencies;
    getConditionalDependencies = depsConfig.getConditionalDependencies;
    getDevDependencies = depsConfig.getDevDependencies;
    getConditionalDevDependencies = depsConfig.getConditionalDevDependencies;
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
    getConditionalDevDependencies = () => ({});
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
// logger.log(`🔍 Project root: ${projectRoot}`, "blue");
// logger.log(`🔍 Project config path: ${path.join(projectRoot, "package-manager/project-config")}`, "blue");

const projectConfig = require(path.join(
  projectRoot,
  "package-manager/project-config.js"
));

// logger.log(`🔍 Project config loaded:`, "blue");
// logger.log(`   - filterByPrefix: ${projectConfig.components.filterByPrefix.enabled}`, "blue");
// logger.log(`   - prefix: ${projectConfig.components.filterByPrefix.prefix}`, "blue");
// logger.log(`   - filterByStructure: ${projectConfig.components.filterByStructure.enabled}`, "blue");
// logger.log(`   - requiredFiles: ${JSON.stringify(projectConfig.components.filterByStructure.requiredFiles)}`, "blue");

// Import configurazione dipendenze dinamicamente (con fallback se non esiste)
let getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getConditionalDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines;

// Funzioni di default vuote
function initEmptyFunctions() {
  getBaseDependencies = () => ({});
  getConditionalDependencies = () => ({});
  getDevDependencies = () => ({});
  getConditionalDevDependencies = () => ({});
  getDeprecatedDependencies = () => [];
  getStandardScripts = () => ({});
  getStandardTsConfig = () => ({});
  getNodeEngines = () => ({});
}

// Inizializza con funzioni vuote di default
initEmptyFunctions();

// Funzione per verificare se dependencies-config.js è vuoto
function isDependenciesConfigEmpty() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return true;
  }

  try {
    // Clear cache to ensure fresh loading
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];
    const config = require(configPath);

    // Check if all main objects are empty (ignoring comments and empty values)
    const baseDepsEmpty =
      !config.BASE_DEPENDENCIES ||
      Object.keys(config.BASE_DEPENDENCIES).length === 0 ||
      Object.values(config.BASE_DEPENDENCIES).every(
        (val) =>
          (typeof val === "string" && val.trim() === "") ||
          val === null ||
          val === undefined
      );

    const conditionalDepsEmpty =
      !config.CONDITIONAL_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEPENDENCIES).every(
        (val) =>
          !val ||
          (typeof val === "object" &&
            (!val.version || val.version.trim() === ""))
      );

    const devDepsEmpty =
      !config.DEV_DEPENDENCIES ||
      Object.keys(config.DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.DEV_DEPENDENCIES).every(
        (val) =>
          (typeof val === "string" && val.trim() === "") ||
          val === null ||
          val === undefined
      );

    const conditionalDevDepsEmpty =
      !config.CONDITIONAL_DEV_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEV_DEPENDENCIES).every(
        (val) =>
          !val ||
          (typeof val === "object" &&
            (!val.version || val.version.trim() === ""))
      );

    // Consider empty if ALL dependency objects are empty (no real dependencies)
    const hasAnyDependencies =
      !baseDepsEmpty ||
      !conditionalDepsEmpty ||
      !devDepsEmpty ||
      !conditionalDevDepsEmpty;

    // Return true if file is empty (no dependencies at all)
    return !hasAnyDependencies;
  } catch (error) {
    logger.log(
      `⚠️  Errore leggendo dependencies-config.js: ${error.message}`,
      "yellow"
    );
    return true;
  }
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
function showVersionChanges(
  componentDirs,
  finalBaseDeps,
  finalDevDeps,
  projectConfig,
  conditionalDeps = {},
  conditionalDevDeps = {}
) {
  logger.log("\n📊 Riepilogo modifiche versioni:", "cyan");

  const changes = {
    dependencies: {},
    devDependencies: {},
  };

  // Raccoglie le versioni attuali da tutti i componenti per il confronto
  // IMPORTANTE: Per ogni componente controlliamo se le conditional deps/devDeps 
  // sono presenti in package.json, anche se non vengono rilevate come "usate" nel codice
  // perché updatePackageJson le aggiornerà comunque se sono presenti
  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(
      process.cwd(),
      componentDir,
      "package.json"
    );
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

      // Controlla BASE dependencies (stesso meccanismo di prima)
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

      // Controlla CONDITIONAL dependencies - IMPORTANTE:
      // updatePackageJson aggiorna conditional deps che sono già in package.json
      // anche se non vengono rilevate come "usate" nel codice
      // Quindi controlliamo TUTTE le conditional deps dal config
      // se sono presenti in package.json del componente corrente
      Object.entries(conditionalDeps).forEach(([name, newVersion]) => {
        // Gestire sia stringhe che oggetti (per compatibilità)
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        
        const oldVersion = packageJson.dependencies?.[name];
        // Se il pacchetto è già presente in package.json di questo componente, 
        // verrà aggiornato da updatePackageJson indipendentemente dall'uso nel codice
        if (oldVersion && oldVersion !== configVersion) {
          // Pacchetto presente ma con versione diversa - da aggiornare
          // Se già presente in changes, aggiorna solo se la nuova versione è diversa
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: oldVersion, new: configVersion };
          } else if (changes.dependencies[name].new !== configVersion) {
            // Se la versione target è diversa da quella già registrata, aggiorna
            changes.dependencies[name].new = configVersion;
          }
        }
      });

      // Controlla BASE devDependencies (stesso meccanismo di prima)
      Object.entries(finalDevDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.devDependencies?.[name];
        if (oldVersion && oldVersion !== newVersion) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = {
              old: oldVersion,
              new: newVersion,
            };
          }
        } else if (!oldVersion) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = { old: null, new: newVersion };
          }
        }
      });

      // Controlla CONDITIONAL devDependencies - IMPORTANTE:
      // updatePackageJson aggiorna conditional devDeps che sono già in package.json
      // anche se non vengono rilevate come "usate" nel codice
      // Quindi controlliamo TUTTE le conditional devDeps dal config
      // se sono presenti in package.json del componente corrente
      Object.entries(conditionalDevDeps).forEach(([name, newVersion]) => {
        // Gestire sia stringhe che oggetti (per compatibilità)
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        
        const oldVersion = packageJson.devDependencies?.[name];
        // Se il pacchetto è già presente in package.json di questo componente, 
        // verrà aggiornato da updatePackageJson indipendentemente dall'uso nel codice
        if (oldVersion && oldVersion !== configVersion) {
          // Pacchetto presente ma con versione diversa - da aggiornare
          // Se già presente in changes, aggiorna solo se la nuova versione è diversa
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = {
              old: oldVersion,
              new: configVersion,
            };
          } else if (changes.devDependencies[name].new !== configVersion) {
            // Se la versione target è diversa da quella già registrata, aggiorna
            changes.devDependencies[name].new = configVersion;
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

  // Ritorna true se ci sono modifiche da applicare
  const hasChanges =
    Object.keys(changes.dependencies).length > 0 ||
    Object.keys(changes.devDependencies).length > 0 ||
    Object.keys(getStandardTsConfig()).length > 0;

  return hasChanges;
}

// Funzione per formattare i log delle modifiche per componente
function logComponentChanges(changes, componentDir) {
  logger.log(`\n📦 ${componentDir}:`, "cyan");

  let hasAnyChanges = false;

  // Dependencies - aggiunte da BASE
  if (changes.dependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔧 Dipendenze aggiunte (BASE):`, "yellow");
    changes.dependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  // Dependencies - aggiunte condizionali
  if (changes.dependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze condizionali aggiunte:`, "yellow");
    changes.dependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  // Dependencies - aggiornate
  if (changes.dependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze aggiornate:`, "yellow");
    changes.dependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  // DevDependencies - aggiunte da DEV
  if (changes.devDependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🛠️  Dipendenze dev aggiunte (BASE):`, "yellow");
    changes.devDependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  // DevDependencies - aggiunte condizionali
  if (changes.devDependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze dev condizionali aggiunte:`, "yellow");
    changes.devDependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  // DevDependencies - aggiornate
  if (changes.devDependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze dev aggiornate:`, "yellow");
    changes.devDependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  // Rimosse deprecate
  if (changes.removed.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🗑️  Dipendenze rimosse:`, "yellow");
    changes.removed.forEach(({ name, version, type }) => {
      const typeLabel =
        type === "dependency" ? "dependencies" : "devDependencies";
      logger.log(`      - ${name}@${version} (${typeLabel})`, "red");
    });
  }

  if (!hasAnyChanges) {
    logger.log(`   ✅ Nessuna modifica`, "green");
  }
}

// Funzione principale per aggiornare tutte le configurazioni
async function updateAllConfigs(scope = "all", components = []) {
  logger.log("🚀 Avvio aggiornamento configurazioni componenti...", "cyan");

  // Clear all cached modules to ensure fresh loading
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("dependencies-config") || key.includes("project-config")) {
      delete require.cache[key];
    }
  });

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

      // Dopo aver copiato il template, verifica subito se è vuoto
      if (isDependenciesConfigEmpty()) {
        logger.log("⚠️  dependencies-config.js è vuoto (template)!", "yellow");
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
          if (
            generated.standardTsConfig &&
            Object.keys(generated.standardTsConfig).length > 0
          ) {
            logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
            logger.log(
              `   Versione TypeScript: ${generated.tsVersion}`,
              "blue"
            );
            if (generated.standardTsConfig.compilerOptions) {
              const opts = generated.standardTsConfig.compilerOptions;
              logger.log(`   Target: ${opts.target || "es2018"}`, "blue");
              logger.log(`   Module: ${opts.module || "commonjs"}`, "blue");
              logger.log(`   Strict: ${opts.strict || true}`, "blue");
            }

            const tsAnswer = await askQuestion(
              rl,
              "Salvare questa configurazione TypeScript? (y/N): "
            );
            if (tsAnswer !== "y" && tsAnswer !== "yes") {
              generated.standardTsConfig = {};
              logger.log(
                "Configurazione TypeScript non sarà salvata",
                "yellow"
              );
            }
          }

          const saveAnswer = await askQuestion(
            rl,
            "Salvare questa configurazione? (y/N): "
          );
          if (saveAnswer === "y" || saveAnswer === "yes") {
            const saved = saveGeneratedDependencies(generated, projectRoot);
            if (saved) {
              logger.log("✅ Configurazione salvata!", "green");

              // Ricarica la configurazione dopo il salvataggio
              reloadDependenciesConfig(projectRoot);

              // Chiedi conferma per procedere con l'aggiornamento
              const updateAnswer = await askQuestion(
                rl,
                "Procedere con l'aggiornamento per tutti i componenti? (y/N): "
              );
              if (updateAnswer === "y" || updateAnswer === "yes") {
                // Continua con l'aggiornamento normale
              } else {
                logger.log("❌ Generazione annullata", "yellow");
                rl.close();
                return false;
              }
            } else {
              logger.log("❌ Errore salvando configurazione", "red");
              rl.close();
              return false;
            }
          } else {
            logger.log("❌ Generazione annullata", "yellow");
            rl.close();
            return false;
          }
        } else {
          logger.log("❌ Generazione annullata", "yellow");
          rl.close();
          return false;
        }
        rl.close();
      } else {
        // Se il template non è vuoto, mostra le istruzioni manuali
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
      }
    } else {
      logger.log("❌ Errore copiando template", "red");
      return false;
    }
  }

  // 2. Verifica se è vuota usando la funzione dedicata (prima di caricare)
  if (isDependenciesConfigEmpty()) {
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
      if (
        generated.standardTsConfig &&
        Object.keys(generated.standardTsConfig).length > 0
      ) {
        logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
        logger.log(`   Versione TypeScript: ${generated.tsVersion}`, "blue");
        if (generated.standardTsConfig.compilerOptions) {
          const opts = generated.standardTsConfig.compilerOptions;
          logger.log(`   Target: ${opts.target || "es2018"}`, "blue");
          logger.log(`   Module: ${opts.module || "commonjs"}`, "blue");
          logger.log(`   Strict: ${opts.strict || true}`, "blue");
        }

        const confirmTs = await askQuestion(
          rl,
          "Salvare questa configurazione TypeScript? (y/N): "
        );

        if (confirmTs !== "y" && confirmTs !== "yes") {
          delete generated.standardTsConfig;
          logger.log("Configurazione TypeScript non sarà salvata", "yellow");
        }
      }

      const confirm = await askQuestion(
        rl,
        "Salvare questa configurazione? (y/N): "
      );

      if (confirm === "y" || confirm === "yes") {
        saveDependenciesConfig(generated, projectConfig);
        logger.log("Configurazione salvata!", "green");
        reloadDependenciesConfig(projectRoot);

        // Chiedi se vuole procedere con l'aggiornamento
        const proceed = await askQuestion(
          rl,
          "Procedere con l'aggiornamento per tutti i componenti? (y/N): "
        );
        rl.close();

        if (proceed !== "y" && proceed !== "yes") {
          logger.log("🔄 Ritorno al menu principale...", "cyan");
          return false;
        }

        logger.log("🚀 Procedo con l'aggiornamento...", "cyan");
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

  // 5. Carica la configurazione dopo la verifica/generazione
  reloadDependenciesConfig(projectRoot);

  // Carica le dipendenze dopo la verifica/generazione
  const baseDeps = getBaseDependencies();
  const conditionalDeps = getConditionalDependencies();
  const devDeps = getDevDependencies();
  const conditionalDevDeps = getConditionalDevDependencies();

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

  // logger.log(`🔍 Trovati ${componentDirs.length} componenti:`, "blue");
  // componentDirs.forEach((dir, index) => {
  //   logger.log(`   ${index + 1}. ${dir}`, "blue");
  // });

  // Applica filtrazione basata su scope e components
  if (scope === "single" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => components.includes(dir));
    // logger.log(`🔍 Dopo filtro single: ${componentDirs.length} componenti`, "blue");
  } else if (scope === "exclude" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => !components.includes(dir));
    // logger.log(`🔍 Dopo filtro exclude: ${componentDirs.length} componenti`, "blue");
  }

  if (componentDirs.length === 0) {
    logger.log("❌ Nessun componente trovato", "red");
    return false;
  }

  // Conferma aggiornamento tsconfig
  if (Object.keys(standardTsConfig).length > 0) {
    logger.log(
      "\ntsconfig.json sarà aggiornato secondo STANDARD_TSCONFIG",
      "yellow"
    );

    const rl = createReadlineInterface();
    const confirmTsUpdate = await askQuestion(
      rl,
      "Continuare l'aggiornamento tsconfig.json per tutti i componenti? (y/N): "
    );
    rl.close();

    if (confirmTsUpdate !== "y" && confirmTsUpdate !== "yes") {
      logger.log("Aggiornamento tsconfig.json saltato", "yellow");
      // Salta l'aggiornamento tsconfig
      Object.keys(standardTsConfig).forEach(
        (key) => delete standardTsConfig[key]
      );
    }
  }

  // Mostra riepilogo delle dipendenze che verranno applicate
  logger.log("\n📋 Riepilogo configurazione dipendenze:", "cyan");
  logger.log("", "reset");

  if (Object.keys(finalBaseDeps).length > 0) {
    logger.log("🔧 DIPENDENZE BASE che verranno aggiunte:", "yellow");
    Object.entries(finalBaseDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(conditionalDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE CONDIZIONALI che verranno aggiunte (se utilizzate):",
      "yellow"
    );
    Object.entries(conditionalDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(finalDevDeps).length > 0) {
    logger.log("🛠️  DIPENDENZE DEV che verranno aggiunte:", "yellow");
    Object.entries(finalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(conditionalDevDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE DEV CONDIZIONALI che verranno aggiunte (se utilizzate):",
      "yellow"
    );
    Object.entries(conditionalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  // Mostra tsconfig standard se disponibile
  const previewTsConfig = getStandardTsConfig();
  if (previewTsConfig && Object.keys(previewTsConfig).length > 0) {
    logger.log("⚙️  TSCONFIG.JSON STANDARD che verrà applicato:", "yellow");
    logger.log(
      `   Target: ${previewTsConfig.compilerOptions?.target || "es2018"}`,
      "blue"
    );
    logger.log(
      `   Module: ${previewTsConfig.compilerOptions?.module || "commonjs"}`,
      "blue"
    );
    logger.log(
      `   Strict: ${previewTsConfig.compilerOptions?.strict || true}`,
      "blue"
    );
    logger.log("", "reset");
  }

  // Mostra il riepilogo delle modifiche delle versioni solo se ci sono modifiche
  // Passa anche conditional deps per controllare le versioni se presenti in package.json
  const hasChanges = showVersionChanges(
    componentDirs,
    finalBaseDeps,
    finalDevDeps,
    projectConfig,
    conditionalDeps,
    conditionalDevDeps
  );

  if (!hasChanges) {
    logger.log("\n✅ Tutti i componenti sono già aggiornati!", "green");
    logger.log("🔙 Premi INVIO per tornare al menu principale...", "cyan");
    const pauseRl = createReadlineInterface();
    await askQuestion(pauseRl, "");
    pauseRl.close();
    return true;
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const totalCount = componentDirs.length;

  componentDirs.forEach((componentDir) => {
    const fullPath = path.join(process.cwd(), componentDir);

    // Debug: mostra il percorso completo
    // logger.log(`   📁 Percorso completo: ${fullPath}`, "blue");
    const packageJsonPath = path.join(fullPath, "package.json");
    // logger.log(`   📄 package.json: ${packageJsonPath}`, "blue");
    // logger.log(`   ✅ Esiste: ${fs.existsSync(packageJsonPath)}`, "blue");

    // Verifica se il componente esiste
    if (!fs.existsSync(fullPath)) {
      logger.error(`❌ Directory non trovata: ${fullPath}`, "red");
      errorCount++;
      return;
    }

    // Verifica se package.json esiste
    if (!fs.existsSync(packageJsonPath)) {
      logger.error(`❌ package.json non trovato in ${componentDir}`, "red");
      errorCount++;
      return;
    }

    // Analizza dipendenze condizionali per questo componente specifico
    const { analyzeDependencyUsage } = require("./dependencies/analyzer");
    const usedConditionalDeps = analyzeDependencyUsage(
      fullPath,
      conditionalDeps,
      projectConfig
    );
    const componentConditionalDeps = {};
    usedConditionalDeps.forEach((dep) => {
      componentConditionalDeps[dep.name] = dep.version;
    });

    // Analizza dipendenze dev condizionali per questo componente specifico
    const usedConditionalDevDeps = analyzeDependencyUsage(
      fullPath,
      conditionalDevDeps,
      projectConfig
    );
    const componentConditionalDevDeps = {};
    usedConditionalDevDeps.forEach((dep) => {
      componentConditionalDevDeps[dep.name] = dep.version;
    });

    // Додати conditional deps/devDeps, які вже є в package.json з іншою версією
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Для conditional deps
    Object.entries(conditionalDeps).forEach(([name, configVersionValue]) => {
      // Gestire sia stringhe che oggetti (per compatibilità)
      const configVersion = typeof configVersionValue === 'string' 
        ? configVersionValue 
        : (configVersionValue?.version || configVersionValue);
      if (!configVersion) return;
      
      const currentVersion = packageJson.dependencies?.[name];
      if (currentVersion && currentVersion !== configVersion) {
        // Вже є в package.json з іншою версією - додати для оновлення
        if (!componentConditionalDeps[name]) {
          componentConditionalDeps[name] = configVersion;
        }
      }
    });

    // Для conditional devDeps
    Object.entries(conditionalDevDeps).forEach(([name, configVersionValue]) => {
      // Gestire sia stringhe che oggetti (per compatibilità)
      const configVersion = typeof configVersionValue === 'string' 
        ? configVersionValue 
        : (configVersionValue?.version || configVersionValue);
      if (!configVersion) return;
      
      const currentVersion = packageJson.devDependencies?.[name];
      if (currentVersion && currentVersion !== configVersion) {
        // Вже є в package.json з іншою версією - додати для оновлення
        if (!componentConditionalDevDeps[name]) {
          componentConditionalDevDeps[name] = configVersion;
        }
      }
    });

    const packageResult = updatePackageJson(
      fullPath,
      projectConfig,
      finalBaseDeps,
      finalDevDeps,
      deprecatedDeps,
      standardScripts,
      nodeEngines,
      componentConditionalDeps,
      componentConditionalDevDeps
    );

    // Formattiamo i log per componente
    if (packageResult.changes) {
      logComponentChanges(packageResult.changes, componentDir);
    }

    const tsConfigSuccess = updateTsConfig(
      fullPath,
      projectConfig,
      standardTsConfig
    );

    // Aggiungiamo log per tsconfig.json se è stato aggiornato
    if (tsConfigSuccess && Object.keys(standardTsConfig).length > 0) {
      // Il logging è già in updateTsConfig, ma possiamo aggiungere qui se necessario
    }

    const tslintSuccess = removeTslintJson(fullPath, projectConfig);

    if (packageResult.success && tsConfigSuccess && tslintSuccess) {
      if (packageResult.changes) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    } else {
      errorCount++;
      logger.log(`   ❌ Errore aggiornamento ${componentDir}`, "red");
    }
  });

  logger.log(`\n📊 Risultato:`, "cyan");
  logger.log(`   ✅ Aggiornati: ${updatedCount}/${totalCount}`, "green");
  logger.log(`   ⏭️  Senza modifiche: ${skippedCount}/${totalCount}`, "blue");
  logger.log(
    `   ❌ Errori: ${errorCount}/${totalCount}`,
    errorCount > 0 ? "red" : "green"
  );

  if (errorCount === 0) {
    logger.log(
      "\n🎉 Tutte le configurazioni aggiornate con successo!",
      "green"
    );
    // Chiedi se installare i pacchetti ora
    try {
      const projectConfigPath = path.join(
        process.cwd(),
        "package-manager",
        "project-config.js"
      );
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = require(projectConfigPath);

        const rl = createReadlineInterface();
        const answer = await askQuestion(
          rl,
          "\nVuoi installare i pacchetti adesso? (y/N): "
        );
        rl.close();

        if (answer === "y" || answer === "yes") {
          if (
            projectConfig.workspace?.enabled &&
            projectConfig.workspace?.initialized
          ) {
            logger.log(
              "\n🔄 Workspace rilevato - installazione pacchetti centralizzata...",
              "cyan"
            );
            const {
              installAllComponentsWorkspace,
            } = require("./operations/workspace-install");
            const workspaceSuccess = installAllComponentsWorkspace(
              projectConfig,
              "normal"
            );
            if (workspaceSuccess) {
              logger.success("✅ Pacchetti installati tramite workspace!");
            } else {
              logger.warning("⚠️  Errore durante l'installazione workspace");
            }
          } else {
            logger.log("\n🔄 Installazione pacchetti standard...", "cyan");
            const { getComponentDirectories } = require("./utils/common");
            const components = getComponentDirectories(projectConfig);
            let installSuccess = 0;
            for (const component of components) {
              try {
                const componentPath = path.join(process.cwd(), component);
                const {
                  installPackagesStandard,
                } = require("./operations/standard-install");
                const success = installPackagesStandard(
                  componentPath,
                  "normal",
                  projectConfig
                );
                if (success) installSuccess++;
              } catch (error) {
                logger.warning(
                  `⚠️  Errore installazione ${component}: ${error.message}`
                );
              }
            }
            if (installSuccess === components.length) {
              logger.success("✅ Tutti i pacchetti installati con successo!");
            } else {
              logger.warning(
                `⚠️  Installati ${installSuccess}/${components.length} componenti`
              );
            }
          }
        } else {
          logger.info("⏭️  Installazione pacchetti saltata su richiesta");
        }
      }
    } catch (error) {
      logger.warning("⚠️  Errore durante l'installazione pacchetti");
      logger.warning(`   ${error.message}`);
    }
  } else {
    logger.log(
      "\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.",
      "yellow"
    );
  }

  // Pausa per permettere all'utente di leggere i risultati
  logger.log("\n🔙 Premi INVIO per tornare al menu principale...", "cyan");
  const pauseRl = createReadlineInterface();
  await askQuestion(pauseRl, "");
  pauseRl.close();

  return errorCount === 0;
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
  createEmptyDependenciesConfig,
  reloadDependenciesConfig,
  isDependenciesConfigEmpty,
};
