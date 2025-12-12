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
  getProjectRoot,
  removeDirectory,
  removeFile,
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


// cleanComponent ora importato da operations/cleaner
function cleanComponent(componentPath) {
  return cleanComponentFromModule(componentPath, projectConfig);
}

function installPackages(componentPath, mode = "normal") {
  // Reload project config to get latest settings
  let currentProjectConfig = projectConfig;
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    currentProjectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  // Auto-detect workspace configuration from files
  const {
    detectWorkspaceConfiguration,
  } = require("./utils/workspace-detector");
  const workspaceDetection = detectWorkspaceConfiguration(process.cwd());

  // Resolve lock file conflicts before proceeding
  const { resolveLockFileConflicts } = require("./operations/cleaner");
  resolveLockFileConflicts(currentProjectConfig);

  // Check if workspace mode is enabled in config OR detected from files
  let isWorkspaceMode =
    currentProjectConfig.workspace?.enabled &&
    currentProjectConfig.workspace?.initialized;

  // If workspace is detected in files but not enabled in config, auto-enable it
  if (
    workspaceDetection &&
    workspaceDetection.hasWorkspaceConfig &&
    workspaceDetection.hasYarnLock &&
    !isWorkspaceMode
  ) {
    logger.section("🔍 Rilevamento automatico Yarn Workspace");
    logger.info("📦 Trovati workspaces in root package.json");
    logger.info(`📊 Numero workspace: ${workspaceDetection.workspaceCount}`);
    logger.info(`📁 Package manager: ${workspaceDetection.packageManager}`);

    // Auto-enable workspace mode
    const {
      updateProjectConfigWorkspace,
      syncRootPackageJson,
    } = require("./operations/workspace");
    updateProjectConfigWorkspace(
      currentProjectConfig,
      true,
      true,
      workspaceDetection.workspaces
    );

    // Sync package.json with workspace configuration
    syncRootPackageJson(currentProjectConfig);

    logger.success("✅ Modalità Workspace abilitata automaticamente!");
    isWorkspaceMode = true;
  }

  if (isWorkspaceMode) {
    // Use workspace installation logic
    const {
      installAllComponentsWorkspace,
    } = require("./operations/workspace-install");
    return installAllComponentsWorkspace(currentProjectConfig, mode);
  } else {
    // Use standard installation logic
    const {
      installPackagesStandard,
    } = require("./operations/standard-install");
    return installPackagesStandard(componentPath, mode, currentProjectConfig);
  }
}

// Funzioni per aggiornamento configurazioni
async function updateAllConfigs(scope = "all", components = []) {
  const updateScript = require("./update-configs");
  return await updateScript.updateAllConfigs(scope, components);
}

// Importa isDependenciesConfigEmpty per verificare se il config è vuoto
const { isDependenciesConfigEmpty } = require("./update-configs");

// Funzione per chiedere il modo di rimozione dipendenze
function askDepcheckRemovalMode(scope, components, callback) {
  logger.section("Modalità rimozione dipendenze");
  logger.log("1. 🗑️  Rimozione profonda (rimuove da node_modules)", "yellow");
  logger.log("2. ⚡ Rimozione rapida (solo da package.json)", "blue");
  logger.warning("⚠️  La rimozione rapida può causare comportamenti inattesi o errori!");
  logger.warning("0. 🔙 Annulla");

  if (!rl) return;

  rl.question("\nScegli modalità rimozione (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Operazione annullata");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        callback(scope, components, "deep");
        break;
      case "2":
        logger.warning(
          "\n⚠️  ATTENZIONE: Rimozione rapida selezionata!",
          "red"
        );
        logger.warning(
          "⚠️  Le dipendenze verranno rimosse solo da package.json",
          "yellow"
        );
        logger.warning(
          "⚠️  I pacchetti rimarranno in node_modules e potrebbero causare:",
          "yellow"
        );
        logger.warning("   - Comportamenti inattesi", "yellow");
        logger.warning("   - Errori di runtime", "yellow");
        logger.warning("   - Problemi di compatibilità", "yellow");
        rl.question("\nSei sicuro di voler continuare? (y/N): ", (confirm) => {
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
            callback(scope, components, "quick");
          } else {
            logger.info("Operazione annullata");
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => askDepcheckRemovalMode(scope, components, callback), 1000);
    }
  });
}

