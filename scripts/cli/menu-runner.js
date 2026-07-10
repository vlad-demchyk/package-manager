/**
 * Punto di ingresso della modalità interattiva: main(), il menu principale
 * (showMenu) e il messaggio di utilizzo CLI (showUsage).
 *
 * Gestisce anche il ciclo di vita dell'istanza readline condivisa (cliContext)
 * e registra l'handler di ritorno al menu principale usato da tutti i
 * sotto-menu (cliContext.returnToMainMenu()).
 */

const readline = require("readline");

const logger = require("../utils/logger");
const cliContext = require("./context");

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
  logger.log("  node package-manager.js clean [--single component] [--exclude comp1 comp2]", "blue");
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
  logger.log("  node package-manager.js depcheck [--single component] [--exclude comp1 comp2] clean", "blue");
  logger.log("");
  logger.section("Esempi");
  logger.success("  node package-manager.js install --exclude c106-header c106-footer");
  logger.success("  node package-manager.js install --single c106-header force");
  logger.success("  node package-manager.js reinstall --exclude c106-header legacy");
  logger.success("  node package-manager.js clean --single c106-header");
  logger.success("  node package-manager.js update");
  logger.success("  node package-manager.js depcheck --single c106-header");
  logger.success("  node package-manager.js depcheck --remove");
  logger.success("  node package-manager.js depcheck --single c106-header clean");
  logger.success("  node package-manager.js depcheck --exclude c106-header c106-footer clean");
  logger.log("");
  logger.section("Modalità interattiva");
  logger.log("  node package-manager.js");
}

function showMenu() {
  // Reload project config to get latest settings. Delegato a cliContext:
  // punto unico di reload, che invalida solo la cache di project-config.js
  // (mai quella di scripts/cli/context.js o di altri moduli sotto scripts/,
  // per non distruggere lo stato condiviso di cliContext come rl e
  // mainMenuHandler) e, in caso di errore, restituisce la versione in cache.
  const projectConfig = cliContext.reloadProjectConfig();

  // Get search mode indicator
  const recursiveEnabled = projectConfig.components.recursiveSearch?.enabled;

  // Reload workspace status from actual files
  let workspaceEnabled = projectConfig.workspace?.enabled || false;
  let workspaceInitialized = projectConfig.workspace?.initialized || false;

  // Use ONLY projectConfig for workspace status - no file checking
  // This ensures consistency and prevents conflicts

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

  // Workspace mode indicator
  if (workspaceEnabled) {
    if (workspaceInitialized) {
      logger.info("🏢 Modalità installazione: WORKSPACE (centralizzato) - Yarn Workspaces attivo");
    } else {
      logger.warning("🏢 Modalità installazione: WORKSPACE (non inizializzato) - Richiede inizializzazione");
    }
  } else {
    logger.info("📦 Modalità installazione: STANDARD (node_modules locali)");
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

// Variabile locale al modulo, allo stesso modo della vecchia `rl` globale in
// core.js: è null quando main() esegue l'auto-detect workspace (che quindi,
// come nel comportamento originale, viene invocato solo se rl è già stato
// assegnato in una precedente esecuzione del processo).
let rl = null;

async function main() {
  // Reload project config to get latest settings, dal punto unico di reload
  // (cliContext.reloadProjectConfig): invalida solo la cache di
  // project-config.js, mai quella di altri moduli sotto scripts/.
  const projectConfig = cliContext.reloadProjectConfig();

  if (!projectConfig || !projectConfig.project || !projectConfig.project.name) {
    logger.error("❌ Errore caricando configurazione progetto:");
    logger.warning("   Invalid project configuration");
    logger.info("💡 Esegui 'npx packman' per riconfigurare il progetto");
    process.exit(1);
  }

  // Check and add workspace section if missing (for new versions)
  try {
    const { ensureWorkspaceSectionExists } = require("../menus/workspace-menu");
    ensureWorkspaceSectionExists(projectConfig);
    cliContext.setProjectConfig(projectConfig);
  } catch (error) {
    logger.warning("⚠️  Impossibile aggiornare la sezione workspace della configurazione:");
    logger.warning(`   ${error.message}`);
  }

  // Auto-detect workspace configuration for other users
  try {
    const { autoDetectAndPromptWorkspace } = require("../utils/workspace-detector");
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

  logger.log(`🚀 ${projectConfig.project.name} - ${projectConfig.project.description}`, "bright");

  const args = process.argv.slice(2);

  // Se sono passati argomenti da riga di comando
  if (args.length > 0) {
    const { parseAndExecuteCommand } = require("../core");
    await parseAndExecuteCommand(args);
    return;
  }

  // Modalità interattiva
  try {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    cliContext.setRl(rl);

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

    const askQuestion = function () {
      if (rl && rl.closed) {
        return;
      }

      // Mostra il menu e chiedi l'opzione
      showMenu();
      if (rl) {
        rl.question("\nScegli opzione (0-6, 9): ", (answer) => {
          switch (answer.trim()) {
            case "1":
              require("../menus/update-menu").showUpdateMenu();
              break;
            case "2":
              require("../menus/install-menu").showInstallMenu();
              break;
            case "3":
              require("../menus/install-menu").showReinstallMenu();
              break;
            case "4":
              require("../menus/install-menu").showCleanMenu();
              break;
            case "5":
              require("../menus/logs-menu").showLogsMenu();
              break;
            case "6":
              require("../menus/experimental-menu").showExperimentalMenu();
              break;
            case "9":
              require("../menus/component-list").showDetailedComponentList();
              break;
            case "0":
              logger.log("👋 Arrivederci!", "green");
              if (rl) rl.close();
              break;
            default:
              logger.log("❌ Scelta non valida. Riprova.", "red");
              setTimeout(() => {
                askQuestion();
              }, 100);
          }
        });
      }
    };

    cliContext.setMainMenuHandler(askQuestion);
    askQuestion();
  } catch (error) {
    logger.log(`❌ Errore durante l'inizializzazione: ${error.message}`, "red");
    process.exit(1);
  }
}

module.exports = {
  main,
  showMenu,
  showUsage,
};
