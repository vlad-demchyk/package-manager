/**
 * Workspace installation logic
 * Handles package installation in Yarn Workspace mode
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Import shared logger
const logger = require("../utils/logger");

// Import common utilities
const { 
  isWindows, 
  getNpmCommand, 
  getComponentDirectories,
  loadPackageJson,
  fileExists,
  getProjectRoot
} = require("../utils/common");

/**
 * Install packages for all components in workspace mode
 */
function installAllComponentsWorkspace(projectConfig, mode = "normal") {
  try {
    logger.section("📦 Installazione Workspace - Tutti i componenti");
    
    const projectRoot = process.cwd();
    const components = getComponentDirectories(projectConfig);
    
    if (components.length === 0) {
      logger.warning("⚠️  Nessun componente trovato");
      return false;
    }
    
    logger.log(`🔍 Trovati ${components.length} componenti per workspace`, "cyan");
    
    // Use yarn install for workspace
    const yarnCommand = "yarn install";
    logger.log(`🚀 Esecuzione: ${yarnCommand}`, "blue");
    
    try {
      execSync(yarnCommand, { 
        stdio: "inherit",
        cwd: projectRoot
      });
      
      logger.success("✅ Installazione workspace completata!");
      return true;
      
    } catch (error) {
      logger.error(`❌ Errore installazione workspace: ${error.message}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`❌ Errore installazione workspace: ${error.message}`);
    return false;
  }
}

/**
 * Install packages for specific components in workspace mode
 */
function installSpecificComponentsWorkspace(components, projectConfig, mode = "normal") {
  try {
    logger.section(`📦 Installazione Workspace - Componenti specifici`);
    
    const projectRoot = process.cwd();
    
    if (components.length === 0) {
      logger.warning("⚠️  Nessun componente specificato");
      return false;
    }
    
    logger.log(`🔍 Installazione per: ${components.join(", ")}`, "cyan");
    
    // In workspace mode, we still use yarn install at root level
    // because workspace manages all packages centrally
    const yarnCommand = "yarn install";
    logger.log(`🚀 Esecuzione: ${yarnCommand}`, "blue");
    
    try {
      execSync(yarnCommand, { 
        stdio: "inherit",
        cwd: projectRoot
      });
      
      logger.success("✅ Installazione workspace completata!");
      return true;
      
    } catch (error) {
      logger.error(`❌ Errore installazione workspace: ${error.message}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`❌ Errore installazione workspace: ${error.message}`);
    return false;
  }
}

/**
 * Reinstall packages in workspace mode
 */
function reinstallWorkspace(projectConfig, mode = "normal") {
  try {
    logger.section("🔄 Reinstallazione Workspace");
    
    const projectRoot = process.cwd();
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    
    // Remove yarn.lock if exists
    if (fs.existsSync(yarnLockPath)) {
      try {
        fs.unlinkSync(yarnLockPath);
        logger.log("🗑️  Rimosso yarn.lock", "yellow");
      } catch (error) {
        logger.warning("⚠️  Impossibile rimuovere yarn.lock");
      }
    }
    
    // Remove root node_modules
    const rootNodeModules = path.join(projectRoot, "node_modules");
    if (fs.existsSync(rootNodeModules)) {
      try {
        if (isWindows()) {
          execSync(`rmdir /s /q "${rootNodeModules}"`, { stdio: "ignore" });
        } else {
          execSync(`rm -rf "${rootNodeModules}"`, { stdio: "ignore" });
        }
        logger.log("🗑️  Rimosso root node_modules", "yellow");
      } catch (error) {
        logger.warning("⚠️  Impossibile rimuovere root node_modules");
      }
    }
    
    // Reinstall with yarn
    const yarnCommand = "yarn install";
    logger.log(`🚀 Esecuzione: ${yarnCommand}`, "blue");
    
    try {
      execSync(yarnCommand, { 
        stdio: "inherit",
        cwd: projectRoot
      });
      
      logger.success("✅ Reinstallazione workspace completata!");
      return true;
      
    } catch (error) {
      logger.error(`❌ Errore reinstallazione workspace: ${error.message}`);
      return false;
    }
    
  } catch (error) {
    logger.error(`❌ Errore reinstallazione workspace: ${error.message}`);
    return false;
  }
}

module.exports = {
  installAllComponentsWorkspace,
  installSpecificComponentsWorkspace,
  reinstallWorkspace
};