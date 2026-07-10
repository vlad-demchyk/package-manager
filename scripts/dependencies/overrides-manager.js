/**
 * Gestione interattiva degli "overrides" (package-manager/dependencies-config.js
 * -> OVERRIDES) durante l'aggiornamento dei componenti.
 *
 * Estratto da update-configs.js per mantenere quel file focalizzato solo
 * sull'orchestrazione dell'aggiornamento.
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { compareVersions } = require("../utils/version-utils");
const { createReadlineInterface, askQuestion } = require("../cli/prompt");
const { reloadDependenciesConfig } = require("./config-loader");

/**
 * Tra i pacchetti che stanno per essere aggiornati (componentChanges), propone
 * di aggiungere agli OVERRIDES quelli non ancora presenti, e persiste la
 * scelta dell'utente direttamente nel file dependencies-config.js.
 *
 * @returns {Object} l'oggetto overrides aggiornato (stesso riferimento se non modificato)
 */
async function proposeOverridesForUpdatedPackages(componentChanges, overrides, projectRoot) {
  const packagesToUpdate = new Map();
  Object.values(componentChanges).forEach((compChanges) => {
    [...compChanges.dependencies, ...compChanges.devDependencies].forEach(({ name, to }) => {
      if (!packagesToUpdate.has(name) || compareVersions(to, packagesToUpdate.get(name)) > 0) {
        packagesToUpdate.set(name, to);
      }
    });
  });

  const packagesNotInOverrides = Array.from(packagesToUpdate.entries()).filter(
    ([name, version]) => !overrides[name] || overrides[name] !== version
  );

  if (packagesNotInOverrides.length === 0 || Object.keys(overrides).length === 0) {
    return overrides;
  }

  logger.log("\n💡 Alcuni pacchetti aggiornati non hanno overrides configurati", "yellow");
  logger.log("   Pacchetti che verranno aggiornati (non in overrides):", "cyan");

  const packagesList = packagesNotInOverrides.slice(0, 20).map(([name, version], index) => ({
    index: index + 1,
    name,
    version,
    display: `${index + 1}. ${name}@${version}`,
  }));

  packagesList.forEach((p) => logger.log(`      ${p.display}`, "gray"));
  if (packagesNotInOverrides.length > 20) {
    logger.log(`      ... e altri ${packagesNotInOverrides.length - 20} pacchetti`, "gray");
  }

  const rl = createReadlineInterface();
  logger.log("\n💡 Puoi aggiungere overrides per questi pacchetti", "cyan");
  logger.log("   Inserisci i numeri separati da virgola (es: 1,3,5) o 'all' per tutti", "gray");
  const addOverridesAnswer = await askQuestion(
    rl,
    "\nQuali pacchetti vuoi aggiungere agli overrides? (numeri/all/N): "
  );
  rl.close();

  if (!addOverridesAnswer || ["n", "no"].includes(addOverridesAnswer.toLowerCase())) {
    return overrides;
  }

  const selectedPackages = new Map();
  if (addOverridesAnswer.toLowerCase() === "all") {
    packagesNotInOverrides.forEach(([name, version]) => selectedPackages.set(name, version));
  } else {
    const selectedIndices = addOverridesAnswer
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0 && n <= packagesList.length);
    selectedIndices.forEach((index) => {
      const pkg = packagesList[index - 1];
      if (pkg) selectedPackages.set(pkg.name, pkg.version);
    });
  }

  if (selectedPackages.size === 0) {
    logger.log("❌ Nessun pacchetto selezionato", "yellow");
    return overrides;
  }

  const newOverrides = {};
  selectedPackages.forEach((version, name) => {
    newOverrides[name] = version;
  });

  return persistNewOverrides(projectRoot, overrides, newOverrides);
}

