/**
 * Anteprima e reportistica delle modifiche versione prima/dopo l'aggiornamento
 * dei package.json dei componenti.
 *
 * Estratto da update-configs.js per mantenere quel file focalizzato solo
 * sull'orchestrazione dell'aggiornamento.
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { versionSatisfiesRange } = require("../utils/version-utils");
const { analyzeDependencyUsage } = require("./analyzer");

/**
 * Calcola e mostra un riepilogo delle modifiche di versione che verranno
 * applicate a tutti i componenti, prima di procedere realmente.
 *
 * @param {string[]} componentDirs
 * @param {Object} finalBaseDeps
 * @param {Object} finalDevDeps
 * @param {Object} projectConfig
 * @param {Object} conditionalDeps
 * @param {Object} conditionalDevDeps
 * @returns {{hasChanges: boolean, componentChanges: Object}}
 */
function showVersionChanges(
  componentDirs,
  finalBaseDeps,
  finalDevDeps,
  projectConfig,
  conditionalDeps = {},
  conditionalDevDeps = {}
) {
  logger.log("\n📊 Riepilogo modifiche versioni:", "cyan");

  const changes = {
    dependencies: {},
    devDependencies: {},
  };

  // Raccoglie le versioni attuali da tutti i componenti per il confronto
  // IMPORTANTE: Per ogni componente controlliamo se le conditional deps/devDeps
  // sono presenti in package.json, anche se non vengono rilevate come "usate" nel codice
  // perché updatePackageJson le aggiornerà comunque se sono presenti
  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(process.cwd(), componentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const componentFullPath = path.join(process.cwd(), componentDir);

      // Controlla BASE dependencies (in entrambe le sezioni: potrebbe essere
      // già presente in devDependencies e verrà spostata in dependencies)
      Object.entries(finalBaseDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        if (oldVersion) {
          if (!versionSatisfiesRange(oldVersion, newVersion)) {
            if (!changes.dependencies[name]) {
              changes.dependencies[name] = { old: oldVersion, new: newVersion };
            }
          }
        } else {
          // Non presente in nessuna sezione: la aggiungiamo solo se è
          // effettivamente rilevata come usata nel codice di QUESTO
          // componente (stesso gate applicato in fase di apply).
          const isUsed = analyzeDependencyUsage(componentFullPath, { [name]: newVersion }, projectConfig).length > 0;
          if (isUsed && !changes.dependencies[name]) {
            changes.dependencies[name] = { old: null, new: newVersion };
          }
        }
      });

      // Controlla CONDITIONAL dependencies - IMPORTANTE:
      // updatePackageJson aggiorna conditional deps che sono già in package.json
      // anche se non vengono rilevate come "usate" nel codice
      Object.entries(conditionalDeps).forEach(([name, newVersion]) => {
        const configVersion = typeof newVersion === "string" ? newVersion : newVersion?.version || newVersion;
        if (!configVersion) return;

        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: oldVersion, new: configVersion };
          } else if (changes.dependencies[name].new !== configVersion) {
            changes.dependencies[name].new = configVersion;
          }
        }
      });

      // Controlla BASE devDependencies (stesso meccanismo di prima)
      Object.entries(finalDevDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.devDependencies?.[name];
        if (oldVersion) {
          if (!versionSatisfiesRange(oldVersion, newVersion)) {
            if (!changes.devDependencies[name]) {
              changes.devDependencies[name] = { old: oldVersion, new: newVersion };
            }
          }
        } else if (!oldVersion) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = { old: null, new: newVersion };
          }
        }
      });

      // Controlla CONDITIONAL devDependencies - IMPORTANTE:
      // updatePackageJson aggiorna conditional devDeps che sono già in package.json
      // anche se non vengono rilevate come "usate" nel codice
      Object.entries(conditionalDevDeps).forEach(([name, newVersion]) => {
        const configVersion = typeof newVersion === "string" ? newVersion : newVersion?.version || newVersion;
        if (!configVersion) return;

        const oldVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = { old: oldVersion, new: configVersion };
          } else if (changes.devDependencies[name].new !== configVersion) {
            changes.devDependencies[name].new = configVersion;
          }
        }
      });
    }
  });

  // Raccogliamo le modifiche per componente (usate per proporre gli overrides)
  const componentChanges = {};

  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(process.cwd(), componentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const compChanges = { dependencies: [], devDependencies: [] };

      // Controlla BASE dependencies (entrambe le sezioni)
      Object.entries(finalBaseDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, newVersion)) {
          compChanges.dependencies.push({ name, from: oldVersion, to: newVersion });
        }
      });

      // Controlla CONDITIONAL dependencies
      Object.entries(conditionalDeps).forEach(([name, newVersion]) => {
        const configVersion = typeof newVersion === "string" ? newVersion : newVersion?.version || newVersion;
        if (!configVersion) return;
        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          if (!compChanges.dependencies.find((d) => d.name === name)) {
            compChanges.dependencies.push({ name, from: oldVersion, to: configVersion });
          }
        }
      });

      // Controlla BASE devDependencies
      Object.entries(finalDevDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.devDependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, newVersion)) {
          compChanges.devDependencies.push({ name, from: oldVersion, to: newVersion });
        }
      });

      // Controlla CONDITIONAL devDependencies
      Object.entries(conditionalDevDeps).forEach(([name, newVersion]) => {
        const configVersion = typeof newVersion === "string" ? newVersion : newVersion?.version || newVersion;
        if (!configVersion) return;
        const oldVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          if (!compChanges.devDependencies.find((d) => d.name === name)) {
            compChanges.devDependencies.push({ name, from: oldVersion, to: configVersion });
          }
        }
      });

      if (compChanges.dependencies.length > 0 || compChanges.devDependencies.length > 0) {
        componentChanges[componentDir] = compChanges;
      }
    }
  });

  // Mostra le modifiche per ogni componente
  Object.entries(componentChanges).forEach(([componentDir, compChanges]) => {
    logger.log(`\n📦 ${componentDir}:`, "cyan");

    if (compChanges.dependencies.length > 0) {
      logger.log(`   🔄 Dipendenze da aggiornare (${compChanges.dependencies.length}):`, "yellow");
      compChanges.dependencies.forEach(({ name, from, to }) => {
        logger.log(`      ${name}: ${from} → ${to}`, "yellow");
      });
    }

    if (compChanges.devDependencies.length > 0) {
      logger.log(`   🔄 DevDependencies da aggiornare (${compChanges.devDependencies.length}):`, "yellow");
      compChanges.devDependencies.forEach(({ name, from, to }) => {
        logger.log(`      ${name}: ${from} → ${to}`, "yellow");
      });
    }
  });

  // Mostra anche il riepilogo globale (per compatibilità)
  if (Object.keys(changes.dependencies).length > 0) {
    logger.log("\n📊 Riepilogo globale Dependencies:", "yellow");
    Object.entries(changes.dependencies).forEach(([name, versions]) => {
      if (versions.old) {
        logger.log(`  ${name}: ${versions.old} → ${versions.new}`, "blue");
      } else {
        logger.log(`  ${name}: [NUOVO] → ${versions.new}`, "green");
      }
    });
  }

  if (Object.keys(changes.devDependencies).length > 0) {
    logger.log("\n📊 Riepilogo globale DevDependencies:", "yellow");
    Object.entries(changes.devDependencies).forEach(([name, versions]) => {
      if (versions.old) {
        logger.log(`  ${name}: ${versions.old} → ${versions.new}`, "blue");
      } else {
        logger.log(`  ${name}: [NUOVO] → ${versions.new}`, "green");
      }
    });
  }

  const hasChanges = Object.keys(changes.dependencies).length > 0 || Object.keys(changes.devDependencies).length > 0;

  return { hasChanges, componentChanges };
}

