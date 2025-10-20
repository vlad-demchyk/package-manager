/**
 * Generazione automatica configurazione dipendenze
 * Analizza i package.json esistenti e genera dependencies-config.js
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");

function getComponentDirectories(projectConfig) {
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

function parseVersion(version) {
  // Rimuove prefissi come ^, ~, >=, etc.
  return version.replace(/^[\^~>=<]+/, "");
}

function compareVersions(version1, version2) {
  const v1Parts = parseVersion(version1).split(".").map(Number);
  const v2Parts = parseVersion(version2).split(".").map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  return 0;
}

function findLatestTypeScriptComponent(componentDirs, projectConfig) {
  let latestVersion = null;
  let latestComponent = null;
  
  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(process.cwd(), componentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const tsVersion = packageJson.devDependencies?.typescript || packageJson.dependencies?.typescript;
      
      if (tsVersion && (!latestVersion || compareVersions(tsVersion, latestVersion) > 0)) {
        latestVersion = tsVersion;
        latestComponent = componentDir;
      }
    }
  });
  
  return { component: latestComponent, version: latestVersion };
}

function extractTsConfig(componentDir, projectConfig) {
  const tsConfigPath = path.join(process.cwd(), componentDir, "tsconfig.json");
  if (fs.existsSync(tsConfigPath)) {
    const tsConfig = JSON.parse(fs.readFileSync(tsConfigPath, "utf8"));
    return tsConfig;
  }
  return {};
}

function generateDependenciesConfig(projectConfig) {
  const componentDirs = getComponentDirectories(projectConfig);
  const allDeps = {};
  const allDevDeps = {};

  logger.log("🔍 Analisi dipendenze dai componenti...", "cyan", projectConfig);

  componentDirs.forEach((componentDir) => {
    const packageJsonPath = path.join(
      process.cwd(),
      componentDir,
      projectConfig.files.packageJson
    );

    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8")
        );

        // Analizza dependencies
        if (packageJson.dependencies) {
          Object.entries(packageJson.dependencies).forEach(
            ([name, version]) => {
              if (
                !allDeps[name] ||
                compareVersions(version, allDeps[name]) > 0
              ) {
                allDeps[name] = version;
              }
            }
          );
        }

        // Analizza devDependencies
        if (packageJson.devDependencies) {
          Object.entries(packageJson.devDependencies).forEach(
            ([name, version]) => {
              if (
                !allDevDeps[name] ||
                compareVersions(version, allDevDeps[name]) > 0
              ) {
                allDevDeps[name] = version;
              }
            }
          );
        }
      } catch (error) {
        logger.log(
          `⚠️  Errore leggendo ${componentDir}/package.json: ${error.message}`,
          "yellow",
          projectConfig
        );
      }
    }
  });

  // Trova il componente con la versione TypeScript più alta e estrai il suo tsconfig
  const { component: latestTsComponent, version: latestTsVersion } = findLatestTypeScriptComponent(componentDirs, projectConfig);
  let tsConfig = {};
  
  if (latestTsComponent) {
    tsConfig = extractTsConfig(latestTsComponent, projectConfig);
    logger.log(`📋 TypeScript ${latestTsVersion} trovato in ${latestTsComponent}`, "cyan", projectConfig);
  }

  return {
    baseDeps: allDeps,
    devDeps: allDevDeps,
    tsConfig: tsConfig,
    tsVersion: latestTsVersion
  };
}

function displayGeneratedDependencies(generated, projectConfig) {
  logger.log("\n📋 Dipendenze generate:", "cyan", projectConfig);
  logger.log("", "reset", projectConfig);

  if (Object.keys(generated.baseDeps).length > 0) {
    logger.log("🔧 DIPENDENZE BASE:", "yellow", projectConfig);
    Object.entries(generated.baseDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
    logger.log("", "reset", projectConfig);
  }

  if (Object.keys(generated.devDeps).length > 0) {
    logger.log("🛠️  DIPENDENZE DEV:", "yellow", projectConfig);
    Object.entries(generated.devDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
    logger.log("", "reset", projectConfig);
  }

  if (generated.tsConfig && Object.keys(generated.tsConfig).length > 0) {
    logger.log("⚙️  STANDARD TSCONFIG:", "yellow", projectConfig);
    logger.log(`   Preso dal componente con TypeScript ${generated.tsVersion}`, "blue", projectConfig);
    logger.log("", "reset", projectConfig);
  }
}

function saveDependenciesConfig(generated, projectConfig) {
  const projectRoot = process.cwd();
  const configPath = path.join(
    projectRoot,
    "package-manager",
    "dependencies-config.js"
  );

  // Verifichiamo se esiste la cartella package-manager
  const packageManagerDir = path.join(projectRoot, "package-manager");
  if (!fs.existsSync(packageManagerDir)) {
    fs.mkdirSync(packageManagerDir, { recursive: true });
  }

  const configContent = `/**
 * Configurazione dipendenze per Package Manager
 * Versione modulare con configurazione esterna
 */

