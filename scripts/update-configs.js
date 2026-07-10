#!/usr/bin/env node

/**
 * Script cross-platform per aggiornare package.json e tsconfig.json
 * basato sulle dipendenze del calendario per tutti i componenti
 *
 * Questo file è un orchestratore "sottile": la logica è divisa in moduli
 * dedicati, importati qui sotto:
 *  - dependencies/config-loader.js  → caricamento/generazione dependencies-config.js
 *  - dependencies/update-preview.js → anteprima modifiche + log per componente
 *  - dependencies/overrides-manager.js → proposta/persistenza OVERRIDES
 *  - dependencies/updater.js        → applicazione effettiva a package.json/tsconfig.json
 *  - cli/prompt.js                  → helper readline condivisi
 */

const fs = require("fs");
const path = require("path");

const logger = require("./utils/logger");
const { createReadlineInterface, askQuestion } = require("./cli/prompt");
const { getComponentDirectories } = require("./utils/common");

const {
  createEmptyDependenciesConfig,
  reloadDependenciesConfig,
  isDependenciesConfigEmpty,
  ensureDependenciesConfigReady,
} = require("./dependencies/config-loader");
const { showVersionChanges, logComponentChanges } = require("./dependencies/update-preview");
const {
  proposeOverridesForUpdatedPackages,
  confirmApplyOverridesToComponents,
} = require("./dependencies/overrides-manager");
const { analyzeDependencyUsage } = require("./dependencies/analyzer");
const { updatePackageJson, updateTsConfig, removeTslintJson } = require("./dependencies/updater");

const projectRoot = process.cwd();
const projectConfig = require(path.join(projectRoot, "package-manager/project-config.js"));

