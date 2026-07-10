/**
 * Menu principale "Confronta versioni tra tutti i progetti".
 *
 * A differenza dell'Allineamento versioni (che confronta un progetto "base"
 * con UN progetto di riferimento alla volta), questo menu mostra una vista
 * d'insieme: per ogni dipendenza trovata nei package.json di TUTTI i
 * progetti, quali versioni sono usate e in quali progetti, evidenziando
 * quelle divergenti. Da qui si può anche saltare direttamente al confronto/
 * allineamento a coppie per una dipendenza specifica.
 */

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

const PAGE_SIZE = 20;

function backToMainMenu(delay = 500) {
  setTimeout(() => cliContext.returnToMainMenu(), delay);
}

// Punto di ingresso: analizza tutti i progetti e mostra il riepilogo
function showCompareAllProjectsMenu() {
  const projectConfig = cliContext.reloadProjectConfig();
  const { loadComponentsData, computeAllProjectsVersionMatrix } = require("../dependencies/version-alignment");

  logger.section("📊 Confronta versioni tra tutti i progetti");
  logger.info("Analisi dependencies + devDependencies di tutti i progetti in corso...");

  const componentsData = loadComponentsData(projectConfig);
  const componentNames = Object.keys(componentsData);

  if (componentNames.length < 2) {
    logger.warning("⚠️  Servono almeno 2 progetti con package.json per confrontare le versioni");
    backToMainMenu(1500);
    return;
  }

  const matrix = computeAllProjectsVersionMatrix(componentsData);
  const diverging = matrix.packages.filter((p) => p.status === "diverging");
  const sameCount = matrix.packages.length - diverging.length;

  logger.space();
  logger.success(`✅ Analizzati ${componentNames.length} progetti, ${matrix.packages.length} dipendenze totali`);
  logger.log(`   ✅ ${sameCount} con versione identica ovunque siano presenti`, "green");
  logger.log(
    `   ⚠️  ${diverging.length} con versioni divergenti tra progetti`,
    diverging.length > 0 ? "yellow" : "green"
  );

  if (diverging.length === 0) {
    logger.success("\n🎉 Nessuna divergenza di versione trovata tra i progetti!");
    logger.warning("\nPremi INVIO per tornare al menu principale...");
    const rl = cliContext.getRl();
    if (rl) rl.question("", () => cliContext.returnToMainMenu());
    return;
  }

  showDivergingPackagesList(componentsData, diverging, 0);
}

// Elenco (paginato) delle dipendenze con versioni divergenti
function showDivergingPackagesList(componentsData, divergingPackages, page) {
  const totalPages = Math.ceil(divergingPackages.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageItems = divergingPackages.slice(start, start + PAGE_SIZE);

  logger.section(`⚠️  Dipendenze con versioni divergenti (pagina ${page + 1}/${totalPages})`);
  pageItems.forEach((pkg, index) => {
    const versionsPreview = pkg.uniqueVersions.slice(0, 4).join(", ");
    const extra = pkg.uniqueVersions.length > 4 ? `, +${pkg.uniqueVersions.length - 4}` : "";
    logger.info(
      `${start + index + 1}. ${pkg.name} — ${pkg.uniqueVersions.length} versioni (${versionsPreview}${extra}), usato in ${pkg.presentIn} progetti`
    );
  });

  logger.space();
  logger.info("Inserisci il numero di una dipendenza per vederne il dettaglio per progetto");
  if (page > 0) logger.info("'p' pagina precedente");
  if (page < totalPages - 1) logger.info("'n' pagina successiva");
  logger.warning("0. 🔙 Torna al menu principale");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScelta: ", (answer) => {
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "0" || trimmed === "") {
      cliContext.returnToMainMenu();
      return;
    }
    if (trimmed === "n" && page < totalPages - 1) {
      showDivergingPackagesList(componentsData, divergingPackages, page + 1);
      return;
    }
    if (trimmed === "p" && page > 0) {
      showDivergingPackagesList(componentsData, divergingPackages, page - 1);
      return;
    }

    const index = parseInt(trimmed, 10) - 1;
    if (isNaN(index) || index < 0 || index >= divergingPackages.length) {
      logger.error("Scelta non valida");
      setTimeout(() => showDivergingPackagesList(componentsData, divergingPackages, page), 1000);
      return;
    }

    showPackageDetail(componentsData, divergingPackages, divergingPackages[index], page);
  });
}