// Funzioni per depcheck
function showDepcheckMenu() {
  // Check workspace mode
  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  logger.section("Controllo dipendenze non utilizzate (experimental)");

  if (isWorkspaceMode) {
    logger.info("🏢 Modalità: WORKSPACE - Analisi centralizzata dipendenze");
    logger.info(
      "📦 Verranno analizzati tutti i workspace per dipendenze condivise"
    );
  } else {
    logger.info("📦 Modalità: STANDARD - Analisi locale dipendenze");
  }

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
                askDepcheckRemovalMode("all", [], (scope, components, mode) => {
                  logger.log(
                    `\n🔍 Rimozione dipendenze per tutti i componenti (modalità: ${mode === "deep" ? "profonda" : "rapida"})...`,
                    "cyan"
                  );
                  const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                  executeDepcheckCommand(scope, components, args, () => {
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  });
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
                askDepcheckRemovalMode("single", [selectedComponent], (scope, components, mode) => {
                  logger.log(
                    `\n🔍 Rimozione dipendenze per: ${selectedComponent} (modalità: ${mode === "deep" ? "profonda" : "rapida"})...`,
                    "cyan"
                  );
                  const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                  executeDepcheckCommand(scope, components, args, () => {
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  });
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
                askDepcheckRemovalMode("exclude", excludeList, (scope, components, mode) => {
                  logger.log(
                    `\n🔍 Rimozione dipendenze per tutti i componenti eccetto: ${excludeList.join(", ")} (modalità: ${mode === "deep" ? "profonda" : "rapida"})...`,
                    "cyan"
                  );
                  const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                  executeDepcheckCommand(scope, components, args, () => {
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  });
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
  // Reload project config to get latest settings
  let currentProjectConfig = projectConfig;
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    currentProjectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  // Check if workspace mode is enabled - use actual status from files
  let isWorkspaceMode =
    currentProjectConfig.workspace?.enabled &&
    currentProjectConfig.workspace?.initialized;

  // Use ONLY projectConfig for workspace status - no file checking

  if (isWorkspaceMode) {
    // Use workspace installation logic
    const {
      installAllComponentsWorkspace,
    } = require("./operations/workspace-install");
    return installAllComponentsWorkspace(currentProjectConfig, mode);
  } else {
    // Use standard installation logic
    const {
      installAllComponentsStandard,
    } = require("./operations/standard-install");
    return installAllComponentsStandard(mode, currentProjectConfig);
  }
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
        const cleanArgs = args.filter(
          (arg) => arg !== "clean" && arg !== "--remove"
        );
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

function executeReinstallCommand(scope, components, mode, cleanMode = "lock-and-modules") {
  // Prima pulizia, poi installazione
  executeCleanCommand(scope, components, cleanMode);
  executeInstallCommand(scope, components, mode);
  // executeInstallCommand already handles the setTimeout for returning to menu
}

function executeCleanCommand(scope, components, cleanMode = "lock-and-modules") {
  // Reload project config to get latest settings
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  // Check if workspace mode is enabled
  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  switch (scope) {
    case "all":
      cleanAllComponents(null, cleanMode);
      break;
    case "single":
      if (components.length > 0) {
        if (isWorkspaceMode) {
          // Use workspace-specific cleaning for single component
          const {
            cleanSingleWorkspaceComponent,
          } = require("./operations/cleaner");
          const success = cleanSingleWorkspaceComponent(
            components[0],
            projectConfig,
            cleanMode
          );

          if (!success) {
            logger.error(`Errore pulizia workspace ${components[0]}`);
          }
        } else {
          // Use standard cleaning
          cleanComponent(path.join(process.cwd(), components[0]), projectConfig, cleanMode);
        }
      } else {
        logger.error("Nessun componente specificato per --single");
      }
      break;
    case "exclude":
      if (isWorkspaceMode) {
        // Use workspace-specific cleaning with exclude list
        const { cleanWorkspaceComponents } = require("./operations/cleaner");
        cleanWorkspaceComponents(components, projectConfig, cleanMode);
      } else {
        // Use standard cleaning with exclude list
        cleanAllComponents(components, cleanMode);
      }
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
    const configPath = path.join(
      projectRoot,
      "package-manager",
      "project-config.js"
    );
    // Clear all cached modules
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("project-config") || key.includes("package-manager")) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);
  } catch (error) {
    // Use cached version if reload fails
  }

  // Get search mode indicator
  const recursiveEnabled = projectConfig.components.recursiveSearch?.enabled;

  // Reload workspace status from actual files
  let workspaceEnabled = projectConfig.workspace?.enabled || false;
  let workspaceInitialized = projectConfig.workspace?.initialized || false;

  // Use ONLY projectConfig for workspace status - no file checking
  // This ensures consistency and prevents conflicts

  logger.section(`📋 Gestore Pacchetti ${projectConfig.project.name}`);

  if (recursiveEnabled) {
    logger.info(
      "🔍 Modalità ricerca: RICORSIVA - Scansiona progetti in sottocartelle"
    );
    const maxDepth = projectConfig.components.recursiveSearch?.maxDepth;
    if (maxDepth) {
      logger.info(`📊 Profondità massima: ${maxDepth} livelli`);
    } else {
      logger.info("📊 Profondità massima: ILLIMITATA");
    }
  } else {
    logger.info(
      "📁 Modalità ricerca: STANDARD - Solo cartelle di primo livello"
    );
  }

  // Workspace mode indicator
  if (workspaceEnabled) {
    if (workspaceInitialized) {
      logger.info(
        "🏢 Modalità installazione: WORKSPACE (centralizzato) - Yarn Workspaces attivo"
      );
    } else {
      logger.warning(
        "🏢 Modalità installazione: WORKSPACE (non inizializzato) - Richiede inizializzazione"
      );
    }
  } else {
    logger.info("📦 Modalità installazione: STANDARD (node_modules locali)");
  }

  // Empty line to separate info from menu
  logger.space();
  logger.success(
    "1. ⚙️ Aggiornamento configurazioni (importante ad impostare dependencies-config.js)"
  );
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

  const logFiles = fs
    .readdirSync(logsDir)
    .filter((file) => file.startsWith("session-") && file.endsWith(".log"))
    .map((file) => ({
      name: file,
      path: path.join(logsDir, file),
      stats: fs.statSync(path.join(logsDir, file)),
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
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split("\n");

    logger.info(`📊 Totale righe: ${lines.length}`);
    logger.info("📄 Ultime 50 righe del log:");
    logger.log("─".repeat(80), "blue");

    const lastLines = lines.slice(-50);
    lastLines.forEach((line) => {
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
    const configPath = path.join(
      projectRoot,
      "package-manager",
      "project-config.js"
    );
    // Clear all cached modules
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("project-config")) {
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
    rl.question(
      "\nInserisci i nomi dei componenti da escludere (separati da spazio): ",
      (answer) => {
        const excludeList = answer
          .trim()
          .split(/\s+/)
          .filter((name) => name.length > 0);
        const validExcludes = excludeList.filter((name) =>
          components.includes(name)
        );

        if (validExcludes.length > 0) {
          showUpdateConfirmation("exclude", validExcludes);
        } else {
          logger.error("❌ Nessun componente valido specificato");
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        }
      }
    );
  }
}

async function showUpdateConfirmation(scope, components) {
  // Prima mostra cosa verrà aggiornato
  const previewResult = await showUpdatePreview(scope, components);

  // Se il config è vuoto (template), non chiedere conferma - vai direttamente alla generazione
  if (previewResult && previewResult.isEmpty) {
    logger.log("\n🚀 Avvio generazione configurazione...", "cyan");
    const success = await updateAllConfigs(scope, components);
    if (!success) {
      logger.log("🔄 Ritorno al menu principale...", "cyan");
    }
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }

  // Se non ci sono modifiche da applicare, non chiedere conferма e torna al menu
  if (previewResult && previewResult.totalChanges === 0) {
    logger.log("\n✅ Nessuna modifica da applicare.", "green");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");
    if (!rl) return;
    rl.question("", () => {
      if (askQuestion) askQuestion();
    });
    return;
  }

  if (rl) {
    rl.question(
      "\n⚠️  Continuare con l'aggiornamento? (y/N): ",
      async (confirm) => {
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
      }
    );
  }
}

async function showUpdatePreview(scope, components) {
  logger.section("📋 Anteprima aggiornamento");

  // Carica la configurazione per mostrare cosa verrà aggiornato
  const dependenciesConfigPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.error("❌ dependencies-config.js non trovato!");
    return { isEmpty: true };
  }

  // Verifica se il config è vuoto (template)
  if (isDependenciesConfigEmpty()) {
    logger.log("⚠️  dependencies-config.js è vuoto (template)!", "yellow");
    return { isEmpty: true };
  }

  try {
    // Ricarica il modulo dependencies-config usando reloadDependenciesConfig
    // che risolve automaticamente i duplicati e usa la versione più alta
    // Non mostriamo i duplicati durante l'aggiornamento (silent mode)
    const { reloadDependenciesConfig } = require("./update-configs");
    const depsFunctions = reloadDependenciesConfig(projectRoot, { showDuplicates: false });
    
    if (!depsFunctions) {
      logger.error("❌ Errore caricando configurazione dipendenze");
      return { isEmpty: true };
    }
    
    // Usa le funzioni già risolte da reloadDependenciesConfig
    // Queste funzioni restituiscono versioni già allineate (con la più alta per duplicati)
    const baseDeps = depsFunctions.getBaseDependencies();
    const devDeps = depsFunctions.getDevDependencies();
    const scripts = depsFunctions.getStandardScripts();
    const deprecatedDeps = depsFunctions.getDeprecatedDependencies();
    const conditionalDeps = depsFunctions.getConditionalDependencies();
    const conditionalDevDeps = depsFunctions.getConditionalDevDependencies();

    // Log per debug
    if (Object.keys(conditionalDeps).length > 0) {
      logger.log(
        `🔍 Trovate ${
          Object.keys(conditionalDeps).length
        } dipendenze condizionali`,
        "blue"
      );
    }
    if (Object.keys(conditionalDevDeps).length > 0) {
      logger.log(
        `🔍 Trovate ${
          Object.keys(conditionalDevDeps).length
        } dev dipendenze condizionali`,
        "blue"
      );
    }

    // Determina i componenti che verranno aggiornati
    const { getComponentDirectories } = require("./dependencies/analyzer");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) =>
        components.includes(comp)
      );
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter(
        (comp) => !components.includes(comp)
      );
    }

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
        logger.warning(
          `⚠️  package.json non trovato per ${component}`,
          "yellow"
        );
        continue;
      }

      try {
        const currentPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const currentDeps = currentPkg.dependencies || {};
        const currentDevDeps = currentPkg.devDependencies || {};
        const currentScripts = currentPkg.scripts || {};

        // Analizza dependencies (base + conditional per questo componente)
        const usedConditionalDeps = analyzeDependencyUsageForComponent(
          componentPath,
          conditionalDeps
        );
        // Додати conditional deps, які вже є в package.json
        // (незалежно від версії - для оновлення або збереження)
        // Перевіряємо як dependencies, так і devDependencies
        Object.entries(conditionalDeps).forEach(([name, configVersion]) => {
          const currentVersion = currentDeps[name] || currentDevDeps[name];
          // Додати тільки якщо вже є в package.json (в будь-якому розділі)
          // Якщо НЕ знайдена в коді І НЕ є в package.json - НЕ додавати
          if (currentVersion) {
            if (!usedConditionalDeps[name]) {
              usedConditionalDeps[name] = configVersion;
            }
          }
        });
        const targetDeps = { ...baseDeps, ...usedConditionalDeps };

        // Analizza dependencies: mostra aggiornamenti solo se il pacchetto è già in dependencies
        // Se il pacchetto è in devDependencies, lo gestiremo quando analizziamo devDependencies
        const { newDeps, updatedDeps } = analyzeDependencies(
          currentDeps,
          targetDeps,
          currentDevDeps
        );

        totalNewDeps += newDeps.length;
        totalUpdatedDeps += updatedDeps.length;

        // Analizza devDependencies (base + conditional per questo componente)
        const usedConditionalDevDeps = analyzeDependencyUsageForComponent(
          componentPath,
          conditionalDevDeps
        );
        // Aggiungere conditional devDeps che sono già in package.json
        // (indipendentemente dalla versione - per aggiornamento o conservazione)
        // Controlliamo sia devDependencies che dependencies
        Object.entries(conditionalDevDeps).forEach(([name, configVersion]) => {
          const currentVersion = currentDevDeps[name] || currentDeps[name];
          // Aggiungere solo se è già in package.json (in qualsiasi sezione)
          // Se NON trovata nel codice E NON è in package.json - NON aggiungere
          if (currentVersion) {
            if (!usedConditionalDevDeps[name]) {
              usedConditionalDevDeps[name] = configVersion;
            }
          }
        });
        const targetDevDeps = { ...devDeps, ...usedConditionalDevDeps };
        
        // Analizza devDependencies: mostra aggiornamenti solo se il pacchetto è già in devDependencies
        // Ma anche controlla se alcuni pacchetti da CONDITIONAL_DEPENDENCIES sono in devDependencies
        // e devono essere aggiornati qui
        const { newDeps: newDevDeps, updatedDeps: updatedDevDeps } =
          analyzeDependencies(currentDevDeps, targetDevDeps, currentDeps);
        
        // IMPORTANTE: Se un pacchetto da CONDITIONAL_DEPENDENCIES è in devDependencies,
        // dobbiamo aggiornarlo in devDependencies, non in dependencies
        // Usiamo la versione da conditionalDevDeps (che dopo il resolve ha la versione più alta)
        Object.entries(conditionalDeps).forEach(([name, configVersion]) => {
          // Se il pacchetto è in devDependencies ma non in dependencies
          if (currentDevDeps[name] && !currentDeps[name]) {
            // Usa la versione da conditionalDevDeps (se esiste, altrimenti da conditionalDeps)
            // Dopo resolveDuplicateDependencies, entrambe hanno la versione più alta
            const targetVersion = conditionalDevDeps[name] || configVersion;
            // Verifica se la versione in devDependencies non soddisfa il range target
            if (!versionSatisfiesRange(currentDevDeps[name], targetVersion)) {
              // Aggiungi all'elenco degli aggiornamenti per devDependencies
              updatedDevDeps.push([name, currentDevDeps[name], targetVersion]);
            }
          }
        });
        
        // IMPORTANTE: Se un pacchetto da CONDITIONAL_DEV_DEPENDENCIES è in dependencies,
        // dobbiamo aggiornarlo in dependencies, non in devDependencies
        // Usiamo la versione da conditionalDeps (che dopo il resolve ha la versione più alta)
        Object.entries(conditionalDevDeps).forEach(([name, configVersion]) => {
          // Se il pacchetto è in dependencies ma non in devDependencies
          if (currentDeps[name] && !currentDevDeps[name]) {
            // Usa la versione da conditionalDeps (se esiste, altrimenti da conditionalDevDeps)
            // Dopo resolveDuplicateDependencies, entrambe hanno la versione più alta
            const targetVersion = conditionalDeps[name] || configVersion;
            // Verifica se la versione in dependencies non soddisfa il range target
            if (!versionSatisfiesRange(currentDeps[name], targetVersion)) {
              // Aggiungi all'elenco degli aggiornamenti per dependencies
              updatedDeps.push([name, currentDeps[name], targetVersion]);
            }
          }
        });
        
        totalNewDevDeps += newDevDeps.length;
        totalUpdatedDevDeps += updatedDevDeps.length;

        // Analizza deprecated dependencies
        const deprecatedToRemove = deprecatedDeps.filter(
          (dep) => currentDeps[dep] || currentDevDeps[dep]
        );
        totalDeprecatedToRemove += deprecatedToRemove.length;

        // Analizza scripts
        const scriptsToUpdate = Object.entries(scripts).filter(
          ([name, script]) =>
            !currentScripts[name] || currentScripts[name] !== script
        );
        totalScriptsToUpdate += scriptsToUpdate.length;

        // Mostra dettagli solo se ci sono modifiche per questo componente
        if (
          newDeps.length > 0 ||
          updatedDeps.length > 0 ||
          newDevDeps.length > 0 ||
          updatedDevDeps.length > 0 ||
          deprecatedToRemove.length > 0 ||
          scriptsToUpdate.length > 0
        ) {
          logger.log(`\n📦 ${component}:`, "blue");

          if (newDeps.length > 0) {
            logger.log(`   🆕 Nuove dipendenze (${newDeps.length}):`, "green");
            newDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "green");
            });
          }

          if (updatedDeps.length > 0) {
            logger.log(
              `   🔄 Dipendenze da aggiornare (${updatedDeps.length}):`,
              "yellow"
            );
            updatedDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(
                `      ${name}: ${currentVersion} → ${newVersion}`,
                "yellow"
              );
            });
          }

          if (newDevDeps.length > 0) {
            logger.log(
              `   🆕 Nuove devDependencies (${newDevDeps.length}):`,
              "cyan"
            );
            newDevDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "cyan");
            });
          }

          if (updatedDevDeps.length > 0) {
            logger.log(
              `   🔄 DevDependencies da aggiornare (${updatedDevDeps.length}):`,
              "yellow"
            );
            updatedDevDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(
                `      ${name}: ${currentVersion} → ${newVersion}`,
                "yellow"
              );
            });
          }

          if (deprecatedToRemove.length > 0) {
            logger.log(
              `   🗑️  Deprecated da rimuovere (${deprecatedToRemove.length}):`,
              "red"
            );
            deprecatedToRemove.forEach((dep) => {
              const currentVersion = currentDeps[dep] || currentDevDeps[dep];
              logger.log(`      - ${dep}@${currentVersion}`, "red");
            });
          }

          if (scriptsToUpdate.length > 0) {
            logger.log(
              `   📝 Scripts da aggiornare (${scriptsToUpdate.length}):`,
              "magenta"
            );
            scriptsToUpdate.forEach(([name, newScript]) => {
              const currentScript = currentScripts[name] || "(non presente)";
              logger.log(
                `      ${name}: "${currentScript}" → "${newScript}"`,
                "magenta"
              );
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
    if (totalNewDeps > 0)
      logger.log(`   🆕 Nuove dipendenze: ${totalNewDeps}`, "green");
    if (totalUpdatedDeps > 0)
      logger.log(`   🔄 Dipendenze aggiornate: ${totalUpdatedDeps}`, "yellow");
    if (totalNewDevDeps > 0)
      logger.log(`   🆕 Nuove devDependencies: ${totalNewDevDeps}`, "cyan");
    if (totalUpdatedDevDeps > 0)
      logger.log(
        `   🔄 DevDependencies aggiornate: ${totalUpdatedDevDeps}`,
        "yellow"
      );
    if (totalDeprecatedToRemove > 0)
      logger.log(
        `   🗑️  Deprecated rimosse: ${totalDeprecatedToRemove}`,
        "red"
      );
    if (totalScriptsToUpdate > 0)
      logger.log(
        `   📝 Scripts aggiornati: ${totalScriptsToUpdate}`,
        "magenta"
      );

    const totalChanges =
      totalNewDeps +
      totalUpdatedDeps +
      totalNewDevDeps +
      totalUpdatedDevDeps +
      totalDeprecatedToRemove +
      totalScriptsToUpdate;
    if (totalChanges === 0) {
      logger.log(`\n✅ Tutti i componenti sono già aggiornati!`, "green");
    }

    return { isEmpty: false, totalChanges };
  } catch (error) {
    logger.error(`❌ Errore caricando configurazione: ${error.message}`);
    logger.warning(
      "💡 Assicurati che dependencies-config.js contenga tutte le funzioni necessarie"
    );
    return { isEmpty: true };
  }
}

// Funzione per verificare se una versione soddisfa un range semantico
function versionSatisfiesRange(version, range) {
  if (!version || !range) return false;
  
  // Se sono identici, soddisfa
  if (version === range) return true;
  
  // Per git URLs, confrontiamo direttamente
  if (version.includes('git+') || version.includes('bitbucket:') || version.includes('http')) {
    return version === range;
  }
  if (range.includes('git+') || range.includes('bitbucket:') || range.includes('http')) {
    return version === range;
  }
  
  // Rimuoviamo prefissi per confronto
  const cleanVersion = (v) => {
    if (!v || typeof v !== 'string') return '0.0.0';
    return v.replace(/^[\^~>=<]+/, '');
  };
  
  const cleanV = cleanVersion(version);
  const cleanR = cleanVersion(range);
  
  // Se dopo la pulizia sono uguali, soddisfa
  if (cleanV === cleanR) return true;
  
  // Se il range ha prefisso ^, controlliamo compatibilità major
  if (range.startsWith('^')) {
    const vParts = cleanV.split('.').map(Number);
    const rParts = cleanR.split('.').map(Number);
    
    // ^x.y.z significa >=x.y.z <(x+1).0.0
    if (vParts[0] === rParts[0] && vParts[1] >= rParts[1]) {
      if (vParts[1] > rParts[1]) return true;
      if (vParts[1] === rParts[1] && vParts[2] >= rParts[2]) return true;
    }
    return false;
  }
  
  // Se il range ha prefisso ~, controlliamo compatibilità minor
  if (range.startsWith('~')) {
    const vParts = cleanV.split('.').map(Number);
    const rParts = cleanR.split('.').map(Number);
    
    // ~x.y.z significa >=x.y.z <x.(y+1).0
    if (vParts[0] === rParts[0] && vParts[1] === rParts[1] && vParts[2] >= rParts[2]) {
      return true;
    }
    return false;
  }
  
  // Per versioni esatte senza prefisso, confrontiamo direttamente
  return cleanV === cleanR;
}

function analyzeDependencies(currentDeps, targetDeps, currentOtherDeps = {}) {
  const newDeps = [];
  const updatedDeps = [];

  for (const [name, targetVersion] of Object.entries(targetDeps)) {
    // Controlliamo prima nel sezione corrente
    if (currentDeps[name]) {
      // Se la versione non soddisfa il range target - è un aggiornamento
      // IMPORTANTE: mostriamo aggiornamento solo se il pacchetto è già nella sezione corrente
      if (!versionSatisfiesRange(currentDeps[name], targetVersion)) {
        updatedDeps.push([name, currentDeps[name], targetVersion]);
      }
      // Se la versione soddisfa il range - non facciamo nulla
    } else if (currentOtherDeps[name]) {
      // Il pacchetto è già nell'altra sezione (dependencies/devDependencies)
      // NON lo mostriamo come aggiornamento nella sezione corrente, perché non è presente qui
      // Se l'utente vuole spostarlo o aggiornarlo, lo farà manualmente o attraverso l'altra sezione
      // Non aggiungiamo né a newDeps né a updatedDeps
    } else {
      // Il pacchetto non è stato trovato né in dependencies né in devDependencies - è una nuova dipendenza
      newDeps.push([name, targetVersion]);
    }
  }

  return { newDeps, updatedDeps };
}

function analyzeDependencyUsageForComponent(componentPath, conditionalDeps) {
  const usedDeps = {};

  Object.entries(conditionalDeps).forEach(([depName, version]) => {
    // Se è un oggetto (vecchio formato), usa la logica originale
    if (typeof version === "object" && version !== null) {
      const patterns = version.patterns || [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps[depName] = version.version;
      }
    } else {
      // Se è una stringa (nuovo formato), usa solo il nome del pacchetto
      const patterns = [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps[depName] = version;
      }
    }
  });

  return usedDeps;
}

function scanDirectoryForPatterns(
  dirPath,
  patterns,
  extensions = [".js", ".ts", ".tsx", ".jsx"]
) {
  const results = new Set();

  function extractImports(content) {
    const imports = new Set();
    const importPatterns = [
      /import\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
      /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /\bdefine\(\s*\[([^\]]+)\]/g,
    ];

    for (const rx of importPatterns) {
      let m;
      while ((m = rx.exec(content))) {
        if (rx === importPatterns[3]) {
          // AMD array
          const arr = m[1].split(",").map((s) => s.trim().replace(/['"`]/g, ""));
          arr.forEach(name => {
            if (name && !name.startsWith(".") && !name.startsWith("/")) {
              const root = name.split("/")[0].startsWith("@") 
                ? name.split("/").slice(0, 2).join("/") 
                : name.split("/")[0];
              if (root) imports.add(root);
            }
          });
        } else {
          const name = m[1].trim().replace(/['"`]/g, "");
          if (name && !name.startsWith(".") && !name.startsWith("/")) {
            const root = name.split("/")[0].startsWith("@") 
              ? name.split("/").slice(0, 2).join("/") 
              : name.split("/")[0];
            if (root) imports.add(root);
          }
        }
      }
    }
    return Array.from(imports);
  }

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const imports = extractImports(content);

      patterns.forEach((pattern) => {
        // Перевірка через імпорти (точніше)
        if (imports.includes(pattern)) {
          results.add(pattern);
        }
        // Fallback: простий пошук для старих форматів з patterns
        else if (content.includes(pattern)) {
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

function showInstallModeMenu(scope, components, cleanMode = null) {
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
          if (cleanMode) {
            executeReinstallCommand(scope, components, mode, cleanMode);
          } else {
            executeInstallCommand(scope, components, mode);
          }
        }
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      });
    } else {
      if (cleanMode) {
        executeReinstallCommand(scope, components, mode, cleanMode);
      } else {
        executeInstallCommand(scope, components, mode);
      }
    }
  });
}

function showComponentSelectionMenu(scope, callback = null) {
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
        if (callback) {
          callback(scope, [selectedComponent]);
        } else {
          showInstallModeMenu(scope, [selectedComponent]);
        }
      } else {
        logger.error("Numero componente non valido");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      }
    }
  );
}

function showExcludeSelectionMenu(callback = null) {
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
            if (callback) {
              callback("exclude", excludeList);
            } else {
              showInstallModeMenu("exclude", excludeList);
            }
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

// Funzione per chiedere il modo di pulizia durante la reinstallazione
function askCleanupMode(scope, components, callback) {
  logger.section("Modalità pulizia");
  logger.log("1. Rimuovi solo package-lock.json (mantieni node_modules)", "blue");
  logger.log("2. Rimuovi package-lock.json + node_modules (pulizia completa)", "yellow");
  logger.warning("0. 🔙 Annulla");

  if (!rl) return;

  rl.question("\nScegli modalità pulizia (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Operazione annullata");
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case "1":
        callback(scope, components, "lock-only");
        break;
      case "2":
        callback(scope, components, "lock-and-modules");
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => askCleanupMode(scope, components, callback), 1000);
    }
  });
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
          "\n⚠️  Questo rimuoverà i file selezionati!",
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (
            confirm.toLowerCase() === "y" ||
            confirm.toLowerCase() === "yes"
          ) {
            askCleanupMode("all", [], (scope, components, cleanMode) => {
              showInstallModeMenu(scope, components, cleanMode);
            });
          } else {
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
        break;
      case "2":
        showComponentSelectionMenu("single", (selectedScope, selectedComponents) => {
          askCleanupMode(selectedScope, selectedComponents, (scope, components, cleanMode) => {
            showInstallModeMenu(scope, components, cleanMode);
          });
        });
        break;
      case "3":
        showExcludeSelectionMenu((selectedScope, selectedComponents) => {
          askCleanupMode(selectedScope, selectedComponents, (scope, components, cleanMode) => {
            showInstallModeMenu(scope, components, cleanMode);
          });
        });
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
  // Check workspace mode
  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  logger.log("\n🧹 Modalità pulizia:", "yellow");

  if (isWorkspaceMode) {
    logger.info("🏢 Modalità: WORKSPACE - Pulizia workspace");
    logger.info("📦 Verranno puliti lock files e tslint.json dai workspace");
    logger.info("🔒 Root node_modules mantenuto per workspace centralizzato");
  } else {
    logger.info("📦 Modalità: STANDARD - Pulizia locale");
  }

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

              // Check if workspace mode is enabled
              const isWorkspaceMode =
                projectConfig.workspace?.enabled &&
                projectConfig.workspace?.initialized;

              if (isWorkspaceMode) {
                // Use workspace-specific cleaning
                const {
                  cleanSingleWorkspaceComponent,
                } = require("./operations/cleaner");
                const success = cleanSingleWorkspaceComponent(
                  selectedComponent,
                  projectConfig
                );

                if (!success) {
                  logger.error(`Errore pulizia workspace ${selectedComponent}`);
                }
              } else {
                // Use standard cleaning
                cleanComponent(path.join(process.cwd(), selectedComponent));
                logger.log("\n✅ Pulizia completata!", "green");
              }
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

/**
 * Ensure workspace section exists in project config
 * @param {Object} projectConfig - Project configuration object
 */
function ensureWorkspaceSectionExists(projectConfig) {
  try {
    // Check if workspace section exists

    // Check if workspace section exists
    if (!projectConfig.workspace) {
      logger.section("🆕 Aggiornamento configurazione");
      logger.info("📦 Aggiunta nuova funzionalità sperimentale: Workspace");

      // Add default workspace configuration
      projectConfig.workspace = {
        enabled: false,
        initialized: false,
        packagesPath: [],
        useYarn: true,
      };

      // Save updated configuration
      const configPath = path.join(
        projectRoot,
        "package-manager",
        "project-config.js"
      );

      // Create properly formatted config content
      const configContent = `module.exports = ${JSON.stringify(
        projectConfig,
        null,
        2
      )};`;

      try {
        logger.debug(`📝 Salvando configurazione in: ${configPath}`);
        fs.writeFileSync(configPath, configContent);
        logger.success("✅ Configurazione workspace aggiunta automaticamente");
        logger.info(
          "💡 Usa 'Funzioni sperimentali > Gestione Monorepo Workspace' per abilitare"
        );

        // Reload the config to reflect changes
        delete require.cache[require.resolve(configPath)];
        const updatedConfig = require(configPath);
        Object.assign(projectConfig, updatedConfig);
        logger.debug("✅ Configurazione ricaricata in memoria");
      } catch (writeError) {
        logger.warning("⚠️  Impossibile salvare configurazione aggiornata:");
        logger.warning(`   ${writeError.message}`);
      }
    } else {
      // Workspace section already exists, no need to add it
      logger.debug("✅ Sezione workspace già presente");
    }
  } catch (error) {
    logger.warning("⚠️  Impossibile aggiornare configurazione workspace:");
    logger.warning(`   ${error.message}`);
  }
}

async function main() {
  // Reload project config to get latest settings
  try {
    const configPath = path.join(
      projectRoot,
      "package-manager",
      "project-config.js"
    );
    // Clear all cached modules
    Object.keys(require.cache).forEach((key) => {
      if (key.includes("project-config")) {
        delete require.cache[key];
      }
    });
    projectConfig = require(configPath);

    // Validate project config
    if (
      !projectConfig ||
      !projectConfig.project ||
      !projectConfig.project.name
    ) {
      throw new Error("Invalid project configuration");
    }

    // Check and add workspace section if missing (for new versions)
    ensureWorkspaceSectionExists(projectConfig);
  } catch (error) {
    logger.error("❌ Errore caricando configurazione progetto:");
    logger.warning(`   ${error.message}`);
    logger.info("💡 Esegui 'npx packman' per riconfigurare il progetto");
    process.exit(1);
  }

  // Auto-detect workspace configuration for other users
  try {
    const {
      autoDetectAndPromptWorkspace,
    } = require("./utils/workspace-detector");
    if (rl) {
      await autoDetectAndPromptWorkspace(projectConfig, (question) => {
        return new Promise((resolve) => {
          rl.question(question, (answer) => {
            resolve(answer.trim());
          });
        });
      });
    }
  } catch (error) {
    logger.warning("⚠️  Errore durante il rilevamento automatico workspace");
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
  logger.space();
  logger.info("1. Cambia modalita di ricerca progetti (ricorsiva on/off)");
  logger.info("2. Controllo dipendenze non utilizzate");
  logger.info("3. Gestione Monorepo Workspace");
  logger.info("4. Strumenti npm/package");
  logger.info("5. Aggiorna tsconfig (skipLibCheck)");
  logger.info("6. Gestione configurazione dipendenze");
  logger.space();
  logger.warning("0. Torna al menu principale");

  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        toggleRecursiveSearch();
        break;
      case "2":
        showDepcheckMenu();
        break;
      case "3":
        showWorkspaceMenu();
        break;
      case "4":
        showNpmToolsMenu();
        break;
      case "5":
        showUpdateTsConfigSkipLibCheckMenu();
        break;
      case "6":
        showDependenciesConfigMenu();
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

// Funzione per mostrare il menu strumenti npm/package
function showNpmToolsMenu() {
  logger.section("📦 Strumenti npm/package");
  logger.space();
  logger.info("1. Rimuovi package-lock.json per progetti");
  logger.info("2. npm install --package-lock-only (verifica rapida)");
  logger.info("3. npm outdated (verifica versioni obsolete)");
  logger.info("4. npm audit (verifica vulnerabilità)");
  logger.space();
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showRemoveLockFilesMenu();
        break;
      case "2":
        showPackageLockOnlyMenu();
        break;
      case "3":
        showNpmOutdatedMenu();
        break;
      case "4":
        showNpmAuditMenu();
        break;
      case "0":
        logger.info("Tornando al menu sperimentale...");
        setTimeout(() => showExperimentalMenu(), 500);
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showNpmToolsMenu(), 1000);
    }
  });
}