// Funzione principale per aggiornare tutte le configurazioni
async function updateAllConfigs(scope = "all", components = []) {
  logger.log("🚀 Avvio aggiornamento configurazioni componenti...", "cyan");

  // Clear all cached modules to ensure fresh loading
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("dependencies-config") || key.includes("project-config")) {
      delete require.cache[key];
    }
  });

  // 1-4. Verifica/crea/genera dependencies-config.js se manca o è vuoto
  const readiness = await ensureDependenciesConfigReady(projectRoot, projectConfig);
  if (!readiness.proceed) {
    return false;
  }

  // 5. Carica la configurazione dopo la verifica/generazione
  const depsFunctions = reloadDependenciesConfig(projectRoot);
  if (!depsFunctions) {
    logger.error("❌ Errore caricando configurazione dipendenze");
    return false;
  }

  const baseDeps = depsFunctions.getBaseDependencies();
  const conditionalDeps = depsFunctions.getConditionalDependencies();
  const devDeps = depsFunctions.getDevDependencies();
  const conditionalDevDeps = depsFunctions.getConditionalDevDependencies();

  // Non aggiungere più tutte le dipendenze condizionali globalmente
  // Verranno processate per ogni componente individualmente
  const finalBaseDeps = { ...baseDeps };
  const finalDevDeps = { ...devDeps };

  const standardScripts = depsFunctions.getStandardScripts();
  let standardTsConfig = depsFunctions.getStandardTsConfig();
  const nodeEngines = depsFunctions.getNodeEngines();
  let overrides = depsFunctions.getOverrides();
  const deprecatedDeps = depsFunctions.getDeprecatedDependencies();

  // Ottieni componenti con filtrazione
  let componentDirs = getComponentDirectories(projectConfig);

  // Applica filtrazione basata su scope e components
  if (scope === "single" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => components.includes(dir));
  } else if (scope === "exclude" && components.length > 0) {
    componentDirs = componentDirs.filter((dir) => !components.includes(dir));
  }

  if (componentDirs.length === 0) {
    logger.log("❌ Nessun componente trovato", "red");
    return false;
  }

  // Conferma aggiornamento tsconfig
  if (Object.keys(standardTsConfig).length > 0) {
    logger.log("\ntsconfig.json sarà aggiornato secondo STANDARD_TSCONFIG", "yellow");

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
    logger.log("🔀 DIPENDENZE CONDIZIONALI che verranno aggiunte (se utilizzate):", "yellow");
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
    logger.log("🔀 DIPENDENZE DEV CONDIZIONALI che verranno aggiunte (se utilizzate):", "yellow");
    Object.entries(conditionalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue");
    });
    logger.log("", "reset");
  }

  // Mostra tsconfig standard se disponibile (rispetta lo skip deciso sopra)
  if (standardTsConfig && Object.keys(standardTsConfig).length > 0) {
    logger.log("⚙️  TSCONFIG.JSON STANDARD che verrà applicato:", "yellow");
    logger.log(`   Target: ${standardTsConfig.compilerOptions?.target || "es2018"}`, "blue");
    logger.log(`   Module: ${standardTsConfig.compilerOptions?.module || "commonjs"}`, "blue");
    logger.log(`   Strict: ${standardTsConfig.compilerOptions?.strict || true}`, "blue");
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

  const hasChanges = versionChangesResult.hasChanges || Object.keys(standardTsConfig).length > 0;
  const componentChanges = versionChangesResult.componentChanges || {};

  if (!hasChanges) {
    logger.log("\n✅ Tutti i componenti sono già aggiornati!", "green");
    logger.log("🔙 Premi INVIO per tornare al menu principale...", "cyan");
    const pauseRl = createReadlineInterface();
    await askQuestion(pauseRl, "");
    pauseRl.close();
    return true;
  }

  // Proponi di aggiungere agli overrides i pacchetti aggiornati che non ci sono ancora
  // (solo se ci sono già overrides definiti nel config)
  overrides = await proposeOverridesForUpdatedPackages(componentChanges, overrides, projectRoot);

  // Per tutti gli scope: chiedi una volta se vuoi aggiungere gli overrides esistenti
  // ai componenti che non li hanno ancora
  const globalOverridesDecision = await confirmApplyOverridesToComponents(componentDirs, overrides, scope);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const totalCount = componentDirs.length;

  for (const componentDir of componentDirs) {
    const fullPath = path.join(process.cwd(), componentDir);
    const packageJsonPath = path.join(fullPath, "package.json");

    if (!fs.existsSync(fullPath)) {
      logger.error(`❌ Directory non trovata: ${fullPath}`, "red");
      errorCount++;
      continue;
    }

    if (!fs.existsSync(packageJsonPath)) {
      logger.error(`❌ package.json non trovato in ${componentDir}`, "red");
      errorCount++;
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Analizza dipendenze condizionali per questo componente specifico
    const usedConditionalDeps = analyzeDependencyUsage(fullPath, conditionalDeps, projectConfig);
    const componentConditionalDeps = {};
    usedConditionalDeps.forEach((dep) => {
      componentConditionalDeps[dep.name] = dep.version;
    });

    // BASE_DEPENDENCIES: per default sono "sempre necessarie", ma se un nuovo
    // pacchetto viene promosso a BASE (perché usato in tutti gli altri
    // componenti) non deve essere installato a forza in un componente che
    // non lo usa affatto e non lo ha già in package.json. Applichiamo quindi
    // lo stesso "usage gate" usato per le CONDITIONAL_DEPENDENCIES.
    // NOTA: questo non si applica a DEV_DEPENDENCIES (build tool come gulp,
    // typescript, eslint...) perché quelli sono richiamati da script/CLI e
    // quasi mai tramite import/require statico: il gate li rimuoverebbe
    // erroneamente ovunque.
    const usedBaseDeps = analyzeDependencyUsage(fullPath, finalBaseDeps, projectConfig);
    const componentBaseDeps = {};
    usedBaseDeps.forEach((dep) => {
      componentBaseDeps[dep.name] = dep.version;
    });
    Object.entries(finalBaseDeps).forEach(([name, version]) => {
      const alreadyPresent = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
      // Già presente in un progetto (in qualsiasi sezione): conserviamo/aggiorniamo
      // sempre, indipendentemente dal rilevamento d'uso (evita falsi negativi).
      // Se NON è presente E NON è rilevato come usato, non lo aggiungiamo.
      if (alreadyPresent && !componentBaseDeps[name]) {
        componentBaseDeps[name] = version;
      }
    });

    // Analizza dipendenze dev condizionali per questo componente specifico
    const usedConditionalDevDeps = analyzeDependencyUsage(fullPath, conditionalDevDeps, projectConfig);
    const componentConditionalDevDeps = {};
    usedConditionalDevDeps.forEach((dep) => {
      componentConditionalDevDeps[dep.name] = dep.version;
    });

    // Aggiungere conditional deps/devDeps che sono già in package.json
    // (indipendentemente dalla versione - per aggiornamento o conservazione)
    // Controlliamo sia dependencies che devDependencies
    Object.entries(conditionalDeps).forEach(([name, configVersionValue]) => {
      const configVersion =
        typeof configVersionValue === "string" ? configVersionValue : configVersionValue?.version || configVersionValue;
      if (!configVersion) return;

      const currentVersion = packageJson.dependencies?.[name] || packageJson.devDependencies?.[name];
      if (currentVersion && !componentConditionalDeps[name]) {
        componentConditionalDeps[name] = configVersion;
      }
    });

    // Per conditional devDeps: controlliamo sia devDependencies che dependencies
    Object.entries(conditionalDevDeps).forEach(([name, configVersionValue]) => {
      const configVersion =
        typeof configVersionValue === "string" ? configVersionValue : configVersionValue?.version || configVersionValue;
      if (!configVersion) return;

      const currentVersion = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name];
      if (currentVersion && !componentConditionalDevDeps[name]) {
        componentConditionalDevDeps[name] = configVersion;
      }
    });

    // Determina quali overrides usare per questo componente
    let finalOverrides = {};
    if (overrides && Object.keys(overrides).length > 0) {
      if (globalOverridesDecision === false) {
        // Non aggiungere overrides - usa solo quelli già presenti
        finalOverrides = packageJson.overrides || {};
      } else {
        // true o null (nessuna decisione richiesta): usa quelli dal config
        finalOverrides = overrides;
      }
    }

    const packageResult = updatePackageJson(
      fullPath,
      projectConfig,
      componentBaseDeps,
      finalDevDeps,
      deprecatedDeps,
      standardScripts,
      nodeEngines,
      componentConditionalDeps,
      componentConditionalDevDeps,
      finalOverrides
    );

    if (packageResult.changes) {
      logComponentChanges(packageResult.changes, componentDir);
    }

    // Aggiorna tsconfig.json solo se standardTsConfig non è vuoto
    let tsConfigSuccess = true;
    if (standardTsConfig && Object.keys(standardTsConfig).length > 0) {
      tsConfigSuccess = updateTsConfig(fullPath, projectConfig, standardTsConfig);
    } else {
      logger.log(`ℹ️  tsconfig.json non verrà aggiornato (configurazione non specificata)`, "blue", projectConfig);
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
  logger.log(`   ❌ Errori: ${errorCount}/${totalCount}`, errorCount > 0 ? "red" : "green");

  if (errorCount === 0) {
    logger.log("\n🎉 Tutte le configurazioni aggiornate con successo!", "green");
    await promptInstallPackages(overrides);
  } else {
    logger.log("\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.", "yellow");
  }

  // Pausa per permettere all'utente di leggere i risultati
  logger.log("\n🔙 Premi INVIO per tornare al menu principale...", "cyan");
  const pauseRl = createReadlineInterface();
  await askQuestion(pauseRl, "");
  pauseRl.close();

  return errorCount === 0;
}

// Chiede se installare i pacchetti subito dopo l'aggiornamento dei config,
// e delega all'installazione workspace o standard in base alla configurazione.
async function promptInstallPackages(overrides) {
  try {
    const projectConfigPath = path.join(process.cwd(), "package-manager", "project-config.js");
    if (!fs.existsSync(projectConfigPath)) return;

    const currentProjectConfig = require(projectConfigPath);

    const rl = createReadlineInterface();
    const answer = await askQuestion(rl, "\nVuoi installare i pacchetti adesso? (y/N): ");
    rl.close();

    if (answer !== "y" && answer !== "yes") {
      logger.info("⏭️  Installazione pacchetti saltata su richiesta");
      return;
    }

    if (currentProjectConfig.workspace?.enabled && currentProjectConfig.workspace?.initialized) {
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

      logger.log("\n🔄 Workspace rilevato - installazione pacchetti centralizzata...", "cyan");
      const { installAllComponentsWorkspace } = require("./operations/workspace-install");
      const workspaceSuccess = installAllComponentsWorkspace(currentProjectConfig, "normal");
      if (workspaceSuccess) {
        logger.success("✅ Pacchetti installati tramite workspace!");
      } else {
        logger.warning("⚠️  Errore durante l'installazione workspace");
      }
    } else {
      logger.log("\n🔄 Installazione pacchetti standard...", "cyan");
      const componentsToInstall = getComponentDirectories(currentProjectConfig);
      const { installPackagesStandard } = require("./operations/standard-install");
      let installSuccess = 0;
      for (const component of componentsToInstall) {
        try {
          const componentPath = path.join(process.cwd(), component);
          const success = installPackagesStandard(componentPath, "normal", currentProjectConfig);
          if (success) installSuccess++;
        } catch (error) {
          logger.warning(`⚠️  Errore installazione ${component}: ${error.message}`);
        }
      }
      if (installSuccess === componentsToInstall.length) {
        logger.success("✅ Tutti i pacchetti installati con successo!");
      } else {
        logger.warning(`⚠️  Installati ${installSuccess}/${componentsToInstall.length} componenti`);
      }
    }
  } catch (error) {
    logger.warning("⚠️  Errore durante l'installazione pacchetti");
    logger.warning(`   ${error.message}`);
  }
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