// Dettaglio di una dipendenza: versione usata da ciascun progetto
function showPackageDetail(componentsData, divergingPackages, pkg, page) {
  logger.section(`📦 ${pkg.name}`);
  const components = Object.keys(pkg.versions).sort();

  const withVersion = components.filter((c) => pkg.versions[c] !== undefined);
  const withoutVersion = components.filter((c) => pkg.versions[c] === undefined);

  withVersion.forEach((component) => {
    logger.log(`   ${component}: ${pkg.versions[component]}`, "yellow");
  });
  if (withoutVersion.length > 0) {
    logger.log(
      `\n   ℹ️  Non presente in: ${withoutVersion.join(", ")}`,
      "blue"
    );
  }

  logger.space();
  logger.info("Vuoi confrontare/allineare due progetti per questa dipendenza?");
  logger.step("Sì, scegli progetto base e progetto di riferimento", 1);
  logger.warning("0. 🔙 Torna all'elenco dipendenze");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScelta (0-1): ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showAlignPickBase(componentsData, divergingPackages, pkg, withVersion, page);
        break;
      case "0":
      default:
        showDivergingPackagesList(componentsData, divergingPackages, page);
    }
  });
}

// Scelta del progetto "base" tra quelli che hanno la dipendenza selezionata
function showAlignPickBase(componentsData, divergingPackages, pkg, withVersion, page) {
  logger.section(`Scegli il progetto base per ${pkg.name}`);
  withVersion.forEach((component, index) => {
    logger.info(`${index + 1}. ${component} (${pkg.versions[component]})`);
  });
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nProgetto base: ", (answer) => {
    if (answer.trim() === "0") {
      showPackageDetail(componentsData, divergingPackages, pkg, page);
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= withVersion.length) {
      logger.error("Numero non valido");
      setTimeout(() => showAlignPickBase(componentsData, divergingPackages, pkg, withVersion, page), 1000);
      return;
    }

    const baseComponent = withVersion[index];
    const targetCandidates = withVersion.filter((c) => c !== baseComponent);
    showAlignPickTarget(componentsData, divergingPackages, pkg, page, baseComponent, targetCandidates);
  });
}

// Scelta del progetto "di riferimento" e passaggio al confronto completo
// (riusa il flusso di Allineamento versioni già esistente per la coppia scelta)
function showAlignPickTarget(componentsData, divergingPackages, pkg, page, baseComponent, targetCandidates) {
  logger.section(`Scegli il progetto di riferimento (base: ${baseComponent})`);
  targetCandidates.forEach((component, index) => {
    logger.info(`${index + 1}. ${component} (${pkg.versions[component]})`);
  });
  logger.warning("0. 🔙 Annulla");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nProgetto di riferimento: ", (answer) => {
    if (answer.trim() === "0") {
      showPackageDetail(componentsData, divergingPackages, pkg, page);
      return;
    }

    const index = parseInt(answer, 10) - 1;
    if (isNaN(index) || index < 0 || index >= targetCandidates.length) {
      logger.error("Numero non valido");
      setTimeout(
        () => showAlignPickTarget(componentsData, divergingPackages, pkg, page, baseComponent, targetCandidates),
        1000
      );
      return;
    }

    const targetComponent = targetCandidates[index];
    // Riusa il confronto completo (tutte le dipendenze, non solo quella scelta)
    // e il flusso di allineamento già implementato in version-alignment-menu.js.
    const { showAlignmentDiff } = require("./version-alignment-menu");
    showAlignmentDiff(baseComponent, targetComponent, componentsData);
  });
}

module.exports = {
  showCompareAllProjectsMenu,
  showDivergingPackagesList,
  showPackageDetail,
};