// ============================================================================
// DIPENDENZE BASE (sempre aggiunte)
// ============================================================================
const BASE_DEPENDENCIES = {
${Object.entries(generated.baseDeps)
  .map(([name, version]) => `  "${name}": "${version}"`)
  .join(",\n")}
};

// ============================================================================
// DIPENDENZE CONDIZIONALI (aggiunte solo se utilizzate)
// ============================================================================
const CONDITIONAL_DEPENDENCIES = {
  // Esempio: "axios": { version: "^1.3.0", patterns: ["axios"], description: "Client HTTP" }
};

// ============================================================================
// DIPENDENZE DEV (sempre aggiunte come devDependencies)
// ============================================================================
const DEV_DEPENDENCIES = {
${Object.entries(generated.devDeps)
  .map(([name, version]) => `  "${name}": "${version}"`)
  .join(",\n")}
};

// ============================================================================
// DIPENDENZE DEPRECATE (rimosse da package.json)
// ============================================================================
const DEPRECATED_DEPENDENCIES = [
  // Esempio: "vecchio-nome-pacchetto"
];

// ============================================================================
// SCRIPT NPM STANDARD
// ============================================================================
const STANDARD_SCRIPTS = {
  // Esempio: "build": "tsc"
};

// ============================================================================
// TSCONFIG.JSON STANDARD
// ============================================================================
const STANDARD_TSCONFIG = {
${generated.tsConfig && Object.keys(generated.tsConfig).length > 0 
  ? Object.entries(generated.tsConfig)
      .map(([key, value]) => `  "${key}": ${JSON.stringify(value, null, 2).replace(/\n/g, '\n  ')}`)
      .join(',\n')
  : '  // Esempio: "compilerOptions": { "target": "es2016" }'
}
};

// ============================================================================
// ENGINE NODE.JS
// ============================================================================
const NODE_ENGINES = {
  // Esempio: "node": ">=18.0.0 < 20.0.0"
};

// ============================================================================
// FUNZIONI PER ESPORTAZIONE (NON MODIFICARE)
// ============================================================================

function getAllDependencies() {
  const allDeps = { ...BASE_DEPENDENCIES };
  Object.entries(CONDITIONAL_DEPENDENCIES).forEach(([name, config]) => {
    allDeps[name] = config.version;
  });
  return allDeps;
}

function getBaseDependencies() {
  return { ...BASE_DEPENDENCIES };
}

function getConditionalDependencies() {
  return { ...CONDITIONAL_DEPENDENCIES };
}

function getDevDependencies() {
  return { ...DEV_DEPENDENCIES };
}

function getDeprecatedDependencies() {
  return [...DEPRECATED_DEPENDENCIES];
}

function getStandardScripts() {
  return { ...STANDARD_SCRIPTS };
}

function getStandardTsConfig() {
  return { ...STANDARD_TSCONFIG };
}

function getNodeEngines() {
  return { ...NODE_ENGINES };
}

module.exports = {
  BASE_DEPENDENCIES,
  CONDITIONAL_DEPENDENCIES,
  DEV_DEPENDENCIES,
  DEPRECATED_DEPENDENCIES,
  STANDARD_SCRIPTS,
  STANDARD_TSCONFIG,
  NODE_ENGINES,
  getAllDependencies,
  getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines
};
`;

  fs.writeFileSync(configPath, configContent, "utf8");
  logger.log(
    `✅ Configurazione salvata in ${configPath}`,
    "green",
    projectConfig
  );
}

module.exports = {
  generateDependenciesConfig,
  displayGeneratedDependencies,
  saveDependenciesConfig,
  findLatestTypeScriptComponent,
  extractTsConfig,
};