function toggleRecursiveSearch() {
  logger.section("Cambio Modalita Ricerca");

  const currentState =
    projectConfig.components.recursiveSearch?.enabled || false;
  logger.info(`Stato attuale: ${currentState ? "RICORSIVA" : "STANDARD"}`);
  logger.space();
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
  const configPath = path.join(
    projectRoot,
    "package-manager",
    "project-config.js"
  );

  // Read, modify, and write config
  try {
    let configContent = fs.readFileSync(configPath, "utf8");

    // Check if recursiveSearch section exists
    if (configContent.includes("recursiveSearch:")) {
      // Update existing recursiveSearch.enabled to true
      configContent = configContent.replace(
        /(recursiveSearch:\s*\{[^}]*enabled:\s*)(false)/,
        "$1true"
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

    fs.writeFileSync(configPath, configContent, "utf8");

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
  const configPath = path.join(
    projectRoot,
    "package-manager",
    "project-config.js"
  );

  try {
    let configContent = fs.readFileSync(configPath, "utf8");

    // Check if recursiveSearch section exists
    if (configContent.includes("recursiveSearch:")) {
      // Update existing recursiveSearch.enabled to false
      configContent = configContent.replace(
        /(recursiveSearch:\s*\{[^}]*enabled:\s*)(true)/,
        "$1false"
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

    fs.writeFileSync(configPath, configContent, "utf8");

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

// Workspace menu functions
function showWorkspaceMenu() {
  logger.section("🏢 Gestione Monorepo Workspace");
  logger.warning("Funzione sperimentale per gestione centralizzata pacchetti");

  // Reload project config to get latest settings
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  // Use ONLY projectConfig for workspace status - no file checking
  // This ensures consistency and prevents conflicts

  // Get actual workspace status from files, not just config
  let workspaceEnabled = projectConfig.workspace?.enabled || false;
  let workspaceInitialized = projectConfig.workspace?.initialized || false;

  // Check actual workspace status from files for accurate display
  try {
    const { getWorkspaceStatus } = require("./operations/workspace");
    const actualStatus = getWorkspaceStatus(projectConfig);
    if (actualStatus) {
      workspaceEnabled = actualStatus.enabled;
      workspaceInitialized = actualStatus.initialized;
    }
  } catch (error) {
    // Use config values if status check fails
  }

  if (workspaceEnabled) {
    logger.info("Workspace abilitato");
    if (workspaceInitialized) {
      logger.info("Workspace inizializzato");
    } else {
      logger.warning("⚠️  Workspace non inizializzato");
    }
  } else {
    logger.info("Workspace disabilitato");
  }

  logger.space();

  // Show different options based on workspace status
  if (!workspaceEnabled) {
    // Workspace disabled - show only enable and status options
    logger.info("1. Abilita Workspace (inizializza)");
    logger.info("2. Mostra stato Workspace");
    logger.warning("0. Torna al menu sperimentale");
  } else if (workspaceEnabled && !workspaceInitialized) {
    // Workspace enabled but not initialized - show initialize and status
    logger.info("1. Inizializza Workspace");
    logger.info("2. 🔄 Reinizializza Workspace (forza)");
    logger.info("3. Disabilita Workspace");
    logger.info("4. Mostra stato Workspace");
    logger.warning("0. Torna al menu sperimentale");
  } else {
    // Workspace enabled and initialized - show all options
    logger.info("1. Mostra stato Workspace");
    logger.info("2. 🔄 Reinizializza Workspace (forza)");
    logger.info("3. Disabilita Workspace");
    logger.info("4. 🧹 Pulisci node_modules locali (risparmio memoria)");
    logger.info("5. 🔄 Sincronizza workspace con progetti attuali");
    logger.warning("0. Torna al menu sperimentale");
  }

  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    if (!workspaceEnabled) {
      // Workspace disabled
      switch (answer.trim()) {
        case "1":
          initializeWorkspaceFromMenu();
          break;
        case "2":
          showWorkspaceStatus();
          break;
        case "0":
          logger.info("Tornando al menu sperimentale...");
          setTimeout(() => showExperimentalMenu(), 500);
          break;
        default:
          logger.log("Scelta non valida. Riprova.", "red");
          setTimeout(() => showWorkspaceMenu(), 1000);
      }
    } else if (workspaceEnabled && !workspaceInitialized) {
      // Workspace enabled but not initialized
      switch (answer.trim()) {
        case "1":
          initializeWorkspaceFromMenu();
          break;
        case "2":
          reinitializeWorkspaceFromMenu();
          break;
        case "3":
          disableWorkspaceFromMenu();
          break;
        case "4":
          showWorkspaceStatus();
          break;
        case "0":
          logger.info("Tornando al menu sperimentale...");
          setTimeout(() => showExperimentalMenu(), 500);
          break;
        default:
          logger.log("Scelta non valida. Riprova.", "red");
          setTimeout(() => showWorkspaceMenu(), 1000);
      }
    } else {
      // Workspace enabled and initialized
      switch (answer.trim()) {
        case "1":
          showWorkspaceStatus();
          break;
        case "2":
          reinitializeWorkspaceFromMenu();
          break;
        case "3":
          disableWorkspaceFromMenu();
          break;
        case "4":
          cleanLocalNodeModulesFromMenu();
          break;
        case "5":
          syncWorkspaceFromMenu();
          break;
        case "0":
          logger.info("Tornando al menu sperimentale...");
          setTimeout(() => showExperimentalMenu(), 500);
          break;
        default:
          logger.log("Scelta non valida. Riprova.", "red");
          setTimeout(() => showWorkspaceMenu(), 1000);
      }
    }
  });
}

function reinitializeWorkspaceFromMenu() {
  logger.section("🔄 Reinizializzazione Workspace");

  logger.warning("⚠️  Questa operazione rimuoverà la configurazione workspace esistente");
  logger.info("Verrà rimosso yarn.lock e root node_modules");
  logger.info("Verrà ricreata la configurazione workspace");
  logger.info("");

  if (!rl) return;
  rl.question("Continuare con la reinizializzazione? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      // Ask about force mode
      logger.info("");
      logger.info("💡 Opzioni di reinizializzazione:");
      logger.info("   - Normale: verifica se workspace è già inizializzato");
      logger.info("   - Forza: ignora controlli e reinizializza comunque");
      logger.info("");
      
      rl.question("Usare modalità FORZA? (y/N): ", (forceConfirm) => {
        const useForce = forceConfirm.toLowerCase() === "y" || forceConfirm.toLowerCase() === "yes";
        
        if (useForce) {
          logger.log("🔧 Modalità FORZA attivata", "yellow");
        } else {
          logger.log("🔧 Modalità normale", "blue");
        }
        
        try {
          // First disable workspace to clean up
          const { disableWorkspace } = require("./operations/workspace");
          disableWorkspace(projectConfig);
          
          // Reload project config after disabling
          try {
            const configPath = path.join(
              process.cwd(),
              "package-manager",
              "project-config.js"
            );
            delete require.cache[require.resolve(configPath)];
            projectConfig = require(configPath);
            logger.info("Configurazione ricaricata dopo disabilitazione");
          } catch (error) {
            logger.warning("⚠️  Impossibile ricaricare la configurazione");
          }
          
          // Then reinitialize with fresh config (with or without force)
          const { initializeWorkspace } = require("./operations/workspace");
          const success = initializeWorkspace(projectConfig, useForce);

          if (success) {
            logger.success("Workspace reinizializzato con successo!");
            // Reload project config again after initialization
            try {
              const configPath = path.join(
                process.cwd(),
                "package-manager",
                "project-config.js"
              );
              delete require.cache[require.resolve(configPath)];
              projectConfig = require(configPath);
              logger.info("Configurazione ricaricata dopo inizializzazione");
            } catch (error) {
              logger.warning("⚠️  Impossibile ricaricare la configurazione");
            }
          } else {
            logger.error("❌ Errore durante la reinizializzazione del workspace");
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showWorkspaceMenu(), 2000);
      });
    } else {
      logger.info("Operazione annullata");
      setTimeout(() => showWorkspaceMenu(), 1000);
    }
  });
}

function initializeWorkspaceFromMenu() {
  logger.section("🏢 Inizializzazione Workspace");

  if (
    projectConfig.workspace?.enabled &&
    projectConfig.workspace?.initialized
  ) {
    logger.warning("⚠️  Workspace già inizializzato!");
    logger.info("Usa l'opzione 'Reinizializza Workspace' per ripristinare");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione modificherà la struttura del progetto");
  logger.info("Verrà creato un root package.json con workspaces");
  logger.info("Tutti i pacchetti saranno gestiti centralmente");

  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { initializeWorkspace } = require("./operations/workspace");
        const success = initializeWorkspace(projectConfig, false);

        if (success) {
          logger.success("Workspace inizializzato con successo!");
          // Reload project config
          try {
            const configPath = path.join(
              process.cwd(),
              "package-manager",
              "project-config.js"
            );
            delete require.cache[require.resolve(configPath)];
            projectConfig = require(configPath);
            logger.info("Configurazione ricaricata");
          } catch (error) {
            logger.warning("⚠️  Impossibile ricaricare la configurazione");
            logger.warning(
              "Riavvia il package manager per vedere le modifiche"
            );
          }
        } else {
          logger.error("❌ Errore durante l'inizializzazione del workspace");
        }
      } catch (error) {
        logger.error(`❌ Errore: ${error.message}`);
      }

      setTimeout(() => showWorkspaceMenu(), 2000);
    } else {
      logger.info("Operazione annullata");
      setTimeout(() => showWorkspaceMenu(), 1000);
    }
  });
}

function disableWorkspaceFromMenu() {
  logger.section("🔙 Disabilitazione Workspace");

  if (!projectConfig.workspace?.enabled) {
    logger.warning("⚠️  Workspace non abilitato!");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione rimuoverà la configurazione workspace");
  logger.info("Verrà rimosso workspaces dal root package.json");
  logger.info("Verrà rimosso yarn.lock");
  logger.warning(
    "I node_modules locali dovranno essere reinstallati manualmente"
  );

  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { disableWorkspace } = require("./operations/workspace");
        const success = disableWorkspace(projectConfig);

        if (success) {
          logger.success("Workspace disabilitato con successo!");
          // Reload project config
          try {
            const configPath = path.join(
              process.cwd(),
              "package-manager",
              "project-config.js"
            );
            delete require.cache[require.resolve(configPath)];
            projectConfig = require(configPath);
          } catch (error) {
            logger.warning("⚠️  Impossibile ricaricare la configurazione");
          }
        } else {
          logger.error("❌ Errore durante la disabilitazione del workspace");
        }
      } catch (error) {
        logger.error(`❌ Errore: ${error.message}`);
      }

      setTimeout(() => showWorkspaceMenu(), 2000);
    } else {
      logger.info("Operazione annullata");
      setTimeout(() => showWorkspaceMenu(), 1000);
    }
  });
}

