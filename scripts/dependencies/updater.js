/**
 * Aggiornamento package.json e tsconfig.json
 * Applica le configurazioni standard ai componenti
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");

// Funzione per verificare se una versione soddisfa un range semantico
function versionSatisfiesRange(version, range) {
  if (!version || !range) return false;
  
  // Se sono identici, soddisfa
  if (version === range) return true;
  
  // Per git URLs, confrontiamo direttamente
  if (version.includes('git+') || version.includes('bitbucket:') || version.includes('http')) {
    return version === range;
  }
  if (range.includes('git+') || range.includes('bitbucket:') || range.includes('http')) {
    return version === range;
  }
  
  // Rimuoviamo prefissi per confronto
  const cleanVersion = (v) => {
    if (!v || typeof v !== 'string') return '0.0.0';
    return v.replace(/^[\^~>=<]+/, '');
  };
  
  const cleanV = cleanVersion(version);
  const cleanR = cleanVersion(range);
  
  // Se dopo la pulizia sono uguali, soddisfa
  if (cleanV === cleanR) return true;
  
  // Se il range ha prefisso ^, controlliamo compatibilità major
  if (range.startsWith('^')) {
    const vParts = cleanV.split('.').map(Number);
    const rParts = cleanR.split('.').map(Number);
    
    // ^x.y.z significa >=x.y.z <(x+1).0.0
    if (vParts[0] === rParts[0] && vParts[1] >= rParts[1]) {
      if (vParts[1] > rParts[1]) return true;
      if (vParts[1] === rParts[1] && vParts[2] >= rParts[2]) return true;
    }
    return false;
  }
  
  // Se il range ha prefisso ~, controlliamo compatibilità minor
  if (range.startsWith('~')) {
    const vParts = cleanV.split('.').map(Number);
    const rParts = cleanR.split('.').map(Number);
    
    // ~x.y.z significa >=x.y.z <x.(y+1).0
    if (vParts[0] === rParts[0] && vParts[1] === rParts[1] && vParts[2] >= rParts[2]) {
      return true;
    }
    return false;
  }
  
  // Per versioni esatte senza prefisso, confrontiamo direttamente
  return cleanV === cleanR;
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
      } else if (!versionSatisfiesRange(currentVersion, version)) {
        // Aggiornamento versione solo se la versione corrente non soddisfa il range
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
    // IMPORTANTE: Se il pacchetto è già in devDependencies, aggiorniamolo lì, non in dependencies
    Object.entries(conditionalDeps).forEach(([name, version]) => {
      const currentDepVersion = packageJson.dependencies?.[name];
      const currentDevDepVersion = packageJson.devDependencies?.[name];
      
      // Se il pacchetto è in devDependencies ma non in dependencies
      if (currentDevDepVersion !== undefined && currentDepVersion === undefined) {
        // Aggiorniamo in devDependencies dove è già presente solo se la versione non soddisfa il range
        if (!versionSatisfiesRange(currentDevDepVersion, version)) {
          packageJson.devDependencies[name] = version;
          updated = true;
          changes.devDependencies.updated.push({
            name,
            from: currentDevDepVersion,
            to: version,
          });
        }
      } else if (currentDepVersion !== undefined) {
        // Il pacchetto è in dependencies - aggiorniamo lì solo se la versione non soddisfa il range
        if (!versionSatisfiesRange(currentDepVersion, version)) {
          packageJson.dependencies[name] = version;
          updated = true;
          changes.dependencies.updated.push({
            name,
            from: currentDepVersion,
            to: version,
          });
        }
      } else if (currentDepVersion === undefined && currentDevDepVersion === undefined) {
        // Nuova dipendenza condizionale - aggiungiamo in dependencies
        packageJson.dependencies[name] = version;
        updated = true;
        changes.dependencies.conditional.push({ name, version });
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
      } else if (!versionSatisfiesRange(currentVersion, version)) {
        // Aggiornamento versione dipendenza dev solo se la versione corrente non soddisfa il range
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.updated.push({
          name,
          from: currentVersion,
          to: version,
        });
      }
    });

    // Aggiungi dipendenze dev condizionali utilizzate
    // IMPORTANTE: Se il pacchetto è già in dependencies, aggiorniamolo lì, non in devDependencies
    Object.entries(conditionalDevDeps).forEach(([name, version]) => {
      const currentDepVersion = packageJson.dependencies?.[name];
      const currentDevDepVersion = packageJson.devDependencies?.[name];
      
      // Se il pacchetto è in dependencies ma non in devDependencies
      if (currentDepVersion !== undefined && currentDevDepVersion === undefined) {
        // Aggiorniamo in dependencies dove è già presente solo se la versione non soddisfa il range
        if (!versionSatisfiesRange(currentDepVersion, version)) {
          packageJson.dependencies[name] = version;
          updated = true;
          changes.dependencies.updated.push({
            name,
            from: currentDepVersion,
            to: version,
          });
        }
      } else if (currentDevDepVersion !== undefined) {
        // Il pacchetto è in devDependencies - aggiorniamo lì solo se la versione non soddisfa il range
        if (!versionSatisfiesRange(currentDevDepVersion, version)) {
          packageJson.devDependencies[name] = version;
          updated = true;
          changes.devDependencies.updated.push({
            name,
            from: currentDevDepVersion,
            to: version,
          });
        }
      } else if (currentDepVersion === undefined && currentDevDepVersion === undefined) {
        // Nuova dipendenza dev condizionale - aggiungiamo in devDependencies
        packageJson.devDependencies[name] = version;
        updated = true;
        changes.devDependencies.conditional.push({ name, version });
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

    // Aggiungi overrides se definiti (solo per standard mode, workspace gestito separatamente)
    if (overrides && Object.keys(overrides).length > 0) {
      if (!packageJson.overrides) {
        packageJson.overrides = {};
        updated = true;
      }
      Object.entries(overrides).forEach(([name, version]) => {
        if (packageJson.overrides[name] !== version) {
          packageJson.overrides[name] = version;
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
};
