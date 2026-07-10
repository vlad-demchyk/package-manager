/**
 * Menu "EXPERIMENTAL - Funzioni sperimentali": orchestratore sottile che
 * instrada verso i vari sotto-menu sperimentali.
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

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
  logger.info("7. 🔀 Allineamento versioni dipendenze tra progetti");
  logger.space();
  logger.warning("0. Torna al menu principale");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        require("./recursive-search-menu").toggleRecursiveSearch();
        break;
      case "2":
        require("./depcheck-menu").showDepcheckMenu();
        break;
      case "3":
        require("./workspace-menu").showWorkspaceMenu();
        break;
      case "4":
        require("./npm-tools-menu").showNpmToolsMenu();
        break;
      case "5":
        require("./npm-tools-menu").showUpdateTsConfigSkipLibCheckMenu();
        break;
      case "6":
        require("./dependencies-config-menu").showDependenciesConfigMenu();
        break;
      case "7":
        require("./version-alignment-menu").showVersionAlignmentMenu();
        break;
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 500);
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showExperimentalMenu(), 1000);
    }
  });
}

module.exports = {
  showExperimentalMenu,
};
