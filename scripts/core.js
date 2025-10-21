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

// Import common utilities
const { 
  isWindows, 
  getNpmCommand, 
  getComponentDirectories,
  loadPackageJson,
  fileExists,
  getProjectRoot
} = require("./utils/common");

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

// Abilita il logging su file per tutte le operazioni
logger.enableFileLogging(true, projectRoot);
logger.log(`📝 Logging abilitato: ${logger.getLogFilePath()}`, "blue");

// Variabili globali per readline
let rl = null;
let askQuestion = null;



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
  
  if (!projectConfig.files || !projectConfig.files.packageJson) {
    logger.log(`❌ projectConfig.files.packageJson non definito`, "red");
    return false;
  }
  
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

    logger.log(`🔄 Avvio: ${getNpmCommand(projectConfig)} ${npmArgs.join(" ")}`, "blue");

    const result = execSync(`${getNpmCommand(projectConfig)} ${npmArgs.join(" ")}`, {
      stdio: "inherit",
      cwd: componentPath,
    });

    logger.log(
      `✅ Installati con successo i pacchetti per ${componentName}`,
      "green"
    );
    return true;
  } catch (error) {
    logger.log(
      `❌ Errore durante l'installazione dei pacchetti per ${componentName}: ${error.message}`,
      "red"
    );
    return false;
  } finally {
    // Torniamo alla directory originale del progetto
    process.chdir(projectRoot);
  }
}

// Funzioni per aggiornamento configurazioni
async function updateAllConfigs() {
  const updateScript = require("./update-configs");
  return await updateScript.updateAllConfigs();
}

