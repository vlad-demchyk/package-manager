/**
 * Menu "Strumenti npm/package": rimozione lock files, package-lock-only,
 * npm outdated, npm audit, aggiornamento tsconfig (skipLibCheck).
 */

const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const { showComponentSelectionMenu, showExcludeSelectionMenu } = require("./install-menu");

// showExperimentalMenu è richiesto in modo "lazy" (dentro le funzioni, non in
// cima al file) per evitare un require circolare con experimental-menu.js,
// che a sua volta richiede questo modulo per costruire il proprio menu.
function backToExperimentalMenu(delay = 500) {
  setTimeout(() => require("./experimental-menu").showExperimentalMenu(), delay);
}

function showNpmToolsMenu() {
  logger.section("📦 Strumenti npm/package");
  logger.space();
  logger.info("1. Rimuovi package-lock.json per progetti");
  logger.info("2. npm install --package-lock-only (verifica rapida)");
  logger.info("3. npm outdated (verifica versioni obsolete)");
  logger.info("4. npm audit (verifica vulnerabilità)");
  logger.space();
  logger.warning("0. 🔙 Torna al menu sperimentale");

  const rl = cliContext.getRl();
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
        backToExperimentalMenu();
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showNpmToolsMenu(), 1000);
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

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu sperimentale...");
        backToExperimentalMenu();
        break;
      case "1":
        logger.log("\n⚠️  Questo rimuoverà package-lock.json da TUTTI i componenti!", "yellow");
        rl.question("Continua? (y/N): ", (confirm) => {
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
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
  const { reloadProjectConfig } = require("../cli/actions");
  const projectConfig = reloadProjectConfig();

  const { getComponentDirectories } = require("../dependencies/analyzer");
  const { removeFile } = require("../utils/common");
  let targetComponents = getComponentDirectories(projectConfig);

  // Filter components based on scope
  if (scope === "single" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) => components.includes(comp));
  } else if (scope === "exclude" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) => !components.includes(comp));
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

  const rl = cliContext.getRl();
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

  const rl = cliContext.getRl();
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

  const rl = cliContext.getRl();
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
  const { reloadProjectConfig } = require("../cli/actions");
  const projectConfig = reloadProjectConfig();

  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

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
    const { getComponentDirectories } = require("../dependencies/analyzer");
    const { getNpmCommand } = require("../utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => components.includes(comp));
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => !components.includes(comp));
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
        execSync(`${getNpmCommand(projectConfig)} install --package-lock-only`, {
          stdio: "inherit",
          cwd: componentPath,
        });
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
  const { reloadProjectConfig } = require("../cli/actions");
  const projectConfig = reloadProjectConfig();

  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

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
    const { getComponentDirectories } = require("../dependencies/analyzer");
    const { getNpmCommand } = require("../utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => components.includes(comp));
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => !components.includes(comp));
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

  backToExperimentalMenu(2000);
}

// Funzione per eseguire npm audit
function executeNpmAuditCommand(scope, components) {
  const { reloadProjectConfig } = require("../cli/actions");
  const projectConfig = reloadProjectConfig();

  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

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
    const { getComponentDirectories } = require("../dependencies/analyzer");
    const { getNpmCommand } = require("../utils/common");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => components.includes(comp));
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => !components.includes(comp));
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

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("\nScegli opzione (0-3): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu sperimentale...");
        backToExperimentalMenu();
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
  const { reloadProjectConfig } = require("../cli/actions");
  const projectConfig = reloadProjectConfig();

  const { getComponentDirectories } = require("../dependencies/analyzer");
  const { updateTsConfigSkipLibCheck } = require("../dependencies/updater");
  let targetComponents = getComponentDirectories(projectConfig);

  if (scope === "single" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) => components.includes(comp));
  } else if (scope === "exclude" && components.length > 0) {
    targetComponents = targetComponents.filter((comp) => !components.includes(comp));
  }

  if (targetComponents.length === 0) {
    logger.error("❌ Nessun componente trovato");
    backToExperimentalMenu(1000);
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

module.exports = {
  showNpmToolsMenu,
  showRemoveLockFilesMenu,
  removeLockFiles,
  showPackageLockOnlyMenu,
  showNpmOutdatedMenu,
  showNpmAuditMenu,
  executePackageLockOnlyCommand,
  executeNpmOutdatedCommand,
  executeNpmAuditCommand,
  showUpdateTsConfigSkipLibCheckMenu,
  executeUpdateTsConfigSkipLibCheck,
};