function showWorkspaceStatus() {
  logger.section("📊 Stato Workspace");

  try {
    const { getWorkspaceStatus } = require("./operations/workspace");
    const status = getWorkspaceStatus(projectConfig);

    if (!status) {
      logger.error("❌ Impossibile ottenere lo stato del workspace");
      setTimeout(() => showWorkspaceMenu(), 2000);
      return;
    }

    logger.log("📋 Informazioni Workspace:", "cyan");
    logger.log(
      `   Abilitato: ${status.enabled ? "✅ Sì" : "❌ No"}`,
      status.enabled ? "green" : "red"
    );
    logger.log(
      `   Inizializzato: ${status.initialized ? "✅ Sì" : "❌ No"}`,
      status.initialized ? "green" : "red"
    );
    logger.log(
      `   Yarn Lock: ${status.hasYarnLock ? "✅ Presente" : "❌ Assente"}`,
      status.hasYarnLock ? "green" : "red"
    );
    logger.log(
      `   Workspaces: ${
        status.hasWorkspaces ? "✅ Configurati" : "❌ Non configurati"
      }`,
      status.hasWorkspaces ? "green" : "red"
    );

    if (status.workspaces.length > 0) {
      logger.log(`   Numero workspaces: ${status.workspaces.length}`, "blue");
      logger.log("   Workspaces:", "blue");
      status.workspaces.forEach((workspace, index) => {
        logger.log(`     ${index + 1}. ${workspace}`, "blue");
      });
    }

    if (status.rootNodeModulesSize > 0) {
      const { formatBytes } = require("./utils/common");
      logger.log(
        `   Root node_modules: ${formatBytes(status.rootNodeModulesSize)}`,
        "cyan"
      );
    }

    logger.log(
      `   Node_modules locali: ${status.localNodeModulesCount}`,
      "yellow"
    );
  } catch (error) {
    logger.error(`❌ Errore ottenendo stato workspace: ${error.message}`);
  }

  logger.warning("\nPremi INVIO per tornare...");
  if (!rl) return;
  rl.question("", () => showWorkspaceMenu());
}

