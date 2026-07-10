/**
 * Menu "Gestione configurazione dipendenze": rimozione prefissi versione,
 * rimozione duplicati, allineamento versioni duplicate in dependencies-config.js.
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

// showExperimentalMenu è richiesto in modo "lazy" per evitare un require
// circolare con experimental-menu.js (che richiede questo modulo).
function backToExperimentalMenu(delay = 500) {
  setTimeout(() => require("./experimental-menu").showExperimentalMenu(), delay);
}

function showDependenciesConfigMenu() {
  logger.section("⚙️  Gestione configurazione dipendenze");
  logger.space();
  logger.info("1. Rimuovi prefissi versioni (^, ~, >=, <=, >, <)");
  logger.info("2. Rimuovi duplicati (usa la versione più alta)");
  logger.info("3. Allinea versioni duplicate (mantiene duplicati con versione più alta)");
  logger.space();
  logger.warning("0. 🔙 Torna al menu sperimentale");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        cleanVersionPrefixes();
        break;
      case "2":
        removeDuplicateDependencies();
        break;
      case "3":
        alignDuplicateVersions();
        break;
      case "0":
        logger.info("Tornando al menu sperimentale...");
        backToExperimentalMenu();
        break;
      default:
        logger.log("Scelta non valida. Riprova.", "red");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
    }
  });
}

// Funzione per rimuovere prefissi dalle versioni
function cleanVersionPrefixes() {
  logger.section("🧹 Rimozione prefissi versioni");
  logger.warning("⚠️  Questa operazione rimuoverà i prefissi (^, ~, >=, <=, >, <) da tutte le versioni");
  logger.info("Può essere utile se le versioni sono state definite automaticamente");
  logger.space();

  const rl = cliContext.getRl();
  if (!rl) return;

  // Prima mostriamo il preview
  try {
    const { previewCleanVersionPrefixes } = require("../dependencies/config-manager");
    const preview = previewCleanVersionPrefixes();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.cleaned === 0) {
      logger.info("ℹ️  Nessun prefisso trovato nelle versioni");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno rimossi prefissi da ${preview.cleaned} versioni`, "cyan");
    logger.log("Esempi di modifiche:", "yellow");

    // Mostriamo alcuni esempi
    const examples = preview.changes.slice(0, 10);
    examples.forEach((change) => {
      logger.log(`   "${change.prefix}${change.version}" → "${change.cleaned}"`, "blue");
    });

    if (preview.changes.length > 10) {
      logger.log(`   ... e altre ${preview.changes.length - 10} versioni`, "blue");
    }

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { cleanVersionPrefixesFromConfig } = require("../dependencies/config-manager");
          const result = cleanVersionPrefixesFromConfig();

          if (result.success) {
            logger.success(`✅ Rimosso prefissi da ${result.cleaned} versioni`);
            if (result.errors.length > 0) {
              logger.warning(`⚠️  ${result.errors.length} errori durante l'elaborazione`);
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
}

// Funzione per rimuovere duplicati
function removeDuplicateDependencies() {
  logger.section("🗑️  Rimozione duplicati");
  logger.warning(
    "⚠️  Questa operazione rimuoverà i duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES"
  );
  logger.info("Rimarrà la versione più alta nella sezione dove è stata trovata più frequentemente");
  logger.space();

  const rl = cliContext.getRl();
  if (!rl) return;

  // Prima mostriamo il preview
  try {
    const { previewRemoveDuplicateDependencies } = require("../dependencies/config-manager");
    const preview = previewRemoveDuplicateDependencies();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.removed === 0) {
      logger.info("ℹ️  Nessun duplicato trovato");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno rimossi ${preview.removed} duplicati`, "cyan");
    logger.log("Duplicati che verranno risolti:", "yellow");

    preview.duplicates.forEach((dup) => {
      logger.log(`   ${dup.name}:`, "blue");
      logger.log(
        `      ${dup.depVersion} (CONDITIONAL_DEPENDENCIES) vs ${dup.devDepVersion} (CONDITIONAL_DEV_DEPENDENCIES)`,
        "gray"
      );
      logger.log(`      → Rimossa da ${dup.removedFrom}, mantenuta in ${dup.keptIn} con versione ${dup.version}`, "green");
    });

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { removeDuplicateDependenciesFromConfig } = require("../dependencies/config-manager");
          const result = removeDuplicateDependenciesFromConfig();

          if (result.success) {
            logger.success(`✅ Rimossi ${result.removed} duplicati`);
            if (result.duplicates.length > 0) {
              logger.log("\n📋 Duplicati risolti:", "cyan");
              result.duplicates.forEach((dup) => {
                logger.log(`   ${dup.name}: ${dup.removedFrom} → ${dup.keptIn} (${dup.version})`, "yellow");
              });
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
}

// Funzione per allineare versioni duplicate
function alignDuplicateVersions() {
  logger.section("⚖️  Allineamento versioni duplicate");
  logger.warning("⚠️  Questa operazione allineerà le versioni dei duplicati, usando la versione più alta");
  logger.info("I duplicati rimarranno in entrambe le sezioni, ma con la stessa versione più alta");
  logger.space();

  const rl = cliContext.getRl();
  if (!rl) return;

  // Prima mostriamo il preview
  try {
    const { previewAlignDuplicateVersions } = require("../dependencies/config-manager");
    const preview = previewAlignDuplicateVersions();

    if (!preview.success) {
      logger.error(`❌ Errore: ${preview.error}`);
      setTimeout(() => showDependenciesConfigMenu(), 2000);
      return;
    }

    if (preview.aligned === 0) {
      logger.info("ℹ️  Nessun duplicato da allineare (tutte le versioni sono già allineate)");
      logger.warning("\nPremi INVIO per tornare...");
      rl.question("", () => showDependenciesConfigMenu());
      return;
    }

    logger.log(`\n📋 Anteprima: verranno allineati ${preview.aligned} duplicati`, "cyan");
    logger.log("Versioni che verranno allineate:", "yellow");

    preview.duplicates.forEach((dup) => {
      logger.log(`   ${dup.name}:`, "blue");
      logger.log(`      CONDITIONAL_DEPENDENCIES: ${dup.oldDepVersion} → ${dup.newVersion}`, "gray");
      logger.log(`      CONDITIONAL_DEV_DEPENDENCIES: ${dup.oldDevDepVersion} → ${dup.newVersion}`, "gray");
    });

    logger.space();
    rl.question("Continuare con il salvataggio? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const { alignDuplicateVersionsInConfig } = require("../dependencies/config-manager");
          const result = alignDuplicateVersionsInConfig();

          if (result.success) {
            logger.success(`✅ Allineati ${result.aligned} duplicati`);
            if (result.duplicates.length > 0) {
              logger.log("\n📋 Duplicati allineati:", "cyan");
              result.duplicates.forEach((dup) => {
                logger.log(
                  `   ${dup.name}: ${dup.oldDepVersion} (deps) + ${dup.oldDevDepVersion} (devDeps) → ${dup.newVersion}`,
                  "yellow"
                );
              });
            }
          } else {
            logger.error(`❌ Errore: ${result.error}`);
          }
        } catch (error) {
          logger.error(`❌ Errore: ${error.message}`);
        }

        setTimeout(() => showDependenciesConfigMenu(), 2000);
      } else {
        logger.info("Operazione annullata");
        setTimeout(() => showDependenciesConfigMenu(), 1000);
      }
    });
  } catch (error) {
    logger.error(`❌ Errore: ${error.message}`);
    setTimeout(() => showDependenciesConfigMenu(), 2000);
  }
}

module.exports = {
  showDependenciesConfigMenu,
  cleanVersionPrefixes,
  removeDuplicateDependencies,
  alignDuplicateVersions,
};
