/**
 * Aggiornamento package.json e tsconfig.json
 * Applica le configurazioni standard ai componenti
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");
const { versionSatisfiesRange } = require("../utils/version-utils");

/**
 * Applica un insieme di dipendenze (baseDeps/conditionalDeps/devDeps/conditionalDevDeps)
 * alla sezione "canonica" del package.json, spostando il pacchetto dalla sezione
 * opposta se necessario (es. era in devDependencies ma il config lo vuole in dependencies).
 *
 * @returns {boolean} true se package.json è stato modificato
 */
function applyDependencyEntries(packageJson, entries, options) {
  const {
    canonicalSection,
    oppositeSection,
    newAdditionsArray,
    updatedArray,
    movedArray,
  } = options;

  let updated = false;

  Object.entries(entries).forEach(([name, version]) => {
    const canonicalCurrent = packageJson[canonicalSection][name];
    const oppositeCurrent = packageJson[oppositeSection][name];

    if (canonicalCurrent !== undefined) {
      // Già nella sezione corretta: aggiorna la versione se serve
      if (!versionSatisfiesRange(canonicalCurrent, version)) {
        packageJson[canonicalSection][name] = version;
        updated = true;
        updatedArray.push({ name, from: canonicalCurrent, to: version });
      }
      // Se per errore è presente anche nella sezione opposta, rimuovi il duplicato
      if (oppositeCurrent !== undefined) {
        delete packageJson[oppositeSection][name];
        updated = true;
      }
    } else if (oppositeCurrent !== undefined) {
      // Presente ma nella sezione sbagliata: sposta in quella canonica
      delete packageJson[oppositeSection][name];
      packageJson[canonicalSection][name] = version;
      updated = true;
      movedArray.push({ name, version, from: oppositeSection, to: canonicalSection });
    } else {
      // Nuova dipendenza
      packageJson[canonicalSection][name] = version;
      updated = true;
      newAdditionsArray.push({ name, version });
    }
  });

  return updated;
}

function updatePackageJson(
  componentPath,
  projectConfig,
  baseDeps,
  devDeps,
  deprecatedDeps,
  standardScripts,
  nodeEngines,
  conditionalDeps = {},
  conditionalDevDeps = {},
  overrides = {}
) {
  const packageJsonPath = path.join(
    componentPath,
    projectConfig.files.packageJson
  );

  if (!fs.existsSync(packageJsonPath)) {
    logger.log(
      `❌ package.json non trovato in ${componentPath}`,
      "red",
      projectConfig
    );
    return { success: false, changes: null };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    let updated = false;

    // Struttura per raccogliere le modifiche
    const changes = {
      component: path.basename(componentPath),
      dependencies: {
        added: [], // Aggiunte da BASE_DEPENDENCIES (nuove)
        updated: [], // Versioni aggiornate
        conditional: [], // Aggiunte da CONDITIONAL_DEPENDENCIES
        moved: [], // Spostate qui dalla sezione opposta (sezione canonica)
      },
      devDependencies: {
        added: [], // Aggiunte da DEV_DEPENDENCIES (nuove)
        updated: [], // Versioni aggiornate
        conditional: [], // Aggiunte da CONDITIONAL_DEV_DEPENDENCIES
        moved: [], // Spostate qui dalla sezione opposta (sezione canonica)
      },
      removed: [], // Rimosse deprecate
      overrides: {
        added: [], // Overrides aggiunti
        updated: [], // Overrides aggiornati
      },
    };

    // Entrambe le sezioni devono esistere prima di elaborare qualsiasi bucket,
    // perché ogni bucket può leggere/scrivere sia la propria sezione canonica
    // che quella opposta (per rilevare e correggere un posizionamento errato).
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }
    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    // BASE_DEPENDENCIES: canonicamente in dependencies
    if (
      applyDependencyEntries(packageJson, baseDeps, {
        canonicalSection: "dependencies",
        oppositeSection: "devDependencies",
        newAdditionsArray: changes.dependencies.added,
        updatedArray: changes.dependencies.updated,
        movedArray: changes.dependencies.moved,
      })
    ) {
      updated = true;
    }

    // CONDITIONAL_DEPENDENCIES: canonicamente in dependencies
    if (
      applyDependencyEntries(packageJson, conditionalDeps, {
        canonicalSection: "dependencies",
        oppositeSection: "devDependencies",
        newAdditionsArray: changes.dependencies.conditional,
        updatedArray: changes.dependencies.updated,
        movedArray: changes.dependencies.moved,
      })
    ) {
      updated = true;
    }

    // Rimuovi dipendenze deprecate da dependencies
    deprecatedDeps.forEach((depName) => {
      if (packageJson.dependencies && packageJson.dependencies[depName]) {
        const removedVersion = packageJson.dependencies[depName];
        delete packageJson.dependencies[depName];
        updated = true;
        changes.removed.push({
          name: depName,
          version: removedVersion,
          type: "dependency",
        });
      }
    });

    // DEV_DEPENDENCIES: canonicamente in devDependencies
    if (
      applyDependencyEntries(packageJson, devDeps, {
        canonicalSection: "devDependencies",
        oppositeSection: "dependencies",
        newAdditionsArray: changes.devDependencies.added,
        updatedArray: changes.devDependencies.updated,
        movedArray: changes.devDependencies.moved,
      })
    ) {
      updated = true;
    }

    // CONDITIONAL_DEV_DEPENDENCIES: canonicamente in devDependencies
    if (
      applyDependencyEntries(packageJson, conditionalDevDeps, {
        canonicalSection: "devDependencies",
        oppositeSection: "dependencies",
        newAdditionsArray: changes.devDependencies.conditional,
        updatedArray: changes.devDependencies.updated,
        movedArray: changes.devDependencies.moved,
      })
    ) {
      updated = true;
    }

    // Rimuovi dipendenze deprecate da devDependencies
    deprecatedDeps.forEach((depName) => {
      if (packageJson.devDependencies && packageJson.devDependencies[depName]) {
        const removedVersion = packageJson.devDependencies[depName];
        delete packageJson.devDependencies[depName];
        updated = true;
        changes.removed.push({
          name: depName,
          version: removedVersion,
          type: "devDependency",
        });
      }
    });

    // Aggiorna scripts
    if (!packageJson.scripts) {
      packageJson.scripts = {};
    }

    Object.entries(standardScripts).forEach(([name, script]) => {
      if (packageJson.scripts[name] !== script) {
        packageJson.scripts[name] = script;
        updated = true;
      }
    });

    // Aggiorna engines
    if (Object.keys(nodeEngines).length > 0) {
      if (!packageJson.engines) {
        packageJson.engines = {};
      }

      Object.entries(nodeEngines).forEach(([name, version]) => {
        if (packageJson.engines[name] !== version) {
          packageJson.engines[name] = version;
          updated = true;
        }
      });
    }

    // Aggiungi overrides se definiti (solo per standard mode, workspace gestito separatamente)
    // IMPORTANTE: overrides devono essere sempre aggiunti/aggiornati, anche se non ci sono altre modifiche
    let overridesChanged = false;
    if (overrides && Object.keys(overrides).length > 0) {
      if (!packageJson.overrides) {
        packageJson.overrides = {};
        overridesChanged = true;
      }
      
      Object.entries(overrides).forEach(([name, version]) => {
        if (!packageJson.overrides[name]) {
          // Nuovo override
          packageJson.overrides[name] = version;
          overridesChanged = true;
          updated = true;
          changes.overrides.added.push({ name, version });
        } else if (packageJson.overrides[name] !== version) {
          // Override aggiornato
          const oldVersion = packageJson.overrides[name];
          packageJson.overrides[name] = version;
          overridesChanged = true;
          updated = true;
          changes.overrides.updated.push({ name, from: oldVersion, to: version });
        }
      });
    }

    // Salva sempre se ci sono modifiche o se overrides sono stati aggiunti/aggiornati
    if (updated || overridesChanged) {
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify(packageJson, null, 2),
        "utf8"
      );
      return { success: true, changes };
    } else {
      return { success: true, changes: null }; // Nessuna modifica
    }
  } catch (error) {
    logger.log(
      `❌ Errore aggiornando package.json: ${error.message}`,
      "red",
      projectConfig
    );
    return { success: false, changes: null };
  }
}

