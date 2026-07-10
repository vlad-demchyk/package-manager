#!/usr/bin/env node

/**
 * Core script per il gestore pacchetti Cherry 106
 * Versione modulare con configurazione esterna.
 *
 * Questo file contiene solo:
 *  - il caricamento/setup iniziale di configurazione e logging;
 *  - il parsing dei comandi CLI non interattivi (parseAndExecuteCommand);
 *  - l'entry point del processo.
 *
 * Tutta la logica dei menu interattivi vive in scripts/menus/*, la logica
 * condivisa tra CLI e menu in scripts/cli/actions.js, e main()/showMenu()
 * in scripts/cli/menu-runner.js.
 */

const path = require("path");

const logger = require("./utils/logger");
const cliContext = require("./cli/context");
const actions = require("./cli/actions");

// Carica configurazione progetto dinamicamente
const projectRoot = process.cwd();
let projectConfig = {};
try {
  projectConfig = require(path.join(projectRoot, "package-manager/project-config"));
} catch (e) {
  // project-config may be created later; use an empty config until then
  projectConfig = { logging: { colors: {} } };
}
cliContext.setProjectConfig(projectConfig);

// Abilita il logging su file per tutte le operazioni
logger.enableFileLogging(true, projectRoot);
logger.log(`📝 Logging abilitato: ${logger.getLogFilePath()}`, "blue");

// Wrapper mantenuti per compatibilità con l'API esistente (module.exports):
// la logica reale vive in scripts/cli/actions.js.
function cleanComponent(componentPath) {
  return actions.cleanComponent(componentPath);
}

function installPackages(componentPath, mode = "normal") {
  return actions.installPackages(componentPath, mode);
}

function installAllComponents(mode = "normal") {
  return actions.installAllComponents(mode);
}

function cleanAllComponents(excludeList = [], cleanMode = "lock-and-modules") {
  return actions.cleanAllComponents(excludeList, cleanMode);
}

async function updateAllConfigs(scope = "all", components = []) {
  return actions.updateAllConfigs(scope, components);
}

// Funzioni per parsing comandi CLI non interattivi
async function parseAndExecuteCommand(args) {
  const currentDir = process.cwd();
  const currentDirName = path.basename(currentDir);

  // Controlliamo se l'utente si trova nella cartella package-manager
  if (currentDirName === "package-manager") {
    logger.warning("Ti trovi nella cartella del modulo package-manager!");
    logger.log("");
    logger.log("📁 Per eseguire i comandi del progetto devi tornare alla root del progetto:", "cyan");
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
      actions.executeInstallCommand(scope, components, mode);
      break;
    case "reinstall":
      actions.executeReinstallCommand(scope, components, mode);
      break;
    case "clean":
      actions.executeCleanCommand(scope, components);
      break;
    case "update":
      await actions.executeUpdateCommand(scope, components);
      break;
    case "depcheck": {
      // Support both 'clean' and '--remove' as removal triggers
      const hasClean = args.includes("clean") || args.includes("--remove");
      if (hasClean) {
        // Rimuoviamo 'clean' dagli argomenti
        const cleanArgs = args.filter((arg) => arg !== "clean" && arg !== "--remove");
        await actions.executeDepcheckCleanCommand(scope, components, cleanArgs);
      } else {
        await actions.executeDepcheckCommand(scope, components, args);
      }
      break;
    }
    default:
      require("./cli/menu-runner").showUsage();
      process.exit(1);
  }
}

// main() vive in scripts/cli/menu-runner.js; qui lo richiediamo in modo
// lazy per evitare un require circolare (menu-runner.js richiede questo
// modulo per parseAndExecuteCommand quando ci sono argomenti CLI).
async function main() {
  return require("./cli/menu-runner").main();
}

// Avvio script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  installPackages,
  cleanComponent,
  installAllComponents,
  cleanAllComponents,
  updateAllConfigs,
  showDepcheckMenu: (...args) => require("./menus/depcheck-menu").showDepcheckMenu(...args),
  showDepcheckWhitelistMenu: (...args) => require("./menus/depcheck-menu").showDepcheckWhitelistMenu(...args),
  showVersionAlignmentMenu: (...args) => require("./menus/version-alignment-menu").showVersionAlignmentMenu(...args),
};