// Funzioni per depcheck
function showDepcheckMenu() {
  logger.section("Controllo dipendenze non utilizzate (experimental)");
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
  const components = getComponentDirectories(projectConfig);

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
  const originalCwd = process.cwd(); // Save original directory

  components.forEach((component, index) => {
    logger.log(
      `\n[${index + 1}/${totalCount}] Elaborazione ${component}...`,
      "magenta"
    );
    const componentPath = path.join(originalCwd, component);
    const success = installPackages(componentPath, mode);
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
      await executeUpdateCommand(scope, components);
      break;
    case "depcheck":
      // Support both 'clean' and '--remove' as removal triggers
      const hasClean = args.includes("clean") || args.includes("--remove");
      if (hasClean) {
        // Rimuoviamo 'clean' dagli argomenti
        const cleanArgs = args.filter((arg) => arg !== "clean" && arg !== "--remove");
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
      const allComponents = getComponentDirectories(projectConfig);
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

async function executeUpdateCommand(scope = "all", components = []) {
  // Passa i parametri di scope e components al modulo update-configs
  const success = await updateAllConfigs(scope, components);

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
  logger.section("Controllo dipendenze non utilizzate (experimental)");
  logger.log(
    "  node package-manager.js depcheck [--single component] [--exclude comp1 comp2] [clean|--remove]",
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
  // Reload project config to get latest settings
  try {
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    // Clear all cached modules
    Object.keys(require.cache).forEach(key => {
      if (key.includes('project-config') || key.includes('package-manager')) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);
  } catch (error) {
    // Use cached version if reload fails
  }
  
  // Get search mode indicator
  const recursiveEnabled = projectConfig.components.recursiveSearch?.enabled;
  
  logger.section(`📋 Gestore Pacchetti ${projectConfig.project.name}`);
  
  if (recursiveEnabled) {
    logger.info("🔍 Modalità ricerca: RICORSIVA - Scansiona progetti in sottocartelle");
    const maxDepth = projectConfig.components.recursiveSearch?.maxDepth;
    if (maxDepth) {
      logger.info(`📊 Profondità massima: ${maxDepth} livelli`);
    } else {
      logger.info("📊 Profondità massima: ILLIMITATA");
    }
  } else {
    logger.info("📁 Modalità ricerca: STANDARD - Solo cartelle di primo livello");
  }
  
  // Empty line to separate info from menu
  logger.space();
  logger.success("1. ⚙️ Aggiornamento configurazioni (importante ad impostare dependencies-config.js)");
  logger.info("2. 📦 Installazione pacchetti");
  logger.info("3. 🔄 Reinstallazione pacchetti (clean install)");
  logger.warning("4. 🧹 Pulizia/rimozione pacchetti");
  logger.info("5. 📝 Visualizza log delle operazioni");
  logger.warning("6. 🔬 EXPERIMENTAL - Funzioni sperimentali");
  logger.space();
  logger.info("9. 📁 Mostra tutti i componenti trovati");
  logger.error("0. 🚪Esci");
}

function showComponentList() {
  const components = getComponentDirectories(projectConfig);
  logger.section("Componenti disponibili");
  components.forEach((component, index) => {
    logger.info(`${index + 1}. ${component}`);
  });
  logger.warning(`0. 🔙 Torna al menu principale`);
  return components;
}

function showLogsMenu() {
  logger.section("📝 Gestione Log delle Operazioni");
  
  const logsDir = path.join(projectRoot, "package-manager", "logs");
  
  if (!fs.existsSync(logsDir)) {
    logger.warning("📁 Cartella logs non trovata");
    logger.info("I log verranno creati automaticamente durante le operazioni");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");
    
    if (!rl) return;
    rl.question("", () => {
      logger.info("Tornando al menu principale...");
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 500);
    });
    return;
  }
  
  const logFiles = fs.readdirSync(logsDir)
    .filter(file => file.startsWith('session-') && file.endsWith('.log'))
    .map(file => ({
      name: file,
      path: path.join(logsDir, file),
      stats: fs.statSync(path.join(logsDir, file))
    }))
    .sort((a, b) => b.stats.mtime - a.stats.mtime);
  
  if (logFiles.length === 0) {
    logger.warning("📁 Nessun file di log trovato");
    logger.info("I log verranno creati durante le operazioni");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");
    
    if (!rl) return;
    rl.question("", () => {
      logger.info("Tornando al menu principale...");
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 500);
    });
    return;
  }
  
  logger.info(`📁 Trovati ${logFiles.length} file di log:`);
  logFiles.forEach((file, index) => {
    const date = file.stats.mtime.toLocaleString();
    const size = (file.stats.size / 1024).toFixed(1);
    logger.log(`   ${index + 1}. ${file.name} (${date}, ${size} KB)`, "blue");
  });
  
  logger.info("1. Visualizza log più recente");
  logger.info("2. Visualizza log specifico");
  logger.info("3. Pulisci log vecchi (mantiene solo gli ultimi 10)");
  logger.warning("0. 🔙 Torna al menu principale");
  
  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showLogContent(logFiles[0].path);
        break;
      case "2":
        showLogSelection(logFiles);
        break;
      case "3":
        cleanupLogs();
        break;
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 500);
        break;
      default:
        logger.log("❌ Scelta non valida. Riprova.", "red");
        setTimeout(() => {
          showLogsMenu();
        }, 1000);
    }
  });
}

function showLogContent(logPath) {
  logger.section(`📄 Contenuto Log: ${path.basename(logPath)}`);
  
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    
    logger.info(`📊 Totale righe: ${lines.length}`);
    logger.info("📄 Ultime 50 righe del log:");
    logger.log("─".repeat(80), "blue");
    
    const lastLines = lines.slice(-50);
    lastLines.forEach(line => {
      if (line.trim()) {
        logger.log(line, "white");
      }
    });
    
    logger.log("─".repeat(80), "blue");
    logger.warning("🔙 Premi INVIO per tornare al menu log...");
    
    if (!rl) return;
    rl.question("", () => {
      showLogsMenu();
    });
    
  } catch (error) {
    logger.error(`Errore leggendo log: ${error.message}`);
    logger.warning("🔙 Premi INVIO per tornare al menu log...");
    
    if (!rl) return;
    rl.question("", () => {
      showLogsMenu();
    });
  }
}

function showLogSelection(logFiles) {
  logger.section("📄 Seleziona Log da Visualizzare");
  
  logFiles.forEach((file, index) => {
    const date = file.stats.mtime.toLocaleString();
    const size = (file.stats.size / 1024).toFixed(1);
    logger.log(`   ${index + 1}. ${file.name} (${date}, ${size} KB)`, "blue");
  });
  
  logger.warning("0. 🔙 Torna al menu log");
  
  if (!rl) return;
  rl.question("\nScegli numero log: ", (answer) => {
    const index = parseInt(answer) - 1;
    if (index >= 0 && index < logFiles.length) {
      showLogContent(logFiles[index].path);
    } else if (answer.trim() === "0") {
      showLogsMenu();
    } else {
      logger.log("❌ Scelta non valida. Riprova.", "red");
      setTimeout(() => {
        showLogSelection(logFiles);
      }, 1000);
    }
  });
}

