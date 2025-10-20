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
  nodeEngines
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
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    let updated = false;

    // Aggiorna dependencies
    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    // Aggiungi dipendenze base
    Object.entries(baseDeps).forEach(([name, version]) => {
      if (packageJson.dependencies[name] !== version) {
        packageJson.dependencies[name] = version;
        updated = true;
      }
    });

    // Dipendenze condizionali sono già incluse in baseDeps
    // (vengono processate in update-configs.js prima di chiamare questa funzione)

    // Rimuovi dipendenze deprecate
    deprecatedDeps.forEach((depName) => {
      if (packageJson.dependencies[depName]) {
        delete packageJson.dependencies[depName];
        updated = true;
      }
    });

    // Aggiorna devDependencies
    if (!packageJson.devDependencies) {
      packageJson.devDependencies = {};
    }

    Object.entries(devDeps).forEach(([name, version]) => {
      if (packageJson.devDependencies[name] !== version) {
        packageJson.devDependencies[name] = version;
        updated = true;
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
      logger.log(`✅ package.json aggiornato`, "green", projectConfig);
      return true;
    } else {
      logger.log(`ℹ️  package.json già aggiornato`, "blue", projectConfig);
      return true;
    }
  } catch (error) {
    logger.log(
      `❌ Errore aggiornando package.json: ${error.message}`,
      "red",
      projectConfig
    );
    return false;
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
      logger.log(`ℹ️  tsconfig.json già aggiornato`, "blue", projectConfig);
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
    logger.log(`ℹ️  tslint.json non trovato`, "blue", projectConfig);
    return true;
  }
}

module.exports = {
  updatePackageJson,
  updateTsConfig,
  removeTslintJson,
};