// Scrive i nuovi overrides in dependencies-config.js (regex-based, preserva il resto del file)
// e ricarica il config per restituire l'oggetto overrides aggiornato.
function persistNewOverrides(projectRoot, overrides, newOverrides) {
  const dependenciesConfigPath = path.join(projectRoot, "package-manager", "dependencies-config.js");
  if (!fs.existsSync(dependenciesConfigPath)) {
    return overrides;
  }

  try {
    const configContent = fs.readFileSync(dependenciesConfigPath, "utf8");
    const overridesRegex = /const\s+OVERRIDES\s*=\s*({[\s\S]*?});/;
    const existingOverrides = configContent.match(overridesRegex);

    let updatedConfig;
    if (existingOverrides) {
      try {
        const existingObj = existingOverrides[1];
        const cleanedObj = existingObj.replace(/\/\/.*$/gm, "").trim();
        const existingParsed =
          cleanedObj === "{}" || cleanedObj === '{\n  // Esempio: "package-name": "1.2.3"\n}'
            ? {}
            : JSON.parse(cleanedObj);
        const mergedOverrides = { ...existingParsed, ...newOverrides };
        updatedConfig = configContent.replace(
          overridesRegex,
          `const OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};`
        );
      } catch (error) {
        const mergedOverrides = { ...overrides, ...newOverrides };
        updatedConfig = configContent.replace(
          overridesRegex,
          `const OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};`
        );
      }
    } else {
      const mergedOverrides = { ...overrides, ...newOverrides };
      const overridesSection =
        "\n// ============================================================================\n" +
        "// OVERRIDES (forzatura versioni dipendenze)\n" +
        "// ============================================================================\n" +
        `const OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};\n\n`;
      updatedConfig = configContent.replace(/module\.exports\s*=/, `${overridesSection}module.exports =`);
    }

    fs.writeFileSync(dependenciesConfigPath, updatedConfig, "utf8");
    logger.log(`✅ Aggiunti ${Object.keys(newOverrides).length} overrides al config`, "green");

    const depsFunctionsReload = reloadDependenciesConfig(projectRoot, { showDuplicates: false });
    return depsFunctionsReload ? depsFunctionsReload.getOverrides() : overrides;
  } catch (error) {
    logger.warning(`⚠️  Errore aggiungendo overrides: ${error.message}`);
    return overrides;
  }
}

/**
 * Se esistono overrides nel config ma manca la loro applicazione in almeno un
 * componente dello scope corrente, chiede UNA VOLTA se applicarli a tutti.
 *
 * @returns {boolean|null} true/false = decisione dell'utente, null = non era necessario chiedere
 */
async function confirmApplyOverridesToComponents(componentDirs, overrides, scope) {
  if (!overrides || Object.keys(overrides).length === 0) {
    return null;
  }

  const overridesToAdd = {};
  let hasAnyMissing = false;

  for (const componentDir of componentDirs) {
    const packageJsonPath = path.join(process.cwd(), componentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const currentOverrides = packageJson.overrides || {};

      Object.entries(overrides).forEach(([name, version]) => {
        if (!currentOverrides[name] || currentOverrides[name] !== version) {
          overridesToAdd[name] = version;
          hasAnyMissing = true;
        }
      });
    }
  }

  if (!hasAnyMissing || Object.keys(overridesToAdd).length === 0) {
    return null;
  }

  let scopeLabel;
  if (scope === "all") {
    scopeLabel = "TUTTI i componenti";
  } else if (scope === "exclude") {
    scopeLabel = "i componenti selezionati";
  } else {
    scopeLabel = componentDirs.length === 1 ? `il componente ${componentDirs[0]}` : "i componenti selezionati";
  }

  logger.log("\n💡 Overrides disponibili da aggiungere:", "yellow");
  logger.log(`   I seguenti overrides verranno aggiunti a ${scopeLabel}:`, "cyan");
  Object.entries(overridesToAdd).forEach(([name, version]) => {
    logger.log(`      ${name}: ${version}`, "gray");
  });

  const rl = createReadlineInterface();
  const addOverridesAnswer = await askQuestion(rl, `\nVuoi aggiungere questi overrides a ${scopeLabel}? (y/N): `);
  rl.close();

  return addOverridesAnswer === "y" || addOverridesAnswer === "yes";
}

module.exports = {
  proposeOverridesForUpdatedPackages,
  confirmApplyOverridesToComponents,
};