function cleanupLogs() {
  logger.section("🧹 Pulizia Log Vecchi");
  
  try {
    logger.cleanupOldLogs(projectRoot, 10);
    logger.success("✅ Pulizia log completata");
    logger.info("Mantenuti solo gli ultimi 10 file di log");
  } catch (error) {
    logger.error(`Errore durante la pulizia: ${error.message}`);
  }
  
  logger.warning("🔙 Premi INVIO per tornare al menu log...");
  
  if (!rl) return;
  rl.question("", () => {
    showLogsMenu();
  });
}

function showDetailedComponentList() {
  // Reload project config to get latest settings
  try {
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    // Clear all cached modules
    Object.keys(require.cache).forEach(key => {
      if (key.includes('project-config')) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("Could not reload project config, using cached version");
  }
  
  const components = getComponentDirectories(projectConfig);

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

function showUpdateMenu() {
  logger.section("⚙️  Aggiornamento configurazioni");
  logger.info("1. Tutte le web parts");
  logger.info("2. Una web part specifica");
  logger.info("3. Tutte eccetto quelle specificate");
  logger.warning("0. 🔙 Torna al menu principale");

  if (rl) {
    rl.question("\nScegli opzione (0-3): ", (answer) => {
      switch (answer.trim()) {
        case "1":
          showUpdateConfirmation("all", []);
          break;
        case "2":
          showUpdateComponentSelection();
          break;
        case "3":
          showUpdateExcludeSelection();
          break;
        case "0":
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
          break;
        default:
          logger.error("❌ Scelta non valida per aggiornamento");
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
      }
    });
  }
}

function showUpdateComponentSelection() {
  const components = showComponentList();
  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }

  if (rl) {
    rl.question(`\nScegli componente (1-${components.length}): `, (answer) => {
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        showUpdateConfirmation("single", [selectedComponent]);
      } else {
        logger.error("❌ Componente non valido");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    });
  }
}

function showUpdateExcludeSelection() {
  const components = showComponentList();
  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }

  if (rl) {
    rl.question("\nInserisci i nomi dei componenti da escludere (separati da spazio): ", (answer) => {
      const excludeList = answer.trim().split(/\s+/).filter(name => name.length > 0);
      const validExcludes = excludeList.filter(name => components.includes(name));
      
      if (validExcludes.length > 0) {
        showUpdateConfirmation("exclude", validExcludes);
      } else {
        logger.error("❌ Nessun componente valido specificato");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    });
  }
}

async function showUpdateConfirmation(scope, components) {
  // Prima mostra cosa verrà aggiornato
  await showUpdatePreview(scope, components);
  
  if (rl) {
    rl.question("\n⚠️  Continuare con l'aggiornamento? (y/N): ", async (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        logger.log("\n🚀 Avvio aggiornamento...", "cyan");
        const success = await updateAllConfigs(scope, components);
        if (!success) {
          logger.log("🔄 Ritorno al menu principale...", "cyan");
        }
      } else {
        logger.log("❌ Aggiornamento annullato", "yellow");
      }
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 100);
    });
  }
}