function cleanLocalNodeModulesFromMenu() {
  logger.section("🧹 Pulizia Node_modules Locali");

  // Reload project config to get latest settings
  let currentProjectConfig = projectConfig;
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    currentProjectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  if (!currentProjectConfig.workspace?.enabled) {
    logger.error("❌ Workspace non abilitato!");
    logger.info("Abilita prima il workspace per utilizzare questa funzione");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione rimuoverà tutti i node_modules locali");
  logger.info("I pacchetti saranno disponibili solo tramite root node_modules");
  logger.info("Utile per risparmiare spazio su disco");

  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { cleanLocalNodeModules } = require("./operations/workspace");
        const success = cleanLocalNodeModules(currentProjectConfig);

        if (success) {
          logger.success("✅ Node_modules locali puliti con successo!");
        } else {
          logger.error("❌ Errore durante la pulizia dei node_modules locali");
        }
      } catch (error) {
        logger.error(`❌ Errore: ${error.message}`);
      }

      setTimeout(() => showWorkspaceMenu(), 2000);
    } else {
      logger.info("Operazione annullata");
      setTimeout(() => showWorkspaceMenu(), 1000);
    }
  });
}

// Funzione per mostrare il menu di rimozione lock files
function showRemoveLockFilesMenu() {
  logger.section("🗑️  Rimozione package-lock.json");
  logger.warning("Questa operazione rimuoverà solo i file package-lock.json");
  logger.info("I node_modules non verranno rimossi");
  logger.space();
  logger.log("1. Rimuovi per tutti i componenti", "blue");
  logger.log("2. Rimuovi per un componente", "blue");
  logger.log("3. Rimuovi per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu sperimentale...");
        setTimeout(() => showExperimentalMenu(), 500);
        break;
      case "1":
        logger.log(
          "\n⚠️  Questo rimuoverà package-lock.json da TUTTI i componenti!",
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (
            confirm.toLowerCase() === "y" ||
            confirm.toLowerCase() === "yes"
          ) {
            removeLockFiles("all", []);
          } else {
            setTimeout(() => showNpmToolsMenu(), 100);
          }
        });
        break;
      case "2":
        showComponentSelectionMenu("single", (scope, components) => {
          removeLockFiles(scope, components);
        });
        break;
      case "3":
        showExcludeSelectionMenu((scope, components) => {
          removeLockFiles(scope, components);
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => showRemoveLockFilesMenu(), 1000);
    }
  });
}

