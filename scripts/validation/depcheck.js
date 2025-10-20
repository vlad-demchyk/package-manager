#!/usr/bin/env node

/**
 * Script per il controllo delle dipendenze non utilizzate
 * Versione conservativa e sicura per tutti i tipi di progetti
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// Import shared logger
const logger = require("../utils/logger");

// Carica la configurazione del progetto dinamicamente
const projectRoot = process.cwd();
const projectConfig = require(path.join(
  projectRoot,
  "package-manager/project-config"
));

// Variabili globali per readline
let rl = null;

// Cerca riferimenti a una dipendenza nei file di configurazione comuni
function isReferencedInConfigFiles(componentPath, dependencyName) {
  try {
    const configFiles = [
      "next.config.js",
      "next.config.ts",
      "tailwind.config.js",
      "tailwind.config.ts",
      "postcss.config.js",
      "postcss.config.mjs",
      "webpack.config.js",
      "webpack.config.ts",
      "vite.config.js",
      "vite.config.ts",
      "babel.config.js",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.json",
      "postcss.config.mjs",
      "tsconfig.json",
      "package.json",
    ];

    for (const fileName of configFiles) {
      const filePath = path.join(componentPath, fileName);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf8");

      // Riutilizziamo lo stesso controllo di analyzeDependencyUsage per cercare la dipendenza
      const patterns = [
        new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
        new RegExp(`import\\s+['"]${dependencyName}['"]`, "gi"),
        new RegExp(`require\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
        new RegExp(`['"]${dependencyName}['"]`, "gi"),
      ];

      for (const pattern of patterns) {
        if (pattern.test(content)) return true;
      }
    }

    return false;
  } catch (e) {
    // In caso di errore conservativo, consideriamo la dipendenza come referenziata
    return true;
  }
}

function isWindows() {
  return process.platform === "win32";
}

function getNpmCommand() {
  return isWindows()
    ? projectConfig.commands.npm.windows
    : projectConfig.commands.npm.unix;
}

// Ottieni la lista dei componenti
function getComponentDirectories() {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);

  return items.filter((item) => {
    const fullPath = path.join(currentDir, item);

    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }

    // Controllo per prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        return false;
      }
    }

    // Controllo per struttura
    if (projectConfig.components.filterByStructure.enabled) {
      const requiredFiles =
        projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders =
        projectConfig.components.filterByStructure.requiredFolders;

      for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, file))) {
          return false;
        }
      }

      for (const folder of requiredFolders) {
        const folderPath = path.join(fullPath, folder);
        if (
          !fs.existsSync(folderPath) ||
          !fs.statSync(folderPath).isDirectory()
        ) {
          return false;
        }
      }
    }

    // Controllo per lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        return false;
      }
    }

    // Controllo per regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        return false;
      }
    }

    // Controlliamo sempre la presenza di package.json
    return fs.existsSync(path.join(fullPath, projectConfig.files.packageJson));
  });
}

// Configurazione sicura per diversi tipi di progetti
const SAFE_DEPENDENCY_RULES = {
  // Regole universali - sempre sicure da rimuovere
  universal: {
    // Pacchetti di test che non sono mai utilizzati nel codice di produzione
    testPackages: [
      "@testing-library/dom",
      "@testing-library/jest-dom",
      "@testing-library/react",
      "@testing-library/user-event",
      "jest",
      "mocha",
      "chai",
      "karma",
      "jasmine",
      "protractor",
      "cypress",
      "playwright",
    ],

    // Pacchetti di build che sono solo per sviluppo
    buildOnlyPackages: [
      "gh-pages",
      "ts-loader",
      "webpack-cli",
      "webpack-dev-server",
    ],

    // Pacchetti che sono solo per deployment
    deploymentPackages: ["gh-pages", "vercel", "netlify-cli"],
  },

  // Regole specifiche per SharePoint/SPFx
  sharepoint: {
    alwaysKeep: [
      "@microsoft/sp-",
      "@microsoft/rush-stack-",
      "gulp",
      "webpack",
      "typescript",
      "eslint",
    ],
  },

  // Regole specifiche per React
  react: {
    alwaysKeep: ["react", "react-dom", "react-scripts"],
    conditionalKeep: ["styled-components", "emotion", "css-in-js"],
  },

  // Regole specifiche per Next.js
  nextjs: {
    alwaysKeep: [
      "next",
      "react",
      "react-dom",
      "next-images",
      "next-seo",
      "next-auth",
    ],
    devAlwaysKeep: [
      "@types/react",
      "@types/react-dom",
      "@types/node",
      "typescript",
      "eslint",
      "eslint-config-next",
      "tailwindcss",
      "postcss",
      "autoprefixer",
    ],
  },

  // Regole specifiche per WordPress
  wordpress: {
    alwaysKeep: ["wp-", "wordpress", "gutenberg"],
  },

  // Regole specifiche per Vue.js
  vue: {
    alwaysKeep: ["vue", "@vue/cli", "vue-loader"],
  },

  // Regole specifiche per Angular
  angular: {
    alwaysKeep: ["@angular/", "ng-"],
  },
};

// Funzione per rilevare il tipo di progetto
function detectProjectType(componentPath) {
  const packageJsonPath = path.join(componentPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    // package.json non trovato - silenzioso
    return "unknown";
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const depNames = Object.keys(dependencies);

    // Analizzando dipendenze - silenzioso

    // Rileva SharePoint/SPFx
    if (
      depNames.some(
        (dep) =>
          dep.includes("@microsoft/sp-") ||
          dep.includes("@microsoft/rush-stack-")
      )
    ) {
      // Rilevato SharePoint/SPFx - silenzioso
      return "sharepoint";
    }

    // Rileva Next.js
    if (
      dependencies.next ||
      dependencies["next-images"] ||
      dependencies["next-seo"]
    ) {
      // Rilevato Next.js - silenzioso
      return "nextjs";
    }

    // Rileva React
    if (
      dependencies.react ||
      dependencies["react-dom"] ||
      dependencies["react-scripts"]
    ) {
      // Rilevato React - silenzioso
      return "react";
    }

    // Rileva WordPress
    if (
      depNames.some((dep) => dep.includes("wp-") || dep.includes("wordpress"))
    ) {
      // Rilevato WordPress - silenzioso
      return "wordpress";
    }

    // Rileva Vue.js
    if (
      dependencies.vue ||
      dependencies["@vue/cli"] ||
      dependencies["vue-loader"]
    ) {
      // Rilevato Vue.js - silenzioso
      return "vue";
    }

    // Rileva Angular
    if (
      depNames.some((dep) => dep.includes("@angular/") || dep.includes("ng-"))
    ) {
      // Rilevato Angular - silenzioso
      return "angular";
    }
    // Tipo progetto sconosciuto - silenzioso
    return "unknown";
  } catch (error) {
    // Errore nel rilevamento - silenzioso
    return "unknown";
  }
}

// Funzione per controllare se una dipendenza è sicura da rimuovere
function isSafeToRemove(dependencyName, projectType, isDevDependency = false) {
  const rules = SAFE_DEPENDENCY_RULES;

  // Controlla regole universali
  if (rules.universal.testPackages.includes(dependencyName)) {
    return true; // Sicuro da rimuovere
  }

  if (rules.universal.buildOnlyPackages.includes(dependencyName)) {
    return true; // Sicuro da rimuovere
  }

  if (rules.universal.deploymentPackages.includes(dependencyName)) {
    return true; // Sicuro da rimuovere
  }

  // Controlla regole specifiche per tipo di progetto
  if (projectType !== "unknown" && rules[projectType]) {
    const projectRules = rules[projectType];

    // Se è nelle dipendenze da mantenere sempre, non rimuovere
    if (projectRules.alwaysKeep) {
      for (const pattern of projectRules.alwaysKeep) {
        if (
          dependencyName.includes(pattern) ||
          dependencyName.startsWith(pattern)
        ) {
          return false; // NON sicuro da rimuovere
        }
      }
    }

    // Se è nelle devDependencies da mantenere sempre, non rimuovere
    if (isDevDependency && projectRules.devAlwaysKeep) {
      for (const pattern of projectRules.devAlwaysKeep) {
        if (
          dependencyName.includes(pattern) ||
          dependencyName.startsWith(pattern)
        ) {
          return false; // NON sicuro da rimuovere
        }
      }
    }
  }

  // Per sicurezza, se non siamo sicuri, non rimuovere
  return false;
}

// Funzione per analizzare l'uso di una dipendenza nel codice
function analyzeDependencyUsage(filePath, dependencyName) {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    // Pattern di ricerca per l'uso della dipendenza
    const patterns = [
      // ES6 imports
      new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
      new RegExp(`import\\s+['"]${dependencyName}['"]`, "gi"),
      new RegExp(
        `import\\s*\\{[^}]*\\}\\s*from\\s+['"]${dependencyName}['"]`,
        "gi"
      ),

      // CommonJS requires
      new RegExp(`require\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
      new RegExp(`require\\(['"]${dependencyName}['"]\\)`, "gi"),

      // Dynamic imports
      new RegExp(`import\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),

      // Riferimenti diretti
      new RegExp(`['"]${dependencyName}['"]`, "gi"),

      // Per pacchetti con sottopacchetti
      new RegExp(`['"]${dependencyName}/`, "gi"),
    ];

    // Controlla ogni pattern
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        return true; // Trovato uso
      }
    }

    return false; // Non trovato uso
  } catch (error) {
    return false; // In caso di errore, assumiamo che sia utilizzato
  }
}

// Funzione per scansionare tutti i file in una directory
function scanDirectoryForUsage(dirPath, dependencyName) {
  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Salta cartelle di sistema
        if (
          [
            "node_modules",
            ".git",
            "dist",
            "build",
            "lib",
            "temp",
            "release",
          ].includes(item)
        ) {
          continue;
        }

        // Scansiona ricorsivamente
        if (scanDirectoryForUsage(fullPath, dependencyName)) {
          return true;
        }
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();

        // Controlla solo file di codice o config
        if (
          [
            ".js",
            ".ts",
            ".tsx",
            ".jsx",
            ".vue",
            ".svelte",
            ".json",
            ".mjs",
            ".cjs",
          ].includes(ext)
        ) {
          if (analyzeDependencyUsage(fullPath, dependencyName)) {
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

// Funzione per analizzare le dipendenze di un componente
function analyzeComponentDependencies(componentPath) {
  // analyzeComponentDependencies - silenzioso
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    logger.error(`package.json non trovato in ${componentName}`);
    return { used: [], unused: [], error: true };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const peerDependencies = packageJson.peerDependencies || {};
    const optionalDependencies = packageJson.optionalDependencies || {};

    if (Object.keys(dependencies).length === 0) {
      return { used: [], unused: [], error: false };
    }

    // Analisi dipendenze - silenzioso

    // Rileva il tipo di progetto
    // Chiamando detectProjectType - silenzioso
    const projectType = detectProjectType(componentPath);
    // Tipo progetto rilevato - silenzioso

    // Debug: mostriamo le dipendenze trovate
    const depNames = Object.keys(dependencies);
    // Dipendenze trovate - silenzioso

    const usedDependencies = [];
    const unusedDependencies = [];

    // Analizza ogni dipendenza
    for (const [depName, depVersion] of Object.entries(dependencies)) {
      const isDevDependency =
        packageJson.devDependencies && packageJson.devDependencies[depName];

      // Se è nelle peer o optional, consideriamolo usato
      if (peerDependencies[depName] || optionalDependencies[depName]) {
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: peerDependencies[depName]
            ? "peerDependency"
            : "optionalDependency",
        });
        continue;
      }

      // Se è referenziato in file di configurazione consideriamolo utilizzato
      if (isReferencedInConfigFiles(componentPath, depName)) {
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: "riferito in file di configurazione",
        });
        continue;
      }

      // Prima controlla se è sicuro da rimuovere
      if (isSafeToRemove(depName, projectType, !!isDevDependency)) {
        // Se è sicuro da rimuovere, controlla se è effettivamente utilizzato
        const isUsed = scanDirectoryForUsage(componentPath, depName);

        if (isUsed) {
          usedDependencies.push({
            name: depName,
            version: depVersion,
            reason: "utilizzato nel codice",
          });
        } else {
          unusedDependencies.push({
            name: depName,
            version: depVersion,
            reason: "sicuro da rimuovere",
          });
        }
      } else {
        // Se non è sicuro da rimuovere, assumiamo che sia utilizzato
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: "necessario per il progetto",
        });
      }
    }

    return { used: usedDependencies, unused: unusedDependencies, error: false };
  } catch (error) {
    logger.error(`Errore nell'analisi ${componentName}: ${error.message}`);
    return { used: [], unused: [], error: true };
  }
}

// Funzione per rimuovere dipendenze non utilizzate
function removeUnusedDependencies(componentPath, unusedDependencies) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Rimuovi da dependencies e devDependencies
    for (const dep of unusedDependencies) {
      if (packageJson.dependencies && packageJson.dependencies[dep.name]) {
        delete packageJson.dependencies[dep.name];
      }
      if (
        packageJson.devDependencies &&
        packageJson.devDependencies[dep.name]
      ) {
        delete packageJson.devDependencies[dep.name];
      }
    }

    // Salva il package.json aggiornato
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Rimuovi i pacchetti tramite npm
    logger.process(`Rimozione pacchetti per ${componentName}...`);

    const packagesToRemove = unusedDependencies
      .map((dep) => dep.name)
      .join(" ");
    const npmCommand = `${getNpmCommand()} uninstall ${packagesToRemove} --ignore-scripts`;

    try {
      execSync(npmCommand, {
        cwd: componentPath,
        stdio: "inherit",
      });
      logger.success(`Pacchetti rimossi per ${componentName}`);
      return true;
    } catch (npmError) {
      logger.warning(
        `Errore nella rimozione dei pacchetti per ${componentName}: ${npmError.message}`
      );
      logger.warning(
        `package.json aggiornato, ma i pacchetti sono rimasti in node_modules`
      );
      return false;
    }
  } catch (error) {
    logger.error(
      `Errore nella rimozione delle dipendenze per ${componentName}: ${error.message}`
    );
    return false;
  }
}

// Funzione per eseguire il comando depcheck
async function executeDepcheckCommand(
  scope,
  components,
  args,
  onComplete = null
) {
  const allComponents = getComponentDirectories();
  let targetComponents = [];

  // Determina i componenti target
  switch (scope) {
    case "all":
      targetComponents = allComponents;
      break;
    case "single":
      if (components.length > 0) {
        targetComponents = [components[0]];
      }
      break;
    case "exclude":
      targetComponents = allComponents.filter(
        (comp) => !components.includes(comp)
      );
      break;
  }

  if (targetComponents.length === 0) {
    logger.error("Nessun componente trovato per l'analisi");
    if (onComplete) onComplete();
    return;
  }

  logger.process(`Analisi ${targetComponents.length} componenti...`);

  let totalUnused = 0;
  let componentsWithUnused = 0;
  const allUnusedDependencies = [];
  const conciseOutput = [];

  // Analizza ogni componente
  for (const component of targetComponents) {
    const componentPath = path.join(process.cwd(), component);
    const result = analyzeComponentDependencies(componentPath);

    if (result.error) {
      continue;
    }

    if (result.unused.length > 0) {
      componentsWithUnused++;
      totalUnused += result.unused.length;

      if (!logger.isVerbose()) {
        // quiet/default: output conciso: component: dep1 dep2 ...
        conciseOutput.push(
          `${component}: ${result.unused.map((d) => d.name).join(" ")}`
        );
      } else {
        logger.info(`${component}:`);
        logger.error(`Sicure da rimuovere (${result.unused.length}):`);
        result.unused.forEach((dep) => {
          logger.log(`      - ${dep.name} (${dep.reason})`);
        });
      }

      allUnusedDependencies.push({
        component: component,
        path: componentPath,
        unused: result.unused,
      });
    } else {
      logger.success(`${component}: tutte le dipendenze sono necessarie`);
    }
  }

  // Mostra il risultato
  if (!logger.isVerbose()) {
    // Stampa lista concisa e ritorna
    conciseOutput.forEach((line) => console.log(line));
  } else {
    logger.section("Risultato controllo");
    logger.info(`Componenti analizzati: ${targetComponents.length}`);
    if (totalUnused > 0) {
      logger.error(`Dipendenze sicure da rimuovere: ${totalUnused}`);
      logger.error(
        `Componenti con dipendenze rimovibili: ${componentsWithUnused}`
      );
    } else {
      logger.success(`Tutte le dipendenze sono necessarie`);
    }
  }

  if (totalUnused > 0 && !args.includes("clean")) {
    logger.info("Per rimuovere le dipendenze sicure usa:");
    logger.log(`   npx packman depcheck clean`);
  } else if (totalUnused === 0) {
    logger.success(
      "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
    );
  }

  // Se è specificato clean, rimuovi automaticamente
  if (args.includes("clean") && totalUnused > 0) {
    if (logger.isVerbose())
      logger.process("Rimozione automatica delle dipendenze sicure...");

    for (const item of allUnusedDependencies) {
      if (logger.isVerbose())
        logger.process(`Rimozione dipendenze per ${item.component}...`);
      const success = removeUnusedDependencies(item.path, item.unused);

      if (success) {
        if (logger.isVerbose())
          logger.success(`Dipendenze rimosse per ${item.component}`);
      } else {
        if (logger.isVerbose())
          logger.error(
            `Errore nella rimozione delle dipendenze per ${item.component}`
          );
      }
    }

    logger.success("Rimozione completata!");
  }

  if (onComplete) onComplete();
}

// Funzione per il parsing e l'esecuzione dei comandi
async function parseAndExecuteCommand(args, onComplete = null) {
  let scope = "all";
  let components = [];

  // Reset verbose by default; can be enabled via flag or env
  logger.setVerbose(!!process.env.PACKMAN_VERBOSE);

  // Parsa gli argomenti
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--verbose" || arg === "-v") {
      logger.setVerbose(true);
      continue;
    }

    if (arg === "--single") {
      scope = "single";
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Salta il prossimo argomento
      }
    } else if (arg === "--exclude") {
      scope = "exclude";
      components = [];
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith("--")) {
          break; // Ci fermiamo al prossimo flag
        }
        components.push(args[j]);
      }
      i += components.length; // Salta gli argomenti processati
    }
  }

  // Esegui il comando
  await executeDepcheckCommand(scope, components, args, onComplete);
}

// Funzione per la modalità interattiva
function showInteractiveMenu() {
  logger.section("Controllo dipendenze non utilizzate");
  logger.step("Controlla tutti i componenti", 1);
  logger.step("Controlla un componente", 2);
  logger.step("Controlla tutti tranne quelli specificati", 3);
  logger.step("Controlla e rimuovi per tutti i componenti (automatico)", 4);
  logger.step("Torna al menu principale", 0);

  if (!rl) return;

  rl.question("Scegli un'opzione (0-4): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        if (onComplete) onComplete();
        break;
      case "1":
        logger.process("Controllo dipendenze per tutti i componenti...");
        executeDepcheckCommand("all", [], [], () => {
          if (rl) {
            // Controlla se ci sono dipendenze sicure da rimuovere
            const allComponents = getComponentDirectories();
            let hasSafeToRemove = false;

            for (const component of allComponents) {
              const componentPath = path.join(process.cwd(), component);
              const result = analyzeComponentDependencies(componentPath);
              if (result.unused.length > 0) {
                hasSafeToRemove = true;
                break;
              }
            }

            if (hasSafeToRemove) {
              logger.warning(
                "Rimuovere le dipendenze sicure per tutti i componenti?"
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    "Rimozione dipendenze per tutti i componenti..."
                  );
                  executeDepcheckCommand("all", [], ["clean"], () => {
                    if (onComplete) onComplete();
                  });
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
              );
              if (onComplete) onComplete();
            }
          }
        });
        break;
      case "2":
        showComponentSelection();
        break;
      case "3":
        showExcludeSelection();
        break;
      case "4":
        logger.process(
          "Controllo e rimozione automatica delle dipendenze per tutti i componenti..."
        );
        executeDepcheckCommand("all", [], ["clean"], () => {
          if (onComplete) onComplete();
        });
        break;
      default:
        logger.error("Scelta non valida");
        if (onComplete) onComplete();
    }
  });
}

// Funzione per la selezione del componente
function showComponentSelection() {
  const components = getComponentDirectories();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    if (onComplete) onComplete();
    return;
  }

  logger.section("Componenti disponibili");
  components.forEach((component, index) => {
    logger.step(component, index + 1);
  });
  logger.step("Torna al menu principale", 0);

  if (!rl) return;

  rl.question(
    "\nInserisci il numero del componente (0 per tornare): ",
    (answer) => {
      if (answer.trim() === "0") {
        logger.info("Tornando al menu principale...");
        if (onComplete) onComplete();
        return;
      }

      const index = parseInt(answer) - 1;

      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        logger.success(`Selezionato: ${selectedComponent}`);

        logger.process(`Analisi dipendenze per: ${selectedComponent}`);
        executeDepcheckCommand("single", [selectedComponent], [], () => {
          if (rl) {
            const componentPath = path.join(process.cwd(), selectedComponent);
            const result = analyzeComponentDependencies(componentPath);

            if (result.unused.length > 0) {
              logger.warning(
                `Rimuovere le dipendenze sicure per: ${selectedComponent}?`
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    `Rimozione dipendenze per: ${selectedComponent}`
                  );
                  executeDepcheckCommand(
                    "single",
                    [selectedComponent],
                    ["clean"],
                    () => {
                      if (onComplete) onComplete();
                    }
                  );
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                `Tutte le dipendenze sono necessarie per ${selectedComponent}, nessuna rimozione sicura disponibile`
              );
              if (onComplete) onComplete();
            }
          }
        });
      } else {
        logger.error("Numero componente non valido");
        if (onComplete) onComplete();
      }
    }
  );
}

// Funzione per la selezione delle esclusioni
function showExcludeSelection() {
  if (!rl) return;

  rl.question(
    "Inserisci i nomi dei componenti da escludere (separati da spazio): ",
    (excludeAnswer) => {
      const excludeList = excludeAnswer
        .trim()
        .split(/\s+/)
        .filter((name) => name.length > 0);
      if (excludeList.length > 0) {
        logger.process(
          `Analisi dipendenze per tutti i componenti tranne: ${excludeList.join(
            ", "
          )}`
        );
        executeDepcheckCommand("exclude", excludeList, [], () => {
          if (rl) {
            const allComponents = getComponentDirectories();
            const filteredComponents = allComponents.filter(
              (component) => !excludeList.includes(component)
            );
            let hasSafeToRemove = false;

            for (const component of filteredComponents) {
              const componentPath = path.join(process.cwd(), component);
              const result = analyzeComponentDependencies(componentPath);
              if (result.unused.length > 0) {
                hasSafeToRemove = true;
                break;
              }
            }

            if (hasSafeToRemove) {
              logger.warning(
                `Rimuovere le dipendenze sicure per tutti i componenti tranne: ${excludeList.join(
                  ", "
                )}?`
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    `Rimozione dipendenze per tutti i componenti tranne: ${excludeList.join(
                      ", "
                    )}`
                  );
                  executeDepcheckCommand(
                    "exclude",
                    excludeList,
                    ["clean"],
                    () => {
                      if (onComplete) onComplete();
                    }
                  );
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
              );
              if (onComplete) onComplete();
            }
          }
        });
      } else {
        logger.error("Nessun componente specificato per l'esclusione");
        if (onComplete) onComplete();
      }
    }
  );
}

// Funzione principale
async function main() {
  logger.section(`${projectConfig.project.name} - Controllo dipendenze`);

  const args = process.argv.slice(2);

  // Se sono passati argomenti dalla riga di comando
  if (args.length > 0) {
    await parseAndExecuteCommand(args);
    return;
  }

  // Modalità interattiva
  try {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Gestione errori readline
    rl.on("error", (err) => {
      logger.error(`Errore readline: ${err.message}`);
    });

    rl.on("close", () => {
      logger.info("Interfaccia chiusa");
      process.exit(0);
    });

    // Gestione SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      logger.success("Arrivederci!");
      if (rl) rl.close();
      process.exit(0);
    });

    showInteractiveMenu();
  } catch (error) {
    logger.error(`Errore durante l'inizializzazione: ${error.message}`);
    process.exit(1);
  }
}

// Avvio dello script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  analyzeComponentDependencies,
  removeUnusedDependencies,
  executeDepcheckCommand,
  detectProjectType,
  isSafeToRemove,
};
