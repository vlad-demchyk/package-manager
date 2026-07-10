/**
 * Gestione configurazione dipendenze
 * Funzioni per pulizia, allineamento e rimozione duplicati
 */

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { compareVersions } = require("../utils/version-utils");

// Funzione per preview rimozione prefissi dalle versioni
function previewCleanVersionPrefixes() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    const configContent = fs.readFileSync(configPath, "utf8");
    const changes = [];
    const versionPattern = /"([\^~>=<]+)([^"]+)"/g;
    let match;

    while ((match = versionPattern.exec(configContent)) !== null) {
      const prefix = match[1];
      const version = match[2];
      changes.push({ prefix, version, cleaned: version });
    }

    return { success: true, cleaned: changes.length, changes };
  } catch (error) {
    return { success: false, error: error.message, changes: [] };
  }
}

// Funzione per rimuovere prefissi dalle versioni
function cleanVersionPrefixesFromConfig() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    let configContent = fs.readFileSync(configPath, "utf8");
    let cleaned = 0;
    const errors = [];

    // Pattern per trovare versioni con prefissi
    const versionPattern = /"([\^~>=<]+)([^"]+)"/g;
    
    // Sostituiamo in tutte le sezioni
    configContent = configContent.replace(versionPattern, (match, prefix, version) => {
      cleaned++;
      return `"${version}"`;
    });

    // Salviamo il file
    fs.writeFileSync(configPath, configContent, "utf8");

    return { success: true, cleaned, errors };
  } catch (error) {
    return { success: false, error: error.message, errors: [] };
  }
}

// Funzione per preview rimozione duplicati
function previewRemoveDuplicateDependencies() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    // Carichiamo il config
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);

    const conditionalDeps = config.CONDITIONAL_DEPENDENCIES || {};
    const conditionalDevDeps = config.CONDITIONAL_DEV_DEPENDENCIES || {};

    const duplicates = [];

    // Troviamo duplicati
    Object.keys(conditionalDeps).forEach((name) => {
      if (conditionalDevDeps[name]) {
        const depVersion = typeof conditionalDeps[name] === 'string' 
          ? conditionalDeps[name] 
          : (conditionalDeps[name]?.version || conditionalDeps[name]);
        const devDepVersion = typeof conditionalDevDeps[name] === 'string' 
          ? conditionalDevDeps[name] 
          : (conditionalDevDeps[name]?.version || conditionalDevDeps[name]);

        if (depVersion && devDepVersion) {
          // Confrontiamo versioni e scegliamo la più alta
          const comparison = compareVersions(depVersion, devDepVersion);
          let highestVersion;
          let keptIn;
          let removedFrom;

          if (comparison >= 0) {
            highestVersion = depVersion;
            keptIn = 'CONDITIONAL_DEPENDENCIES';
            removedFrom = 'CONDITIONAL_DEV_DEPENDENCIES';
          } else {
            highestVersion = devDepVersion;
            keptIn = 'CONDITIONAL_DEV_DEPENDENCIES';
            removedFrom = 'CONDITIONAL_DEPENDENCIES';
          }

          duplicates.push({
            name,
            version: highestVersion,
            keptIn,
            removedFrom,
            depVersion,
            devDepVersion
          });
        }
      }
    });

    return { success: true, removed: duplicates.length, duplicates };
  } catch (error) {
    return { success: false, error: error.message, removed: 0, duplicates: [] };
  }
}

