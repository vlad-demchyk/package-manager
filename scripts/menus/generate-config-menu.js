/**
 * Menu principale "Genera configurazione dipendenze (solo lettura)".
 *
 * Analizza i package.json di tutti i progetti trovati e genera/aggiorna
 * package-manager/dependencies-config.js con l'inventario delle dipendenze
 * usate nel repository, SENZA applicare alcuna modifica ai package.json dei
 * singoli progetti e SENZA eseguire installazioni. È la versione "sola
 * lettura" della generazione automatica già proposta durante
 * "1. Aggiornamento configurazioni": qui serve solo a creare/rivedere il file
 * per un uso successivo (manuale o tramite l'aggiornamento vero e proprio).
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const { createReadlineInterface, askQuestion } = require("../cli/prompt");
const {
  generateDependenciesConfig,
  displayGeneratedDependencies,
  saveDependenciesConfig,
} = require("../dependencies/generator");

async function showGenerateConfigMenu() {
  logger.section("📄 Genera configurazione dipendenze (solo lettura)");
  logger.info("Analizza i package.json di tutti i progetti trovati e genera");
  logger.info("package-manager/dependencies-config.js con le dipendenze usate.");
  logger.warning("⚠️  NON modifica i package.json dei progetti e NON esegue installazioni:");
  logger.warning("   crea/aggiorna solo il file di configurazione, per lettura e uso successivo.");
  logger.space();

  const rl = createReadlineInterface();

  try {
    const projectConfig = cliContext.reloadProjectConfig();
    const generated = generateDependenciesConfig(projectConfig);
    displayGeneratedDependencies(generated, projectConfig);

    if (generated.standardTsConfig && Object.keys(generated.standardTsConfig).length > 0) {
      logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
      logger.log(`   Versione TypeScript: ${generated.tsVersion}`, "blue");
      const tsAnswer = await askQuestion(rl, "Includerlo nella configurazione salvata? (y/N): ");
      if (tsAnswer !== "y" && tsAnswer !== "yes") {
        generated.standardTsConfig = {};
        logger.info("Configurazione TypeScript non sarà salvata");
      }
    }

    const saveAnswer = await askQuestion(
      rl,
      "\nSalvare questa configurazione in dependencies-config.js? (y/N): "
    );

    if (saveAnswer === "y" || saveAnswer === "yes") {
      saveDependenciesConfig(generated, projectConfig);
      logger.success("✅ Configurazione salvata in package-manager/dependencies-config.js");
      logger.info("💡 Nessun package.json è stato modificato, nessuna installazione è stata eseguita.");
      logger.info("💡 Usa '1. Aggiornamento configurazioni' quando vuoi applicare queste versioni ai progetti.");
    } else {
      logger.info("Generazione annullata: nessun file è stato modificato");
    }
  } catch (error) {
    logger.error(`❌ Errore durante la generazione: ${error.message}`);
  }

  logger.warning("\n🔙 Premi INVIO per tornare al menu principale...");
  await askQuestion(rl, "");
  cliContext.returnToMainMenu();
}

module.exports = {
  showGenerateConfigMenu,
};
