#!/usr/bin/env node

/**
 * Script cross-platform per aggiornare package.json e tsconfig.json
 * basato sulle dipendenze del calendario per tutti i componenti
 * Versione modulare con configurazione esterna
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// Import shared logger
const logger = require("./utils/logger");

// Funzione per creare un template vuoto dependencies-config.js
function createEmptyDependenciesConfig(projectRoot) {
  // 1. FONTE PRINCIPALE (per sviluppo del manager)
  let templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "dependencies-config.js"
  );

  // 2. FALLBACK (se l'utente ha rimosso il config)
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "@vlad-demchyk",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  // 3. FALLBACK ALTERNATIVO
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(
      projectRoot,
      "node_modules",
      "package-manager",
      "templates",
      "dependencies-config.js"
    );
  }

  const targetPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  try {
    // Verifichiamo se esiste la cartella package-manager
    const packageManagerDir = path.join(projectRoot, "package-manager");
    if (!fs.existsSync(packageManagerDir)) {
      fs.mkdirSync(packageManagerDir, { recursive: true });
    }

    // Verifichiamo se esiste il template
    if (!fs.existsSync(templatePath)) {
      logger.error(
        `Template non trovato in nessuno dei luoghi: ${templatePath}`
      );
      return false;
    }

    // Copiamo il template
    fs.copyFileSync(templatePath, targetPath);
    logger.log(`✅ Template copiato da: ${templatePath}`, "green");
    return true;
  } catch (error) {
    logger.error(`Errore creando template: ${error.message}`);
    return false;
  }
}

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

// Funzione per confrontare versioni (versione semplificata di compareVersions)
function compareVersions(version1, version2) {
  // Rimuoviamo prefissi (^, ~, >=, <=, >, <)
  const cleanVersion = (v) => {
    if (!v || typeof v !== 'string') return '0.0.0';
    // Per git URLs o altre stringhe non-versioni, restituiamo come sono
    if (v.includes('git+') || v.includes('bitbucket:') || v.includes('http')) {
      return v;
    }
    return v.replace(/^[\^~>=<]+/, '');
  };

  const v1 = cleanVersion(version1);
  const v2 = cleanVersion(version2);

  // Se una delle versioni è un git URL o altra stringa non-versione, non confrontiamo
  if (v1.includes('git+') || v1.includes('bitbucket:') || v1.includes('http')) {
    return v1 === v2 ? 0 : 1; // Se URL uguali, restituiamo 0
  }
  if (v2.includes('git+') || v2.includes('bitbucket:') || v2.includes('http')) {
    return v1 === v2 ? 0 : -1;
  }

  const parseVersion = (v) => {
    const parts = v.split('.').map(Number);
    while (parts.length < 3) parts.push(0);
    return parts;
  };

  const v1Parts = parseVersion(v1);
  const v2Parts = parseVersion(v2);

  for (let i = 0; i < 3; i++) {
    if (v1Parts[i] > v2Parts[i]) return 1;
    if (v1Parts[i] < v2Parts[i]) return -1;
  }

  return 0;
}

// Funzione per rilevare e risolvere duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES
function resolveDuplicateDependencies(conditionalDeps, conditionalDevDeps) {
  const resolvedConditionalDeps = { ...conditionalDeps };
  const resolvedConditionalDevDeps = { ...conditionalDevDeps };
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
        let source;

        if (comparison >= 0) {
          highestVersion = depVersion;
          source = 'CONDITIONAL_DEPENDENCIES';
        } else {
          highestVersion = devDepVersion;
          source = 'CONDITIONAL_DEV_DEPENDENCIES';
        }

        // Aggiorniamo entrambe le sezioni con la versione più alta
        resolvedConditionalDeps[name] = highestVersion;
        resolvedConditionalDevDeps[name] = highestVersion;

        duplicates.push({
          name,
          depVersion,
          devDepVersion,
          resolvedVersion: highestVersion,
          source
        });
      }
    }
  });

  return {
    conditionalDeps: resolvedConditionalDeps,
    conditionalDevDeps: resolvedConditionalDevDeps,
    duplicates
  };
}

// Funzione per ricaricare il modulo dependencies-config
function reloadDependenciesConfig(projectRoot, options = {}) {
  const { showDuplicates = false } = options;
  
  try {
    const configPath = path.join(
      projectRoot,
      "package-manager/dependencies-config"
    );
    const resolvedPath = require.resolve(configPath);

    // Clear cache to ensure fresh loading
    delete require.cache[resolvedPath];

    const depsConfig = require(configPath);
    
    // Отримуємо conditional deps та devDeps
    const conditionalDeps = depsConfig.getConditionalDependencies 
      ? depsConfig.getConditionalDependencies() 
      : {};
    const conditionalDevDeps = depsConfig.getConditionalDevDependencies 
      ? depsConfig.getConditionalDevDependencies() 
      : {};

    // Risolviamo duplicati
    const resolved = resolveDuplicateDependencies(conditionalDeps, conditionalDevDeps);
    
    // Mostra duplicati solo se richiesto (per menu gestione config)
    if (showDuplicates && resolved.duplicates.length > 0) {
      logger.warning(`⚠️  Trovati ${resolved.duplicates.length} duplicati tra CONDITIONAL_DEPENDENCIES e CONDITIONAL_DEV_DEPENDENCIES`);
      resolved.duplicates.forEach((dup) => {
        logger.log(
          `   ${dup.name}: ${dup.depVersion} (deps) vs ${dup.devDepVersion} (devDeps) → ${dup.resolvedVersion}`,
          "yellow"
        );
      });
      logger.log("   Usata versione più alta in entrambe le sezioni", "cyan");
    }

    // Creiamo wrapper che restituiscono versioni risolte
    getBaseDependencies = depsConfig.getBaseDependencies;
    getConditionalDependencies = () => resolved.conditionalDeps;
    getDevDependencies = depsConfig.getDevDependencies;
    getConditionalDevDependencies = () => resolved.conditionalDevDeps;
    getDeprecatedDependencies = depsConfig.getDeprecatedDependencies;
    getStandardScripts = depsConfig.getStandardScripts;
    getStandardTsConfig = depsConfig.getStandardTsConfig;
    getNodeEngines = depsConfig.getNodeEngines;
    getOverrides = depsConfig.getOverrides || (() => ({}));
    logger.log(
      "✅ Modulo dependencies-config ricaricato con successo!",
      "green"
    );
    
    // Restituisce le funzioni per uso esterno
    return {
      getBaseDependencies,
      getConditionalDependencies,
      getDevDependencies,
      getConditionalDevDependencies,
      getDeprecatedDependencies,
      getStandardScripts,
      getStandardTsConfig,
      getNodeEngines,
      getOverrides
    };
  } catch (error) {
    logger.error(`Errore ricaricando modulo: ${error.message}`);
    // Usiamo funzioni di default
    getBaseDependencies = () => ({});
    getConditionalDependencies = () => ({});
    getDevDependencies = () => ({});
    getConditionalDevDependencies = () => ({});
    getDeprecatedDependencies = () => [];
    getStandardScripts = () => ({});
    getStandardTsConfig = () => ({});
    getNodeEngines = () => ({});
    getOverrides = () => ({});
    
    // Restituisce le funzioni di default
    return {
      getBaseDependencies,
      getConditionalDependencies,
      getDevDependencies,
      getConditionalDevDependencies,
      getDeprecatedDependencies,
      getStandardScripts,
      getStandardTsConfig,
      getNodeEngines,
      getOverrides
    };
  }
}

// Import moduli riorganizzati
const {
  generateDependenciesConfig,
  displayGeneratedDependencies,
  saveDependenciesConfig,
} = require("./dependencies/generator");
const { getUsedDependencies } = require("./dependencies/analyzer");
const {
  updatePackageJson,
  updateTsConfig,
  removeTslintJson,
} = require("./dependencies/updater");

// Carica configurazione progetto dinamicamente
const projectRoot = process.cwd();
// logger.log(`🔍 Project root: ${projectRoot}`, "blue");
// logger.log(`🔍 Project config path: ${path.join(projectRoot, "package-manager/project-config")}`, "blue");

const projectConfig = require(path.join(
  projectRoot,
  "package-manager/project-config.js"
));

// logger.log(`🔍 Project config loaded:`, "blue");
// logger.log(`   - filterByPrefix: ${projectConfig.components.filterByPrefix.enabled}`, "blue");
// logger.log(`   - prefix: ${projectConfig.components.filterByPrefix.prefix}`, "blue");
// logger.log(`   - filterByStructure: ${projectConfig.components.filterByStructure.enabled}`, "blue");
// logger.log(`   - requiredFiles: ${JSON.stringify(projectConfig.components.filterByStructure.requiredFiles)}`, "blue");

// Import configurazione dipendenze dinamicamente (con fallback se non esiste)
let getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getConditionalDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines,
  getOverrides;

// Funzioni di default vuote
function initEmptyFunctions() {
  getBaseDependencies = () => ({});
  getConditionalDependencies = () => ({});
  getDevDependencies = () => ({});
  getConditionalDevDependencies = () => ({});
  getDeprecatedDependencies = () => [];
  getStandardScripts = () => ({});
  getStandardTsConfig = () => ({});
  getNodeEngines = () => ({});
  getOverrides = () => ({});
}

// Inizializza con funzioni vuote di default
initEmptyFunctions();

// Funzione per verificare se dependencies-config.js è vuoto
function isDependenciesConfigEmpty() {
  const configPath = path.join(
    process.cwd(),
    "package-manager",
    "dependencies-config.js"
  );

  if (!fs.existsSync(configPath)) {
    return true;
  }

  try {
    // Clear cache to ensure fresh loading
    const resolvedPath = require.resolve(configPath);
    delete require.cache[resolvedPath];
    const config = require(configPath);

    // Check if all main objects are empty (ignoring comments and empty values)
    const baseDepsEmpty =
      !config.BASE_DEPENDENCIES ||
      Object.keys(config.BASE_DEPENDENCIES).length === 0 ||
      Object.values(config.BASE_DEPENDENCIES).every(
        (val) =>
          (typeof val === "string" && val.trim() === "") ||
          val === null ||
          val === undefined
      );

    const conditionalDepsEmpty =
      !config.CONDITIONAL_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEPENDENCIES).every(
        (val) =>
          !val ||
          (typeof val === "object" &&
            (!val.version || val.version.trim() === ""))
      );

    const devDepsEmpty =
      !config.DEV_DEPENDENCIES ||
      Object.keys(config.DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.DEV_DEPENDENCIES).every(
        (val) =>
          (typeof val === "string" && val.trim() === "") ||
          val === null ||
          val === undefined
      );

    const conditionalDevDepsEmpty =
      !config.CONDITIONAL_DEV_DEPENDENCIES ||
      Object.keys(config.CONDITIONAL_DEV_DEPENDENCIES).length === 0 ||
      Object.values(config.CONDITIONAL_DEV_DEPENDENCIES).every(
        (val) =>
          !val ||
          (typeof val === "object" &&
            (!val.version || val.version.trim() === ""))
      );

    // Consider empty if ALL dependency objects are empty (no real dependencies)
    const hasAnyDependencies =
      !baseDepsEmpty ||
      !conditionalDepsEmpty ||
      !devDepsEmpty ||
      !conditionalDevDepsEmpty;

    // Return true if file is empty (no dependencies at all)
    return !hasAnyDependencies;
  } catch (error) {
    logger.log(
      `⚠️  Errore leggendo dependencies-config.js: ${error.message}`,
      "yellow"
    );
    return true;
  }
}

// Funzione per creare readline interface
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}

// Funzione per fare domande all'utente
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Funzione per mostrare le modifiche delle versioni
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
    const packageJsonPath = path.join(
      process.cwd(),
      componentDir,
      "package.json"
    );
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

      // Controlla BASE dependencies (stesso meccanismo di prima)
      Object.entries(finalBaseDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.dependencies?.[name];
        if (oldVersion) {
          // Solo se la versione corrente non soddisfa il range configurato
          if (!versionSatisfiesRange(oldVersion, newVersion)) {
            if (!changes.dependencies[name]) {
              changes.dependencies[name] = { old: oldVersion, new: newVersion };
            }
          }
        } else if (!oldVersion) {
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: null, new: newVersion };
          }
        }
      });

      // Controlla CONDITIONAL dependencies - IMPORTANTE:
      // updatePackageJson aggiorna conditional deps che sono già in package.json
      // anche se non vengono rilevate come "usate" nel codice
      // Quindi controlliamo TUTTE le conditional deps dal config
      // se sono presenti in package.json del componente corrente (in qualsiasi sezione)
      Object.entries(conditionalDeps).forEach(([name, newVersion]) => {
        // Gestire sia stringhe che oggetti (per compatibilità)
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        
        // Controlliamo entrambe le sezioni
        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        // Se il pacchetto è già presente in package.json di questo componente (in qualsiasi sezione), 
        // verrà aggiornato da updatePackageJson indipendentemente dall'uso nel codice
        // Ma solo se la versione corrente non soddisfa il range configurato
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          // Pacchetto presente ma con versione che non soddisfa il range - da aggiornare
          // Se già presente in changes, aggiorna solo se la nuova versione è diversa
          if (!changes.dependencies[name]) {
            changes.dependencies[name] = { old: oldVersion, new: configVersion };
          } else if (changes.dependencies[name].new !== configVersion) {
            // Se la versione target è diversa da quella già registrata, aggiorna
            changes.dependencies[name].new = configVersion;
          }
        }
      });

      // Controlla BASE devDependencies (stesso meccanismo di prima)
      Object.entries(finalDevDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.devDependencies?.[name];
        if (oldVersion) {
          // Solo se la versione corrente non soddisfa il range configurato
          if (!versionSatisfiesRange(oldVersion, newVersion)) {
            if (!changes.devDependencies[name]) {
              changes.devDependencies[name] = {
                old: oldVersion,
                new: newVersion,
              };
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
      // Quindi controlliamo TUTTE le conditional devDeps dal config
      // se sono presenti in package.json del componente corrente (in qualsiasi sezione)
      Object.entries(conditionalDevDeps).forEach(([name, newVersion]) => {
        // Gestire sia stringhe che oggetti (per compatibilità)
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        
        // Controlliamo entrambe le sezioni
        const oldVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
        // Se il pacchetto è già presente in package.json di questo componente (in qualsiasi sezione), 
        // verrà aggiornato da updatePackageJson indipendentemente dall'uso nel codice
        // Ma solo se la versione corrente non soddisfa il range configurato
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          // Pacchetto presente ma con versione che non soddisfa il range - da aggiornare
          // Se già presente in changes, aggiorna solo se la nuova versione è diversa
          if (!changes.devDependencies[name]) {
            changes.devDependencies[name] = {
              old: oldVersion,
              new: configVersion,
            };
          } else if (changes.devDependencies[name].new !== configVersion) {
            // Se la versione target è diversa da quella già registrata, aggiorna
            changes.devDependencies[name].new = configVersion;
          }
        }
      });
    }
  });

  // Raccogliamo le modifiche per componente
  const componentChanges = {};
  
  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(
      process.cwd(),
      componentDir,
      "package.json"
    );
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const compChanges = {
        dependencies: [],
        devDependencies: []
      };

      // Controlla BASE dependencies
      Object.entries(finalBaseDeps).forEach(([name, newVersion]) => {
        const oldVersion = packageJson.dependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, newVersion)) {
          compChanges.dependencies.push({ name, from: oldVersion, to: newVersion });
        }
      });

      // Controlla CONDITIONAL dependencies
      Object.entries(conditionalDeps).forEach(([name, newVersion]) => {
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        const oldVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          // Aggiungi solo se non è già presente
          if (!compChanges.dependencies.find(d => d.name === name)) {
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
        const configVersion = typeof newVersion === 'string' ? newVersion : (newVersion?.version || newVersion);
        if (!configVersion) return;
        const oldVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
        if (oldVersion && !versionSatisfiesRange(oldVersion, configVersion)) {
          // Aggiungi solo se non è già presente
          if (!compChanges.devDependencies.find(d => d.name === name)) {
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

  // Mostra lo stato tsconfig
  if (Object.keys(getStandardTsConfig()).length > 0) {
    logger.log("\ntsconfig.json sarà aggiornato", "yellow");
  }

  // Ritorna true se ci sono modifiche da applicare
  const hasChanges =
    Object.keys(changes.dependencies).length > 0 ||
    Object.keys(changes.devDependencies).length > 0 ||
    Object.keys(getStandardTsConfig()).length > 0;

  return { hasChanges, componentChanges };
}

// Funzione per formattare i log delle modifiche per componente
function logComponentChanges(changes, componentDir) {
  logger.log(`\n📦 ${componentDir}:`, "cyan");

  let hasAnyChanges = false;

  // Dependencies - aggiunte da BASE
  if (changes.dependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔧 Dipendenze aggiunte (BASE):`, "yellow");
    changes.dependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  // Dependencies - aggiunte condizionali
  if (changes.dependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze condizionali aggiunte:`, "yellow");
    changes.dependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  // Dependencies - aggiornate
  if (changes.dependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze aggiornate:`, "yellow");
    changes.dependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  // DevDependencies - aggiunte da DEV
  if (changes.devDependencies.added.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🛠️  Dipendenze dev aggiunte (BASE):`, "yellow");
    changes.devDependencies.added.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "green");
    });
  }

  // DevDependencies - aggiunte condizionali
  if (changes.devDependencies.conditional.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔀 Dipendenze dev condizionali aggiunte:`, "yellow");
    changes.devDependencies.conditional.forEach(({ name, version }) => {
      logger.log(`      + ${name}@${version}`, "cyan");
    });
  }

  // DevDependencies - aggiornate
  if (changes.devDependencies.updated.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🔄 Dipendenze dev aggiornate:`, "yellow");
    changes.devDependencies.updated.forEach(({ name, from, to }) => {
      logger.log(`      ${name}: ${from} → ${to}`, "magenta");
    });
  }

  // Rimosse deprecate
  if (changes.removed.length > 0) {
    hasAnyChanges = true;
    logger.log(`   🗑️  Dipendenze rimosse:`, "yellow");
    changes.removed.forEach(({ name, version, type }) => {
      const typeLabel =
        type === "dependency" ? "dependencies" : "devDependencies";
      logger.log(`      - ${name}@${version} (${typeLabel})`, "red");
    });
  }

  // Overrides aggiunti/aggiornati
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

// Funzione principale per aggiornare tutte le configurazioni
async function updateAllConfigs(scope = "all", components = []) {
  logger.log("🚀 Avvio aggiornamento configurazioni componenti...", "cyan");

  // Clear all cached modules to ensure fresh loading
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("dependencies-config") || key.includes("project-config")) {
      delete require.cache[key];
    }
  });

  const dependenciesConfigPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  // 1. Se il file non esiste, copia il template
  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.log("⚠️  dependencies-config.js non trovato!", "yellow");
    logger.log("📋 Copiando template vuoto...", "cyan");

    if (createEmptyDependenciesConfig(projectRoot)) {
      logger.log("✅ Template copiato!", "green");

      // Dopo aver copiato il template, verifica subito se è vuoto
      if (isDependenciesConfigEmpty()) {
        logger.log("⚠️  dependencies-config.js è vuoto (template)!", "yellow");
        logger.log(
          "💡 Vuoi generare automaticamente dai progetti esistenti?",
          "cyan"
        );

        const rl = createReadlineInterface();
        const answer = await askQuestion(rl, "Generare? (y/N): ");

        if (answer === "y" || answer === "yes") {
          const generated = generateDependenciesConfig(projectConfig);
          displayGeneratedDependencies(generated, projectConfig);

          // Conferma salvataggio tsconfig
          if (
            generated.standardTsConfig &&
            Object.keys(generated.standardTsConfig).length > 0
          ) {
            logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
            logger.log(
              `   Versione TypeScript: ${generated.tsVersion}`,
              "blue"
            );
            if (generated.standardTsConfig.compilerOptions) {
              const opts = generated.standardTsConfig.compilerOptions;
              logger.log(`   Target: ${opts.target || "es2018"}`, "blue");
              logger.log(`   Module: ${opts.module || "commonjs"}`, "blue");
              logger.log(`   Strict: ${opts.strict || true}`, "blue");
            }

            const tsAnswer = await askQuestion(
              rl,
              "Salvare questa configurazione TypeScript? (y/N): "
            );
            if (tsAnswer !== "y" && tsAnswer !== "yes") {
              generated.standardTsConfig = {};
              logger.log(
                "Configurazione TypeScript non sarà salvata",
                "yellow"
              );
            }
          }

          const saveAnswer = await askQuestion(
            rl,
            "Salvare questa configurazione? (y/N): "
          );
          if (saveAnswer === "y" || saveAnswer === "yes") {
            saveDependenciesConfig(generated, projectConfig);
            logger.log("✅ Configurazione salvata!", "green");

            // Ricarica la configurazione dopo il salvataggio
            // Non mostriamo i duplicati durante l'aggiornamento (silent mode)
            reloadDependenciesConfig(projectRoot, { showDuplicates: false });

            // Chiedi conferma per procedere con l'aggiornamento
            const updateAnswer = await askQuestion(
              rl,
              "Procedere con l'aggiornamento per tutti i componenti? (y/N): "
            );
            if (updateAnswer === "y" || updateAnswer === "yes") {
              // Continua con l'aggiornamento normale
            } else {
              logger.log("❌ Generazione annullata", "yellow");
              rl.close();
              return false;
            }
          } else {
            logger.log("❌ Generazione annullata", "yellow");
            rl.close();
            return false;
          }
        } else {
          logger.log("❌ Generazione annullata", "yellow");
          rl.close();
          return false;
        }
        rl.close();
      } else {
        // Se il template non è vuoto, mostra le istruzioni manuali
        logger.log("📝 Ora puoi riempire manualmente il file:", "cyan");
        logger.log("   package-manager/dependencies-config.js", "blue");
        logger.log("");
        logger.log("💡 Sezioni disponibili:", "cyan");
        logger.log("   1. BASE_DEPENDENCIES (sempre aggiunte)", "blue");
        logger.log(
          "   2. CONDITIONAL_DEPENDENCIES (aggiunte se utilizzate)",
          "blue"
        );
        logger.log(
          "   3. DEV_DEPENDENCIES (sempre come devDependencies)",
          "blue"
        );
        logger.log("   4. DEPRECATED_DEPENDENCIES (rimosse)", "blue");
        logger.log("");
      }
    } else {
      logger.log("❌ Errore copiando template", "red");
      return false;
    }
  }

  // 2. Verifica se è vuota usando la funzione dedicata (prima di caricare)
  if (isDependenciesConfigEmpty()) {
    logger.log("⚠️  dependencies-config.js è vuoto!", "yellow");
    logger.log(
      "💡 Vuoi generare automaticamente dai progetti esistenti?",
      "cyan"
    );

    const rl = createReadlineInterface();
    const answer = await askQuestion(rl, "Generare? (y/N): ");

    if (answer === "y" || answer === "yes") {
      const generated = generateDependenciesConfig(projectConfig);
      displayGeneratedDependencies(generated, projectConfig);

      // Conferma salvataggio tsconfig
      if (
        generated.standardTsConfig &&
        Object.keys(generated.standardTsConfig).length > 0
      ) {
        logger.log("\n⚙️  TSCONFIG.JSON STANDARD trovato:", "cyan");
        logger.log(`   Versione TypeScript: ${generated.tsVersion}`, "blue");
        if (generated.standardTsConfig.compilerOptions) {
          const opts = generated.standardTsConfig.compilerOptions;
          logger.log(`   Target: ${opts.target || "es2018"}`, "blue");
          logger.log(`   Module: ${opts.module || "commonjs"}`, "blue");
          logger.log(`   Strict: ${opts.strict || true}`, "blue");
        }

        const confirmTs = await askQuestion(
          rl,
          "Salvare questa configurazione TypeScript? (y/N): "
        );

        if (confirmTs !== "y" && confirmTs !== "yes") {
          generated.standardTsConfig = {};
          logger.log("Configurazione TypeScript non sarà salvata", "yellow");
        }
      }

      const confirm = await askQuestion(
        rl,
        "Salvare questa configurazione? (y/N): "
      );

      if (confirm === "y" || confirm === "yes") {
        saveDependenciesConfig(generated, projectConfig);
        logger.log("Configurazione salvata!", "green");
        // Non mostriamo i duplicati durante l'aggiornamento (silent mode)
        reloadDependenciesConfig(projectRoot, { showDuplicates: false });

        // Chiedi se vuole procedere con l'aggiornamento
        const proceed = await askQuestion(
          rl,
          "Procedere con l'aggiornamento per tutti i componenti? (y/N): "
        );
        rl.close();

        if (proceed !== "y" && proceed !== "yes") {
          logger.log("🔄 Ritorno al menu principale...", "cyan");
          return false;
        }

        logger.log("🚀 Procedo con l'aggiornamento...", "cyan");
      } else {
        logger.log("❌ Generazione annullata", "yellow");
        rl.close();
        return false;
      }
    } else {
      logger.log("❌ Configurazione richiesta per continuare", "yellow");
      rl.close();
      return false;
    }
  } else {
    // 4. Se il file è già configurato, procedi automaticamente
    logger.log("✅ dependencies-config.js trovato e configurato!", "green");
    logger.log("🚀 Procedo con l'aggiornamento automatico...", "cyan");
  }

  // 5. Carica la configurazione dopo la verifica/generazione
  const depsFunctions = reloadDependenciesConfig(projectRoot);
  if (!depsFunctions) {
    logger.error("❌ Errore caricando configurazione dipendenze");
    return false;
  }

  // Carica le dipendenze dopo la verifica/generazione
  const baseDeps = depsFunctions.getBaseDependencies();
  const conditionalDeps = depsFunctions.getConditionalDependencies();
  const devDeps = depsFunctions.getDevDependencies();
  const conditionalDevDeps = depsFunctions.getConditionalDevDependencies();

  // Non aggiungere più tutte le dipendenze condizionali globalmente
  // Verranno processate per ogni componente individualmente
  const finalBaseDeps = { ...baseDeps };
  const finalDevDeps = { ...devDeps };

  // Ottieni configurazioni standard
  const standardScripts = depsFunctions.getStandardScripts();
  let standardTsConfig = depsFunctions.getStandardTsConfig();
  const nodeEngines = depsFunctions.getNodeEngines();
  const overrides = depsFunctions.getOverrides();
  const deprecatedDeps = depsFunctions.getDeprecatedDependencies();

  // Ottieni componenti con filtrazione
  const { getComponentDirectories } = require("./dependencies/analyzer");
  let componentDirs = getComponentDirectories(projectConfig);

  // logger.log(`🔍 Trovati ${componentDirs.length} componenti:`, "blue");
  // componentDirs.forEach((dir, index) => {
  //   logger.log(`   ${index + 1}. ${dir}`, "blue");
  // });

  // Applica filtrazione basata su scope e components
  if (scope === "single" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => components.includes(dir));
    // logger.log(`🔍 Dopo filtro single: ${componentDirs.length} componenti`, "blue");
  } else if (scope === "exclude" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => !components.includes(dir));
    // logger.log(`🔍 Dopo filtro exclude: ${componentDirs.length} componenti`, "blue");
  }

  if (componentDirs.length === 0) {
    logger.log("❌ Nessun componente trovato", "red");
    return false;
  }

  // Conferma aggiornamento tsconfig
  if (Object.keys(standardTsConfig).length > 0) {
    logger.log(
      "\ntsconfig.json sarà aggiornato secondo STANDARD_TSCONFIG",
      "yellow"
    );

    const rl = createReadlineInterface();
    const confirmTsUpdate = await askQuestion(
      rl,
      "Continuare l'aggiornamento tsconfig.json per tutti i componenti? (y/N): "
    );
    rl.close();

    if (confirmTsUpdate !== "y" && confirmTsUpdate !== "yes") {
      logger.log("Aggiornamento tsconfig.json saltato", "yellow");
      // Salta l'aggiornamento tsconfig - imposta come oggetto vuoto
      standardTsConfig = {};
    }
  }

  // Mostra riepilogo delle dipendenze che verranno applicate
  logger.log("\n📋 Riepilogo configurazione dipendenze:", "cyan");
  logger.log("", "reset");

  if (Object.keys(finalBaseDeps).length > 0) {
    logger.log("🔧 DIPENDENZE BASE che verranno aggiunte:", "yellow");
    Object.entries(finalBaseDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(conditionalDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE CONDIZIONALI che verranno aggiunte (se utilizzate):",
      "yellow"
    );
    Object.entries(conditionalDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(finalDevDeps).length > 0) {
    logger.log("🛠️  DIPENDENZE DEV che verranno aggiunte:", "yellow");
    Object.entries(finalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  if (Object.keys(conditionalDevDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE DEV CONDIZIONALI che verranno aggiunte (se utilizzate):",
      "yellow"
    );
    Object.entries(conditionalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  // Mostra tsconfig standard se disponibile
  const previewTsConfig = getStandardTsConfig();
  if (previewTsConfig && Object.keys(previewTsConfig).length > 0) {
    logger.log("⚙️  TSCONFIG.JSON STANDARD che verrà applicato:", "yellow");
    logger.log(
      `   Target: ${previewTsConfig.compilerOptions?.target || "es2018"}`,
      "blue"
    );
    logger.log(
      `   Module: ${previewTsConfig.compilerOptions?.module || "commonjs"}`,
      "blue"
    );
    logger.log(
      `   Strict: ${previewTsConfig.compilerOptions?.strict || true}`,
      "blue"
    );
    logger.log("", "reset");
  }

  // Mostra il riepilogo delle modifiche delle versioni solo se ci sono modifiche
  // Passa anche conditional deps per controllare le versioni se presenti in package.json
  const versionChangesResult = showVersionChanges(
    componentDirs,
    finalBaseDeps,
    finalDevDeps,
    projectConfig,
    conditionalDeps,
    conditionalDevDeps
  );

  const hasChanges = versionChangesResult.hasChanges;
  const componentChanges = versionChangesResult.componentChanges || {};

  if (!hasChanges) {
    logger.log("\n✅ Tutti i componenti sono già aggiornati!", "green");
    logger.log("🔙 Premi INVIO per tornare al menu principale...", "cyan");
    const pauseRl = createReadlineInterface();
    await askQuestion(pauseRl, "");
    pauseRl.close();
    return true;
  }

  // Raccogliamo i pacchetti che verranno aggiornati per proporre overrides
  // Solo se overrides sono già definiti nel config
  const packagesToUpdate = new Map(); // Usa Map per evitare duplicati mantenendo versione
  Object.entries(componentChanges).forEach(([componentDir, compChanges]) => {
    compChanges.dependencies.forEach(({ name, to }) => {
      // Mantieni la versione più alta se il pacchetto appare più volte
      if (!packagesToUpdate.has(name) || compareVersions(to, packagesToUpdate.get(name)) > 0) {
        packagesToUpdate.set(name, to);
      }
    });
    compChanges.devDependencies.forEach(({ name, to }) => {
      // Mantieni la versione più alta se il pacchetto appare più volte
      if (!packagesToUpdate.has(name) || compareVersions(to, packagesToUpdate.get(name)) > 0) {
        packagesToUpdate.set(name, to);
      }
    });
  });

  // Proponi di aggiungere overrides solo se sono già definiti nel config
  // e ci sono pacchetti da aggiornare che non sono già in overrides
  const packagesNotInOverrides = Array.from(packagesToUpdate.entries())
    .filter(([name, version]) => !overrides[name] || overrides[name] !== version);

  if (packagesNotInOverrides.length > 0 && Object.keys(overrides).length > 0) {
    logger.log("\n💡 Alcuni pacchetti aggiornati non hanno overrides configurati", "yellow");
    logger.log("   Pacchetti che verranno aggiornati (non in overrides):", "cyan");
    
    const packagesList = packagesNotInOverrides.slice(0, 20).map(([name, version], index) => {
      return { index: index + 1, name, version, display: `${index + 1}. ${name}@${version}` };
    });
    
    packagesList.forEach(p => logger.log(`      ${p.display}`, "gray"));
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

    if (addOverridesAnswer && addOverridesAnswer.toLowerCase() !== 'n' && addOverridesAnswer.toLowerCase() !== 'no') {
      const selectedPackages = new Map();
      
      if (addOverridesAnswer.toLowerCase() === 'all') {
        // Aggiungi tutti i pacchetti
        packagesNotInOverrides.forEach(([name, version]) => {
          selectedPackages.set(name, version);
        });
      } else {
        // Parsa i numeri selezionati
        const selectedIndices = addOverridesAnswer.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0 && n <= packagesList.length);
        selectedIndices.forEach(index => {
          const pkg = packagesList[index - 1];
          if (pkg) {
            selectedPackages.set(pkg.name, pkg.version);
          }
        });
      }

      if (selectedPackages.size > 0) {
        // Aggiungi overrides al config
        const newOverrides = {};
        selectedPackages.forEach((version, name) => {
          newOverrides[name] = version;
        });

        // Carica il config attuale
        const dependenciesConfigPath = path.join(
          projectRoot,
          "package-manager",
          "dependencies-config.js"
        );
        
        if (fs.existsSync(dependenciesConfigPath)) {
          try {
            const configContent = fs.readFileSync(dependenciesConfigPath, "utf8");
            
            // Trova la sezione OVERRIDES e aggiorna
            const overridesRegex = /const\s+OVERRIDES\s*=\s*({[\s\S]*?});/;
            const existingOverrides = configContent.match(overridesRegex);
            
            let updatedConfig;
            if (existingOverrides) {
              // Aggiorna overrides esistenti
              try {
                const existingObj = existingOverrides[1];
                // Rimuovi commenti e normalizza
                const cleanedObj = existingObj.replace(/\/\/.*$/gm, '').trim();
                const existingParsed = cleanedObj === '{}' || cleanedObj === '{\n  // Esempio: "package-name": "1.2.3"\n}' 
                  ? {} 
                  : JSON.parse(cleanedObj);
                const mergedOverrides = { ...existingParsed, ...newOverrides };
                updatedConfig = configContent.replace(
                  overridesRegex,
                  `const OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};`
                );
              } catch (error) {
                // Se il parsing fallisce, sostituisci completamente
                const mergedOverrides = { ...overrides, ...newOverrides };
                updatedConfig = configContent.replace(
                  overridesRegex,
                  `const OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};`
                );
              }
            } else {
              // Aggiungi nuova sezione OVERRIDES prima di module.exports
              const mergedOverrides = { ...overrides, ...newOverrides };
              const overridesSection = `\n// ============================================================================\n// OVERRIDES (forzatura versioni dipendenze)\n// ============================================================================\nconst OVERRIDES = ${JSON.stringify(mergedOverrides, null, 2)};\n\n`;
              updatedConfig = configContent.replace(
                /module\.exports\s*=/,
                `${overridesSection}module.exports =`
              );
            }
            
            fs.writeFileSync(dependenciesConfigPath, updatedConfig, "utf8");
            logger.log(`✅ Aggiunti ${Object.keys(newOverrides).length} overrides al config`, "green");
            
            // Ricarica il config
            const depsFunctionsReload = reloadDependenciesConfig(projectRoot, { showDuplicates: false });
            if (depsFunctionsReload) {
              const reloadedOverrides = depsFunctionsReload.getOverrides();
              Object.keys(overrides).forEach(key => delete overrides[key]);
              Object.assign(overrides, reloadedOverrides);
            }
          } catch (error) {
            logger.warning(`⚠️  Errore aggiungendo overrides: ${error.message}`);
          }
        }
      } else {
        logger.log("❌ Nessun pacchetto selezionato", "yellow");
      }
    }
  }

  // Per tutti gli scope: chiedi una volta se vuoi aggiungere overrides ai componenti selezionati
  let globalOverridesDecision = null; // null = non ancora deciso, true = sì, false = no
  if (overrides && Object.keys(overrides).length > 0) {
    // Verifica quali overrides mancano in almeno un componente
    let overridesToAdd = {};
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
    
      if (hasAnyMissing && Object.keys(overridesToAdd).length > 0) {
      let scopeLabel;
      if (scope === "all") {
        scopeLabel = "TUTTI i componenti";
      } else if (scope === "exclude") {
        scopeLabel = "i componenti selezionati";
      } else {
        // scope === "single"
        scopeLabel = componentDirs.length === 1 ? `il componente ${componentDirs[0]}` : "i componenti selezionati";
      }
      
      logger.log("\n💡 Overrides disponibili da aggiungere:", "yellow");
      logger.log(`   I seguenti overrides verranno aggiunti a ${scopeLabel}:`, "cyan");
      Object.entries(overridesToAdd).forEach(([name, version]) => {
        logger.log(`      ${name}: ${version}`, "gray");
      });
      
      const rl = createReadlineInterface();
      const addOverridesAnswer = await askQuestion(
        rl,
        `\nVuoi aggiungere questi overrides a ${scopeLabel}? (y/N): `
      );
      rl.close();
      
      globalOverridesDecision = (addOverridesAnswer === "y" || addOverridesAnswer === "yes");
    }
  }

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const totalCount = componentDirs.length;

  for (const componentDir of componentDirs) {
    const fullPath = path.join(process.cwd(), componentDir);

    // Debug: mostra il percorso completo
    // logger.log(`   📁 Percorso completo: ${fullPath}`, "blue");
    const packageJsonPath = path.join(fullPath, "package.json");
    // logger.log(`   📄 package.json: ${packageJsonPath}`, "blue");
    // logger.log(`   ✅ Esiste: ${fs.existsSync(packageJsonPath)}`, "blue");

    // Verifica se il componente esiste
    if (!fs.existsSync(fullPath)) {
      logger.error(`❌ Directory non trovata: ${fullPath}`, "red");
      errorCount++;
      continue;
    }

    // Verifica se package.json esiste
    if (!fs.existsSync(packageJsonPath)) {
      logger.error(`❌ package.json non trovato in ${componentDir}`, "red");
      errorCount++;
      continue;
    }

    // Leggi package.json una volta per tutto il componente
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Analizza dipendenze condizionali per questo componente specifico
    const { analyzeDependencyUsage } = require("./dependencies/analyzer");
    const usedConditionalDeps = analyzeDependencyUsage(
      fullPath,
      conditionalDeps,
      projectConfig
    );
    const componentConditionalDeps = {};
    usedConditionalDeps.forEach((dep) => {
      componentConditionalDeps[dep.name] = dep.version;
    });

    // Analizza dipendenze dev condizionali per questo componente specifico
    const usedConditionalDevDeps = analyzeDependencyUsage(
      fullPath,
      conditionalDevDeps,
      projectConfig
    );
    const componentConditionalDevDeps = {};
    usedConditionalDevDeps.forEach((dep) => {
      componentConditionalDevDeps[dep.name] = dep.version;
    });

    // Aggiungere conditional deps/devDeps che sono già in package.json
    // (indipendentemente dalla versione - per aggiornamento o conservazione)

    // Per conditional deps
    // Controlliamo sia dependencies che devDependencies
    Object.entries(conditionalDeps).forEach(([name, configVersionValue]) => {
      // Gestire sia stringhe che oggetti (per compatibilità)
      const configVersion = typeof configVersionValue === 'string' 
        ? configVersionValue 
        : (configVersionValue?.version || configVersionValue);
      if (!configVersion) return;
      
      // Controlliamo entrambe le sezioni
      const currentVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
      
      // Aggiungere solo se è già in package.json (in qualsiasi sezione, indipendentemente dalla versione)
      // Questo permette di aggiornare versioni di dipendenze esistenti
      // Se NON trovata nel codice E NON è in package.json - NON aggiungere
      if (currentVersion) {
        if (!componentConditionalDeps[name]) {
          componentConditionalDeps[name] = configVersion;
        }
      }
    });

    // Per conditional devDeps
    // Controlliamo sia devDependencies che dependencies
    Object.entries(conditionalDevDeps).forEach(([name, configVersionValue]) => {
      // Gestire sia stringhe che oggetti (per compatibilità)
      const configVersion = typeof configVersionValue === 'string' 
        ? configVersionValue 
        : (configVersionValue?.version || configVersionValue);
      if (!configVersion) return;
      
      // Controlliamo entrambe le sezioni
      const currentVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
      
      // Aggiungere solo se è già in package.json (in qualsiasi sezione, indipendentemente dalla versione)
      if (currentVersion) {
        if (!componentConditionalDevDeps[name]) {
          componentConditionalDevDeps[name] = configVersion;
        }
      }
    });

    // Determina quali overrides usare per questo componente
    let finalOverrides = {};
    
    if (overrides && Object.keys(overrides).length > 0) {
      // Per tutti gli scope: usa la decisione globale
      if (globalOverridesDecision === true) {
        // Aggiungi tutti gli overrides dal config
        finalOverrides = overrides;
      } else if (globalOverridesDecision === false) {
        // Non aggiungere overrides - usa solo quelli già presenti
        finalOverrides = packageJson.overrides || {};
      } else {
        // Se non c'erano overrides da aggiungere, usa quelli dal config
        finalOverrides = overrides;
      }
    }

    const packageResult = updatePackageJson(
      fullPath,
      projectConfig,
      finalBaseDeps,
      finalDevDeps,
      deprecatedDeps,
      standardScripts,
      nodeEngines,
      componentConditionalDeps,
      componentConditionalDevDeps,
      finalOverrides
    );

    // Formattiamo i log per componente
    if (packageResult.changes) {
      logComponentChanges(packageResult.changes, componentDir);
    }

    // Aggiorna tsconfig.json solo se standardTsConfig non è vuoto
    let tsConfigSuccess = true;
    if (standardTsConfig && Object.keys(standardTsConfig).length > 0) {
      tsConfigSuccess = updateTsConfig(
        fullPath,
        projectConfig,
        standardTsConfig
      );
    } else {
      // Se standardTsConfig è vuoto o undefined, non aggiornare tsconfig.json
      logger.log(
        `ℹ️  tsconfig.json non verrà aggiornato (configurazione non specificata)`,
        "blue",
        projectConfig
      );
    }

    const tslintSuccess = removeTslintJson(fullPath, projectConfig);

    if (packageResult.success && tsConfigSuccess && tslintSuccess) {
      if (packageResult.changes) {
        updatedCount++;
      } else {
        skippedCount++;
      }
    } else {
      errorCount++;
      logger.log(`   ❌ Errore aggiornamento ${componentDir}`, "red");
    }
  }

  logger.log(`\n📊 Risultato:`, "cyan");
  logger.log(`   ✅ Aggiornati: ${updatedCount}/${totalCount}`, "green");
  logger.log(`   ⏭️  Senza modifiche: ${skippedCount}/${totalCount}`, "blue");
  logger.log(
    `   ❌ Errori: ${errorCount}/${totalCount}`,
    errorCount > 0 ? "red" : "green"
  );

  if (errorCount === 0) {
    logger.log(
      "\n🎉 Tutte le configurazioni aggiornate con successo!",
      "green"
    );
    // Chiedi se installare i pacchetti ora
    try {
      const projectConfigPath = path.join(
        process.cwd(),
        "package-manager",
        "project-config.js"
      );
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = require(projectConfigPath);

        const rl = createReadlineInterface();
        const answer = await askQuestion(
          rl,
          "\nVuoi installare i pacchetti adesso? (y/N): "
        );
        rl.close();

        if (answer === "y" || answer === "yes") {
          if (
            projectConfig.workspace?.enabled &&
            projectConfig.workspace?.initialized
          ) {
            // Aggiorna overrides in root package.json per workspace
            if (overrides && Object.keys(overrides).length > 0) {
              const rootPackageJsonPath = path.join(process.cwd(), "package.json");
              if (fs.existsSync(rootPackageJsonPath)) {
                try {
                  const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
                  if (!rootPackageJson.overrides) {
                    rootPackageJson.overrides = {};
                  }
                  let overridesUpdated = false;
                  Object.entries(overrides).forEach(([name, version]) => {
                    if (rootPackageJson.overrides[name] !== version) {
                      rootPackageJson.overrides[name] = version;
                      overridesUpdated = true;
                    }
                  });
                  if (overridesUpdated) {
                    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2), "utf8");
                    logger.log("✅ Overrides aggiornati in root package.json", "green");
                  }
                } catch (error) {
                  logger.warning(`⚠️  Errore aggiornando overrides in root package.json: ${error.message}`);
                }
              }
            }
            
            logger.log(
              "\n🔄 Workspace rilevato - installazione pacchetti centralizzata...",
              "cyan"
            );
            const {
              installAllComponentsWorkspace,
            } = require("./operations/workspace-install");
            const workspaceSuccess = installAllComponentsWorkspace(
              projectConfig,
              "normal"
            );
            if (workspaceSuccess) {
              logger.success("✅ Pacchetti installati tramite workspace!");
            } else {
              logger.warning("⚠️  Errore durante l'installazione workspace");
            }
          } else {
            logger.log("\n🔄 Installazione pacchetti standard...", "cyan");
            const { getComponentDirectories } = require("./utils/common");
            const components = getComponentDirectories(projectConfig);
            let installSuccess = 0;
            for (const component of components) {
              try {
                const componentPath = path.join(process.cwd(), component);
                const {
                  installPackagesStandard,
                } = require("./operations/standard-install");
                const success = installPackagesStandard(
                  componentPath,
                  "normal",
                  projectConfig
                );
                if (success) installSuccess++;
              } catch (error) {
                logger.warning(
                  `⚠️  Errore installazione ${component}: ${error.message}`
                );
              }
            }
            if (installSuccess === components.length) {
              logger.success("✅ Tutti i pacchetti installati con successo!");
            } else {
              logger.warning(
                `⚠️  Installati ${installSuccess}/${components.length} componenti`
              );
            }
          }
        } else {
          logger.info("⏭️  Installazione pacchetti saltata su richiesta");
        }
      }
    } catch (error) {
      logger.warning("⚠️  Errore durante l'installazione pacchetti");
      logger.warning(`   ${error.message}`);
    }
  } else {
    logger.log(
      "\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.",
      "yellow"
    );
  }

  // Pausa per permettere all'utente di leggere i risultati
  logger.log("\n🔙 Premi INVIO per tornare al menu principale...", "cyan");
  const pauseRl = createReadlineInterface();
  await askQuestion(pauseRl, "");
  pauseRl.close();

  return errorCount === 0;
}

// Avvio script
if (require.main === module) {
  updateAllConfigs().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  updateAllConfigs,
  showVersionChanges,
  createEmptyDependenciesConfig,
  reloadDependenciesConfig,
  isDependenciesConfigEmpty,
};
