/**
 * Operazioni di pulizia componenti
 * Rimuove node_modules, package-lock.json e tslint.json
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

function isWindows() {
  return process.platform === "win32";
}

function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      if (isWindows()) {
        execSync(`rmdir /s /q "${dirPath}"`, { stdio: "ignore" });
      } else {
        execSync(`rm -rf "${dirPath}"`, { stdio: "ignore" });
      }
      return false;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return false;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function cleanComponent(componentPath, projectConfig) {
  const componentName = path.basename(componentPath);
  let cleanedItems = [];

  logger.log(`🧹 Pulizia ${componentName}...`, "yellow", projectConfig);

  // Rimuoviamo node_modules
  const nodeModulesPath = path.join(
    componentPath,
    projectConfig.files.nodeModules
  );
  if (removeDirectory(nodeModulesPath)) {
    cleanedItems.push(projectConfig.files.nodeModules);
  }

  // Rimuoviamo package-lock.json
  const packageLockPath = path.join(
    componentPath,
    projectConfig.files.packageLock
  );
  if (removeFile(packageLockPath)) {
    cleanedItems.push(projectConfig.files.packageLock);
  }

  // Rimuoviamo tslint.json
  const tslintPath = path.join(componentPath, projectConfig.files.tslint);
  if (removeFile(tslintPath)) {
    cleanedItems.push(projectConfig.files.tslint);
  }

  if (cleanedItems.length > 0) {
    logger.log(
      `✅ Pulito ${componentName}: ${cleanedItems.join(", ")}`,
      "green",
      projectConfig
    );
    return false;
  } else {
    logger.log(`ℹ️  ${componentName} già pulito`, "blue", projectConfig);
    return false;
  }
}

function cleanAllComponents(excludeList = [], projectConfig) {
  const components = getComponentDirectories(projectConfig);

  if (components.length === 0) {
    logger.log("❌ Nessun componente trovato", "red", projectConfig);
    return;
  }

  const filteredComponents = components.filter(
    (component) => !excludeList.includes(component)
  );

  if (filteredComponents.length === 0) {
    logger.log(
      "❌ Tutti i componenti esclusi dalla pulizia",
      "red",
      projectConfig
    );
    return;
  }

  logger.log(
    `🧹 Pulizia ${filteredComponents.length} componenti...`,
    "cyan",
    projectConfig
  );

  if (excludeList.length > 0) {
    logger.log(
      `🚫 Escluso dalla pulizia: ${excludeList.join(", ")}`,
      "yellow",
      projectConfig
    );
  }

  let successCount = 0;
  const totalCount = filteredComponents.length;

  filteredComponents.forEach((component, index) => {
    logger.log(
      `\n[${index + 1}/${totalCount}] Elaborazione ${component}...`,
      "magenta",
      projectConfig
    );
    const success = cleanComponent(
      path.join(process.cwd(), component),
      projectConfig
    );
    if (success) successCount++;
  });

  logger.log(`\n📊 Risultato pulizia:`, "cyan", projectConfig);
  logger.log(
    `   ✅ Pulito con successo: ${successCount}/${totalCount}`,
    "green",
    projectConfig
  );
  logger.log(
    `   ❌ Errori: ${totalCount - successCount}/${totalCount}`,
    totalCount - successCount > 0 ? "red" : "green",
    projectConfig
  );
}

module.exports = {
  cleanComponent,
  getComponentDirectories,
  cleanAllComponents,
};
