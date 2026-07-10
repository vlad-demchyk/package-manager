/**
 * Menu "Gestione Monorepo Workspace".
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

// showExperimentalMenu è richiesto in modo "lazy" per evitare un require
// circolare con experimental-menu.js (che richiede questo modulo).
function backToExperimentalMenu(delay = 500) {
  setTimeout(() => require("./experimental-menu").showExperimentalMenu(), delay);
}

// Delegata a cliContext: punto unico di reload di project-config.js
// (vedi commento su cliContext.reloadProjectConfig per i dettagli).
function reloadProjectConfig() {
  return cliContext.reloadProjectConfig();
}

/**
 * Ensure workspace section exists in project config
 * @param {Object} projectConfig - Project configuration object
 */
function ensureWorkspaceSectionExists(projectConfig) {
  const projectRoot = cliContext.getProjectRoot();
  try {
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
      const configPath = path.join(projectRoot, "package-manager", "project-config.js");

      // Create properly formatted config content
      const configContent = `module.exports = ${JSON.stringify(projectConfig, null, 2)};`;

      try {
        logger.debug(`📝 Salvando configurazione in: ${configPath}`);
        fs.writeFileSync(configPath, configContent);
        logger.success("✅ Configurazione workspace aggiunta automaticamente");
        logger.info("💡 Usa 'Funzioni sperimentali > Gestione Monorepo Workspace' per abilitare");

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

// Workspace menu functions
function showWorkspaceMenu() {
  logger.section("🏢 Gestione Monorepo Workspace");
  logger.warning("Funzione sperimentale per gestione centralizzata pacchetti");

  const projectConfig = reloadProjectConfig();

  // Get actual workspace status from files, not just config
  let workspaceEnabled = projectConfig.workspace?.enabled || false;
  let workspaceInitialized = projectConfig.workspace?.initialized || false;

  // Check actual workspace status from files for accurate display
  try {
    const { getWorkspaceStatus } = require("../operations/workspace");
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

  const rl = cliContext.getRl();
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
          backToExperimentalMenu();
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
          backToExperimentalMenu();
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
          backToExperimentalMenu();
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

  const rl = cliContext.getRl();
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
          let projectConfig = cliContext.getProjectConfig();

          // First disable workspace to clean up
          const { disableWorkspace } = require("../operations/workspace");
          disableWorkspace(projectConfig);

          // Reload project config after disabling
          projectConfig = reloadProjectConfig();
          logger.info("Configurazione ricaricata dopo disabilitazione");

          // Then reinitialize with fresh config (with or without force)
          const { initializeWorkspace } = require("../operations/workspace");
          const success = initializeWorkspace(projectConfig, useForce);

          if (success) {
            logger.success("Workspace reinizializzato con successo!");
            // Reload project config again after initialization
            reloadProjectConfig();
            logger.info("Configurazione ricaricata dopo inizializzazione");
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

  const projectConfig = cliContext.getProjectConfig();

  if (projectConfig.workspace?.enabled && projectConfig.workspace?.initialized) {
    logger.warning("⚠️  Workspace già inizializzato!");
    logger.info("Usa l'opzione 'Reinizializza Workspace' per ripristinare");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione modificherà la struttura del progetto");
  logger.info("Verrà creato un root package.json con workspaces");
  logger.info("Tutti i pacchetti saranno gestiti centralmente");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { initializeWorkspace } = require("../operations/workspace");
        const success = initializeWorkspace(projectConfig, false);

        if (success) {
          logger.success("Workspace inizializzato con successo!");
          // Reload project config
          try {
            reloadProjectConfig();
            logger.info("Configurazione ricaricata");
          } catch (error) {
            logger.warning("⚠️  Impossibile ricaricare la configurazione");
            logger.warning("Riavvia il package manager per vedere le modifiche");
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

  const projectConfig = cliContext.getProjectConfig();

  if (!projectConfig.workspace?.enabled) {
    logger.warning("⚠️  Workspace non abilitato!");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione rimuoverà la configurazione workspace");
  logger.info("Verrà rimosso workspaces dal root package.json");
  logger.info("Verrà rimosso yarn.lock");
  logger.warning("I node_modules locali dovranno essere reinstallati manualmente");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { disableWorkspace } = require("../operations/workspace");
        const success = disableWorkspace(projectConfig);

        if (success) {
          logger.success("Workspace disabilitato con successo!");
          reloadProjectConfig();
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
    const projectConfig = cliContext.getProjectConfig();
    const { getWorkspaceStatus } = require("../operations/workspace");
    const status = getWorkspaceStatus(projectConfig);

    if (!status) {
      logger.error("❌ Impossibile ottenere lo stato del workspace");
      setTimeout(() => showWorkspaceMenu(), 2000);
      return;
    }

    logger.log("📋 Informazioni Workspace:", "cyan");
    logger.log(`   Abilitato: ${status.enabled ? "✅ Sì" : "❌ No"}`, status.enabled ? "green" : "red");
    logger.log(
      `   Inizializzato: ${status.initialized ? "✅ Sì" : "❌ No"}`,
      status.initialized ? "green" : "red"
    );
    logger.log(
      `   Yarn Lock: ${status.hasYarnLock ? "✅ Presente" : "❌ Assente"}`,
      status.hasYarnLock ? "green" : "red"
    );
    logger.log(
      `   Workspaces: ${status.hasWorkspaces ? "✅ Configurati" : "❌ Non configurati"}`,
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
      const { formatBytes } = require("../utils/common");
      logger.log(`   Root node_modules: ${formatBytes(status.rootNodeModulesSize)}`, "cyan");
    }

    logger.log(`   Node_modules locali: ${status.localNodeModulesCount}`, "yellow");
  } catch (error) {
    logger.error(`❌ Errore ottenendo stato workspace: ${error.message}`);
  }

  logger.warning("\nPremi INVIO per tornare...");
  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("", () => showWorkspaceMenu());
}

function cleanLocalNodeModulesFromMenu() {
  logger.section("🧹 Pulizia Node_modules Locali");

  const currentProjectConfig = reloadProjectConfig();

  if (!currentProjectConfig.workspace?.enabled) {
    logger.error("❌ Workspace non abilitato!");
    logger.info("Abilita prima il workspace per utilizzare questa funzione");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.warning("⚠️  Questa operazione rimuoverà tutti i node_modules locali");
  logger.info("I pacchetti saranno disponibili solo tramite root node_modules");
  logger.info("Utile per risparmiare spazio su disco");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { cleanLocalNodeModules } = require("../operations/workspace");
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

function syncWorkspaceFromMenu() {
  logger.section("🔄 Sincronizzazione Workspace");

  const currentProjectConfig = reloadProjectConfig();

  if (!currentProjectConfig.workspace?.enabled) {
    logger.error("❌ Workspace non abilitato!");
    logger.info("Abilita prima il workspace per utilizzare questa funzione");
    setTimeout(() => showWorkspaceMenu(), 2000);
    return;
  }

  logger.info("🔄 Questa operazione sincronizzerà la configurazione workspace");
  logger.info("con la struttura attuale dei progetti nel repository");
  logger.info("Utile quando si aggiungono o rimuovono progetti");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("Continuare? (y/N): ", (confirm) => {
    if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
      try {
        const { syncWorkspaceWithProjects } = require("../operations/workspace");
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

module.exports = {
  ensureWorkspaceSectionExists,
  showWorkspaceMenu,
  reinitializeWorkspaceFromMenu,
  initializeWorkspaceFromMenu,
  disableWorkspaceFromMenu,
  showWorkspaceStatus,
  cleanLocalNodeModulesFromMenu,
  syncWorkspaceFromMenu,
};