// Funzione per rimuovere package-lock.json dai componenti
function removeLockFiles(scope, components) {
  // Reload project config to get latest settings
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  const { getComponentDirectories } = require("./dependencies/analyzer");
  const { removeFile } = require("./utils/common");
  let targetComponents = getComponentDirectories(projectConfig);

  // Filter components based on scope
  if (scope === "single" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) =>
      components.includes(comp)
    );
  } else if (scope === "exclude" && components.length > 0) {
    targetComponents = targetComponents.filter(
      (comp) => !components.includes(comp)
    );
  }

  if (targetComponents.length === 0) {
    logger.error("❌ Nessun componente trovato");
    setTimeout(() => showNpmToolsMenu(), 1000);
    return;
  }

  logger.section(`🗑️  Rimozione package-lock.json da ${targetComponents.length} componenti`);
  
  let removedCount = 0;
  targetComponents.forEach((component) => {
    const componentPath = path.join(process.cwd(), component);
    const packageLockPath = path.join(componentPath, "package-lock.json");
    
    if (removeFile(packageLockPath)) {
      removedCount++;
      logger.log(`✅ Rimosso package-lock.json da ${component}`, "green");
    } else {
      logger.log(`ℹ️  package-lock.json non trovato in ${component}`, "blue");
    }
  });

  logger.success(`\n✅ Rimossi ${removedCount}/${targetComponents.length} file package-lock.json`);
  logger.info("💡 I node_modules non sono stati rimossi");
  
  setTimeout(() => showNpmToolsMenu(), 2000);
}

// Funzione per mostrare il menu npm install --package-lock-only
function showPackageLockOnlyMenu() {
  logger.section("📦 npm install --package-lock-only");
  logger.info("Aggiorna solo package-lock.json senza installare node_modules");
  logger.space();
  logger.log("1. Esegui per tutti i componenti", "blue");
  logger.log("2. Esegui per un componente", "blue");
  logger.log("3. Esegui per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu strumenti npm/package...");
        setTimeout(() => showNpmToolsMenu(), 500);
        break;
      case "1":
        executePackageLockOnlyCommand("all", []);
        break;
      case "2":
        showComponentSelectionMenu("single", (scope, components) => {
          executePackageLockOnlyCommand(scope, components);
        });
        break;
      case "3":
        showExcludeSelectionMenu((scope, components) => {
          executePackageLockOnlyCommand(scope, components);
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => showNpmToolsMenu(), 1000);
    }
  });
}