async function showUpdatePreview(scope, components) {
  logger.section("📋 Anteprima aggiornamento");
  
  // Carica la configurazione per mostrare cosa verrà aggiornato
  const dependenciesConfigPath = path.join(projectRoot, "package-manager", "dependencies-config.js");
  
  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.error("❌ dependencies-config.js non trovato!");
    return;
  }

  try {
    // Ricarica il modulo dependencies-config
    delete require.cache[require.resolve(dependenciesConfigPath)];
    const depsConfig = require(dependenciesConfigPath);

    const baseDeps = depsConfig.getBaseDependencies ? depsConfig.getBaseDependencies() : {};
    const devDeps = depsConfig.getDevDependencies ? depsConfig.getDevDependencies() : {};
    const scripts = depsConfig.getStandardScripts ? depsConfig.getStandardScripts() : {};
    const deprecatedDeps = depsConfig.getDeprecatedDependencies ? depsConfig.getDeprecatedDependencies() : [];
    const conditionalDeps = depsConfig.getConditionalDependencies ? depsConfig.getConditionalDependencies() : {};

    // Log per debug
    if (Object.keys(conditionalDeps).length > 0) {
      logger.log(`🔍 Trovate ${Object.keys(conditionalDeps).length} dipendenze condizionali`, "blue");
    }

    // Determina i componenti che verranno aggiornati
    const { getComponentDirectories } = require("./dependencies/analyzer");
    let targetComponents = getComponentDirectories(projectConfig);
    
    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter(comp => components.includes(comp));
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter(comp => !components.includes(comp));
    }

    logger.log(`📁 Componenti da aggiornare: ${targetComponents.length}`, "blue");
    targetComponents.forEach(comp => logger.log(`   - ${comp}`, "blue"));

    // Analizza le modifiche per ogni componente
    let totalNewDeps = 0;
    let totalUpdatedDeps = 0;
    let totalNewDevDeps = 0;
    let totalUpdatedDevDeps = 0;
    let totalDeprecatedToRemove = 0;
    let totalScriptsToUpdate = 0;

    for (const component of targetComponents) {
      const componentPath = path.join(projectRoot, component);
      const packageJsonPath = path.join(componentPath, "package.json");
      
      if (!fs.existsSync(packageJsonPath)) {
        logger.warning(`⚠️  package.json non trovato per ${component}`, "yellow");
        continue;
      }

      try {
        const currentPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const currentDeps = currentPkg.dependencies || {};
        const currentDevDeps = currentPkg.devDependencies || {};
        const currentScripts = currentPkg.scripts || {};

        // Analizza dependencies (base + conditional per questo componente)
        const usedConditionalDeps = analyzeDependencyUsageForComponent(componentPath, conditionalDeps);
        const targetDeps = { ...baseDeps, ...usedConditionalDeps };
        
        
        const { newDeps, updatedDeps } = analyzeDependencies(currentDeps, targetDeps);
        totalNewDeps += newDeps.length;
        totalUpdatedDeps += updatedDeps.length;

        // Analizza devDependencies
        const { newDeps: newDevDeps, updatedDeps: updatedDevDeps } = analyzeDependencies(currentDevDeps, devDeps);
        totalNewDevDeps += newDevDeps.length;
        totalUpdatedDevDeps += updatedDevDeps.length;

        // Analizza deprecated dependencies
        const deprecatedToRemove = deprecatedDeps.filter(dep => 
          currentDeps[dep] || currentDevDeps[dep]
        );
        totalDeprecatedToRemove += deprecatedToRemove.length;

        // Analizza scripts
        const scriptsToUpdate = Object.entries(scripts).filter(([name, script]) => 
          !currentScripts[name] || currentScripts[name] !== script
        );
        totalScriptsToUpdate += scriptsToUpdate.length;

        // Mostra dettagli solo se ci sono modifiche per questo componente
        if (newDeps.length > 0 || updatedDeps.length > 0 || newDevDeps.length > 0 || 
            updatedDevDeps.length > 0 || deprecatedToRemove.length > 0 || scriptsToUpdate.length > 0) {
          
          logger.log(`\n📦 ${component}:`, "blue");
          
          if (newDeps.length > 0) {
            logger.log(`   🆕 Nuove dipendenze (${newDeps.length}):`, "green");
            newDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "green");
            });
          }

          if (updatedDeps.length > 0) {
            logger.log(`   🔄 Dipendenze da aggiornare (${updatedDeps.length}):`, "yellow");
            updatedDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(`      ${name}: ${currentVersion} → ${newVersion}`, "yellow");
            });
          }

          if (newDevDeps.length > 0) {
            logger.log(`   🆕 Nuove devDependencies (${newDevDeps.length}):`, "cyan");
            newDevDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "cyan");
            });
          }

          if (updatedDevDeps.length > 0) {
            logger.log(`   🔄 DevDependencies da aggiornare (${updatedDevDeps.length}):`, "yellow");
            updatedDevDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(`      ${name}: ${currentVersion} → ${newVersion}`, "yellow");
            });
          }

          if (deprecatedToRemove.length > 0) {
            logger.log(`   🗑️  Deprecated da rimuovere (${deprecatedToRemove.length}):`, "red");
            deprecatedToRemove.forEach(dep => {
              const currentVersion = currentDeps[dep] || currentDevDeps[dep];
              logger.log(`      - ${dep}@${currentVersion}`, "red");
            });
          }

          if (scriptsToUpdate.length > 0) {
            logger.log(`   📝 Scripts da aggiornare (${scriptsToUpdate.length}):`, "magenta");
            scriptsToUpdate.forEach(([name, newScript]) => {
              const currentScript = currentScripts[name] || "(non presente)";
              logger.log(`      ${name}: "${currentScript}" → "${newScript}"`, "magenta");
            });
          }
        } else {
          logger.log(`\n✅ ${component}: nessuna modifica necessaria`, "green");
        }

      } catch (error) {
        logger.error(`❌ Errore analizzando ${component}: ${error.message}`);
      }
    }

    // Riepilogo finale
    logger.log(`\n📊 Riepilogo modifiche:`, "blue");
    if (totalNewDeps > 0) logger.log(`   🆕 Nuove dipendenze: ${totalNewDeps}`, "green");
    if (totalUpdatedDeps > 0) logger.log(`   🔄 Dipendenze aggiornate: ${totalUpdatedDeps}`, "yellow");
    if (totalNewDevDeps > 0) logger.log(`   🆕 Nuove devDependencies: ${totalNewDevDeps}`, "cyan");
    if (totalUpdatedDevDeps > 0) logger.log(`   🔄 DevDependencies aggiornate: ${totalUpdatedDevDeps}`, "yellow");
    if (totalDeprecatedToRemove > 0) logger.log(`   🗑️  Deprecated rimosse: ${totalDeprecatedToRemove}`, "red");
    if (totalScriptsToUpdate > 0) logger.log(`   📝 Scripts aggiornati: ${totalScriptsToUpdate}`, "magenta");

    const totalChanges = totalNewDeps + totalUpdatedDeps + totalNewDevDeps + totalUpdatedDevDeps + totalDeprecatedToRemove + totalScriptsToUpdate;
    if (totalChanges === 0) {
      logger.log(`\n✅ Tutti i componenti sono già aggiornati!`, "green");
    }

  } catch (error) {
    logger.error(`❌ Errore caricando configurazione: ${error.message}`);
    logger.warning("💡 Assicurati che dependencies-config.js contenga tutte le funzioni necessarie");
  }
}

