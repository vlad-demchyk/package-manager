/**
 * Menu "Cambia modalità di ricerca progetti" (ricerca ricorsiva on/off + profondità massima).
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

// showExperimentalMenu è richiesto in modo "lazy" per evitare un require
// circolare con experimental-menu.js (che richiede questo modulo).
function backToExperimentalMenu() {
  require("./experimental-menu").showExperimentalMenu();
}

function toggleRecursiveSearch() {
  logger.section("Cambio Modalita Ricerca");

  const projectConfig = cliContext.getProjectConfig();
  const currentState = projectConfig.components.recursiveSearch?.enabled || false;
  logger.info(`Stato attuale: ${currentState ? "RICORSIVA" : "STANDARD"}`);
  logger.space();

  const rl = cliContext.getRl();
  if (!rl) return;

  if (currentState) {
    // Se attualmente abilitata, mostra solo opzioni per disabilitare
    logger.info("1. Disabilita ricerca ricorsiva");
    logger.info("2. Configura profondita massima");
    logger.warning("0. Annulla");

    rl.question("\nScegli opzione: ", async (answer) => {
      switch (answer.trim()) {
        case "1":
          await disableRecursiveSearch();
          break;
        case "2":
          await configureMaxDepth();
          break;
        case "0":
          backToExperimentalMenu();
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

    rl.question("\nScegli opzione: ", async (answer) => {
      switch (answer.trim()) {
        case "1":
          await enableRecursiveSearch();
          break;
        case "2":
          await configureMaxDepth();
          break;
        case "0":
          backToExperimentalMenu();
          break;
        default:
          logger.log("Scelta non valida", "red");
          setTimeout(() => toggleRecursiveSearch(), 1000);
      }
    });
  }
}

async function enableRecursiveSearch() {
  const projectRoot = cliContext.getProjectRoot();
  const configPath = path.join(projectRoot, "package-manager", "project-config.js");

  // Read, modify, and write config
  try {
    let configContent = fs.readFileSync(configPath, "utf8");

    // Check if recursiveSearch section exists
    if (configContent.includes("recursiveSearch:")) {
      // Update existing recursiveSearch.enabled to true
      configContent = configContent.replace(/(recursiveSearch:\s*\{[^}]*enabled:\s*)(false)/, "$1true");
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
      configContent = configContent.replace(/(\s*)(\},\s*\/\/ Configurazione file)/, `$1${recursiveSearchSection}$1$2`);
    }

    fs.writeFileSync(configPath, configContent, "utf8");

    // Reload config dal punto unico di reload (cliContext.reloadProjectConfig)
    cliContext.reloadProjectConfig();

    logger.success("Ricerca ricorsiva ABILITATA");
    logger.info("Riavvia il package manager per applicare le modifiche");
  } catch (error) {
    logger.error(`Errore: ${error.message}`);
  }

  logger.warning("\nPremi INVIO per tornare...");
  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("", () => backToExperimentalMenu());
}

async function disableRecursiveSearch() {
  const projectRoot = cliContext.getProjectRoot();
  const configPath = path.join(projectRoot, "package-manager", "project-config.js");

  try {
    let configContent = fs.readFileSync(configPath, "utf8");

    // Check if recursiveSearch section exists
    if (configContent.includes("recursiveSearch:")) {
      // Update existing recursiveSearch.enabled to false
      configContent = configContent.replace(/(recursiveSearch:\s*\{[^}]*enabled:\s*)(true)/, "$1false");
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
      configContent = configContent.replace(/(\s*)(\},\s*\/\/ Configurazione file)/, `$1${recursiveSearchSection}$1$2`);
    }

    fs.writeFileSync(configPath, configContent, "utf8");

    // Reload config dal punto unico di reload (cliContext.reloadProjectConfig)
    cliContext.reloadProjectConfig();

    logger.success("Ricerca ricorsiva DISABILITATA");
    logger.info("Riavvia il package manager per applicare le modifiche");
  } catch (error) {
    logger.error(`Errore: ${error.message}`);
  }

  logger.warning("\nPremi INVIO per tornare...");
  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("", () => backToExperimentalMenu());
}

async function configureMaxDepth() {
  logger.info("Configura profondita massima ricerca");
  logger.warning("NOTA: modifica manualmente project-config.js");
  logger.info("Imposta components.recursiveSearch.maxDepth a:");
  logger.info("  - Numero (es: 3) per limitare la profondita");
  logger.info("  - null per ricerca illimitata");

  logger.warning("\nPremi INVIO per tornare...");
  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("", () => backToExperimentalMenu());
}

module.exports = {
  toggleRecursiveSearch,
  enableRecursiveSearch,
  disableRecursiveSearch,
  configureMaxDepth,
};