// Funzione per rimuovere duplicati (usa la versione più alta, determina dove lasciare in base alla frequenza)
function removeDuplicateDependenciesFromConfig() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    // Carichiamo il config
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);

    const conditionalDeps = config.CONDITIONAL_DEPENDENCIES || {};
    const conditionalDevDeps = config.CONDITIONAL_DEV_DEPENDENCIES || {};

    const newConditionalDeps = { ...conditionalDeps };
    const newConditionalDevDeps = { ...conditionalDevDeps };
    const duplicates = [];
    let removed = 0;

    // Troviamo duplicati
    Object.keys(conditionalDeps).forEach((name) => {
      if (conditionalDevDeps[name]) {
        const depVersion = typeof conditionalDeps[name] === 'string' 
          ? conditionalDeps[name] 
          : (conditionalDeps[name]?.version || conditionalDeps[name]);
        const devDepVersion = typeof conditionalDevDeps[name] === 'string' 
          ? conditionalDevDeps[name] 
          : (conditionalDevDeps[name]?.version || conditionalDevDeps[name]);

        if (depVersion && devDepVersion) {
          // Confrontiamo versioni e scegliamo la più alta
          const comparison = compareVersions(depVersion, devDepVersion);
          let highestVersion;
          let keptIn;
          let removedFrom;

          if (comparison >= 0) {
            highestVersion = depVersion;
            keptIn = 'CONDITIONAL_DEPENDENCIES';
            removedFrom = 'CONDITIONAL_DEV_DEPENDENCIES';
            delete newConditionalDevDeps[name];
          } else {
            highestVersion = devDepVersion;
            keptIn = 'CONDITIONAL_DEV_DEPENDENCIES';
            removedFrom = 'CONDITIONAL_DEPENDENCIES';
            delete newConditionalDeps[name];
          }

          // Aggiorniamo la versione nella sezione dove la lasciamo
          if (keptIn === 'CONDITIONAL_DEPENDENCIES') {
            newConditionalDeps[name] = highestVersion;
          } else {
            newConditionalDevDeps[name] = highestVersion;
          }

          duplicates.push({
            name,
            version: highestVersion,
            keptIn,
            removedFrom
          });
          removed++;
        }
      }
    });

    // Aggiorniamo il file
    let configContent = fs.readFileSync(configPath, "utf8");

    // Sostituiamo CONDITIONAL_DEPENDENCIES
    const conditionalDepsPattern = /const CONDITIONAL_DEPENDENCIES = \{[\s\S]*?\};/;
    const conditionalDepsString = `const CONDITIONAL_DEPENDENCIES = ${JSON.stringify(newConditionalDeps, null, 2)};`;
    configContent = configContent.replace(conditionalDepsPattern, conditionalDepsString);

    // Sostituiamo CONDITIONAL_DEV_DEPENDENCIES
    const conditionalDevDepsPattern = /const CONDITIONAL_DEV_DEPENDENCIES = \{[\s\S]*?\};/;
    const conditionalDevDepsString = `const CONDITIONAL_DEV_DEPENDENCIES = ${JSON.stringify(newConditionalDevDeps, null, 2)};`;
    configContent = configContent.replace(conditionalDevDepsPattern, conditionalDevDepsString);

    fs.writeFileSync(configPath, configContent, "utf8");

    return { success: true, removed, duplicates };
  } catch (error) {
    return { success: false, error: error.message, removed: 0, duplicates: [] };
  }
}

// Funzione per preview allineamento versioni duplicate
function previewAlignDuplicateVersions() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    // Carichiamo il config
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);

    const conditionalDeps = config.CONDITIONAL_DEPENDENCIES || {};
    const conditionalDevDeps = config.CONDITIONAL_DEV_DEPENDENCIES || {};

    const duplicates = [];

    // Troviamo duplicati e allineiamo versioni
    Object.keys(conditionalDeps).forEach((name) => {
      if (conditionalDevDeps[name]) {
        const depVersion = typeof conditionalDeps[name] === 'string' 
          ? conditionalDeps[name] 
          : (conditionalDeps[name]?.version || conditionalDeps[name]);
        const devDepVersion = typeof conditionalDevDeps[name] === 'string' 
          ? conditionalDevDeps[name] 
          : (conditionalDevDeps[name]?.version || conditionalDevDeps[name]);

        if (depVersion && devDepVersion) {
          // Confrontiamo versioni e scegliamo la più alta
          const comparison = compareVersions(depVersion, devDepVersion);
          let highestVersion;

          if (comparison >= 0) {
            highestVersion = depVersion;
          } else {
            highestVersion = devDepVersion;
          }

          if (depVersion !== highestVersion || devDepVersion !== highestVersion) {
            duplicates.push({
              name,
              oldDepVersion: depVersion,
              oldDevDepVersion: devDepVersion,
              newVersion: highestVersion
            });
          }
        }
      }
    });

    return { success: true, aligned: duplicates.length, duplicates };
  } catch (error) {
    return { success: false, error: error.message, aligned: 0, duplicates: [] };
  }
}