function analyzeDependencies(currentDeps, targetDeps) {
  const newDeps = [];
  const updatedDeps = [];

  for (const [name, targetVersion] of Object.entries(targetDeps)) {
    if (!currentDeps[name]) {
      // Nuova dipendenza
      newDeps.push([name, targetVersion]);
    } else if (currentDeps[name] !== targetVersion) {
      // Versione diversa
      updatedDeps.push([name, currentDeps[name], targetVersion]);
    }
    // Se la versione è uguale, non fare nulla
  }

  return { newDeps, updatedDeps };
}

function analyzeDependencyUsageForComponent(componentPath, conditionalDeps) {
  const usedDeps = {};
  
  Object.entries(conditionalDeps).forEach(([depName, depConfig]) => {
    const patterns = depConfig.patterns || [depName];
    const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);
    
    if (foundPatterns.length > 0) {
      usedDeps[depName] = depConfig.version;
    }
  });
  
  return usedDeps;
}

function scanDirectoryForPatterns(dirPath, patterns, extensions = [".js", ".ts", ".tsx", ".jsx"]) {
  const results = new Set();

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      patterns.forEach((pattern) => {
        if (content.includes(pattern)) {
          results.add(pattern);
        }
      });
    } catch (error) {
      // Ignora errori di lettura file
    }
  }

  function scanDirectory(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);
      items.forEach((item) => {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Salta node_modules e altre cartelle da ignorare
          if (!["node_modules", ".git", "dist", "build"].includes(item)) {
            scanDirectory(fullPath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item);
          if (extensions.includes(ext)) {
            scanFile(fullPath);
          }
        }
      });
    } catch (error) {
      // Ignora errori di accesso directory
    }
  }

  scanDirectory(dirPath);
  return Array.from(results);
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
  // Reload project config to get latest settings
  try {
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    // Clear all cached modules
    Object.keys(require.cache).forEach(key => {
      if (key.includes('project-config')) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("Could not reload project config, using cached version");
  }
  
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
        rl.question("\nScegli opzione (0-6, 9): ", (answer) => {
          switch (answer.trim()) {
            case "1":
              showUpdateMenu();
              break;
            case "2":
              showInstallMenu();
              break;
            case "3":
              showReinstallMenu();
              break;
            case "4":
              showCleanMenu();
              break;
            case "5":
              showLogsMenu();
              break;
            case "6":
              showExperimentalMenu();
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

// Experimental menu functions
function showExperimentalMenu() {
  logger.section("🔬 EXPERIMENTAL - Funzioni Sperimentali");
  logger.warning("Attenzione: queste funzioni sono in fase di test");
  logger.info("1. Analisi profonda - Mostra progetti a tutti i livelli");
  logger.info("2. Cambia modalita di ricerca progetti (ricorsiva on/off)");
  logger.info("3. 🔍 Controllo dipendenze non utilizzate");
  logger.warning("0. Torna al menu principale");
  
  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showDeepAnalysis();
        break;
      case "2":
        toggleRecursiveSearch();
        break;
      case "3":
        showDepcheckMenu();
        break;
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 500);
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showExperimentalMenu(), 1000);
    }
  });
}

