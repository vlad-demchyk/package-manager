/**
 * Menu "Controllo dipendenze non utilizzate" (depcheck) + gestione whitelist manuale.
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const actions = require("../cli/actions");
const depcheckWhitelist = require("../dependencies/depcheck-whitelist");

// Funzione per chiedere il modo di rimozione dipendenze
function askDepcheckRemovalMode(scope, components, callback) {
  logger.section("Modalità rimozione dipendenze");
  logger.log("1. 🗑️  Rimozione profonda (rimuove da node_modules)", "yellow");
  logger.log("2. ⚡ Rimozione rapida (solo da package.json)", "blue");
  logger.warning("⚠️  La rimozione rapida può causare comportamenti inattesi o errori!");
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("\nScegli modalità rimozione (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Operazione annullata");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
        break;
      case "1":
        callback(scope, components, "deep");
        break;
      case "2":
        logger.warning("\n⚠️  ATTENZIONE: Rimozione rapida selezionata!", "red");
        logger.warning("⚠️  Le dipendenze verranno rimosse solo da package.json", "yellow");
        logger.warning("⚠️  I pacchetti rimarranno in node_modules e potrebbero causare:", "yellow");
        logger.warning("   - Comportamenti inattesi", "yellow");
        logger.warning("   - Errori di runtime", "yellow");
        logger.warning("   - Problemi di compatibilità", "yellow");
        rl.question("\nSei sicuro di voler continuare? (y/N): ", (confirm) => {
          if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
            callback(scope, components, "quick");
          } else {
            logger.info("Operazione annullata");
            setTimeout(() => {
              cliContext.returnToMainMenu();
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
  const projectConfig = cliContext.getProjectConfig();
  // Check workspace mode
  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  logger.section("Controllo dipendenze non utilizzate (experimental)");

  if (isWorkspaceMode) {
    logger.info("🏢 Modalità: WORKSPACE - Analisi centralizzata dipendenze");
    logger.info("📦 Verranno analizzati tutti i workspace per dipendenze condivise");
  } else {
    logger.info("📦 Modalità: STANDARD - Analisi locale dipendenze");
  }

  logger.step("Controlla tutti i componenti", 1);
  logger.step("Controlla un componente", 2);
  logger.step("Controlla tutti eccetto quelli specificati", 3);
  logger.step("Controlla e rimuovi per tutti i componenti (automatico)", 4);
  logger.step("Gestisci whitelist manuale (pacchetti da non rimuovere mai)", 5);
  logger.step("Torna al menu principale", 0);

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli opzione (0-5): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
        break;
      case "1":
        logger.process("Controllo dipendenze per tutti i componenti...");
        actions.executeDepcheckCommand("all", [], [], () => {
          // Dopo l'analisi, chiedi conferma per la rimozione
          const activeRl = cliContext.getRl();
          if (activeRl) {
            logger.log("\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per tutti i componenti?", "yellow");
            activeRl.question("Continua? (y/N): ", (confirm) => {
              if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
                askDepcheckRemovalMode("all", [], (scope, components, mode) => {
                  logger.log(
                    `\n🔍 Rimozione dipendenze per tutti i componenti (modalità: ${mode === "deep" ? "profonda" : "rapida"})...`,
                    "cyan"
                  );
                  const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                  actions.executeDepcheckCommand(scope, components, args, () => {
                    setTimeout(() => {
                      cliContext.returnToMainMenu();
                    }, 100);
                  });
                });
              } else {
                logger.warning("Operazione annullata");
                setTimeout(() => {
                  cliContext.returnToMainMenu();
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
        logger.log("\n🔍 Controllo e rimozione automatica dipendenze per tutti i componenti...", "cyan");
        actions.executeDepcheckCommand("all", [], ["clean"], () => {
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
        });
        break;
      case "5":
        showDepcheckWhitelistMenu();
        break;
      default:
        logger.error("Scelta non valida");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
    }
  });
}

// Menu per gestire la whitelist manuale di depcheck (package-manager/project-config.js -> depcheck.ignore)
function showDepcheckWhitelistMenu() {
  const projectConfig = cliContext.getProjectConfig();
  const projectRoot = cliContext.getProjectRoot();
  const currentList = depcheckWhitelist.getIgnoreList(projectConfig);

  logger.section("🔒 Whitelist manuale depcheck");
  logger.info(
    "Pacchetti qui elencati non verranno MAI proposti per la rimozione, anche se depcheck non rileva un uso esplicito nel codice."
  );

  if (currentList.length === 0) {
    logger.log("   (vuota)", "gray");
  } else {
    currentList.forEach((name, index) => {
      logger.log(`   ${index + 1}. ${name}`, "blue");
    });
  }

  logger.log("", "reset");
  logger.step("Aggiungi pacchetto alla whitelist", 1);
  logger.step("Rimuovi pacchetto dalla whitelist", 2);
  logger.step("Torna al menu depcheck", 0);

  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Scegli opzione (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        showDepcheckMenu();
        break;
      case "1":
        rl.question("Nome pacchetto da escludere (es. some-package): ", (name) => {
          const trimmed = name.trim();
          if (!trimmed) {
            logger.error("Nome pacchetto non valido");
            setTimeout(() => showDepcheckWhitelistMenu(), 300);
            return;
          }
          const result = depcheckWhitelist.addToIgnoreList(projectRoot, projectConfig, trimmed);
          if (result.success) {
            logger.success(`🔒 "${trimmed}" aggiunto alla whitelist`);
          } else if (result.reason === "already-present") {
            logger.info(`"${trimmed}" è già nella whitelist`);
          } else {
            logger.error(`Impossibile aggiungere "${trimmed}" (${result.reason})`);
          }
          setTimeout(() => showDepcheckWhitelistMenu(), 300);
        });
        break;
      case "2":
        if (currentList.length === 0) {
          logger.warning("La whitelist è vuota");
          setTimeout(() => showDepcheckWhitelistMenu(), 300);
          return;
        }
        rl.question(`Numero del pacchetto da rimuovere (1-${currentList.length}): `, (indexAnswer) => {
          const index = parseInt(indexAnswer.trim(), 10);
          if (isNaN(index) || index < 1 || index > currentList.length) {
            logger.error("Numero non valido");
            setTimeout(() => showDepcheckWhitelistMenu(), 300);
            return;
          }
          const name = currentList[index - 1];
          const result = depcheckWhitelist.removeFromIgnoreList(projectRoot, projectConfig, name);
          if (result.success) {
            logger.success(`🔓 "${name}" rimosso dalla whitelist`);
          } else {
            logger.error(`Impossibile rimuovere "${name}" (${result.reason})`);
          }
          setTimeout(() => showDepcheckWhitelistMenu(), 300);
        });
        break;
      default:
        logger.error("Scelta non valida");
        setTimeout(() => showDepcheckWhitelistMenu(), 300);
    }
  });
}

function showDepcheckComponentSelection() {
  const { showComponentList } = require("./component-list");
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

      // Prima mostra le dipendenze non utilizzate
      logger.log(`\n🔍 Analisi dipendenze per: ${selectedComponent}`, "cyan");
      actions.executeDepcheckCommand("single", [selectedComponent], [], () => {
        // Dopo l'analisi, chiedi conferma per la rimozione
        const activeRl = cliContext.getRl();
        if (activeRl) {
          logger.log(`\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per: ${selectedComponent}?`, "yellow");
          activeRl.question("Continua? (y/N): ", (confirm) => {
            if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
              askDepcheckRemovalMode("single", [selectedComponent], (scope, components, mode) => {
                logger.log(
                  `\n🔍 Rimozione dipendenze per: ${selectedComponent} (modalità: ${mode === "deep" ? "profonda" : "rapida"})...`,
                  "cyan"
                );
                const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                actions.executeDepcheckCommand(scope, components, args, () => {
                  setTimeout(() => {
                    cliContext.returnToMainMenu();
                  }, 100);
                });
              });
            } else {
              logger.warning("Operazione annullata");
              setTimeout(() => {
                cliContext.returnToMainMenu();
              }, 100);
            }
          });
        }
      });
    } else {
      logger.error("Numero componente non valido");
      setTimeout(() => {
        cliContext.returnToMainMenu();
      }, 100);
    }
  });
}

function showDepcheckExcludeSelection() {
  const rl = cliContext.getRl();
  if (!rl) return;

  rl.question("Inserisci nomi componenti da escludere (separati da spazio): ", (excludeAnswer) => {
    const excludeList = excludeAnswer
      .trim()
      .split(/\s+/)
      .filter((name) => name.length > 0);
    if (excludeList.length > 0) {
      // Prima mostra le dipendenze non utilizzate
      logger.log(`\n🔍 Analisi dipendenze per tutti i componenti eccetto: ${excludeList.join(", ")}`, "cyan");
      actions.executeDepcheckCommand("exclude", excludeList, [], () => {
        // Dopo l'analisi, chiedi conferma per la rimozione
        const activeRl = cliContext.getRl();
        if (activeRl) {
          logger.log(
            `\n⚠️  Vuoi rimuovere le dipendenze non utilizzate per tutti i componenti eccetto: ${excludeList.join(", ")}?`,
            "yellow"
          );
          activeRl.question("Continua? (y/N): ", (confirm) => {
            if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
              askDepcheckRemovalMode("exclude", excludeList, (scope, components, mode) => {
                logger.log(
                  `\n🔍 Rimozione dipendenze per tutti i componenti eccetto: ${excludeList.join(", ")} (modalità: ${
                    mode === "deep" ? "profonda" : "rapida"
                  })...`,
                  "cyan"
                );
                const args = mode === "quick" ? ["clean", "--quick-remove"] : ["clean"];
                actions.executeDepcheckCommand(scope, components, args, () => {
                  setTimeout(() => {
                    cliContext.returnToMainMenu();
                  }, 100);
                });
              });
            } else {
              logger.warning("Operazione annullata");
              setTimeout(() => {
                cliContext.returnToMainMenu();
              }, 100);
            }
          });
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

module.exports = {
  askDepcheckRemovalMode,
  showDepcheckMenu,
  showDepcheckWhitelistMenu,
  showDepcheckComponentSelection,
  showDepcheckExcludeSelection,
};