// Funzione per allineare versioni duplicate (mantiene duplicati con versione più alta)
function alignDuplicateVersionsInConfig() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return { success: false, error: "dependencies-config.js non trovato" };
  }

  try {
    // Carichiamo il config
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);

    const conditionalDeps = config.CONDITIONAL_DEPENDENCIES || {};
    const conditionalDevDeps = config.CONDITIONAL_DEV_DEPENDENCIES || {};

    const newConditionalDeps = { ...conditionalDeps };
    const newConditionalDevDeps = { ...conditionalDevDeps };
    const duplicates = [];
    let aligned = 0;

    // Troviamo duplicati e allineiamo versioni
    Object.keys(conditionalDeps).forEach((name) => {
      if (conditionalDevDeps[name]) {
        const depVersion = typeof conditionalDeps[name] === 'string' 
          ? conditionalDeps[name] 
          : (conditionalDeps[name]?.version || conditionalDeps[name]);
        const devDepVersion = typeof conditionalDevDeps[name] === 'string' 
          ? conditionalDevDeps[name] 
          : (conditionalDevDeps[name]?.version || conditionalDevDeps[name]);

        if (depVersion && devDepVersion) {
          // Confrontiamo versioni e scegliamo la più alta
          const comparison = compareVersions(depVersion, devDepVersion);
          let highestVersion;

          if (comparison >= 0) {
            highestVersion = depVersion;
          } else {
            highestVersion = devDepVersion;
          }

          // Aggiorniamo entrambe le sezioni con la versione più alta
          newConditionalDeps[name] = highestVersion;
          newConditionalDevDeps[name] = highestVersion;

          duplicates.push({
            name,
            oldDepVersion: depVersion,
            oldDevDepVersion: devDepVersion,
            newVersion: highestVersion
          });
          aligned++;
        }
      }
    });

    // Aggiorniamo il file
    let configContent = fs.readFileSync(configPath, "utf8");

    // Sostituiamo CONDITIONAL_DEPENDENCIES
    const conditionalDepsPattern = /const CONDITIONAL_DEPENDENCIES = \{[\s\S]*?\};/;
    const conditionalDepsString = `const CONDITIONAL_DEPENDENCIES = ${JSON.stringify(newConditionalDeps, null, 2)};`;
    configContent = configContent.replace(conditionalDepsPattern, conditionalDepsString);

    // Sostituiamo CONDITIONAL_DEV_DEPENDENCIES
    const conditionalDevDepsPattern = /const CONDITIONAL_DEV_DEPENDENCIES = \{[\s\S]*?\};/;
    const conditionalDevDepsString = `const CONDITIONAL_DEV_DEPENDENCIES = ${JSON.stringify(newConditionalDevDeps, null, 2)};`;
    configContent = configContent.replace(conditionalDevDepsPattern, conditionalDevDepsString);

    fs.writeFileSync(configPath, configContent, "utf8");

    return { success: true, aligned, duplicates };
  } catch (error) {
    return { success: false, error: error.message, aligned: 0, duplicates: [] };
  }
}

module.exports = {
  previewCleanVersionPrefixes,
  cleanVersionPrefixesFromConfig,
  previewRemoveDuplicateDependencies,
  removeDuplicateDependenciesFromConfig,
  previewAlignDuplicateVersions,
  alignDuplicateVersionsInConfig,
  compareVersions
};

