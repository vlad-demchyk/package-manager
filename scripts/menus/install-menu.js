/**
 * Menu "Installazione", "Reinstallazione" e "Pulizia" pacchetti.
 */

const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const actions = require("../cli/actions");
const { showComponentList } = require("./component-list");

function showInstallMenu() {
  logger.section("Modalità installazione");
  logger.info("1. Installa per tutti i componenti");
  logger.info("2. Installa per un componente");
  logger.info("3. Installa per tutti eccetto quelli specificati");
  logger.warning("0. 🔙 Torna al menu principale");

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli modalità installazione (0-3): ", (installAnswer) => {
    switch (installAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
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
          cliContext.returnToMainMenu();
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

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli modalità (0-3): ", (modeAnswer) => {
    let mode = "normal";
    switch (modeAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
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
          cliContext.returnToMainMenu();
        }, 100);
        return;
    }

    if (scope === "all") {
      logger.log("\n⚠️  Questo installerà i pacchetti per TUTTI i componenti!", "yellow");
      rl.question("Continua? (y/N): ", (confirm) => {
        if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
          if (cleanMode) {
            actions.executeReinstallCommand(scope, components, mode, cleanMode);
          } else {
            actions.executeInstallCommand(scope, components, mode);
          }
        }
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
      });
    } else {
      if (cleanMode) {
        actions.executeReinstallCommand(scope, components, mode, cleanMode);
      } else {
        actions.executeInstallCommand(scope, components, mode);
      }
    }
  });
}

function showComponentSelectionMenu(scope, callback = null) {
  const components = showComponentList();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      cliContext.returnToMainMenu();
    }, 100);
    return;
  }

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("\nInserisci numero componente (0 per tornare al menu): ", (answer) => {
    if (answer.trim() === "0") {
      logger.info("Tornando al menu principale...");
      setTimeout(() => {
        cliContext.returnToMainMenu();
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
        cliContext.returnToMainMenu();
      }, 100);
    }
  });
}

function showExcludeSelectionMenu(callback = null) {
  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Inserisci nomi componenti da escludere (separati da spazio): ", (excludeAnswer) => {
    const excludeList = excludeAnswer
      .trim()
      .split(/\s+/)
      .filter((name) => name.length > 0);
    if (excludeList.length > 0) {
      logger.log(`\n⚠️  Questo installerà per tutti i componenti eccetto: ${excludeList.join(", ")}`, "yellow");
      rl.question("Continua? (y/N): ", (confirm) => {
        if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
          if (callback) {
            callback("exclude", excludeList);
          } else {
            showInstallModeMenu("exclude", excludeList);
          }
        } else {
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
        }
      });
    } else {
      logger.error("Nessun componente specificato per esclusione");
      setTimeout(() => {
        cliContext.returnToMainMenu();
      }, 100);
    }
  });
}

// Funzione per chiedere il modo di pulizia durante la reinstallazione
function askCleanupMode(scope, components, callback) {
  logger.section("Modalità pulizia");
  logger.log("1. Rimuovi solo package-lock.json (mantieni node_modules)", "blue");
  logger.log("2. Rimuovi package-lock.json + node_modules (pulizia completa)", "yellow");
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("\nScegli modalità pulizia (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Operazione annullata");
        setTimeout(() => {
          cliContext.returnToMainMenu();
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

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli modalità reinstallazione (0-3): ", (reinstallAnswer) => {
    switch (reinstallAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
        break;
      case "1":
        logger.log("\n⚠️  Questo rimuoverà i file selezionati!", "yellow");
        rl.question("Continua? (y/N): ", (confirm) => {
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
            askCleanupMode("all", [], (scope, components, cleanMode) => {
              showInstallModeMenu(scope, components, cleanMode);
            });
          } else {
            setTimeout(() => {
              cliContext.returnToMainMenu();
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
          cliContext.returnToMainMenu();
        }, 100);
    }
  });
}

function showCleanMenu() {
  const projectConfig = cliContext.getProjectConfig();
  // Check workspace mode
  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

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

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli opzione pulizia (0-3): ", (cleanAnswer) => {
    switch (cleanAnswer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
        break;
      case "1":
        logger.log(
          "\n⚠️  Questo rimuoverà node_modules, package-lock.json e tslint.json da TUTTI i componenti!",
          "yellow"
        );
        rl.question("Continua? (y/N): ", (confirm) => {
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
            actions.cleanAllComponents();
          }
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
        });
        break;
      case "2": {
        const components = showComponentList();
        if (components.length === 0) {
          logger.error("Nessun componente trovato");
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
          return;
        }

        rl.question("\nInserisci numero componente per pulizia (0 per tornare al menu): ", (answer) => {
          if (answer.trim() === "0") {
            logger.info("Tornando al menu principale...");
            setTimeout(() => {
              cliContext.returnToMainMenu();
            }, 100);
            return;
          }

          const index = parseInt(answer) - 1;

          if (index >= 0 && index < components.length) {
            const selectedComponent = components[index];
            logger.log(`\n🎯 Selezionato per pulizia: ${selectedComponent}`, "green");

            // Check if workspace mode is enabled
            const currentProjectConfig = cliContext.getProjectConfig();
            const isWorkspace = currentProjectConfig.workspace?.enabled && currentProjectConfig.workspace?.initialized;

            if (isWorkspace) {
              // Use workspace-specific cleaning
              const { cleanSingleWorkspaceComponent } = require("../operations/cleaner");
              const success = cleanSingleWorkspaceComponent(selectedComponent, currentProjectConfig);

              if (!success) {
                logger.error(`Errore pulizia workspace ${selectedComponent}`);
              }
            } else {
              // Use standard cleaning
              actions.cleanComponent(path.join(process.cwd(), selectedComponent));
              logger.log("\n✅ Pulizia completata!", "green");
            }
            setTimeout(() => {
              cliContext.returnToMainMenu();
            }, 100);
          } else {
            logger.error("Numero componente non valido");
            setTimeout(() => {
              cliContext.returnToMainMenu();
            }, 100);
          }
        });
        break;
      }
      case "3":
        rl.question("Inserisci nomi componenti da escludere (separati da spazio): ", (excludeAnswer) => {
          const excludeList = excludeAnswer
            .trim()
            .split(/\s+/)
            .filter((name) => name.length > 0);
          if (excludeList.length > 0) {
            logger.log(
              `\n⚠️  Questo rimuoverà file da tutti i componenti eccetto: ${excludeList.join(", ")}`,
              "yellow"
            );
            rl.question("Continua? (y/N): ", (confirm) => {
              if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
                actions.cleanAllComponents(excludeList);
              }
              setTimeout(() => {
                cliContext.returnToMainMenu();
              }, 100);
            });
          } else {
            logger.error("Nessun componente specificato per esclusione");
            setTimeout(() => {
              cliContext.returnToMainMenu();
            }, 100);
          }
        });
        break;
      default:
        logger.log("❌ Scelta non valida per pulizia", "red");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
    }
  });
}

module.exports = {
  showInstallMenu,
  showInstallModeMenu,
  showComponentSelectionMenu,
  showExcludeSelectionMenu,
  askCleanupMode,
  showReinstallMenu,
  showCleanMenu,
};
