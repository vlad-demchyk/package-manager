/**
 * Menu "Allineamento versioni dipendenze tra progetti".
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");
const { showComponentList } = require("./component-list");

// showExperimentalMenu è richiesto in modo "lazy" per evitare un require
// circolare con experimental-menu.js (che richiede questo modulo).
function backToExperimentalMenu(delay = 500) {
  setTimeout(() => require("./experimental-menu").showExperimentalMenu(), delay);
}

// Funzione per mostrare il menu di selezione del progetto base da allineare
function showVersionAlignmentMenu() {
  logger.section("🔀 Allineamento versioni dipendenze tra progetti");
  logger.info("1. Scegli un progetto base");
  logger.info("2. Vengono trovati i progetti con dipendenze alla stessa versione");
  logger.info("3. Scegli un progetto (per nome o partendo da un pacchetto)");
  logger.info("4. Confronta le differenze e decidi cosa allineare");
  logger.space();

  const components = showComponentList();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    backToExperimentalMenu(1500);
    return;
  }

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nInserisci numero del progetto base da allineare (0 per tornare): ", (answer) => {
    if (answer.trim() === "0") {
      logger.info("Tornando al menu sperimentale...");
      backToExperimentalMenu(100);
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= components.length) {
      logger.error("Numero componente non valido");
      setTimeout(() => showVersionAlignmentMenu(), 1000);
      return;
    }

    startVersionAlignmentFlow(components[index]);
  });
}

// Analizza il progetto base e propone le modalità di ricerca del riferimento
function startVersionAlignmentFlow(baseComponent) {
  const projectConfig = cliContext.getProjectConfig();
  const { loadComponentsData, findMatchingProjectsByName } = require("../dependencies/version-alignment");

  logger.log(`\n🎯 Progetto base: ${baseComponent}`, "green");
  logger.log("🔍 Analisi versioni dipendenze in corso...", "cyan");

  const componentsData = loadComponentsData(projectConfig);

  if (!componentsData[baseComponent]) {
    logger.error("Impossibile leggere package.json del progetto selezionato");
    backToExperimentalMenu(1500);
    return;
  }

  const matchingProjects = findMatchingProjectsByName(baseComponent, componentsData);

  if (matchingProjects.length === 0) {
    logger.warning("\n⚠️  Nessun altro progetto condivide dipendenze con la stessa versione esatta");
    logger.info("Non ci sono candidati per l'allineamento");
    logger.warning("\nPremi INVIO per tornare...");
    const rl = cliContext.getRl();
    if (rl) rl.question("", () => require("./experimental-menu").showExperimentalMenu());
    return;
  }

  logger.success(`\n✅ Trovati ${matchingProjects.length} progetti compatibili con ${baseComponent}`);
  logger.space();
  logger.info("Come vuoi scegliere il progetto di riferimento?");
  logger.step("Per nome progetto (mostra i progetti compatibili)", 1);
  logger.step("Per pacchetto (parti da una dipendenza in comune)", 2);
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScegli opzione (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showAlignmentProjectSelection(baseComponent, componentsData, matchingProjects);
        break;
      case "2": {
        const { findMatchingPackagesForComponent } = require("../dependencies/version-alignment");
        const packageMatches = findMatchingPackagesForComponent(baseComponent, componentsData);
        showAlignmentPackageSelection(baseComponent, componentsData, packageMatches);
        break;
      }
      case "0":
        logger.info("Operazione annullata");
        backToExperimentalMenu();
        break;
      default:
        logger.error("Scelta non valida");
        setTimeout(() => startVersionAlignmentFlow(baseComponent), 1000);
    }
  });
}

// Modalità "per nome progetto": elenca i progetti compatibili con il numero di corrispondenze
function showAlignmentProjectSelection(baseComponent, componentsData, matchingProjects) {
  logger.section(`📋 Progetti compatibili con ${baseComponent}`);
  matchingProjects.forEach((entry, index) => {
    const exampleNames = entry.matches.slice(0, 3).map((m) => m.name).join(", ");
    const extra = entry.matches.length > 3 ? ` e altri ${entry.matches.length - 3}` : "";
    logger.info(`${index + 1}. ${entry.component} — ${entry.matchCount} corrispondenze (${exampleNames}${extra})`);
  });
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nInserisci numero progetto di riferimento: ", (answer) => {
    if (answer.trim() === "0") {
      logger.info("Operazione annullata");
      backToExperimentalMenu();
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= matchingProjects.length) {
      logger.error("Numero non valido");
      setTimeout(() => showAlignmentProjectSelection(baseComponent, componentsData, matchingProjects), 1000);
      return;
    }

    showAlignmentDiff(baseComponent, matchingProjects[index].component, componentsData);
  });
}

// Modalità "per pacchetto": elenca le dipendenze del progetto base che hanno
// corrispondenza esatta in almeno un altro progetto
function showAlignmentPackageSelection(baseComponent, componentsData, packageMatches) {
  if (packageMatches.length === 0) {
    logger.warning("Nessun pacchetto con versione corrispondente trovato");
    setTimeout(() => startVersionAlignmentFlow(baseComponent), 1500);
    return;
  }

  logger.section(`📦 Pacchetti di ${baseComponent} con corrispondenze in altri progetti`);
  packageMatches.forEach((entry, index) => {
    logger.info(`${index + 1}. ${entry.name}@${entry.version} — presente anche in ${entry.components.length} progetti`);
  });
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nInserisci numero pacchetto: ", (answer) => {
    if (answer.trim() === "0") {
      logger.info("Operazione annullata");
      backToExperimentalMenu();
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= packageMatches.length) {
      logger.error("Numero non valido");
      setTimeout(() => showAlignmentPackageSelection(baseComponent, componentsData, packageMatches), 1000);
      return;
    }

    showAlignmentPackageProjectSelection(baseComponent, componentsData, packageMatches[index]);
  });
}

// Mostra i progetti che condividono il pacchetto scelto con la stessa versione
function showAlignmentPackageProjectSelection(baseComponent, componentsData, selectedPackage) {
  logger.section(`📋 Progetti con ${selectedPackage.name}@${selectedPackage.version}`);
  selectedPackage.components.forEach((component, index) => {
    logger.info(`${index + 1}. ${component}`);
  });
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nInserisci numero progetto di riferimento: ", (answer) => {
    if (answer.trim() === "0") {
      logger.info("Operazione annullata");
      backToExperimentalMenu();
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= selectedPackage.components.length) {
      logger.error("Numero non valido");
      setTimeout(
        () => showAlignmentPackageProjectSelection(baseComponent, componentsData, selectedPackage),
        1000
      );
      return;
    }

    showAlignmentDiff(baseComponent, selectedPackage.components[index], componentsData);
  });
}

// Mostra il confronto completo tra progetto base e progetto di riferimento
function showAlignmentDiff(baseComponent, targetComponent, componentsData) {
  const { computeVersionDiff } = require("../dependencies/version-alignment");
  const diff = computeVersionDiff(componentsData[baseComponent], componentsData[targetComponent]);

  const differentRows = diff.filter((r) => r.status === "different");
  const onlyBaseRows = diff.filter((r) => r.status === "onlyBase");
  const onlyTargetRows = diff.filter((r) => r.status === "onlyTarget");
  const sameCount = diff.filter((r) => r.status === "same").length;

  logger.section(`⚖️  Confronto: ${baseComponent} ↔ ${targetComponent}`);

  if (differentRows.length === 0) {
    logger.success("✅ Nessuna divergenza di versione tra le dipendenze in comune");
  } else {
    logger.warning(`⚠️  ${differentRows.length} dipendenze con versione diversa:`);
    differentRows.forEach((row, index) => {
      logger.log(
        `   ${index + 1}. ${row.name}: ${row.baseVersion} (${baseComponent}) → ${row.targetVersion} (${targetComponent})`,
        "yellow"
      );
    });
  }

  if (onlyBaseRows.length > 0) {
    logger.log(
      `\nℹ️  Solo in ${baseComponent} (${onlyBaseRows.length}): ${onlyBaseRows
        .slice(0, 8)
        .map((r) => r.name)
        .join(", ")}${onlyBaseRows.length > 8 ? "…" : ""}`,
      "blue"
    );
  }
  if (onlyTargetRows.length > 0) {
    logger.log(
      `ℹ️  Solo in ${targetComponent} (${onlyTargetRows.length}): ${onlyTargetRows
        .slice(0, 8)
        .map((r) => r.name)
        .join(", ")}${onlyTargetRows.length > 8 ? "…" : ""}`,
      "blue"
    );
  }
  logger.log(`✅ Versioni già identiche: ${sameCount}`, "green");

  const rl = cliContext.getRl();

  if (differentRows.length === 0) {
    logger.warning("\nPremi INVIO per tornare...");
    if (rl) rl.question("", () => require("./experimental-menu").showExperimentalMenu());
    return;
  }

  logger.space();
  logger.info("Cosa vuoi fare?");
  logger.step(`Allinea tutte le ${differentRows.length} versioni divergenti su ${targetComponent}`, 1);
  logger.step("Seleziona singolarmente i pacchetti da allineare", 2);
  logger.warning("0. 🔙 Annulla (nessuna modifica)");

  if (!rl) return;
  rl.question("\nScegli opzione (0-2): ", (answer) => {
    switch (answer.trim()) {
      case "1":
        confirmAndApplyAlignment(baseComponent, targetComponent, differentRows);
        break;
      case "2":
        selectIndividualAlignments(baseComponent, targetComponent, differentRows);
        break;
      case "0":
        logger.info("Operazione annullata, nessuna modifica effettuata");
        backToExperimentalMenu();
        break;
      default:
        logger.error("Scelta non valida");
        setTimeout(() => showAlignmentDiff(baseComponent, targetComponent, componentsData), 1000);
    }
  });
}

// Permette di scegliere manualmente quali pacchetti divergenti allineare
function selectIndividualAlignments(baseComponent, targetComponent, differentRows) {
  logger.section("Seleziona i pacchetti da allineare");
  differentRows.forEach((row, index) => {
    logger.info(`${index + 1}. ${row.name}: ${row.baseVersion} → ${row.targetVersion}`);
  });
  logger.info("\nInserisci i numeri separati da spazio (es: 1 3 4), 'all' per tutti, 0 per annullare");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nSelezione: ", (answer) => {
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "0" || trimmed === "") {
      logger.info("Operazione annullata, nessuna modifica effettuata");
      backToExperimentalMenu();
      return;
    }

    let selectedRows;
    if (trimmed === "all" || trimmed === "tutti") {
      selectedRows = differentRows;
    } else {
      const uniqueIndices = Array.from(
        new Set(
          trimmed
            .split(/\s+/)
            .map((n) => parseInt(n, 10) - 1)
            .filter((n) => !isNaN(n) && n >= 0 && n < differentRows.length)
        )
      );

      if (uniqueIndices.length === 0) {
        logger.error("Nessuna selezione valida");
        setTimeout(() => selectIndividualAlignments(baseComponent, targetComponent, differentRows), 1000);
        return;
      }

      selectedRows = uniqueIndices.map((i) => differentRows[i]);
    }

    confirmAndApplyAlignment(baseComponent, targetComponent, selectedRows);
  });
}

// Mostra l'anteprima finale e, se confermato, applica l'allineamento su disco
function confirmAndApplyAlignment(baseComponent, targetComponent, rows) {
  logger.space();
  logger.warning(`⚠️  Verranno aggiornate ${rows.length} dipendenze in ${baseComponent}/package.json:`);
  rows.forEach((row) => {
    logger.log(`   ${row.name}: ${row.baseVersion} → ${row.targetVersion}`, "yellow");
  });
  logger.info("💡 Verrà inoltre rimosso package-lock.json del progetto (se presente)");

  const hasRangeSymbols = rows.some((row) => /^[\^~>=<]/.test(row.targetVersion || ""));

  const rl = cliContext.getRl();
  if (!rl) return;

  askPinExactVersion(rl, hasRangeSymbols, (pinExactVersion) => {
    rl.question("\nConfermi l'allineamento? (y/N): ", (confirm) => {
      if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
        logger.info("Operazione annullata, nessuna modifica effettuata");
        backToExperimentalMenu();
        return;
      }

      const { applyVersionAlignment } = require("../dependencies/version-alignment");
      const alignments = rows.map((row) => ({
        name: row.name,
        section: row.baseSection,
        newVersion: row.targetVersion,
      }));

      const result = applyVersionAlignment(baseComponent, alignments, true, pinExactVersion);

      if (result.success) {
        logger.success(`\n✅ Allineate ${result.applied.length} dipendenze di ${baseComponent} su ${targetComponent}`);
        result.applied.forEach((a) => {
          logger.log(`   ${a.name}: ${a.oldVersion} → ${a.newVersion}`, "green");
        });
        logger.info(`💡 Esegui l'installazione per ${baseComponent} per applicare le nuove versioni`);
      } else {
        logger.error(`❌ Errore durante l'allineamento: ${result.error}`);
      }

      backToExperimentalMenu(2000);
    });
  });
}

// Se almeno una delle versioni target ha un simbolo di range (^, ~, >=, <=,
// >, <), chiede se fissare la versione esatta (senza il simbolo) invece di
// copiare il range così com'è. Se nessuna versione ha simboli di range, salta
// la domanda e procede senza pin (non ci sarebbe alcuna differenza).
function askPinExactVersion(rl, hasRangeSymbols, callback) {
  if (!hasRangeSymbols) {
    callback(false);
    return;
  }

  logger.space();
  logger.info("ℹ️  Alcune versioni di riferimento usano un range (^, ~, >=, <=, >, <)");
  rl.question(
    "Vuoi fissare la versione ESATTA indicata (rimuovendo il simbolo di range) invece del range originale? (y/N): ",
    (answer) => {
      const pin = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      if (pin) {
        logger.info("💡 Verrà usata solo la versione esatta indicata, senza simboli di range");
      }
      callback(pin);
    }
  );
}

module.exports = {
  showVersionAlignmentMenu,
  startVersionAlignmentFlow,
  showAlignmentProjectSelection,
  showAlignmentPackageSelection,
  showAlignmentPackageProjectSelection,
  showAlignmentDiff,
  selectIndividualAlignments,
  confirmAndApplyAlignment,
};
