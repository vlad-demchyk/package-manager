/**
 * Generazione automatica configurazione dipendenze
 * Analizza i package.json esistenti e genera dependencies-config.js
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");

// Import common utilities
const { getComponentDirectories } = require("../utils/common");

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
    const packageJsonPath = path.join(
      process.cwd(),
      componentDir,
      "package.json"
    );
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const tsVersion =
        packageJson.devDependencies?.typescript ||
        packageJson.dependencies?.typescript;

      if (
        tsVersion &&
        (!latestVersion || compareVersions(tsVersion, latestVersion) > 0)
      ) {
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
  const depUsage = {}; // Tracciamo in quanti progetti viene utilizzata ogni dipendenza
  const devDepUsage = {};

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
              if (!allDeps[name]) {
                allDeps[name] = [];
              }
              allDeps[name].push(version);

              if (!depUsage[name]) {
                depUsage[name] = 0;
              }
              depUsage[name]++;
            }
          );
        }

        // Analizza devDependencies
        if (packageJson.devDependencies) {
          Object.entries(packageJson.devDependencies).forEach(
            ([name, version]) => {
              if (!allDevDeps[name]) {
                allDevDeps[name] = [];
              }
              allDevDeps[name].push(version);

              if (!devDepUsage[name]) {
                devDepUsage[name] = 0;
              }
              devDepUsage[name]++;
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

  const totalComponents = componentDirs.length;
  logger.log(`📊 Totale componenti: ${totalComponents}`, "cyan", projectConfig);

  const baseDeps = {};
  const conditionalDeps = {};
  const devDeps = {};
  const conditionalDevDeps = {};

  // Distribuiamo dependencies
  Object.entries(allDeps).forEach(([name, versions]) => {
    const usageCount = depUsage[name];

    // Logging per diagnostica
    if (usageCount >= totalComponents * 0.8) {
      // Mostriamo solo quelle utilizzate in 80%+ progetti
      logger.log(
        `🔍 ${name}: ${usageCount}/${totalComponents} progetti`,
        "blue",
        projectConfig
      );
    }

    if (usageCount === totalComponents) {
      // La dipendenza è in tutti i progetti
      const uniqueVersions = [...new Set(versions)];
      if (uniqueVersions.length === 1) {
        // Stessa versione in tutti i progetti
        baseDeps[name] = uniqueVersions[0];
      } else {
        // Versioni diverse - prendiamo la più alta
        const highestVersion = uniqueVersions.reduce((highest, current) => {
          return compareVersions(current, highest) > 0 ? current : highest;
        });
        baseDeps[name] = highestVersion;
      }
    } else {
      // La dipendenza è solo in alcuni progetti
      const highestVersion = versions.reduce((highest, current) => {
        return compareVersions(current, highest) > 0 ? current : highest;
      });
      conditionalDeps[name] = highestVersion;
    }
  });

  // Distribuiamo devDependencies
  Object.entries(allDevDeps).forEach(([name, versions]) => {
    const usageCount = devDepUsage[name];

    // Logging per diagnostica
    if (usageCount >= totalComponents * 0.8) {
      // Mostriamo solo quelle utilizzate in 80%+ progetti
      logger.log(
        `🔍 DEV ${name}: ${usageCount}/${totalComponents} progetti`,
        "blue",
        projectConfig
      );
    }

    if (usageCount === totalComponents) {
      // La dipendenza dev è in tutti i progetti
      const uniqueVersions = [...new Set(versions)];
      if (uniqueVersions.length === 1) {
        // Stessa versione in tutti i progetti
        devDeps[name] = uniqueVersions[0];
      } else {
        // Versioni diverse - prendiamo la più alta
        const highestVersion = uniqueVersions.reduce((highest, current) => {
          return compareVersions(current, highest) > 0 ? current : highest;
        });
        devDeps[name] = highestVersion;
      }
    } else {
      // La dipendenza dev è solo in alcuni progetti - aggiungiamo a conditionalDevDeps
      const highestVersion = versions.reduce((highest, current) => {
        return compareVersions(current, highest) > 0 ? current : highest;
      });
      conditionalDevDeps[name] = highestVersion;
    }
  });

  // Mostriamo il riepilogo della distribuzione
  logger.log(`\n📊 Riepilogo distribuzione dipendenze:`, "cyan", projectConfig);
  logger.log(
    `   🔧 BASE_DEPENDENCIES: ${Object.keys(baseDeps).length}`,
    "yellow",
    projectConfig
  );
  logger.log(
    `   🔀 CONDITIONAL_DEPENDENCIES: ${Object.keys(conditionalDeps).length}`,
    "yellow",
    projectConfig
  );
  logger.log(
    `   🛠️  DEV_DEPENDENCIES: ${Object.keys(devDeps).length}`,
    "yellow",
    projectConfig
  );
  logger.log(
    `   🔀 CONDITIONAL_DEV_DEPENDENCIES: ${
      Object.keys(conditionalDevDeps).length
    }`,
    "yellow",
    projectConfig
  );

  // Trova il componente con la versione TypeScript più alta e estrai il suo tsconfig
  const { component: latestTsComponent, version: latestTsVersion } =
    findLatestTypeScriptComponent(componentDirs, projectConfig);
  let tsConfig = {};

  if (latestTsComponent) {
    tsConfig = extractTsConfig(latestTsComponent, projectConfig);
    logger.log(
      `📋 TypeScript ${latestTsVersion} trovato in ${latestTsComponent}`,
      "cyan",
      projectConfig
    );
  }

  return {
    baseDeps,
    conditionalDeps,
    devDeps,
    conditionalDevDeps,
    standardTsConfig: tsConfig,
    tsVersion: latestTsVersion,
  };
}

function displayGeneratedDependencies(generated, projectConfig) {
  logger.log("\n📋 Dipendenze generate:", "cyan", projectConfig);
  logger.log("", "reset", projectConfig);

  if (Object.keys(generated.baseDeps).length > 0) {
    logger.log(
      "🔧 DIPENDENZE BASE (in tutti i progetti):",
      "yellow",
      projectConfig
    );
    Object.entries(generated.baseDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
    logger.log("", "reset", projectConfig);
  }

  if (Object.keys(generated.conditionalDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE CONDIZIONALI (solo in alcuni progetti):",
      "yellow",
      projectConfig
    );
    Object.entries(generated.conditionalDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
    logger.log("", "reset", projectConfig);
  }

  if (Object.keys(generated.devDeps).length > 0) {
    logger.log(
      "🛠️  DIPENDENZE DEV BASE (in tutti i progetti):",
      "yellow",
      projectConfig
    );
    Object.entries(generated.devDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
    logger.log("", "reset", projectConfig);
  }

  if (Object.keys(generated.conditionalDevDeps).length > 0) {
    logger.log(
      "🔀 DIPENDENZE DEV CONDIZIONALI (solo in alcuni progetti):",
      "yellow",
      projectConfig
    );
    Object.entries(generated.conditionalDevDeps).forEach(([name, version]) => {
      logger.log(`   ${name}: ${version}`, "blue", projectConfig);
    });
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
${Object.entries(generated.conditionalDeps)
  .map(([name, version]) => `  "${name}": "${version}"`)
  .join(",\n")}
};

// ============================================================================
// DIPENDENZE DEV BASE (sempre aggiunte come devDependencies)
// ============================================================================
const DEV_DEPENDENCIES = {
${Object.entries(generated.devDeps)
  .map(([name, version]) => `  "${name}": "${version}"`)
  .join(",\n")}
};

// ============================================================================
// DIPENDENZE DEV CONDIZIONALI (aggiunte solo se utilizzate come devDependencies)
// ============================================================================
const CONDITIONAL_DEV_DEPENDENCIES = {
${Object.entries(generated.conditionalDevDeps)
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
const STANDARD_TSCONFIG = ${
    Object.keys(generated.standardTsConfig).length > 0
      ? JSON.stringify(generated.standardTsConfig, null, 2)
      : '{\n  // Esempio: "compilerOptions": { "target": "es2016" }\n}'
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
  Object.entries(CONDITIONAL_DEPENDENCIES).forEach(([name, version]) => {
    allDeps[name] = version;
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

function getConditionalDevDependencies() {
  return { ...CONDITIONAL_DEV_DEPENDENCIES };
}

function getAllDevDependencies() {
  const allDevDeps = { ...DEV_DEPENDENCIES };
  Object.entries(CONDITIONAL_DEV_DEPENDENCIES).forEach(([name, version]) => {
    allDevDeps[name] = version;
  });
  return allDevDeps;
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
  CONDITIONAL_DEV_DEPENDENCIES,
  DEPRECATED_DEPENDENCIES,
  STANDARD_SCRIPTS,
  STANDARD_TSCONFIG,
  NODE_ENGINES,
  getAllDependencies,
  getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getConditionalDevDependencies,
  getAllDevDependencies,
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