// Funzione per mostrare il menu npm outdated
function showNpmOutdatedMenu() {
  logger.section("📊 npm outdated");
  logger.info("Verifica versioni obsolete dei pacchetti");
  logger.space();
  logger.log("1. Verifica per tutti i componenti", "blue");
  logger.log("2. Verifica per un componente", "blue");
  logger.log("3. Verifica per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu strumenti npm/package...");
        setTimeout(() => showNpmToolsMenu(), 500);
        break;
      case "1":
        executeNpmOutdatedCommand("all", []);
        break;
      case "2":
        showComponentSelectionMenu("single", (scope, components) => {
          executeNpmOutdatedCommand(scope, components);
        });
        break;
      case "3":
        showExcludeSelectionMenu((scope, components) => {
          executeNpmOutdatedCommand(scope, components);
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => showNpmToolsMenu(), 1000);
    }
  });
}

// Funzione per mostrare il menu npm audit
function showNpmAuditMenu() {
  logger.section("🔒 npm audit");
  logger.info("Verifica vulnerabilità di sicurezza nei pacchetti");
  logger.space();
  logger.log("1. Verifica per tutti i componenti", "blue");
  logger.log("2. Verifica per un componente", "blue");
  logger.log("3. Verifica per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu strumenti npm/package...");
        setTimeout(() => showNpmToolsMenu(), 500);
        break;
      case "1":
        executeNpmAuditCommand("all", []);
        break;
      case "2":
        showComponentSelectionMenu("single", (scope, components) => {
          executeNpmAuditCommand(scope, components);
        });
        break;
      case "3":
        showExcludeSelectionMenu((scope, components) => {
          executeNpmAuditCommand(scope, components);
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => showNpmToolsMenu(), 1000);
    }
  });
}

// Funzione per eseguire npm install --package-lock-only
function executePackageLockOnlyCommand(scope, components) {
  // Reload project config
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  if (isWorkspaceMode) {
    // Workspace mode: esegui yarn install in root
    logger.section("📦 Aggiornamento lock file (Workspace)");
    logger.info("🔄 Esecuzione: yarn install");
    const { execSync } = require("child_process");
    try {
      execSync("yarn install", {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      logger.success("✅ Lock file aggiornato");
    } catch (error) {
      logger.error(`❌ Errore: ${error.message}`);
    }
  } else {
    // Standard mode: esegui npm install --package-lock-only per ogni componente
    const { getComponentDirectories } = require("./dependencies/analyzer");
    const { getNpmCommand } = require("./utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) =>
        components.includes(comp)
      );
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter(
        (comp) => !components.includes(comp)
      );
    }

    if (targetComponents.length === 0) {
      logger.error("❌ Nessun componente trovato");
      setTimeout(() => showNpmToolsMenu(), 1000);
      return;
    }

    logger.section(`📦 Aggiornamento lock file (${targetComponents.length} componenti)`);
    const { execSync } = require("child_process");

    targetComponents.forEach((component) => {
      const componentPath = path.join(process.cwd(), component);
      logger.log(`\n🔄 ${component}...`, "cyan");
      try {
        execSync(
          `${getNpmCommand(projectConfig)} install --package-lock-only`,
          {
            stdio: "inherit",
            cwd: componentPath,
          }
        );
        logger.log(`✅ ${component} - lock file aggiornato`, "green");
      } catch (error) {
        logger.error(`❌ ${component} - Errore: ${error.message}`);
      }
    });
  }

  setTimeout(() => showNpmToolsMenu(), 2000);
}

// Funzione per eseguire npm outdated
function executeNpmOutdatedCommand(scope, components) {
  // Reload project config
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  if (isWorkspaceMode) {
    // Workspace mode: esegui yarn outdated in root
    logger.section("📊 Verifica versioni obsolete (Workspace)");
    logger.info("🔄 Esecuzione: yarn outdated");
    const { execSync } = require("child_process");
    try {
      execSync("yarn outdated", {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      logger.success("✅ Verifica completata");
    } catch (error) {
      // yarn outdated può uscire con codice non-zero se ci sono pacchetti obsoleti
      logger.info("ℹ️  Verifica completata (alcuni pacchetti potrebbero essere obsoleti)");
    }
  } else {
    // Standard mode: esegui npm outdated per ogni componente
    const { getComponentDirectories } = require("./dependencies/analyzer");
    const { getNpmCommand } = require("./utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) =>
        components.includes(comp)
      );
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter(
        (comp) => !components.includes(comp)
      );
    }

    if (targetComponents.length === 0) {
      logger.error("❌ Nessun componente trovato");
      setTimeout(() => showNpmToolsMenu(), 1000);
      return;
    }

    logger.section(`📊 Verifica versioni obsolete (${targetComponents.length} componenti)`);
    const { execSync } = require("child_process");

    targetComponents.forEach((component) => {
      const componentPath = path.join(process.cwd(), component);
      logger.log(`\n📦 ${component}:`, "cyan");
      try {
        execSync(`${getNpmCommand(projectConfig)} outdated`, {
          stdio: "inherit",
          cwd: componentPath,
        });
      } catch (error) {
        // npm outdated può uscire con codice non-zero se ci sono pacchetti obsoleti
        logger.info(`ℹ️  ${component} - Verifica completata`);
      }
    });
  }

  setTimeout(() => showExperimentalMenu(), 2000);
}

// Funzione per eseguire npm audit
function executeNpmAuditCommand(scope, components) {
  // Reload project config
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  const isWorkspaceMode =
    projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  if (isWorkspaceMode) {
    // Workspace mode: esegui yarn audit in root
    logger.section("🔒 Verifica vulnerabilità (Workspace)");
    logger.info("🔄 Esecuzione: yarn audit");
    const { execSync } = require("child_process");
    try {
      execSync("yarn audit", {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      logger.success("✅ Verifica completata");
    } catch (error) {
      // yarn audit può uscire con codice non-zero se ci sono vulnerabilità
      logger.warning("⚠️  Verifica completata (potrebbero esserci vulnerabilità)");
    }
  } else {
    // Standard mode: esegui npm audit per ogni componente
    const { getComponentDirectories } = require("./dependencies/analyzer");
    const { getNpmCommand } = require("./utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) =>
        components.includes(comp)
      );
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter(
        (comp) => !components.includes(comp)
      );
    }

    if (targetComponents.length === 0) {
      logger.error("❌ Nessun componente trovato");
      setTimeout(() => showNpmToolsMenu(), 1000);
      return;
    }

    logger.section(`🔒 Verifica vulnerabilità (${targetComponents.length} componenti)`);
    const { execSync } = require("child_process");

    targetComponents.forEach((component) => {
      const componentPath = path.join(process.cwd(), component);
      logger.log(`\n🔍 ${component}:`, "cyan");
      try {
        execSync(`${getNpmCommand(projectConfig)} audit`, {
          stdio: "inherit",
          cwd: componentPath,
        });
        logger.log(`✅ ${component} - Nessuna vulnerabilità trovata`, "green");
      } catch (error) {
        // npm audit può uscire con codice non-zero se ci sono vulnerabilità
        logger.warning(`⚠️  ${component} - Verifica completata (potrebbero esserci vulnerabilità)`);
      }
    });
  }

  setTimeout(() => showNpmToolsMenu(), 2000);
}

// Funzione per mostrare il menu aggiornamento tsconfig (skipLibCheck)
function showUpdateTsConfigSkipLibCheckMenu() {
  logger.section("⚙️  Aggiorna tsconfig (skipLibCheck)");
  logger.info("Attiva skipLibCheck in tutti i tsconfig.json");
  logger.warning("⚠️  Questa operazione modificherà i file tsconfig.json!");
  logger.space();
  logger.log("1. Aggiorna per tutti i componenti", "blue");
  logger.log("2. Aggiorna per un componente", "blue");
  logger.log("3. Aggiorna per tutti eccetto quelli specificati", "blue");
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu sperimentale...");
        setTimeout(() => showExperimentalMenu(), 500);
        break;
      case "1":
        executeUpdateTsConfigSkipLibCheck("all", []);
        break;
      case "2":
        showComponentSelectionMenu("single", (scope, components) => {
          executeUpdateTsConfigSkipLibCheck(scope, components);
        });
        break;
      case "3":
        showExcludeSelectionMenu((scope, components) => {
          executeUpdateTsConfigSkipLibCheck(scope, components);
        });
        break;
      default:
        logger.log("❌ Scelta non valida", "red");
        setTimeout(() => showUpdateTsConfigSkipLibCheckMenu(), 1000);
    }
  });
}

