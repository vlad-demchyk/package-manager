#!/usr/bin/env node

/**
 * Core script per il gestore pacchetti Cherry 106
 * Versione modulare con configurazione esterna
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const readline = require("readline");

// Import shared logger
const logger = require("./utils/logger");

// Import moduli riorganizzati
const {
  cleanComponent: cleanComponentFromModule,
  cleanAllComponents: cleanAllComponentsFromModule,
} = require("./operations/cleaner");

// Carica configurazione progetto dinamicamente
const projectRoot = process.cwd();
let projectConfig = {};
try {
  projectConfig = require(path.join(
    projectRoot,
    "package-manager/project-config"
  ));
} catch (e) {
  // project-config may be created later; use an empty config until then
  projectConfig = { logging: { colors: {} } };
}

// Variabili globali per readline
let rl = null;
let askQuestion = null;

function isWindows() {
  return process.platform === "win32";
}

function getNpmCommand() {
  return isWindows()
    ? projectConfig.commands.npm.windows
    : projectConfig.commands.npm.unix;
}

function getComponentDirectories() {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);

  return items.filter((item) => {
    const fullPath = path.join(currentDir, item);

    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }

    // Controllo per prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        return false;
      }
    }

    // Controllo per struttura
    if (projectConfig.components.filterByStructure.enabled) {
      const requiredFiles =
        projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders =
        projectConfig.components.filterByStructure.requiredFolders;

      for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, file))) {
          return false;
        }
      }

      for (const folder of requiredFolders) {
        const folderPath = path.join(fullPath, folder);
        if (
          !fs.existsSync(folderPath) ||
          !fs.statSync(folderPath).isDirectory()
        ) {
          return false;
        }
      }
    }

    // Controllo per lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        return false;
      }
    }

    // Controllo per regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        return false;
      }
    }

    // Controlliamo sempre la presenza di package.json
    return fs.existsSync(path.join(fullPath, projectConfig.files.packageJson));
  });
}

function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      if (isWindows()) {
        execSync(`rmdir /s /q "${dirPath}"`, { stdio: "ignore" });
      } else {
        execSync(`rm -rf "${dirPath}"`, { stdio: "ignore" });
      }
      return false;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return false;
    } catch (error) {
      return false;
    }
  }
  return true;
}

// cleanComponent ora importato da operations/cleaner
function cleanComponent(componentPath) {
  return cleanComponentFromModule(componentPath, projectConfig);
}

function installPackages(componentPath, mode = "normal") {
  // expose projectConfig to logger for color rendering if needed
  try {
    logger.projectConfig = projectConfig;
  } catch (e) {}
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(
    componentPath,
    projectConfig.files.packageJson
  );

  if (!fs.existsSync(packageJsonPath)) {
    logger.log(
      `❌ ${projectConfig.files.packageJson} non trovato in ${componentName}`,
      "red"
    );
    return false;
  }

  logger.log(
    `📦 Installazione pacchetti per ${componentName} (modalità: ${mode})...`,
    "cyan"
  );

  try {
    process.chdir(componentPath);

    let npmArgs = ["install"];

    switch (mode) {
      case "clean":
        logger.log(`🧹 Pulizia ${componentName}...`, "yellow");
        removeDirectory(projectConfig.files.nodeModules);
        removeFile(projectConfig.files.packageLock);
        logger.log(`✅ Pulito ${componentName}`, "green");
        break;

      case "legacy":
        npmArgs.push("--legacy-peer-deps");
        logger.log(
          `⚠️  Usando --legacy-peer-deps per ${componentName}`,
          "yellow"
        );
        break;

      case "force":
        npmArgs.push("--force");
        logger.log(`⚠️  Usando --force per ${componentName}`, "yellow");
        break;
    }

    logger.log(`🔄 Avvio: ${getNpmCommand()} ${npmArgs.join(" ")}`, "blue");

    const result = execSync(`${getNpmCommand()} ${npmArgs.join(" ")}`, {
      stdio: "inherit",
      cwd: componentPath,
    });

    logger.log(
      `✅ Installati con successo i pacchetti per ${componentName}`,
      "green"
    );
    return false;
  } catch (error) {
    logger.log(
      `❌ Errore durante l'installazione dei pacchetti per ${componentName}: ${error.message}`,
      "red"
    );
    return false;
  } finally {
    // Torniamo alla directory root
    process.chdir(path.join(__dirname, "../.."));
  }
}

// Funzioni per aggiornamento configurazioni
async function updateAllConfigs() {
  const updateScript = require("./update-configs");
  return await updateScript.updateAllConfigs();
}

// Funzioni per depcheck
function showDepcheckMenu() {
  logger.section("Controllo dipendenze non utilizzate");
  logger.step("Controlla tutti i componenti", 1);
  logger.step("Controlla un componente", 2);
  logger.step("Controlla tutti eccetto quelli specificati", 3);
  logger.step("Controlla e rimuovi per tutti i componenti (automatico)", 4);
  logger.step("Torna al menu principale", 0);

  if (!rl) return;

  rl.question("Scegli opzione (0-4): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        logger.process("Controllo dipendenze per tutti i componenti...");
        executeDepcheckCommand("all", [], [], () => {
          // Dopo l'analisi, chiedi conferma per la rimozione
          if (rl) {
            logger.log(
              "\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per tutti i componenti?",
              "yellow"
            );
            rl.question("Continua? (y/N): ", (confirm) => {
              if (
                confirm.toLowerCase() === "y" ||
                confirm.toLowerCase() === "yes"
              ) {
                logger.log(
                  "\n🔍 Rimozione dipendenze per tutti i componenti...",
                  "cyan"
                );
                executeDepcheckCommand("all", [], ["clean"], () => {
                  setTimeout(() => {
                    if (askQuestion) askQuestion();
                  }, 100);
                });
              } else {
                logger.warning("Operazione annullata");
                setTimeout(() => {
                  if (askQuestion) askQuestion();
                }, 100);
              }
            });
          }
        });
        break;
      case "2":
        showDepcheckComponentSelection();
        break;
      case "3":
        showDepcheckExcludeSelection();
        break;
      case "4":
        logger.log(
          "\n🔍 Controllo e rimozione automatica dipendenze per tutti i componenti...",
          "cyan"
        );
        executeDepcheckCommand("all", [], ["clean"], () => {
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        });
        break;
      default:
        logger.error("Scelta non valida");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function showDepcheckComponentSelection() {
  const components = showComponentList();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }

  if (!rl) return;

  rl.question(
    "\nInserisci numero componente (0 per tornare al menu): ",
    (answer) => {
      if (answer.trim() === "0") {
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
      }

      const index = parseInt(answer) - 1;

      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        logger.log(`\n🎯 Selezionato: ${selectedComponent}`, "green");

        // Prima mostra le dipendenze non utilizzate
        logger.log(`\n🔍 Analisi dipendenze per: ${selectedComponent}`, "cyan");
        executeDepcheckCommand("single", [selectedComponent], [], () => {
          // Dopo l'analisi, chiedi conferma per la rimozione
          if (rl) {
            logger.log(
              `\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per: ${selectedComponent}?`,
              "yellow"
            );
            rl.question("Continua? (y/N): ", (confirm) => {
              if (
                confirm.toLowerCase() === "y" ||
                confirm.toLowerCase() === "yes"
              ) {
                logger.log(
                  `\n🔍 Rimozione dipendenze per: ${selectedComponent}`,
                  "cyan"
                );
                executeDepcheckCommand(
                  "single",
                  [selectedComponent],
                  ["clean"],
                  () => {
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  }
                );
              } else {
                logger.warning("Operazione annullata");
                setTimeout(() => {
                  if (askQuestion) askQuestion();
                }, 100);
              }
            });
          }
        });
      } else {
        logger.error("Numero componente non valido");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    }
  );
}

function showDepcheckExcludeSelection() {
  if (!rl) return;

  rl.question(
    "Inserisci nomi componenti da escludere (separati da spazio): ",
    (excludeAnswer) => {
      const excludeList = excludeAnswer
        .trim()
        .split(/\s+/)
        .filter((name) => name.length > 0);
      if (excludeList.length > 0) {
        // Prima mostra le dipendenze non utilizzate
        logger.log(
          `\n🔍 Analisi dipendenze per tutti i componenti eccetto: ${excludeList.join(
            ", "
          )}`,
          "cyan"
        );
        executeDepcheckCommand("exclude", excludeList, [], () => {
          // Dopo l'analisi, chiedi conferma per la rimozione
          if (rl) {
            logger.log(
              `\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per tutti i componenti eccetto: ${excludeList.join(
                ", "
              )}?`,
              "yellow"
            );
            rl.question("Continua? (y/N): ", (confirm) => {
              if (
                confirm.toLowerCase() === "y" ||
                confirm.toLowerCase() === "yes"
              ) {
                logger.log(
                  `\n🔍 Rimozione dipendenze per tutti i componenti eccetto: ${excludeList.join(
                    ", "
                  )}`,
                  "cyan"
                );
                executeDepcheckCommand(
                  "exclude",
                  excludeList,
                  ["clean"],
                  () => {
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  }
                );
              } else {
                logger.warning("Operazione annullata");
                setTimeout(() => {
                  if (askQuestion) askQuestion();
                }, 100);
              }
            });
          }
        });
      } else {
        logger.error("Nessun componente specificato per esclusione");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    }
  );
}

// Funzioni per pulizia ora importate da operations/cleaner
function cleanAllComponents(excludeList = []) {
  return cleanAllComponentsFromModule(excludeList, projectConfig);
}

function installAllComponents(mode = "normal") {
  const components = getComponentDirectories();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    return;
  }

  logger.log(
    `🚀 Installazione pacchetti per tutti i ${components.length} componenti...`,
    "cyan"
  );

  let successCount = 0;
  const totalCount = components.length;

  components.forEach((component, index) => {
    logger.log(
      `\n[${index + 1}/${totalCount}] Elaborazione ${component}...`,
      "magenta"
    );
    const success = installPackages(path.join(process.cwd(), component), mode);
    if (success) successCount++;
  });

  logger.log(`\n📊 Risultato:`, "cyan");
  logger.log(`   ✅ Successo: ${successCount}/${totalCount}`, "green");
  logger.log(
    `   ❌ Errori: ${totalCount - successCount}/${totalCount}`,
    totalCount - successCount > 0 ? "red" : "green"
  );
}

// Funzioni per parsing comandi
async function parseAndExecuteCommand(args) {
  const currentDir = process.cwd();
  const currentDirName = path.basename(currentDir);

  // Controlliamo se l'utente si trova nella cartella package-manager
  if (currentDirName === "package-manager") {
    logger.warning("Ti trovi nella cartella del modulo package-manager!");
    logger.log("");
    logger.log(
      "📁 Per eseguire i comandi del progetto devi tornare alla root del progetto:",
      "cyan"
    );
    logger.log("   cd ..");
    logger.log("");
    logger.section("Dopo potrai utilizzare");
    logger.log("   node package-manager.js");
    logger.log("   node package-manager.js update");
    logger.log("   node package-manager.js install --single component-name");
    logger.log("");
    logger.section("Oppure rimani qui per configurare il modulo");
    logger.log("   node install.js");
    logger.log("");
    logger.section("Hai bisogno di aiuto?");
    logger.log("   Leggi la documentazione: package-manager/README.md");
    process.exit(0);
  }

  const command = args[0];

  let mode = "normal";
  let scope = "all";
  let components = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--single") {
      scope = "single";
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Skip next argument
      } else {
        logger.error("--single richiede il nome del componente");
        process.exit(1);
      }
    } else if (arg === "--exclude") {
      scope = "exclude";
      components = [];
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith("--")) {
          break; // Stop at next flag
        }
        components.push(args[j]);
      }
      i += components.length; // Skip processed arguments
    } else if (["normal", "legacy", "force"].includes(arg)) {
      mode = arg;
    }
  }

  switch (command) {
    case "install":
      executeInstallCommand(scope, components, mode);
      break;
    case "reinstall":
      executeReinstallCommand(scope, components, mode);
      break;
    case "clean":
      executeCleanCommand(scope, components);
      break;
    case "update":
      if (scope !== "all") {
        logger.log(
          "⚠️  Il comando update supporta solo l'aggiornamento globale di tutti i componenti",
          "yellow"
        );
        logger.log(
          "   Questo garantisce che tutte le versioni rimangano sincronizzate",
          "blue"
        );
      }
      await executeUpdateCommand();
      break;
    case "depcheck":
      // Controlliamo se c'è 'clean' alla fine degli argomenti
      const hasClean = args.includes("clean");
      if (hasClean) {
        // Rimuoviamo 'clean' dagli argomenti
        const cleanArgs = args.filter((arg) => arg !== "clean");
        await executeDepcheckCleanCommand(scope, components, cleanArgs);
      } else {
        await executeDepcheckCommand(scope, components, args);
      }
      break;
    default:
      showUsage();
      process.exit(1);
  }
}

function executeInstallCommand(scope, components, mode) {
  switch (scope) {
    case "all":
      installAllComponents(mode);
      break;
    case "single":
      if (components.length > 0) {
        installPackages(path.join(process.cwd(), components[0]), mode);
      } else {
        logger.error("Nessun componente specificato per --single");
      }
      break;
    case "exclude":
      const allComponents = getComponentDirectories();
      const filteredComponents = allComponents.filter(
        (comp) => !components.includes(comp)
      );
      if (filteredComponents.length > 0) {
        logger.log(
          `🚀 Installazione per ${
            filteredComponents.length
          } componenti (escluso: ${components.join(", ")})...`,
          "cyan"
        );
        filteredComponents.forEach((component) => {
          installPackages(path.join(process.cwd(), component), mode);
        });
      } else {
        logger.error("Tutti i componenti esclusi dall'installazione");
      }
      break;
  }

  // Ritorna al menu dopo l'installazione
  setTimeout(() => {
    if (askQuestion) askQuestion();
  }, 100);
}

function executeReinstallCommand(scope, components, mode) {
  // Prima pulizia, poi installazione
  executeCleanCommand(scope, components);
  executeInstallCommand(scope, components, mode);

  // Ritorna al menu dopo la reinstallazione
  setTimeout(() => {
    if (askQuestion) askQuestion();
  }, 100);
}

function executeCleanCommand(scope, components) {
  switch (scope) {
    case "all":
      cleanAllComponents();
      break;
    case "single":
      if (components.length > 0) {
        cleanComponent(path.join(process.cwd(), components[0]));
      } else {
        logger.error("Nessun componente specificato per --single");
      }
      break;
    case "exclude":
      cleanAllComponents(components);
      break;
  }

  // Ritorna al menu dopo la pulizia
  setTimeout(() => {
    if (askQuestion) askQuestion();
  }, 100);
}

async function executeUpdateCommand() {
  // Update è sempre globale per mantenere sincronizzate le versioni
  const success = await updateAllConfigs();

  if (!success) {
    logger.log("🔄 Ritorno al menu principale...", "cyan");
  }

  // Ritorna al menu dopo l'aggiornamento
  setTimeout(() => {
    if (askQuestion) askQuestion();
  }, 100);
}

async function executeDepcheckCommand(
  scope,
  components,
  args,
  onComplete = null
) {
  // Pulisce la cache del modulo per assicurarsi di usare la versione più recente
  delete require.cache[require.resolve("./validation/depcheck")];
  const depcheckScript = require("./validation/depcheck");

  // Costruiamo gli argomenti per depcheck basandoci su scope e components
  let depcheckArgs = [];

  if (scope === "single" && components.length > 0) {
    depcheckArgs.push("--single", components[0]);
  } else if (scope === "exclude" && components.length > 0) {
    depcheckArgs.push("--exclude", ...components);
  }

  // Aggiungiamo altri argomenti se presenti
  if (args && args.length > 0) {
    depcheckArgs.push(...args);
  }

  // Passiamo gli argomenti al modulo depcheck con callback
  await depcheckScript.parseAndExecuteCommand(depcheckArgs, onComplete);
}

async function executeDepcheckCleanCommand(
  scope,
  components,
  args,
  onComplete = null
) {
  // Pulisce la cache del modulo per assicurarsi di usare la versione più recente
  delete require.cache[require.resolve("./validation/depcheck")];
  const depcheckScript = require("./validation/depcheck");

  // Costruiamo gli argomenti per depcheck basandoci su scope e components
  let depcheckArgs = [];

  if (scope === "single" && components.length > 0) {
    depcheckArgs.push("--single", components[0]);
  } else if (scope === "exclude" && components.length > 0) {
    depcheckArgs.push("--exclude", ...components);
  }

  // Aggiungiamo clean per rimozione automatica
  depcheckArgs.push("clean");

  // Aggiungiamo altri argomenti se presenti
  if (args && args.length > 0) {
    depcheckArgs.push(...args);
  }

  // Passiamo gli argomenti al modulo depcheck con callback
  await depcheckScript.parseAndExecuteCommand(depcheckArgs, onComplete);
}

function showUsage() {
  logger.error("Comando non valido. Utilizzo:");
  logger.log("");
  logger.section("Installazione");
  logger.log(
    "  node package-manager.js install [--single component] [--exclude comp1 comp2] [normal|legacy|force]"
  );
  logger.log("");
  logger.section("Reinstallazione (clean install)");
  logger.log(
    "  node package-manager.js reinstall [--single component] [--exclude comp1 comp2] [normal|legacy|force]",
    "blue"
  );
  logger.log("");
  logger.section("Pulizia");
  logger.log(
    "  node package-manager.js clean [--single component] [--exclude comp1 comp2]",
    "blue"
  );
  logger.log("");
  logger.section("Aggiornamento configurazioni");
  logger.log("  node package-manager.js update");
  logger.warning("  (sempre globale per mantenere versioni sincronizzate)");
  logger.log("");
  logger.section("Controllo dipendenze non utilizzate");
  logger.log(
    "  node package-manager.js depcheck [--single component] [--exclude comp1 comp2] [--remove]",
    "blue"
  );
  logger.log(
    "  node package-manager.js depcheck [--single component] [--exclude comp1 comp2] clean",
    "blue"
  );
  logger.log("");
  logger.section("Esempi");
  logger.success(
    "  node package-manager.js install --exclude c106-header c106-footer"
  );
  logger.success(
    "  node package-manager.js install --single c106-header force"
  );
  logger.success(
    "  node package-manager.js reinstall --exclude c106-header legacy"
  );
  logger.success("  node package-manager.js clean --single c106-header");
  logger.success("  node package-manager.js update");
  logger.success("  node package-manager.js depcheck --single c106-header");
  logger.success("  node package-manager.js depcheck --remove");
  logger.success(
    "  node package-manager.js depcheck --single c106-header clean"
  );
  logger.success(
    "  node package-manager.js depcheck --exclude c106-header c106-footer clean"
  );
  logger.log("");
  logger.section("Modalità interattiva");
  logger.log("  node package-manager.js");
}

// Funzioni per menu interattivo
function showMenu() {
  logger.section(`Gestore Pacchetti ${projectConfig.project.name}`);
  logger.success(
    "1. ⚙️  Aggiornamento configurazioni (globale | importante ad impostare dependencies-config.js)"
  );
  logger.info("2. 🔍 Controllo dipendenze non utilizzate");
  logger.info("3. 📦 Installazione pacchetti");
  logger.info("4. 🔄 Reinstallazione pacchetti (clean install)");
  logger.warning("5. 🧹 Pulizia/rimozione pacchetti");
  logger.info("9. 📁 Mostra tutti i componenti trovati");
  logger.error("0. 🚪 Esci");
}

function showComponentList() {
  const components = getComponentDirectories();
  logger.section("Componenti disponibili");
  components.forEach((component, index) => {
    logger.info(`${index + 1}. ${component}`);
  });
  logger.warning(`0. 🔙 Torna al menu principale`);
  return components;
}

function showDetailedComponentList() {
  const components = getComponentDirectories();

  logger.section("Componenti trovati nel progetto");
  logger.log("=".repeat(50));

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    logger.log("");
    logger.warning("💡 Verifica la configurazione in project-config.js:");
    logger.info("   - Filtri per prefisso, struttura, lista o regex");
    logger.info("   - Assicurati che i componenti abbiano package.json");
    logger.log("");
  } else {
    logger.success(`✅ Trovati ${components.length} componenti:`);
    logger.log("");

    components.forEach((component, index) => {
      const componentPath = path.join(process.cwd(), component);
      logger.log(`${index + 1}. 📦 ${component}`);

      // Verifica presenza file importanti
      const packageJsonPath = path.join(componentPath, "package.json");
      const tsConfigPath = path.join(componentPath, "tsconfig.json");
      const srcPath = path.join(componentPath, "src");
      const nodeModulesPath = path.join(componentPath, "node_modules");

      if (fs.existsSync(packageJsonPath)) {
        logger.log(`   ✅ package.json`, "green");
      } else {
        logger.log(`   ❌ package.json (MANCANTE!)`, "red");
      }

      if (fs.existsSync(tsConfigPath)) {
        logger.log(`   ✅ tsconfig.json`, "green");
      } else {
        logger.log(`   ⚪ tsconfig.json (opzionale)`, "blue");
      }

      if (fs.existsSync(srcPath)) {
        logger.log(`   ✅ src/`, "green");
      } else {
        logger.log(`   ❌ src/ (MANCANTE!)`, "red");
      }

      if (fs.existsSync(nodeModulesPath)) {
        logger.log(`   📦 node_modules/ (installato)`, "cyan");
      } else {
        logger.log(`   ⚪ node_modules/ (non installato)`, "yellow");
      }

      logger.log("");
    });

    logger.section("Riepilogo configurazione filtri");
    logger.log("=".repeat(50));

    if (projectConfig.components.filterByPrefix.enabled) {
      logger.log(
        `🔤 Filtro per prefisso: "${projectConfig.components.filterByPrefix.prefix}"`,
        "blue"
      );
    }

    if (projectConfig.components.filterByStructure.enabled) {
      logger.log(`📁 Filtro per struttura:`, "blue");
      logger.log(
        `   File richiesti: ${projectConfig.components.filterByStructure.requiredFiles.join(
          ", "
        )}`,
        "blue"
      );
      logger.log(
        `   Cartelle richieste: ${projectConfig.components.filterByStructure.requiredFolders.join(
          ", "
        )}`,
        "blue"
      );
    }

    if (projectConfig.components.filterByList.enabled) {
      logger.log(
        `📋 Filtro per lista: ${projectConfig.components.filterByList.folders.join(
          ", "
        )}`,
        "blue"
      );
    }

    if (projectConfig.components.filterByRegex.enabled) {
      logger.log(
        `🔍 Filtro per regex: ${projectConfig.components.filterByRegex.pattern}`,
        "blue"
      );
    }

    if (
      !projectConfig.components.filterByPrefix.enabled &&
      !projectConfig.components.filterByStructure.enabled &&
      !projectConfig.components.filterByList.enabled &&
      !projectConfig.components.filterByRegex.enabled
    ) {
      logger.log(
        `⚠️  Nessun filtro attivo - vengono mostrati tutti i componenti con package.json`,
        "yellow"
      );
    }
  }

  logger.log("");
  logger.warning("🔙 Premi INVIO per tornare al menu principale...");

  if (!rl) return;

  rl.question("", () => {
    logger.info("Tornando al menu principale...");
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
  });
}

function showInstallMenu() {
  logger.section("Modalità installazione");
  logger.info("1. Installa per tutti i componenti");
  logger.info("2. Installa per un componente");
  logger.info("3. Installa per tutti eccetto quelli specificati");
  logger.warning("0. 🔙 Torna al menu principale");

  if (!rl) return;

  rl.question("Scegli modalità installazione (0-3): ", (installAnswer) => {
    switch (installAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        showInstallModeMenu("all", []);
        break;
      case "2":
        showComponentSelectionMenu("single");
        break;
      case "3":
        showExcludeSelectionMenu();
        break;
      default:
        logger.error("❌ Scelta non valida per installazione");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function showInstallModeMenu(scope, components) {
  logger.section("Modalità installazione");
  logger.info("1. Normale");
  logger.warning("2. --legacy-peer-deps");
  logger.warning("3. --force");
  logger.warning("0. 🔙 Torna al menu principale");

  if (!rl) return;

  rl.question("Scegli modalità (0-3): ", (modeAnswer) => {
    let mode = "normal";
    switch (modeAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
      case "1":
        mode = "normal";
        break;
      case "2":
        mode = "legacy";
        break;
      case "3":
        mode = "force";
        break;
      default:
        logger.error("❌ Modalità non valida");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
    }

    if (scope === "all") {
      logger.log(
        "\n⚠️  Questo installerà i pacchetti per TUTTI i componenti!",
        "yellow"
      );
      rl.question("Continua? (y/N): ", (confirm) => {
        if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
          executeInstallCommand(scope, components, mode);
        }
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      });
    } else {
      executeInstallCommand(scope, components, mode);
    }
  });
}

function showComponentSelectionMenu(scope) {
  const components = showComponentList();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }

  if (!rl) return;

  rl.question(
    "\nInserisci numero componente (0 per tornare al menu): ",
    (answer) => {
      if (answer.trim() === "0") {
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
      }

      const index = parseInt(answer) - 1;

      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        logger.log(`\n🎯 Selezionato: ${selectedComponent}`, "green");
        showInstallModeMenu(scope, [selectedComponent]);
      } else {
        logger.error("Numero componente non valido");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    }
  );
}

function showExcludeSelectionMenu() {
  if (!rl) return;

  rl.question(
    "Inserisci nomi componenti da escludere (separati da spazio): ",
    (excludeAnswer) => {
      const excludeList = excludeAnswer
        .trim()
        .split(/\s+/)
        .filter((name) => name.length > 0);
      if (excludeList.length > 0) {
        logger.log(
          `\n⚠️  Questo installerà per tutti i componenti eccetto: ${excludeList.join(
            ", "
          )}`,
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (
            confirm.toLowerCase() === "y" ||
            confirm.toLowerCase() === "yes"
          ) {
            showInstallModeMenu("exclude", excludeList);
          } else {
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
      } else {
        logger.error("Nessun componente specificato per esclusione");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    }
  );
}

function showReinstallMenu() {
  logger.section("Modalità reinstallazione");
  logger.log("1. Reinstalla per tutti i componenti", "blue");
  logger.log("2. Reinstalla per un componente", "blue");
  logger.log("3. Reinstalla per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu principale");

  if (!rl) return;

  rl.question("Scegli modalità reinstallazione (0-3): ", (reinstallAnswer) => {
    switch (reinstallAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        logger.log(
          "\n⚠️  Questo rimuoverà tutti i file node_modules e package-lock.json!",
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (
            confirm.toLowerCase() === "y" ||
            confirm.toLowerCase() === "yes"
          ) {
            showInstallModeMenu("all", []);
          } else {
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
        break;
      case "2":
        showComponentSelectionMenu("single");
        break;
      case "3":
        showExcludeSelectionMenu();
        break;
      default:
        logger.log("❌ Scelta non valida per reinstallazione", "red");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function showCleanMenu() {
  logger.log("\n🧹 Modalità pulizia:", "yellow");
  logger.log("1. Pulisci tutti i componenti", "blue");
  logger.log("2. Pulisci un componente", "blue");
  logger.log("3. Pulisci tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu principale");

  if (!rl) return;

  rl.question("Scegli opzione pulizia (0-3): ", (cleanAnswer) => {
    switch (cleanAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        logger.log(
          "\n⚠️  Questo rimuoverà node_modules, package-lock.json e tslint.json da TUTTI i componenti!",
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (
            confirm.toLowerCase() === "y" ||
            confirm.toLowerCase() === "yes"
          ) {
            cleanAllComponents();
          }
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        });
        break;
      case "2":
        const components = showComponentList();
        if (components.length === 0) {
          logger.error("Nessun componente trovato");
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
          return;
        }

        rl.question(
          "\nInserisci numero componente per pulizia (0 per tornare al menu): ",
          (answer) => {
            if (answer.trim() === "0") {
              logger.info("Tornando al menu principale...");
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
              return;
            }

            const index = parseInt(answer) - 1;

            if (index >= 0 && index < components.length) {
              const selectedComponent = components[index];
              logger.log(
                `\n🎯 Selezionato per pulizia: ${selectedComponent}`,
                "green"
              );
              cleanComponent(path.join(process.cwd(), selectedComponent));
              logger.log("\n✅ Pulizia completata!", "green");
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
            } else {
              logger.error("Numero componente non valido");
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
            }
          }
        );
        break;
      case "3":
        rl.question(
          "Inserisci nomi componenti da escludere (separati da spazio): ",
          (excludeAnswer) => {
            const excludeList = excludeAnswer
              .trim()
              .split(/\s+/)
              .filter((name) => name.length > 0);
            if (excludeList.length > 0) {
              logger.log(
                `\n⚠️  Questo rimuoverà file da tutti i componenti eccetto: ${excludeList.join(
                  ", "
                )}`,
                "yellow"
              );
              rl.question("Continua? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  cleanAllComponents(excludeList);
                }
                setTimeout(() => {
                  if (askQuestion) askQuestion();
                }, 100);
              });
            } else {
              logger.error("Nessun componente specificato per esclusione");
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
            }
          }
        );
        break;
      default:
        logger.log("❌ Scelta non valida per pulizia", "red");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

async function main() {
  logger.log(
    `🚀 ${projectConfig.project.name} - ${projectConfig.project.description}`,
    "bright"
  );

  const args = process.argv.slice(2);

  // Se sono passati argomenti da riga di comando
  if (args.length > 0) {
    await parseAndExecuteCommand(args);
    return;
  }

  // Modalità interattiva
  try {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Gestione errori readline
    rl.on("error", (err) => {
      logger.log(`❌ Errore readline: ${err.message}`, "red");
    });

    rl.on("close", () => {
      logger.log("\n👋 Interfaccia chiusa", "blue");
      process.exit(0);
    });

    // Gestione SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      logger.log("\n\n👋 Arrivederci!", "green");
      if (rl) rl.close();
      process.exit(0);
    });

    askQuestion = function () {
      if (rl && rl.closed) {
        return;
      }

      // Mostra il menu e chiedi l'opzione
      showMenu();
      if (rl) {
        rl.question("\nScegli opzione (0-5, 9): ", (answer) => {
          switch (answer.trim()) {
            case "1":
              logger.log(
                "\n⚙️  Aggiornamento configurazioni per tutti i componenti...",
                "cyan"
              );
              logger.log(
                "⚠️  Questo aggiornerà le configurazioni per TUTTI i componenti!",
                "yellow"
              );
              if (rl) {
                rl.question("Continua? (y/N): ", async (confirm) => {
                  if (
                    confirm.toLowerCase() === "y" ||
                    confirm.toLowerCase() === "yes"
                  ) {
                    const success = await updateAllConfigs();
                    if (!success) {
                      logger.log("🔄 Ritorno al menu principale...", "cyan");
                    }
                  }
                  setTimeout(() => {
                    if (askQuestion) askQuestion();
                  }, 100);
                });
              }
              break;
            case "2":
              showDepcheckMenu();
              break;
            case "3":
              showInstallMenu();
              break;
            case "4":
              showReinstallMenu();
              break;
            case "5":
              showCleanMenu();
              break;
            case "9":
              showDetailedComponentList();
              break;
            case "0":
              logger.log("👋 Arrivederci!", "green");
              if (rl) rl.close();
              break;
            default:
              logger.log("❌ Scelta non valida. Riprova.", "red");
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
          }
        });
      }
    };

    askQuestion();
  } catch (error) {
    logger.log(`❌ Errore durante l'inizializzazione: ${error.message}`, "red");
    process.exit(1);
  }
}

// Avvio script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  getComponentDirectories,
  installPackages,
  cleanComponent,
  installAllComponents,
  cleanAllComponents,
  updateAllConfigs,
  showDepcheckMenu,
};
