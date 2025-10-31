/**
 * Standard installation logic for individual project components
 * Original npm-based installation approach
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("../utils/logger");
const { removeDirectory, removeFile } = require("../utils/common");

/**
 * Install packages for a single component using standard npm approach
 * @param {string} componentPath - Path to component directory
 * @param {string} mode - Installation mode (normal, legacy, force)
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function installPackagesStandard(componentPath, mode = "normal", projectConfig) {
  try {
    const componentName = path.basename(componentPath);
    
    if (!projectConfig.files || !projectConfig.files.packageJson) {
      logger.log(`❌ projectConfig.files.packageJson non definito`, "red");
      return false;
    }
    
    const packageJsonPath = path.join(
      componentPath,
      projectConfig.files.packageJson
    );

    if (!fs.existsSync(packageJsonPath)) {
      logger.log(
        `❌ ${projectConfig.files.packageJson} non trovato in ${componentName}`,
        "red"
      );
      return false;
    }

    logger.log(
      `📦 Installazione pacchetti per ${componentName} (modalità standard: ${mode})...`,
      "cyan"
    );

    const originalCwd = process.cwd();
    
    try {
      process.chdir(componentPath);

      let npmArgs = ["install"];

      switch (mode) {
        case "clean":
          logger.log(`🧹 Pulizia ${componentName}...`, "yellow");
          removeDirectory(projectConfig.files.nodeModules);
          removeFile(projectConfig.files.packageLock);
          logger.log(`✅ Pulito ${componentName}`, "green");
          break;

        case "legacy":
          npmArgs.push("--legacy-peer-deps");
          logger.log(
            `⚠️  Utilizzo --legacy-peer-deps per ${componentName}`,
            "yellow"
          );
          break;

        case "force":
          npmArgs.push("--force");
          logger.log(`⚠️  Utilizzo --force per ${componentName}`, "yellow");
          break;
      }

      // Check if project is configured as Yarn Workspace
      const { detectWorkspaceConfiguration } = require("../utils/workspace-detector");
      const workspaceDetection = detectWorkspaceConfiguration(process.cwd());
      
      if (workspaceDetection && workspaceDetection.hasWorkspaceConfig && workspaceDetection.hasYarnLock) {
        logger.warning(`⚠️  Progetto configurato come Yarn Workspace!`);
        logger.info(`💡 Utilizzare la modalità workspace per installare i pacchetti`);
        logger.info(`📦 Eseguire: yarn install (nella directory root)`);
        return false;
      }

      const { getNpmCommand } = require("../utils/common");
      logger.log(`🔄 Esecuzione: ${getNpmCommand(projectConfig)} ${npmArgs.join(" ")}`, "blue");

      const result = execSync(`${getNpmCommand(projectConfig)} ${npmArgs.join(" ")}`, {
        stdio: "inherit",
        cwd: componentPath,
      });

      logger.log(
        `✅ Pacchetti installati con successo per ${componentName}`,
        "green"
      );
      return true;
    } catch (error) {
      logger.log(
        `❌ Errore durante l'installazione dei pacchetti per ${componentName}: ${error.message}`,
        "red"
      );
      return false;
    } finally {
      // Ritorno alla directory originale
      process.chdir(originalCwd);
    }

  } catch (error) {
    logger.log(
      `❌ Errore installazione pacchetti per ${componentPath}: ${error.message}`,
      "red"
    );
    return false;
  }
}

/**
 * Install packages for all components using standard npm approach
 * @param {string} mode - Installation mode (normal, legacy, force)
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function installAllComponentsStandard(mode = "normal", projectConfig) {
  try {
    const { getComponentDirectories } = require("../utils/common");
    const components = getComponentDirectories(projectConfig);

    if (components.length === 0) {
      logger.error("Nessun componente trovato");
      return false;
    }

    logger.log(
      `🚀 Installazione pacchetti per tutti i ${components.length} componenti (modalità standard)...`,
      "cyan"
    );

    let successCount = 0;
    const totalCount = components.length;
    const originalCwd = process.cwd();

    components.forEach((component, index) => {
      logger.log(
        `\n[${index + 1}/${totalCount}] Elaborazione ${component}...`,
        "magenta"
      );
      const componentPath = path.join(originalCwd, component);
      const success = installPackagesStandard(componentPath, mode, projectConfig);
      if (success) successCount++;
    });

    logger.log(`\n📊 Risultato:`, "cyan");
    logger.log(`   ✅ Successo: ${successCount}/${totalCount}`, "green");
    logger.log(
      `   ❌ Errori: ${totalCount - successCount}/${totalCount}`,
      totalCount - successCount > 0 ? "red" : "green"
    );

    return successCount === totalCount;

  } catch (error) {
    logger.error(`❌ Errore installazione tutti i componenti: ${error.message}`);
    return false;
  }
}


module.exports = {
  installPackagesStandard,
  installAllComponentsStandard
};