// Funzione per eseguire aggiornamento tsconfig con skipLibCheck
function executeUpdateTsConfigSkipLibCheck(scope, components) {
  // Reload project config
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    projectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  const { getComponentDirectories } = require("./dependencies/analyzer");
  const { updateTsConfigSkipLibCheck } = require("./dependencies/updater");
  let targetComponents = getComponentDirectories(projectConfig);

  if (scope === "single" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) =>
      components.includes(comp)
    );
  } else if (scope === "exclude" && components.length > 0) {
    targetComponents = targetComponents.filter(
      (comp) => !components.includes(comp)
    );
  }

  if (targetComponents.length === 0) {
    logger.error("❌ Nessun componente trovato");
    setTimeout(() => showExperimentalMenu(), 1000);
    return;
  }

  logger.section(`⚙️  Aggiornamento tsconfig (skipLibCheck) - ${targetComponents.length} componenti`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  targetComponents.forEach((component) => {
    const componentPath = path.join(process.cwd(), component);
    logger.log(`\n📝 ${component}...`, "cyan");
    
    const success = updateTsConfigSkipLibCheck(componentPath, projectConfig);
    
    if (success === true) {
      updatedCount++;
      logger.log(`✅ ${component} - skipLibCheck attivato`, "green");
    } else if (success === null) {
      skippedCount++;
      logger.log(`ℹ️  ${component} - tsconfig.json non trovato o già configurato`, "blue");
    } else {
      errorCount++;
      logger.error(`❌ ${component} - Errore durante l'aggiornamento`);
    }
  });

  logger.log(`\n📊 Risultato:`, "cyan");
  logger.log(`   ✅ Aggiornati: ${updatedCount}/${targetComponents.length}`, "green");
  logger.log(`   ⏭️  Saltati: ${skippedCount}/${targetComponents.length}`, "blue");
  if (errorCount > 0) {
    logger.log(`   ❌ Errori: ${errorCount}/${targetComponents.length}`, "red");
  }

  setTimeout(() => showNpmToolsMenu(), 2000);
}

function syncWorkspaceFromMenu() {
  logger.section("🔄 Sincronizzazione Workspace");

  // Reload project config to get latest settings
  let currentProjectConfig = projectConfig;
  try {
    const configPath = path.join(
      process.cwd(),
      "package-manager",
      "project-config.js"
    );
    delete require.cache[require.resolve(configPath)];
    currentProjectConfig = require(configPath);
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione");
  }

  if (!currentProjectConfig.workspace?.enabled) {
    logger.error("❌ Workspace non abilitato!");
    logger.info("Abilita prima il workspace per utilizzare questa funzione");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.info("🔄 Questa operazione sincronizzerà la configurazione workspace");
  logger.info("con la struttura attuale dei progetti nel repository");
  logger.info("Utile quando si aggiungono o rimuovono progetti");

  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { syncWorkspaceWithProjects } = require("./operations/workspace");
        const success = syncWorkspaceWithProjects(currentProjectConfig);

        if (success) {
          logger.success("✅ Workspace sincronizzato con successo!");
        } else {
          logger.error("❌ Errore durante la sincronizzazione del workspace");
        }
      } catch (error) {
        logger.error(`❌ Errore: ${error.message}`);
      }

      setTimeout(() => showWorkspaceMenu(), 2000);
    } else {
      logger.info("Operazione annullata");
      setTimeout(() => showWorkspaceMenu(), 1000);
    }
  });
}

// ============================================================================
// Gestione configurazione dipendenze
// ============================================================================
function showDependenciesConfigMenu() {
  logger.section("⚙️  Gestione configurazione dipendenze");
  logger.space();
  logger.info("1. Rimuovi prefissi versioni (^, ~, >=, <=, >, <)");
  logger.info("2. Rimuovi duplicati (usa la versione più alta)");
  logger.info("3. Allinea versioni duplicate (mantiene duplicati con versione più alta)");
  logger.space();
  logger.warning("0. 🔙 Torna al menu sperimentale");

  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        cleanVersionPrefixes();
        break;
      case "2":
        removeDuplicateDependencies();
        break;
      case "3":
        alignDuplicateVersions();
        break;
      case "0":
        logger.info("Tornando al menu sperimentale...");
        setTimeout(() => showExperimentalMenu(), 500);
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
    }
  });
}

// Funzione per rimuovere prefissi dalle versioni
function cleanVersionPrefixes() {
  logger.section("🧹 Rimozione prefissi versioni");
  logger.warning("⚠️  Questa operazione rimuoverà i prefissi (^, ~, >=, <=, >, <) da tutte le versioni");
  logger.info("Può essere utile se le versioni sono state definite automaticamente");
  logger.space();

  if (!rl) return;
  
  // Prima mostriamo il preview
  try {
    const { previewCleanVersionPrefixes } = require("./dependencies/config-manager");
    const preview = previewCleanVersionPrefixes();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.cleaned === 0) {
      logger.info("ℹ️  Nessun prefisso trovato nelle versioni");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno rimossi prefissi da ${preview.cleaned} versioni`, "cyan");
    logger.log("Esempi di modifiche:", "yellow");
    
    // Mostriamo alcuni esempi
    const examples = preview.changes.slice(0, 10);
    examples.forEach((change) => {
      logger.log(`   "${change.prefix}${change.version}" → "${change.cleaned}"`, "blue");
    });
    
    if (preview.changes.length > 10) {
      logger.log(`   ... e altre ${preview.changes.length - 10} versioni`, "blue");
    }

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { cleanVersionPrefixesFromConfig } = require("./dependencies/config-manager");
          const result = cleanVersionPrefixesFromConfig();

          if (result.success) {
            logger.success(`✅ Rimosso prefissi da ${result.cleaned} versioni`);
            if (result.errors.length > 0) {
              logger.warning(`⚠️  ${result.errors.length} errori durante l'elaborazione`);
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
}

// Funzione per rimuovere duplicati
function removeDuplicateDependencies() {
  logger.section("🗑️  Rimozione duplicati");
  logger.warning("⚠️  Questa operazione rimuoverà i duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES");
  logger.info("Rimarrà la versione più alta nella sezione dove è stata trovata più frequentemente");
  logger.space();

  if (!rl) return;
  
  // Prima mostriamo il preview
  try {
    const { previewRemoveDuplicateDependencies } = require("./dependencies/config-manager");
    const preview = previewRemoveDuplicateDependencies();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.removed === 0) {
      logger.info("ℹ️  Nessun duplicato trovato");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno rimossi ${preview.removed} duplicati`, "cyan");
    logger.log("Duplicati che verranno risolti:", "yellow");
    
    preview.duplicates.forEach((dup) => {
      logger.log(
        `   ${dup.name}:`,
        "blue"
      );
      logger.log(
        `      ${dup.depVersion} (CONDITIONAL_DEPENDENCIES) vs ${dup.devDepVersion} (CONDITIONAL_DEV_DEPENDENCIES)`,
        "gray"
      );
      logger.log(
        `      → Rimossa da ${dup.removedFrom}, mantenuta in ${dup.keptIn} con versione ${dup.version}`,
        "green"
      );
    });

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { removeDuplicateDependenciesFromConfig } = require("./dependencies/config-manager");
          const result = removeDuplicateDependenciesFromConfig();

          if (result.success) {
            logger.success(`✅ Rimossi ${result.removed} duplicati`);
            if (result.duplicates.length > 0) {
              logger.log("\n📋 Duplicati risolti:", "cyan");
              result.duplicates.forEach((dup) => {
                logger.log(
                  `   ${dup.name}: ${dup.removedFrom} → ${dup.keptIn} (${dup.version})`,
                  "yellow"
                );
              });
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
}

// Funzione per allineare versioni duplicate
function alignDuplicateVersions() {
  logger.section("⚖️  Allineamento versioni duplicate");
  logger.warning("⚠️  Questa operazione allineerà le versioni dei duplicati, usando la versione più alta");
  logger.info("I duplicati rimarranno in entrambe le sezioni, ma con la stessa versione più alta");
  logger.space();

  if (!rl) return;
  
  // Prima mostriamo il preview
  try {
    const { previewAlignDuplicateVersions } = require("./dependencies/config-manager");
    const preview = previewAlignDuplicateVersions();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.aligned === 0) {
      logger.info("ℹ️  Nessun duplicato da allineare (tutte le versioni sono già allineate)");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno allineati ${preview.aligned} duplicati`, "cyan");
    logger.log("Versioni che verranno allineate:", "yellow");
    
    preview.duplicates.forEach((dup) => {
      logger.log(
        `   ${dup.name}:`,
        "blue"
      );
      logger.log(
        `      CONDITIONAL_DEPENDENCIES: ${dup.oldDepVersion} → ${dup.newVersion}`,
        "gray"
      );
      logger.log(
        `      CONDITIONAL_DEV_DEPENDENCIES: ${dup.oldDevDepVersion} → ${dup.newVersion}`,
        "gray"
      );
    });

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { alignDuplicateVersionsInConfig } = require("./dependencies/config-manager");
          const result = alignDuplicateVersionsInConfig();

          if (result.success) {
            logger.success(`✅ Allineati ${result.aligned} duplicati`);
            if (result.duplicates.length > 0) {
              logger.log("\n📋 Duplicati allineati:", "cyan");
              result.duplicates.forEach((dup) => {
                logger.log(
                  `   ${dup.name}: ${dup.oldDepVersion} (deps) + ${dup.oldDevDepVersion} (devDeps) → ${dup.newVersion}`,
                  "yellow"
                );
              });
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
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
