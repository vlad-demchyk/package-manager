#!/usr/bin/env node

/**
 * Custom Package Manager - Installer & Main Entry Point
 * Installa automaticamente i file necessari e configura il modulo
 * Può essere eseguito come install.js o come entry point principale
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Import shared logger
const logger = require("./scripts/utils/logger");

// Funzione per creare interfaccia readline
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
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

// Funzione per configurare il progetto
async function configureProject() {
  const rl = createReadlineInterface();

  logger.process("Configurazione del progetto...");
  logger.log("");

  const config = {
    project: {
      name: "",
      version: "1.0.0",
      description: "",
    },
    components: {
      filterByPrefix: { enabled: false, prefix: "" },
      filterByStructure: {
        enabled: false,
        requiredFiles: [],
        requiredFolders: [],
      },
      filterByList: { enabled: false, folders: [] },
      filterByRegex: { enabled: false, pattern: "" },
    },
  };

  try {
    // Nome del progetto
    const projectName = await askQuestion(rl, "📝 Nome del progetto: ");
    config.project.name = projectName || "My Project";

    // Descrizione del progetto
    const projectDesc = await askQuestion(
      rl,
      "📝 Descrizione del progetto (opzionale): "
    );
    config.project.description =
      projectDesc || `Gestore pacchetti per ${config.project.name}`;

    logger.log("");
    logger.section("Metodo di identificazione componenti");
    logger.step("Per prefisso (es: c106-, my-app-)", 1);
    logger.step(
      "Per struttura cartella (package.json + cartelle specifiche)",
      2
    );
    logger.step("Per lista cartelle specifiche", 3);
    logger.step("Per espressione regolare", 4);
    logger.step("Salta configurazione (usa impostazioni predefinite)", 5);
    logger.log("");

    const methodChoice = await askQuestion(rl, "Scegli metodo (1-5): ");

    switch (methodChoice) {
      case "1":
        const prefix = await askQuestion(
          rl,
          "🔤 Prefisso componenti (es: c106-): "
        );
        config.components.filterByPrefix = {
          enabled: true,
          prefix: prefix || "c106-",
        };
        break;

      case "2":
        // Chiedi se il progetto usa TypeScript
        const useTypeScript = await askQuestion(
          rl,
          "🔧 Il progetto usa TypeScript? (s/n, default: s): "
        );
        const hasTypeScript =
          useTypeScript.toLowerCase() !== "n" &&
          useTypeScript.toLowerCase() !== "no";

        // File base richiesti
        let baseFiles = ["package.json"];
        if (hasTypeScript) {
          baseFiles.push("tsconfig.json");
        }

        config.components.filterByStructure = {
          enabled: true,
          requiredFiles: baseFiles,
          requiredFolders: ["src"],
        };

        const customFiles = await askQuestion(
          rl,
          `📄 File richiesti (separati da virgola, default: ${baseFiles.join(
            ","
          )}): `
        );
        if (customFiles) {
          config.components.filterByStructure.requiredFiles = customFiles
            .split(",")
            .map((f) => f.trim());
        }

        const customFolders = await askQuestion(
          rl,
          "📁 Cartelle richieste (separate da virgola, default: src): "
        );
        if (customFolders) {
          config.components.filterByStructure.requiredFolders = customFolders
            .split(",")
            .map((f) => f.trim());
        }
        break;

      case "3":
        const folders = await askQuestion(
          rl,
          "📁 Lista cartelle componenti (separate da virgola): "
        );
        if (folders) {
          config.components.filterByList = {
            enabled: true,
            folders: folders.split(",").map((f) => f.trim()),
          };
        }
        break;

      case "4":
        const regex = await askQuestion(
          rl,
          "🔍 Espressione regolare (es: ^my-app-\\w+$): "
        );
        if (regex) {
          config.components.filterByRegex = {
            enabled: true,
            pattern: regex,
          };
        }
        break;

      case "5":
      default:
        logger.log(
          "⏭️  Configurazione saltata - verranno usate le impostazioni predefinite",
          "yellow"
        );
        // Imposta configurazione predefinita per struttura cartelle
        // Verifica se il progetto usa TypeScript controllando la presenza di tsconfig.json nei componenti
        const projectRoot = process.cwd();
        const items = fs.readdirSync(projectRoot);

        // Cerca tsconfig.json in almeno un componente
        let hasTsConfig = false;
        for (const item of items) {
          const fullPath = path.join(projectRoot, item);
          if (fs.statSync(fullPath).isDirectory()) {
            const tsConfigPath = path.join(fullPath, "tsconfig.json");
            if (fs.existsSync(tsConfigPath)) {
              hasTsConfig = true;
              break;
            }
          }
        }

        let defaultFiles = ["package.json"];
        if (hasTsConfig) {
          defaultFiles.push("tsconfig.json");
          logger.log(
            "🔧 Rilevato TypeScript nel progetto - incluso tsconfig.json nei filtri",
            "cyan"
          );
        } else {
          logger.log(
            "🔧 TypeScript non rilevato - solo package.json nei filtri",
            "cyan"
          );
        }

        config.components.filterByStructure = {
          enabled: true,
          requiredFiles: defaultFiles,
          requiredFolders: ["src"],
        };
        break;
    }

    rl.close();
    return config;
  } catch (error) {
    rl.close();
    logger.error("Errore durante la configurazione:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

// Funzione per copiare i file del modulo nella cartella package-manager
function copyModuleFiles(targetDir) {
  const sourceDir = __dirname;
  const itemsToCopy = ["scripts", "docs"];

  itemsToCopy.forEach((item) => {
    const sourcePath = path.join(sourceDir, item);
    const targetPath = path.join(targetDir, item);

    if (fs.existsSync(sourcePath)) {
      try {
        if (fs.statSync(sourcePath).isDirectory()) {
          // Copia ricorsivamente le cartelle
          copyDirectoryRecursive(sourcePath, targetPath);
          logger.log(`✅ Cartella ${item}/ copiata`, "green");
        } else {
          // Copia i file
          fs.copyFileSync(sourcePath, targetPath);
          logger.log(`✅ File ${item} copiato`, "green");
        }
      } catch (error) {
        logger.log(`❌ Errore copiando ${item}: ${error.message}`, "red");
      }
    }
  });

  // Copia il file dependencies-config.js nella cartella package-manager
  const configPath = path.join(sourceDir, "dependencies-config.js");
  const targetConfigPath = path.join(targetDir, "dependencies-config.js");

  if (fs.existsSync(configPath)) {
    try {
      fs.copyFileSync(configPath, targetConfigPath);
      logger.log(
        `✅ dependencies-config.js copiato in package-manager/`,
        "green"
      );
    } catch (error) {
      logger.log(
        `❌ Errore copiando dependencies-config.js: ${error.message}`,
        "red"
      );
    }
  } else {
    logger.log(`❌ dependencies-config.js non trovato in ${configPath}`, "red");
  }

  // Copia anche il template nella root del progetto per facilità d'uso
  const templatePath = path.join(
    sourceDir,
    "templates",
    "dependencies-config.js"
  );
  const rootTemplatePath = path.join(process.cwd(), "dependencies-config.js");

  if (fs.existsSync(templatePath)) {
    try {
      fs.copyFileSync(templatePath, rootTemplatePath);
      logger.log(
        `✅ Template dependencies-config.js copiato nella root del progetto`,
        "green"
      );
    } catch (error) {
      logger.log(
        `❌ Errore copiando template nella root: ${error.message}`,
        "red"
      );
    }
  } else {
    logger.log(`❌ Template non trovato in ${templatePath}`, "red");
  }
}

// Funzione per copiare ricorsivamente una cartella
function copyDirectoryRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source);
  items.forEach((item) => {
    const sourcePath = path.join(source, item);
    const targetPath = path.join(target, item);

    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
}

// Funzione per salvare la configurazione
function saveProjectConfig(config, targetDir = null) {
  const configPath = targetDir
    ? path.join(targetDir, "project-config.js")
    : path.join(__dirname, "project-config.js");

  const configContent = `module.exports = {
  // Configurazione del progetto
  project: {
    name: "${config.project.name}",
    version: "${config.project.version}",
    description: "${config.project.description}"
  },
  
  // Configurazione ricerca componenti
  components: {
    // Metodo 1: Per prefisso
    filterByPrefix: {
      enabled: ${config.components.filterByPrefix.enabled},
      prefix: "${config.components.filterByPrefix.prefix}"
    },
    
    // Metodo 2: Per struttura cartella
    filterByStructure: {
      enabled: ${config.components.filterByStructure.enabled},
      requiredFiles: ${JSON.stringify(
        config.components.filterByStructure.requiredFiles
      )},
      requiredFolders: ${JSON.stringify(
        config.components.filterByStructure.requiredFolders
      )}
    },
    
    // Metodo 3: Per lista cartelle
    filterByList: {
      enabled: ${config.components.filterByList.enabled},
      folders: ${JSON.stringify(config.components.filterByList.folders)}
    },
    
    // Metodo 4: Per regex
    filterByRegex: {
      enabled: ${config.components.filterByRegex.enabled},
      pattern: ${
        config.components.filterByRegex.pattern
          ? `/${config.components.filterByRegex.pattern}/`
          : "null"
      }
    }
  },
  
  // Configurazione file
  files: {
    packageJson: "package.json",
    tsConfig: "tsconfig.json",
    nodeModules: "node_modules",
    packageLock: "package-lock.json",
    tslint: "tslint.json"
  },
  
  // Configurazione comandi
  commands: {
    npm: {
      windows: "npm.cmd",
      unix: "npm"
    }
  },
  
  // Configurazione logging
  logging: {
    colors: {
      reset: '\\x1b[0m',
      bright: '\\x1b[1m',
      red: '\\x1b[31m',
      green: '\\x1b[32m',
      yellow: '\\x1b[33m',
      blue: '\\x1b[34m',
      magenta: '\\x1b[35m',
      cyan: '\\x1b[36m'
    }
  }
};`;

  try {
    fs.writeFileSync(configPath, configContent, "utf8");
    logger.success("Configurazione salvata in project-config.js");
    return true;
  } catch (error) {
    logger.error("Errore salvataggio configurazione:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

// Funzione principale per l'installazione
async function installPackageManager() {
  logger.section("Installazione Package Manager Module");
  logger.log("");

  // Verifica se siamo in modalità npm install
  const isNpmInstall =
    process.env.npm_config_user_config ||
    process.env.npm_lifecycle_event === "postinstall";

  if (isNpmInstall) {
    logger.success("Modalità installazione NPM rilevata");
    logger.info("   Creazione cartella package-manager nel progetto...");
  } else {
    logger.success("Modalità installazione manuale rilevata");
  }

  // Determina la root del progetto
  // Se siamo in modalità npm install, process.cwd() potrebbe essere la cartella del modulo
  // Dobbiamo trovare la cartella del progetto che ha chiamato npm install
  let projectRoot = process.cwd();

  // Se siamo in node_modules, saliamo alla cartella del progetto
  if (projectRoot.includes("node_modules")) {
    // Trova la cartella del progetto (quella che contiene node_modules)
    const parts = projectRoot.split(path.sep);
    const nodeModulesIndex = parts.lastIndexOf("node_modules");
    if (nodeModulesIndex > 0) {
      projectRoot = parts.slice(0, nodeModulesIndex).join(path.sep);
    }
  }

  // Se siamo in modalità npm install, usa la cartella del progetto che ha chiamato npm install
  if (isNpmInstall && process.env.INIT_CWD) {
    // INIT_CWD contiene la cartella del progetto che ha chiamato npm install
    projectRoot = process.env.INIT_CWD;
  }

  // Verifica e crea/aggiorna root package.json
  const rootPackageJsonPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(rootPackageJsonPath)) {
    logger.warning("Root package.json не знайдено, створюю мінімальний...");

    const minimalPackageJson = {
      name: path.basename(projectRoot),
      version: "1.0.0",
      private: true,
      scripts: {
        packman: "npx packman",
        pm: "npx pm",
      },
    };

    fs.writeFileSync(
      rootPackageJsonPath,
      JSON.stringify(minimalPackageJson, null, 2)
    );

    logger.success("Створено мінімальний package.json");
  } else {
    // Se esiste, aggiungi/aggiorna scripts
    try {
      const existingPkg = JSON.parse(
        fs.readFileSync(rootPackageJsonPath, "utf8")
      );

      if (!existingPkg.scripts) {
        existingPkg.scripts = {};
      }

      // Aggiungi packman comandi se non esistono
      if (!existingPkg.scripts.packman) {
        existingPkg.scripts.packman = "npx packman";
      }
      if (!existingPkg.scripts.pm) {
        existingPkg.scripts.pm = "npx pm";
      }

      fs.writeFileSync(
        rootPackageJsonPath,
        JSON.stringify(existingPkg, null, 2)
      );

      logger.success("Оновлено scripts в package.json");
    } catch (error) {
      logger.warning("Не вдалося оновити package.json");
    }
  }

  // Crea la cartella package-manager se non esiste
  const packageManagerDir = path.join(projectRoot, "package-manager");
  if (!fs.existsSync(packageManagerDir)) {
    fs.mkdirSync(packageManagerDir, { recursive: true });
    logger.success("Creata cartella package-manager/");
  }

  // Copia tutti i file del modulo nella cartella package-manager
  logger.process("Copia file del modulo nella cartella package-manager...");
  copyModuleFiles(packageManagerDir);

  // Configurazione del progetto avverrà al primo utilizzo di npx packman

  logger.log("");
  logger.success("Installazione completata!");
  logger.log("");

  logger.section("Comandi disponibili");
  logger.log(
    "   npx packman           - Modalità interattiva (prima configurazione)"
  );
  logger.log("   npx packman install   - Installa pacchetti");
  logger.log("   npx packman update    - Aggiorna configurazioni");
  logger.log("   npx packman clean     - Pulisci componenti");
  logger.log("   npx packman depcheck  - Controlla dipendenze non utilizzate");
  logger.log("   npx pm                - Alias per packman");
  logger.log("");
  logger.section("Prossimi passi");
  logger.step("Esegui 'npx packman' per configurare il progetto", 1);
  logger.step(
    "Modifica dependencies-config.js nella root del progetto se necessario",
    2
  );
  logger.step("Usa 'npx packman update' per aggiornare le configurazioni", 3);
  logger.log("");
  logger.warning(
    "IMPORTANTE: Esegui i comandi dalla directory root del progetto:"
  );
  logger.log(`   cd "${projectRoot}"`);
  logger.log("");
}

// Funzione principale per l'avvio del package manager
async function startPackageManager() {
  // Cerchiamo la cartella package-manager nel progetto corrente
  const projectRoot = process.cwd();
  const packageManagerDir = path.join(projectRoot, "package-manager");

  if (!fs.existsSync(packageManagerDir)) {
    logger.error("Cartella package-manager non trovata!");
    logger.warning("   Il modulo non è stato installato correttamente.");
    logger.log(
      "   Esegui: npm install https://github.com/vlad-demchyk/package-manager"
    );
    process.exit(1);
  }

  // Carichiamo la configurazione del progetto dalla cartella package-manager
  const projectConfigPath = path.join(packageManagerDir, "project-config.js");
  if (!fs.existsSync(projectConfigPath)) {
    logger.process("Prima esecuzione rilevata - configurazione progetto...");
    logger.log("");

    // Avvia la configurazione del progetto
    const projectConfig = await configureProject();
    if (projectConfig) {
      const configSaved = saveProjectConfig(projectConfig, packageManagerDir);
      if (configSaved) {
        logger.success("Configurazione progetto completata!");
        logger.log("");
      } else {
        logger.error("Errore durante il salvataggio della configurazione");
        process.exit(1);
      }
    } else {
      logger.error("Errore durante la configurazione del progetto");
      process.exit(1);
    }
  }

  // Avviamo lo script principale
  const mainScript = path.join(packageManagerDir, "scripts", "core.js");
  if (!fs.existsSync(mainScript)) {
    logger.error("Script principale core.js non trovato!");
    logger.warning("   Il modulo non è stato installato correttamente.");
    process.exit(1);
  }

  try {
    // Carichiamo e avviamo lo script principale
    const coreModule = require(mainScript);

    // Passiamo gli argomenti della riga di comando
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // Modalità interattiva
      await coreModule.main();
    } else {
      // Modalità riga di comando
      await coreModule.parseAndExecuteCommand(args);
    }
  } catch (error) {
    logger.error("Errore durante l'avvio:");
    logger.warning(`   ${error.message}`);

    if (error.code === "MODULE_NOT_FOUND") {
      logger.log(
        "   Assicurati che tutti i file necessari si trovino nella cartella package-manager."
      );
    }

    process.exit(1);
  }
}

// Funzione principale
async function main() {
  // Verifica se siamo in modalità installazione o avvio
  const isInstallMode =
    process.argv[1].endsWith("install.js") ||
    process.env.npm_lifecycle_event === "postinstall" ||
    process.argv.includes("--install");

  if (isInstallMode) {
    await installPackageManager();
  } else {
    await startPackageManager();
  }
}

// Gestione errori
process.on("uncaughtException", (error) => {
  logger.error("Errore imprevisto:");
  logger.warning(`   ${error.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Errore di promessa non gestita:");
  logger.warning(`   ${reason}`);
  process.exit(1);
});

// Avvio della funzione principale
if (require.main === module) {
  main().catch((error) => {
    logger.error("Errore durante l'esecuzione:");
    logger.warning(`   ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, installPackageManager, startPackageManager };