function showDeepAnalysis() {
  logger.section("Analisi Profonda Progetti");
  
  // Reload project config to get latest settings
  try {
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    Object.keys(require.cache).forEach(key => {
      if (key.includes('project-config')) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("Could not reload project config, using cached version");
  }
  
  const recursiveEnabled = projectConfig.components.recursiveSearch?.enabled || false;
  const maxDepth = projectConfig.components.recursiveSearch?.maxDepth;
  
  logger.info(`Ricerca ricorsiva: ${recursiveEnabled ? 'ABILITATA' : 'DISABILITATA'}`);
  if (recursiveEnabled && maxDepth) {
    logger.info(`Profondita massima: ${maxDepth} livelli`);
  } else if (recursiveEnabled) {
    logger.info(`Profondita massima: ILLIMITATA`);
  }
  
  logger.log("\nScansione in corso...", "cyan");
  
  const components = getComponentDirectories(projectConfig);
  
  logger.success(`\nTrovati ${components.length} progetti:`);
  
  // Group by depth level
  const byLevel = {};
  components.forEach(comp => {
    const depth = comp.split(path.sep).length - 1;
    if (!byLevel[depth]) byLevel[depth] = [];
    byLevel[depth].push(comp);
  });
  
  Object.keys(byLevel).sort().forEach(level => {
    logger.log(`\nLivello ${level}:`, "blue");
    byLevel[level].forEach(comp => {
      const pkgPath = path.join(process.cwd(), comp, 'package.json');
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        logger.log(`  - ${comp} (${pkg.name}@${pkg.version})`, "green");
      } catch (e) {
        logger.log(`  - ${comp}`, "yellow");
      }
    });
  });
  
  logger.warning("\nPremi INVIO per tornare al menu sperimentale...");
  if (!rl) return;
  rl.question("", () => showExperimentalMenu());
}

function toggleRecursiveSearch() {
  logger.section("Cambio Modalita Ricerca");
  
  const currentState = projectConfig.components.recursiveSearch?.enabled || false;
  logger.info(`Stato attuale: ${currentState ? 'RICORSIVA' : 'STANDARD'}`);
  
  if (currentState) {
    // Se attualmente abilitata, mostra solo opzioni per disabilitare
    logger.info("1. Disabilita ricerca ricorsiva");
    logger.info("2. Configura profondita massima");
    logger.warning("0. Annulla");
    
    if (!rl) return;
    rl.question("\nScegli opzione: ", async (answer) => {
      switch (answer.trim()) {
        case "1":
          await disableRecursiveSearch();
          break;
        case "2":
          await configureMaxDepth();
          break;
        case "0":
          showExperimentalMenu();
          break;
        default:
          logger.log("Scelta non valida", "red");
          setTimeout(() => toggleRecursiveSearch(), 1000);
      }
    });
  } else {
    // Se attualmente disabilitata, mostra solo opzioni per abilitare
    logger.info("1. Abilita ricerca ricorsiva");
    logger.info("2. Configura profondita massima");
    logger.warning("0. Annulla");
    
    if (!rl) return;
    rl.question("\nScegli opzione: ", async (answer) => {
      switch (answer.trim()) {
        case "1":
          await enableRecursiveSearch();
          break;
        case "2":
          await configureMaxDepth();
          break;
        case "0":
          showExperimentalMenu();
          break;
        default:
          logger.log("Scelta non valida", "red");
          setTimeout(() => toggleRecursiveSearch(), 1000);
      }
    });
  }
}

async function enableRecursiveSearch() {
  const configPath = path.join(projectRoot, "package-manager", "project-config.js");
  
  // Read, modify, and write config
  try {
    let configContent = fs.readFileSync(configPath, 'utf8');
    
    // Check if recursiveSearch section exists
    if (configContent.includes('recursiveSearch:')) {
      // Update existing recursiveSearch.enabled to true
      configContent = configContent.replace(
        /(recursiveSearch:\s*\{[^}]*enabled:\s*)(false)/,
        '$1true'
      );
    } else {
      // Add recursiveSearch section if it doesn't exist
      const recursiveSearchSection = `    
    // Configurazione ricerca ricorsiva
    recursiveSearch: {
      enabled: true,
      maxDepth: 3,
      excludeDirs: ["node_modules","dist","build",".git","coverage"]
    }`;
      
      // Insert before the closing brace of components
      configContent = configContent.replace(
        /(\s*)(\},\s*\/\/ Configurazione file)/,
        `$1${recursiveSearchSection}$1$2`
      );
    }
    
    fs.writeFileSync(configPath, configContent, 'utf8');
    
    // Reload config
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
    
    logger.success("Ricerca ricorsiva ABILITATA");
    logger.info("Riavvia il package manager per applicare le modifiche");
  } catch (error) {
    logger.error(`Errore: ${error.message}`);
  }
  
  logger.warning("\nPremi INVIO per tornare...");
  if (!rl) return;
  rl.question("", () => showExperimentalMenu());
}

