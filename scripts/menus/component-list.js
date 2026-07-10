/**
 * Elenco componenti del progetto (usato da molti altri menu per far scegliere
 * un componente all'utente).
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const { getComponentDirectories } = require("../utils/common");

function showComponentList() {
  const projectConfig = cliContext.getProjectConfig();
  const components = getComponentDirectories(projectConfig);
  logger.section("Componenti disponibili");
  components.forEach((component, index) => {
    logger.info(`${index + 1}. ${component}`);
  });
  logger.warning(`0. 🔙 Torna al menu principale`);
  return components;
}

function showDetailedComponentList() {
  // Reload project config to get latest settings, dal punto unico di reload
  // (cliContext.reloadProjectConfig).
  const projectConfig = cliContext.reloadProjectConfig();

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
      logger.log(`🔤 Filtro per prefisso: "${projectConfig.components.filterByPrefix.prefix}"`, "blue");
    }

    if (projectConfig.components.filterByStructure.enabled) {
      logger.log(`📁 Filtro per struttura:`, "blue");
      logger.log(
        `   File richiesti: ${projectConfig.components.filterByStructure.requiredFiles.join(", ")}`,
        "blue"
      );
      logger.log(
        `   Cartelle richieste: ${projectConfig.components.filterByStructure.requiredFolders.join(", ")}`,
        "blue"
      );
    }

    if (projectConfig.components.filterByList.enabled) {
      logger.log(`📋 Filtro per lista: ${projectConfig.components.filterByList.folders.join(", ")}`, "blue");
    }

    if (projectConfig.components.filterByRegex.enabled) {
      logger.log(`🔍 Filtro per regex: ${projectConfig.components.filterByRegex.pattern}`, "blue");
    }

    if (
      !projectConfig.components.filterByPrefix.enabled &&
      !projectConfig.components.filterByStructure.enabled &&
      !projectConfig.components.filterByList.enabled &&
      !projectConfig.components.filterByRegex.enabled
    ) {
      logger.log(`⚠️  Nessun filtro attivo - vengono mostrati tutti i componenti con package.json`, "yellow");
    }
  }

  logger.log("");
  logger.warning("🔙 Premi INVIO per tornare al menu principale...");

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("", () => {
    logger.info("Tornando al menu principale...");
    setTimeout(() => {
      cliContext.returnToMainMenu();
    }, 100);
  });
}

module.exports = {
  showComponentList,
  showDetailedComponentList,
};