// Formatta i log delle modifiche applicate (risultato di updatePackageJson) per un componente.
function logComponentChanges(changes, componentDir) {
  logger.log(`\n📦 ${componentDir}:`, "cyan");

  let hasAnyChanges = false;

  if (changes.dependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔧 Dipendenze aggiunte (BASE):`, "yellow");
    changes.dependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  if (changes.dependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze condizionali aggiunte:`, "yellow");
    changes.dependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  if (changes.dependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze aggiornate:`, "yellow");
    changes.dependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  if (changes.dependencies.moved && changes.dependencies.moved.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Spostate in dependencies (erano in devDependencies):`, "yellow");
    changes.dependencies.moved.forEach(({ name, version }) => {
      logger.log(`      ${name}@${version}`, "cyan");
    });
  }

  if (changes.devDependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🛠️  Dipendenze dev aggiunte (BASE):`, "yellow");
    changes.devDependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  if (changes.devDependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze dev condizionali aggiunte:`, "yellow");
    changes.devDependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  if (changes.devDependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze dev aggiornate:`, "yellow");
    changes.devDependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  if (changes.devDependencies.moved && changes.devDependencies.moved.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Spostate in devDependencies (erano in dependencies):`, "yellow");
    changes.devDependencies.moved.forEach(({ name, version }) => {
      logger.log(`      ${name}@${version}`, "cyan");
    });
  }

  if (changes.removed.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🗑️  Dipendenze rimosse:`, "yellow");
    changes.removed.forEach(({ name, version, type }) => {
      const typeLabel = type === "dependency" ? "dependencies" : "devDependencies";
      logger.log(`      - ${name}@${version} (${typeLabel})`, "red");
    });
  }

  if (changes.overrides) {
    if (changes.overrides.added && changes.overrides.added.length > 0) {
      hasAnyChanges = true;
      logger.log(`   🔒 Overrides aggiunti:`, "yellow");
      changes.overrides.added.forEach(({ name, version }) => {
        logger.log(`      + ${name}@${version}`, "cyan");
      });
    }
    if (changes.overrides.updated && changes.overrides.updated.length > 0) {
      hasAnyChanges = true;
      logger.log(`   🔒 Overrides aggiornati:`, "yellow");
      changes.overrides.updated.forEach(({ name, from, to }) => {
        logger.log(`      ${name}: ${from} → ${to}`, "cyan");
      });
    }
  }

  if (!hasAnyChanges) {
    logger.log(`   ✅ Nessuna modifica`, "green");
  }
}

module.exports = {
  showVersionChanges,
  logComponentChanges,
};
