/**
 * Workspace detection utilities for automatic workspace configuration detection
 * Helps other users to discover and use existing workspace setups
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * Detect if workspace configuration exists in the project
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Workspace detection result
 */
function detectWorkspaceConfiguration(projectRoot) {
  try {
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    const rootNodeModulesPath = path.join(projectRoot, "node_modules");

    const detection = {
      hasWorkspaceConfig: false,
      hasYarnLock: false,
      hasRootNodeModules: false,
      workspaces: [],
      workspaceCount: 0,
      isYarnWorkspace: false,
      isNpmWorkspace: false,
      packageManager: "unknown"
    };

    // Check for package.json
    if (!fs.existsSync(rootPackageJsonPath)) {
      return detection;
    }

    try {
      const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
      
      // Check for workspaces configuration
      if (rootPackageJson.workspaces) {
        detection.hasWorkspaceConfig = true;
        detection.workspaces = rootPackageJson.workspaces;
        detection.workspaceCount = rootPackageJson.workspaces.length;
      }

      // Determine package manager based on lock files and workspaces
      if (fs.existsSync(yarnLockPath)) {
        detection.hasYarnLock = true;
        detection.packageManager = "yarn";
        detection.isYarnWorkspace = detection.hasWorkspaceConfig;
      }

      // Check for npm workspaces (package-lock.json)
      const packageLockPath = path.join(projectRoot, "package-lock.json");
      if (fs.existsSync(packageLockPath) && detection.hasWorkspaceConfig) {
        detection.isNpmWorkspace = true;
        if (!detection.hasYarnLock) {
          detection.packageManager = "npm";
        }
      }

      // Check for root node_modules
      if (fs.existsSync(rootNodeModulesPath)) {
        detection.hasRootNodeModules = true;
      }

    } catch (error) {
      logger.warning("⚠️  Errore lettura root package.json");
    }

    return detection;

  } catch (error) {
    logger.error("❌ Errore rilevamento workspace:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

/**
 * Check if workspace is properly configured and functional
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Workspace health check result
 */
function checkWorkspaceHealth(projectRoot) {
  try {
    const detection = detectWorkspaceConfiguration(projectRoot);
    
    if (!detection.hasWorkspaceConfig) {
      return {
        isHealthy: false,
        issues: ["Configurazione Workspace non trovata"],
        recommendations: ["Aggiungere workspaces al root package.json"]
      };
    }

    const issues = [];
    const recommendations = [];

    // Check if workspaces are properly configured
    if (detection.workspaceCount === 0) {
      issues.push("Array workspaces vuoto");
      recommendations.push("Aggiungere percorsi progetti in workspaces");
    }

    // Check for lock file
    if (!detection.hasYarnLock && !detection.hasNpmLock) {
      issues.push("File lock non trovato");
      recommendations.push("Eseguire yarn install o npm install");
    }

    // Check for root node_modules
    if (!detection.hasRootNodeModules) {
      issues.push("Root node_modules non trovato");
      recommendations.push("Eseguire installazione pacchetti");
    }

    // Check if workspace directories exist
    const missingWorkspaces = [];
    detection.workspaces.forEach(workspace => {
      const workspacePath = path.join(projectRoot, workspace);
      if (!fs.existsSync(workspacePath)) {
        missingWorkspaces.push(workspace);
      }
    });

    if (missingWorkspaces.length > 0) {
      issues.push(`Directory workspace mancanti: ${missingWorkspaces.join(", ")}`);
      recommendations.push("Verificare percorsi directory workspace");
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      recommendations,
      detection
    };

  } catch (error) {
    logger.error("❌ Errore verifica salute workspace:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

/**
 * Suggest workspace setup for detected projects
 * @param {string} projectRoot - Project root directory
 * @param {Object} projectConfig - Project configuration object
 * @returns {Object} Workspace setup suggestion
 */
function suggestWorkspaceSetup(projectRoot, projectConfig) {
  try {
    const { getComponentDirectories } = require("./common");
    const components = getComponentDirectories(projectConfig);
    
    if (components.length === 0) {
      return {
        canSetup: false,
        reason: "Nessun componente trovato per workspace"
      };
    }

    const detection = detectWorkspaceConfiguration(projectRoot);
    
    // If workspace already exists, suggest using it
    if (detection.hasWorkspaceConfig) {
      return {
        canSetup: false,
        reason: "Workspace già configurato",
        suggestion: "Utilizzare workspace esistente o disabilitarlo"
      };
    }

    // Check if Yarn is available
    const { checkYarnAvailability } = require("../operations/workspace");
    const yarnAvailable = checkYarnAvailability();

    if (!yarnAvailable) {
      return {
        canSetup: true,
        requiresYarn: true,
        components,
        suggestion: "Installare Yarn per utilizzare modalità workspace"
      };
    }

    return {
      canSetup: true,
      requiresYarn: false,
      components,
      suggestion: "È possibile configurare workspace per gestione centralizzata pacchetti"
    };

  } catch (error) {
    logger.error("❌ Errore creazione proposta workspace:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

/**
 * Auto-detect and prompt for workspace usage
 * @param {Object} projectConfig - Project configuration object
 * @param {Function} askQuestion - Function to ask user questions
 * @returns {boolean} Whether workspace was enabled
 */
async function autoDetectAndPromptWorkspace(projectConfig, askQuestion) {
  try {
    const projectRoot = process.cwd();
    const detection = detectWorkspaceConfiguration(projectRoot);
    
    // If workspace is already enabled in config, return
    if (projectConfig.workspace?.enabled) {
      return true;
    }

    // If workspace config exists but not enabled, prompt user
    if (detection.hasWorkspaceConfig) {
      logger.section("🔍 Rilevata configurazione Yarn Workspace");
      logger.info("📦 Trovati workspaces in root package.json");
      logger.info(`📊 Numero workspace: ${detection.workspaceCount}`);
      logger.info(`📁 Package manager: ${detection.packageManager}`);
      
      const useWorkspace = await askQuestion(
        "Vuoi utilizzare la modalità workspace? (y/n): "
      );
      
      if (useWorkspace.toLowerCase() === "y" || useWorkspace.toLowerCase() === "yes") {
        // Check if Yarn is available
        const { checkYarnAvailability } = require("../operations/workspace");
        if (!checkYarnAvailability()) {
          logger.error("❌ Yarn non trovato!");
          logger.info("💡 Installare Yarn: npm install -g yarn");
          return false;
        }
        
        // Enable workspace in config
        const { updateProjectConfigWorkspace } = require("../operations/workspace");
        updateProjectConfigWorkspace(projectConfig, true, true, detection.workspaces);
        
        logger.success("✅ Modalità Workspace abilitata!");
        return true;
      }
    }

    return false;

  } catch (error) {
    logger.error("❌ Errore rilevamento automatico workspace:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Get workspace statistics and information
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Workspace statistics
 */
function getWorkspaceStatistics(projectRoot) {
  try {
    const detection = detectWorkspaceConfiguration(projectRoot);
    
    if (!detection.hasWorkspaceConfig) {
      return null;
    }

    const stats = {
      workspaceCount: detection.workspaceCount,
      packageManager: detection.packageManager,
      hasLockFile: detection.hasYarnLock || detection.hasNpmLock,
      hasRootNodeModules: detection.hasRootNodeModules,
      rootNodeModulesSize: 0,
      localNodeModulesCount: 0
    };

    // Calculate root node_modules size
    if (stats.hasRootNodeModules) {
      const rootNodeModulesPath = path.join(projectRoot, "node_modules");
      stats.rootNodeModulesSize = getDirectorySize(rootNodeModulesPath);
    }

    // Count local node_modules in workspaces
    detection.workspaces.forEach(workspace => {
      const workspacePath = path.join(projectRoot, workspace);
      if (fs.existsSync(workspacePath)) {
        const nodeModulesPath = path.join(workspacePath, "node_modules");
        if (fs.existsSync(nodeModulesPath)) {
          stats.localNodeModulesCount++;
        }
      }
    });

    return stats;

  } catch (error) {
    logger.error("❌ Errore ottenimento statistiche workspace:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

/**
 * Get directory size in bytes
 * @param {string} dirPath - Directory path
 * @returns {number} Size in bytes
 */
function getDirectorySize(dirPath) {
  let size = 0;
  
  try {
    const items = fs.readdirSync(dirPath);
    items.forEach(item => {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        size += getDirectorySize(fullPath);
      } else {
        size += stat.size;
      }
    });
  } catch (error) {
    // Ignore errors
  }
  
  return size;
}

module.exports = {
  detectWorkspaceConfiguration,
  checkWorkspaceHealth,
  suggestWorkspaceSetup,
  autoDetectAndPromptWorkspace,
  getWorkspaceStatistics
};
