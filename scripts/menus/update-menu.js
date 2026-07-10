/**
 * Menu "Aggiornamento configurazioni" (anteprima + conferma + esecuzione).
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { versionSatisfiesRange } = require("../utils/version-utils");
const cliContext = require("../cli/context");
const actions = require("../cli/actions");
const { showComponentList } = require("./component-list");

function showUpdateMenu() {
  logger.section("⚙️  Aggiornamento configurazioni");
  logger.info("1. Tutte le web parts");
  logger.info("2. Una web part specifica");
  logger.info("3. Tutte eccetto quelle specificate");
  logger.warning("0. 🔙 Torna al menu principale");

  const rl = cliContext.getRl();
  if (rl) {
    rl.question("\nScegli opzione (0-3): ", (answer) => {
      switch (answer.trim()) {
        case "1":
          showUpdateConfirmation("all", []);
          break;
        case "2":
          showUpdateComponentSelection();
          break;
        case "3":
          showUpdateExcludeSelection();
          break;
        case "0":
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
          break;
        default:
          logger.error("❌ Scelta non valida per aggiornamento");
          setTimeout(() => {
            cliContext.returnToMainMenu();
          }, 100);
      }
    });
  }
}

function showUpdateComponentSelection() {
  const components = showComponentList();
  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      cliContext.returnToMainMenu();
    }, 100);
    return;
  }

  const rl = cliContext.getRl();
  if (rl) {
    rl.question(`\nScegli componente (1-${components.length}): `, (answer) => {
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        showUpdateConfirmation("single", [selectedComponent]);
      } else {
        logger.error("❌ Componente non valido");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
      }
    });
  }
}

function showUpdateExcludeSelection() {
  const components = showComponentList();
  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    setTimeout(() => {
      cliContext.returnToMainMenu();
    }, 100);
    return;
  }

  const rl = cliContext.getRl();
  if (rl) {
    rl.question("\nInserisci i nomi dei componenti da escludere (separati da spazio): ", (answer) => {
      const excludeList = answer
        .trim()
        .split(/\s+/)
        .filter((name) => name.length > 0);
      const validExcludes = excludeList.filter((name) => components.includes(name));

      if (validExcludes.length > 0) {
        showUpdateConfirmation("exclude", validExcludes);
      } else {
        logger.error("❌ Nessun componente valido specificato");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 100);
      }
    });
  }
}

async function showUpdateConfirmation(scope, components) {
  // Prima mostra cosa verrà aggiornato
  const previewResult = await showUpdatePreview(scope, components);

  // Se il config è vuoto (template), non chiedere conferma - vai direttamente alla generazione
  if (previewResult && previewResult.isEmpty) {
    logger.log("\n🚀 Avvio generazione configurazione...", "cyan");
    const success = await actions.updateAllConfigs(scope, components);
    if (!success) {
      logger.log("🔄 Ritorno al menu principale...", "cyan");
    }
    setTimeout(() => {
      cliContext.returnToMainMenu();
    }, 100);
    return;
  }

  // Se non ci sono modifiche da applicare, non chiedere conferma e torna al menu
  if (previewResult && previewResult.totalChanges === 0) {
    logger.log("\n✅ Nessuna modifica da applicare.", "green");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");
    const rl = cliContext.getRl();
    if (!rl) return;
    rl.question("", () => {
      cliContext.returnToMainMenu();
    });
    return;
  }

  const rl = cliContext.getRl();
  if (rl) {
    rl.question("\n⚠️  Continuare con l'aggiornamento? (y/N): ", async (confirm) => {
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        logger.log("\n🚀 Avvio aggiornamento...", "cyan");
        const success = await actions.updateAllConfigs(scope, components);
        if (!success) {
          logger.log("🔄 Ritorno al menu principale...", "cyan");
        }
      } else {
        logger.log("❌ Aggiornamento annullato", "yellow");
      }
      setTimeout(() => {
        cliContext.returnToMainMenu();
      }, 100);
    });
  }
}

async function showUpdatePreview(scope, components) {
  const projectRoot = cliContext.getProjectRoot();
  const projectConfig = cliContext.getProjectConfig();

  logger.section("📋 Anteprima aggiornamento");

  // Carica la configurazione per mostrare cosa verrà aggiornato
  const dependenciesConfigPath = path.join(projectRoot, "package-manager", "dependencies-config.js");

  if (!fs.existsSync(dependenciesConfigPath)) {
    logger.error("❌ dependencies-config.js non trovato!");
    return { isEmpty: true };
  }

  const { isDependenciesConfigEmpty, reloadDependenciesConfig } = require("../update-configs");

  // Verifica se il config è vuoto (template)
  if (isDependenciesConfigEmpty(projectRoot)) {
    logger.log("⚠️  dependencies-config.js è vuoto (template)!", "yellow");
    return { isEmpty: true };
  }

  try {
    // Ricarica il modulo dependencies-config usando reloadDependenciesConfig
    // che risolve automaticamente i duplicati e usa la versione più alta
    // Non mostriamo i duplicati durante l'aggiornamento (silent mode)
    const depsFunctions = reloadDependenciesConfig(projectRoot, { showDuplicates: false });

    if (!depsFunctions) {
      logger.error("❌ Errore caricando configurazione dipendenze");
      return { isEmpty: true };
    }

    // Usa le funzioni già risolte da reloadDependenciesConfig
    // Queste funzioni restituiscono versioni già allineate (con la più alta per duplicati)
    const baseDeps = depsFunctions.getBaseDependencies();
    const devDeps = depsFunctions.getDevDependencies();
    const scripts = depsFunctions.getStandardScripts();
    const deprecatedDeps = depsFunctions.getDeprecatedDependencies();
    const conditionalDeps = depsFunctions.getConditionalDependencies();
    const conditionalDevDeps = depsFunctions.getConditionalDevDependencies();

    // Log per debug
    if (Object.keys(conditionalDeps).length > 0) {
      logger.log(`🔍 Trovate ${Object.keys(conditionalDeps).length} dipendenze condizionali`, "blue");
    }
    if (Object.keys(conditionalDevDeps).length > 0) {
      logger.log(`🔍 Trovate ${Object.keys(conditionalDevDeps).length} dev dipendenze condizionali`, "blue");
    }

    // Determina i componenti che verranno aggiornati
    const { getComponentDirectories } = require("../dependencies/analyzer");
    let targetComponents = getComponentDirectories(projectConfig);

    if (scope === "single" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => components.includes(comp));
    } else if (scope === "exclude" && components.length > 0) {
      targetComponents = targetComponents.filter((comp) => !components.includes(comp));
    }

    // Analizza le modifiche per ogni componente
    let totalNewDeps = 0;
    let totalUpdatedDeps = 0;
    let totalNewDevDeps = 0;
    let totalUpdatedDevDeps = 0;
    let totalDeprecatedToRemove = 0;
    let totalScriptsToUpdate = 0;

    for (const component of targetComponents) {
      const componentPath = path.join(projectRoot, component);
      const packageJsonPath = path.join(componentPath, "package.json");

      if (!fs.existsSync(packageJsonPath)) {
        logger.warning(`⚠️  package.json non trovato per ${component}`, "yellow");
        continue;
      }

      try {
        const currentPkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const currentDeps = currentPkg.dependencies || {};
        const currentDevDeps = currentPkg.devDependencies || {};
        const currentScripts = currentPkg.scripts || {};

        // Analizza dependencies (base + conditional per questo componente)
        const usedConditionalDeps = analyzeDependencyUsageForComponent(componentPath, conditionalDeps);
        // Aggiungi conditional deps che sono già in package.json
        // (indipendentemente dalla versione - per aggiornamento o conservazione)
        // Controlliamo sia dependencies che devDependencies
        Object.entries(conditionalDeps).forEach(([name, configVersion]) => {
          const currentVersion = currentDeps[name] || currentDevDeps[name];
          // Aggiungi solo se già in package.json (in qualsiasi sezione)
          // Se NON trovata nel codice E NON è in package.json - NON aggiungere
          if (currentVersion) {
            if (!usedConditionalDeps[name]) {
              usedConditionalDeps[name] = configVersion;
            }
          }
        });
        const targetDeps = { ...baseDeps, ...usedConditionalDeps };

        // Analizza dependencies: mostra aggiornamenti solo se il pacchetto è già in dependencies
        // Se il pacchetto è in devDependencies, lo gestiremo quando analizziamo devDependencies
        const { newDeps, updatedDeps } = analyzeDependencies(currentDeps, targetDeps, currentDevDeps);

        totalNewDeps += newDeps.length;
        totalUpdatedDeps += updatedDeps.length;

        // Analizza devDependencies (base + conditional per questo componente)
        const usedConditionalDevDeps = analyzeDependencyUsageForComponent(componentPath, conditionalDevDeps);
        // Aggiungere conditional devDeps che sono già in package.json
        // (indipendentemente dalla versione - per aggiornamento o conservazione)
        // Controlliamo sia devDependencies che dependencies
        Object.entries(conditionalDevDeps).forEach(([name, configVersion]) => {
          const currentVersion = currentDevDeps[name] || currentDeps[name];
          // Aggiungere solo se è già in package.json (in qualsiasi sezione)
          // Se NON trovata nel codice E NON è in package.json - NON aggiungere
          if (currentVersion) {
            if (!usedConditionalDevDeps[name]) {
              usedConditionalDevDeps[name] = configVersion;
            }
          }
        });
        const targetDevDeps = { ...devDeps, ...usedConditionalDevDeps };

        // Analizza devDependencies: mostra aggiornamenti solo se il pacchetto è già in devDependencies
        // Ma anche controlla se alcuni pacchetti da CONDITIONAL_DEPENDENCIES sono in devDependencies
        // e devono essere aggiornati qui
        const { newDeps: newDevDeps, updatedDeps: updatedDevDeps } = analyzeDependencies(
          currentDevDeps,
          targetDevDeps,
          currentDeps
        );

        // IMPORTANTE: Se un pacchetto da CONDITIONAL_DEPENDENCIES è in devDependencies,
        // dobbiamo aggiornarlo in devDependencies, non in dependencies
        // Usiamo la versione da conditionalDevDeps (che dopo il resolve ha la versione più alta)
        Object.entries(conditionalDeps).forEach(([name, configVersion]) => {
          // Se il pacchetto è in devDependencies ma non in dependencies
          if (currentDevDeps[name] && !currentDeps[name]) {
            // Usa la versione da conditionalDevDeps (se esiste, altrimenti da conditionalDeps)
            // Dopo resolveDuplicateDependencies, entrambe hanno la versione più alta
            const targetVersion = conditionalDevDeps[name] || configVersion;
            // Verifica se la versione in devDependencies non soddisfa il range target
            if (!versionSatisfiesRange(currentDevDeps[name], targetVersion)) {
              updatedDevDeps.push([name, currentDevDeps[name], targetVersion]);
            }
          }
        });

        // IMPORTANTE: Se un pacchetto da CONDITIONAL_DEV_DEPENDENCIES è in dependencies,
        // dobbiamo aggiornarlo in dependencies, non in devDependencies
        // Usiamo la versione da conditionalDeps (che dopo il resolve ha la versione più alta)
        Object.entries(conditionalDevDeps).forEach(([name, configVersion]) => {
          // Se il pacchetto è in dependencies ma non in devDependencies
          if (currentDeps[name] && !currentDevDeps[name]) {
            // Usa la versione da conditionalDeps (se esiste, altrimenti da conditionalDevDeps)
            // Dopo resolveDuplicateDependencies, entrambe hanno la versione più alta
            const targetVersion = conditionalDeps[name] || configVersion;
            // Verifica se la versione in dependencies non soddisfa il range target
            if (!versionSatisfiesRange(currentDeps[name], targetVersion)) {
              updatedDeps.push([name, currentDeps[name], targetVersion]);
            }
          }
        });

        totalNewDevDeps += newDevDeps.length;
        totalUpdatedDevDeps += updatedDevDeps.length;

        // Analizza deprecated dependencies
        const deprecatedToRemove = deprecatedDeps.filter((dep) => currentDeps[dep] || currentDevDeps[dep]);
        totalDeprecatedToRemove += deprecatedToRemove.length;

        // Analizza scripts
        const scriptsToUpdate = Object.entries(scripts).filter(
          ([name, script]) => !currentScripts[name] || currentScripts[name] !== script
        );
        totalScriptsToUpdate += scriptsToUpdate.length;

        // Mostra dettagli solo se ci sono modifiche per questo componente
        if (
          newDeps.length > 0 ||
          updatedDeps.length > 0 ||
          newDevDeps.length > 0 ||
          updatedDevDeps.length > 0 ||
          deprecatedToRemove.length > 0 ||
          scriptsToUpdate.length > 0
        ) {
          logger.log(`\n📦 ${component}:`, "blue");

          if (newDeps.length > 0) {
            logger.log(`   🆕 Nuove dipendenze (${newDeps.length}):`, "green");
            newDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "green");
            });
          }

          if (updatedDeps.length > 0) {
            logger.log(`   🔄 Dipendenze da aggiornare (${updatedDeps.length}):`, "yellow");
            updatedDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(`      ${name}: ${currentVersion} → ${newVersion}`, "yellow");
            });
          }

          if (newDevDeps.length > 0) {
            logger.log(`   🆕 Nuove devDependencies (${newDevDeps.length}):`, "cyan");
            newDevDeps.forEach(([name, version]) => {
              logger.log(`      + ${name}@${version}`, "cyan");
            });
          }

          if (updatedDevDeps.length > 0) {
            logger.log(`   🔄 DevDependencies da aggiornare (${updatedDevDeps.length}):`, "yellow");
            updatedDevDeps.forEach(([name, currentVersion, newVersion]) => {
              logger.log(`      ${name}: ${currentVersion} → ${newVersion}`, "yellow");
            });
          }

          if (deprecatedToRemove.length > 0) {
            logger.log(`   🗑️  Deprecated da rimuovere (${deprecatedToRemove.length}):`, "red");
            deprecatedToRemove.forEach((dep) => {
              const currentVersion = currentDeps[dep] || currentDevDeps[dep];
              logger.log(`      - ${dep}@${currentVersion}`, "red");
            });
          }

          if (scriptsToUpdate.length > 0) {
            logger.log(`   📝 Scripts da aggiornare (${scriptsToUpdate.length}):`, "magenta");
            scriptsToUpdate.forEach(([name, newScript]) => {
              const currentScript = currentScripts[name] || "(non presente)";
              logger.log(`      ${name}: "${currentScript}" → "${newScript}"`, "magenta");
            });
          }
        } else {
          logger.log(`\n✅ ${component}: nessuna modifica necessaria`, "green");
        }
      } catch (error) {
        logger.error(`❌ Errore analizzando ${component}: ${error.message}`);
      }
    }

    // Riepilogo finale
    logger.log(`\n📊 Riepilogo modifiche:`, "blue");
    if (totalNewDeps > 0) logger.log(`   🆕 Nuove dipendenze: ${totalNewDeps}`, "green");
    if (totalUpdatedDeps > 0) logger.log(`   🔄 Dipendenze aggiornate: ${totalUpdatedDeps}`, "yellow");
    if (totalNewDevDeps > 0) logger.log(`   🆕 Nuove devDependencies: ${totalNewDevDeps}`, "cyan");
    if (totalUpdatedDevDeps > 0) logger.log(`   🔄 DevDependencies aggiornate: ${totalUpdatedDevDeps}`, "yellow");
    if (totalDeprecatedToRemove > 0) logger.log(`   🗑️  Deprecated rimosse: ${totalDeprecatedToRemove}`, "red");
    if (totalScriptsToUpdate > 0) logger.log(`   📝 Scripts aggiornati: ${totalScriptsToUpdate}`, "magenta");

    const totalChanges =
      totalNewDeps + totalUpdatedDeps + totalNewDevDeps + totalUpdatedDevDeps + totalDeprecatedToRemove + totalScriptsToUpdate;
    if (totalChanges === 0) {
      logger.log(`\n✅ Tutti i componenti sono già aggiornati!`, "green");
    }

    return { isEmpty: false, totalChanges };
  } catch (error) {
    logger.error(`❌ Errore caricando configurazione: ${error.message}`);
    logger.warning("💡 Assicurati che dependencies-config.js contenga tutte le funzioni necessarie");
    return { isEmpty: true };
  }
}

function analyzeDependencies(currentDeps, targetDeps, currentOtherDeps = {}) {
  const newDeps = [];
  const updatedDeps = [];

  for (const [name, targetVersion] of Object.entries(targetDeps)) {
    // Controlliamo prima nel sezione corrente
    if (currentDeps[name]) {
      // Se la versione non soddisfa il range target - è un aggiornamento
      // IMPORTANTE: mostriamo aggiornamento solo se il pacchetto è già nella sezione corrente
      if (!versionSatisfiesRange(currentDeps[name], targetVersion)) {
        updatedDeps.push([name, currentDeps[name], targetVersion]);
      }
      // Se la versione soddisfa il range - non facciamo nulla
    } else if (currentOtherDeps[name]) {
      // Il pacchetto è già nell'altra sezione (dependencies/devDependencies)
      // NON lo mostriamo come aggiornamento nella sezione corrente, perché non è presente qui
      // Se l'utente vuole spostarlo o aggiornarlo, lo farà manualmente o attraverso l'altra sezione
      // Non aggiungiamo né a newDeps né a updatedDeps
    } else {
      // Il pacchetto non è stato trovato né in dependencies né in devDependencies - è una nuova dipendenza
      newDeps.push([name, targetVersion]);
    }
  }

  return { newDeps, updatedDeps };
}

function analyzeDependencyUsageForComponent(componentPath, conditionalDeps) {
  const usedDeps = {};

  Object.entries(conditionalDeps).forEach(([depName, version]) => {
    // Se è un oggetto (vecchio formato), usa la logica originale
    if (typeof version === "object" && version !== null) {
      const patterns = version.patterns || [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps[depName] = version.version;
      }
    } else {
      // Se è una stringa (nuovo formato), usa solo il nome del pacchetto
      const patterns = [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps[depName] = version;
      }
    }
  });

  return usedDeps;
}

function scanDirectoryForPatterns(dirPath, patterns, extensions = [".js", ".ts", ".tsx", ".jsx"]) {
  const results = new Set();

  function extractImports(content) {
    const imports = new Set();
    const importPatterns = [
      /import\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
      /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /\bdefine\(\s*\[([^\]]+)\]/g,
    ];

    for (const rx of importPatterns) {
      let m;
      while ((m = rx.exec(content))) {
        if (rx === importPatterns[3]) {
          // AMD array
          const arr = m[1].split(",").map((s) => s.trim().replace(/['"`]/g, ""));
          arr.forEach((name) => {
            if (name && !name.startsWith(".") && !name.startsWith("/")) {
              const root = name.split("/")[0].startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
              if (root) imports.add(root);
            }
          });
        } else {
          const name = m[1].trim().replace(/['"`]/g, "");
          if (name && !name.startsWith(".") && !name.startsWith("/")) {
            const root = name.split("/")[0].startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
            if (root) imports.add(root);
          }
        }
      }
    }
    return Array.from(imports);
  }

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const imports = extractImports(content);

      patterns.forEach((pattern) => {
        // Controllo tramite import (più preciso)
        if (imports.includes(pattern)) {
          results.add(pattern);
        }
        // Fallback: semplice ricerca per vecchi formati con patterns
        else if (content.includes(pattern)) {
          results.add(pattern);
        }
      });
    } catch (error) {
      // Ignora errori di lettura file
    }
  }

  function scanDirectory(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);
      items.forEach((item) => {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Salta node_modules e altre cartelle da ignorare
          if (!["node_modules", ".git", "dist", "build"].includes(item)) {
            scanDirectory(fullPath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item);
          if (extensions.includes(ext)) {
            scanFile(fullPath);
          }
        }
      });
    } catch (error) {
      // Ignora errori di accesso directory
    }
  }

  scanDirectory(dirPath);

  return Array.from(results);
}

module.exports = {
  showUpdateMenu,
  showUpdateComponentSelection,
  showUpdateExcludeSelection,
  showUpdateConfirmation,
  showUpdatePreview,
  analyzeDependencies,
  analyzeDependencyUsageForComponent,
  scanDirectoryForPatterns,
};