async function disableRecursiveSearch() {
  const configPath = path.join(projectRoot, "package-manager", "project-config.js");
  
  try {
    let configContent = fs.readFileSync(configPath, 'utf8');
    
    // Check if recursiveSearch section exists
    if (configContent.includes('recursiveSearch:')) {
      // Update existing recursiveSearch.enabled to false
      configContent = configContent.replace(
        /(recursiveSearch:\s*\{[^}]*enabled:\s*)(true)/,
        '$1false'
      );
    } else {
      // Add recursiveSearch section if it doesn't exist (disabled by default)
      const recursiveSearchSection = `    
    // Configurazione ricerca ricorsiva
    recursiveSearch: {
      enabled: false,
      maxDepth: 3,
      excludeDirs: ["node_modules","dist","build",".git","coverage"]
    }`;
      
      // Insert before the closing brace of components
      configContent = configContent.replace(
        /(\s*)(\},\s*\/\/ Configurazione file)/,
        `$1${recursiveSearchSection}$1$2`
      );
    }
    
    fs.writeFileSync(configPath, configContent, 'utf8');
    
    // Reload config
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
    
    logger.success("Ricerca ricorsiva DISABILITATA");
    logger.info("Riavvia il package manager per applicare le modifiche");
  } catch (error) {
    logger.error(`Errore: ${error.message}`);
  }
  
  logger.warning("\nPremi INVIO per tornare...");
  if (!rl) return;
  rl.question("", () => showExperimentalMenu());
}

async function configureMaxDepth() {
  logger.info("Configura profondita massima ricerca");
  logger.warning("NOTA: modifica manualmente project-config.js");
  logger.info("Imposta components.recursiveSearch.maxDepth a:");
  logger.info("  - Numero (es: 3) per limitare la profondita");
  logger.info("  - null per ricerca illimitata");
  
  logger.warning("\nPremi INVIO per tornare...");
  if (!rl) return;
  rl.question("", () => showExperimentalMenu());
}

module.exports = {
  main,
  parseAndExecuteCommand,
  installPackages,
  cleanComponent,
  installAllComponents,
  cleanAllComponents,
  updateAllConfigs,
  showDepcheckMenu,
};