function updateTsConfig(componentPath, projectConfig, standardTsConfig) {
  // Verifica che standardTsConfig esista e non sia vuoto
  if (!standardTsConfig || Object.keys(standardTsConfig).length === 0) {
    return true; // Non è un errore se non c'è configurazione da applicare
  }

  const tsConfigPath = path.join(componentPath, projectConfig.files.tsConfig);

  if (!fs.existsSync(tsConfigPath)) {
    logger.log(
      `ℹ️  tsconfig.json non trovato in ${componentPath}`,
      "blue",
      projectConfig
    );
    return true; // Non è un errore se non esiste
  }

  try {
    const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, "utf8"));
    let updated = false;

    // Applica configurazione standard
    Object.entries(standardTsConfig).forEach(([key, value]) => {
      if (JSON.stringify(tsConfig[key]) !== JSON.stringify(value)) {
        tsConfig[key] = value;
        updated = true;
      }
    });

    if (updated) {
      fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2), "utf8");
      logger.log(`✅ tsconfig.json aggiornato`, "green", projectConfig);
      return true;
    } else {
      // Non mostrare messaggio se non ci sono modifiche da applicare
      return true;
    }
  } catch (error) {
    logger.log(
      `❌ Errore aggiornando tsconfig.json: ${error.message}`,
      "red",
      projectConfig
    );
    return false;
  }
}

function removeTslintJson(componentPath, projectConfig) {
  const tslintPath = path.join(componentPath, projectConfig.files.tslint);

  if (fs.existsSync(tslintPath)) {
    try {
      fs.unlinkSync(tslintPath);
      logger.log(`✅ tslint.json rimosso`, "green", projectConfig);
      return true;
    } catch (error) {
      logger.log(
        `❌ Errore rimuovendo tslint.json: ${error.message}`,
        "red",
        projectConfig
      );
      return false;
    }
  } else {
    // Non mostrare messaggio se tslint.json non esiste
    return true;
  }
}

function updateTsConfigSkipLibCheck(componentPath, projectConfig) {
  const tsConfigPath = path.join(componentPath, projectConfig.files.tsConfig);

  if (!fs.existsSync(tsConfigPath)) {
    return null; // tsconfig.json non trovato
  }

  try {
    const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, "utf8"));
    let updated = false;

    // Assicurati che compilerOptions esista
    if (!tsConfig.compilerOptions) {
      tsConfig.compilerOptions = {};
      updated = true;
    }

    // Attiva skipLibCheck se non è già true
    if (tsConfig.compilerOptions.skipLibCheck !== true) {
      tsConfig.compilerOptions.skipLibCheck = true;
      updated = true;
    }

    if (updated) {
      fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2), "utf8");
      return true;
    } else {
      return null; // Già configurato
    }
  } catch (error) {
    logger.log(
      `❌ Errore aggiornando tsconfig.json: ${error.message}`,
      "red",
      projectConfig
    );
    return false;
  }
}

module.exports = {
  updatePackageJson,
  updateTsConfig,
  updateTsConfigSkipLibCheck,
  removeTslintJson,
  applyDependencyEntries,
};
