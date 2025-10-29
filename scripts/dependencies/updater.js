/**
 * Aggiornamento package.json e tsconfig.json
 * Applica le configurazioni standard ai componenti
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");

function updatePackageJson(
  componentPath,
  projectConfig,
  baseDeps,
  devDeps,
  deprecatedDeps,
  standardScripts,
  nodeEngines,
  conditionalDeps = {},
  conditionalDevDeps = {}
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
      },
      devDependencies: {
        added: [], // Aggiunte da DEV_DEPENDENCIES (nuove)
        updated: [], // Versioni aggiornate
        conditional: [], // Aggiunte da CONDITIONAL_DEV_DEPENDENCIES
      },
      removed: [], // Rimosse deprecate
    };

    // Aggiorna dependencies
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    // Aggiungi dipendenze base
    Object.entries(baseDeps).forEach(([name, version]) => {
      const currentVersion = packageJson.dependencies[name];
      if (currentVersion === undefined) {
        // Nuova dipendenza - aggiunta da BASE
        packageJson.dependencies[name] = version;
        updated = true;
        changes.dependencies.added.push({ name, version, type: "base" });
      } else if (currentVersion !== version) {
        // Aggiornamento versione
        packageJson.dependencies[name] = version;
        updated = true;
        changes.dependencies.updated.push({
          name,
          from: currentVersion,
          to: version,
        });
      }
    });

    // Aggiungi dipendenze condizionali utilizzate
    Object.entries(conditionalDeps).forEach(([name, version]) => {
      const currentVersion = packageJson.dependencies[name];
      if (currentVersion === undefined) {
        // Nuova dipendenza condizionale
        packageJson.dependencies[name] = version;
        updated = true;
        changes.dependencies.conditional.push({ name, version });
      } else if (currentVersion !== version) {
        // Aggiornamento versione dipendenza condizionale
        packageJson.dependencies[name] = version;
        updated = true;
        changes.dependencies.updated.push({
          name,
          from: currentVersion,
          to: version,
        });
      }
    });

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

    // Aggiorna devDependencies
    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    // Aggiungi dipendenze dev base
    Object.entries(devDeps).forEach(([name, version]) => {
      const currentVersion = packageJson.devDependencies[name];
      if (currentVersion === undefined) {
        // Nuova dipendenza dev - aggiunta da DEV_DEPENDENCIES
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.added.push({ name, version, type: "base" });
      } else if (currentVersion !== version) {
        // Aggiornamento versione dipendenza dev
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.updated.push({
          name,
          from: currentVersion,
          to: version,
        });
      }
    });

    // Aggiungi dipendenze dev condizionali utilizzate (solo in devDependencies!)
    Object.entries(conditionalDevDeps).forEach(([name, version]) => {
      // Verifichiamo se non è già in dependencies (non deve essere lì!)
      if (packageJson.dependencies && packageJson.dependencies[name]) {
        // Se dipendenza dev condizionale trovata in dependencies - rimuoviamo da lì
        delete packageJson.dependencies[name];
        updated = true;
      }

      const currentVersion = packageJson.devDependencies[name];
      if (currentVersion === undefined) {
        // Nuova dipendenza dev condizionale
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.conditional.push({ name, version });
      } else if (currentVersion !== version) {
        // Aggiornamento versione dipendenza dev condizionale
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.updated.push({
          name,
          from: currentVersion,
          to: version,
        });
      }
    });

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

    if (updated) {
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

module.exports = {
  updatePackageJson,
  updateTsConfig,
  removeTslintJson,
};
