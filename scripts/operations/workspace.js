/**
 * Workspace operations for Yarn Workspaces monorepo management
 * Experimental feature for centralized package management
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("../utils/logger");

/**
 * Initialize Yarn Workspace for the project
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function initializeWorkspace(projectConfig) {
  try {
    logger.section("🏢 Inizializzazione Yarn Workspace");
    
    // Check if workspace is already initialized
    const existingStatus = getWorkspaceStatus(projectConfig);
    if (existingStatus && existingStatus.existingWorkspace) {
      logger.warning("⚠️  Workspace già configurato in package.json!");
      logger.info("Aggiorno la configurazione del manager...");
      
      // Update project config to reflect existing workspace
      updateProjectConfigWorkspace(projectConfig, true, true, existingStatus.workspaces);
      logger.success("Configurazione aggiornata per workspace esistente");
      return true;
    }
    
    if (existingStatus && existingStatus.initialized) {
      logger.warning("⚠️  Workspace già inizializzato!");
      logger.info("Usa 'Disabilita Workspace' per resettare la configurazione");
      return true;
    }
    
    // Check if Yarn is available, install if not
    if (!checkYarnAvailability()) {
      logger.warning("⚠️  Yarn non trovato, provo a installarlo automaticamente...");
      const yarnInstalled = installYarnAutomatically();
      if (!yarnInstalled) {
        logger.error("❌ Impossibile installare Yarn automaticamente");
        logger.info("💡 Installa manualmente: npm install -g yarn");
        return false;
      }
    }

    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    
    // Get all component directories
    const { getComponentDirectories } = require("../utils/common");
    const components = getComponentDirectories(projectConfig);
    
    if (components.length === 0) {
      logger.error("❌ Nessun componente trovato per workspace");
      return false;
    }

    logger.log(`📦 Trovati ${components.length} componenti per workspace`, "cyan");
    
    // Read existing root package.json
    let rootPackageJson = {};
    if (fs.existsSync(rootPackageJsonPath)) {
      try {
        rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
        logger.log("📄 Uso package.json esistente", "blue");
      } catch (error) {
        logger.error("❌ Errore lettura root package.json:");
        logger.warning(`   ${error.message}`);
        return false;
      }
    } else {
      logger.warning("⚠️  Root package.json non trovato, creo nuovo");
      rootPackageJson = {
        name: path.basename(projectRoot),
        version: "1.0.0",
        private: true
      };
    }

    // Configure workspaces
    const workspaces = components.map(comp => {
      // Convert Windows paths to Unix format for Yarn
      return comp.replace(/\\/g, "/");
    });

    // Update root package.json
    rootPackageJson.workspaces = workspaces;
    rootPackageJson.private = true;
    
    // Add workspace scripts
    if (!rootPackageJson.scripts) {
      rootPackageJson.scripts = {};
    }
    rootPackageJson.scripts["install:workspace"] = "yarn install";
    rootPackageJson.scripts["install:all"] = "yarn workspaces run install";
    rootPackageJson.scripts["clean:workspace"] = "yarn workspaces run clean";

    // Save updated package.json
    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
    logger.success("Aggiornato root package.json con workspaces");

    // Update project config with workspace settings
    updateProjectConfigWorkspace(projectConfig, true, true, components);

    // Run yarn install
    logger.log("🔄 Esecuzione yarn install per workspace...", "cyan");
    try {
      execSync("yarn install", { 
        stdio: "inherit", 
        cwd: projectRoot 
      });
      logger.success("Workspace inizializzato con successo!");
      return true;
    } catch (error) {
      logger.error("❌ Errore durante yarn install:");
      logger.warning(`   ${error.message}`);
      return false;
    }

  } catch (error) {
    logger.error("❌ Errore inizializzazione workspace:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Disable Yarn Workspace and return to standard mode
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function disableWorkspace(projectConfig) {
  try {
    logger.section("🔙 Disabilitazione modalità Workspace");
    
    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    
    // Read root package.json
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warning("⚠️  Root package.json non trovato");
      return true;
    }

    let rootPackageJson = {};
    try {
      rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
    } catch (error) {
      logger.error("❌ Errore lettura root package.json");
      return false;
    }

    // Remove workspaces configuration
    if (rootPackageJson.workspaces) {
      delete rootPackageJson.workspaces;
      logger.log("🗑️  Rimossi workspaces da package.json", "yellow");
    }

    // Remove workspace-specific scripts
    if (rootPackageJson.scripts) {
      delete rootPackageJson.scripts["install:workspace"];
      delete rootPackageJson.scripts["install:all"];
      delete rootPackageJson.scripts["clean:workspace"];
      logger.log("🗑️  Rimossi workspace scripts", "yellow");
    }

    // Save updated package.json
    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
    logger.success("Aggiornato root package.json");

    // Remove yarn.lock
    if (fs.existsSync(yarnLockPath)) {
      try {
        fs.unlinkSync(yarnLockPath);
        logger.log("🗑️  Rimosso yarn.lock", "yellow");
      } catch (error) {
        logger.warning("⚠️  Impossibile rimuovere yarn.lock");
      }
    }

    // Update project config
    updateProjectConfigWorkspace(projectConfig, false, false, []);

    logger.success("✅ Modalità Workspace disabilitata");
    logger.info("💡 Ora puoi usare la modalità standard con node_modules locali");
    return true;

  } catch (error) {
    logger.error("❌ Errore disabilitazione workspace:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Clean local node_modules to save space (workspace mode only)
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function cleanLocalNodeModules(projectConfig) {
  try {
    logger.section("🧹 Pulizia node_modules locali");
    
    // Check if workspace is actually enabled (from files, not just config)
    let isWorkspaceEnabled = projectConfig.workspace?.enabled;
    
    // If config says disabled, check actual status from files
    if (!isWorkspaceEnabled) {
      try {
        const actualStatus = getWorkspaceStatus(projectConfig);
        if (actualStatus && actualStatus.enabled && actualStatus.initialized) {
          isWorkspaceEnabled = true;
          logger.log("🔧 Modalità Workspace rilevata dai file", "blue");
        }
      } catch (error) {
        // Ignore errors, use config status
      }
    }
    
    if (!isWorkspaceEnabled) {
      logger.error("❌ Modalità Workspace non abilitata!");
      logger.info("💡 Prima abilita la modalità workspace");
      return false;
    }

    const { getComponentDirectories } = require("../utils/common");
    const components = getComponentDirectories(projectConfig);
    
    if (components.length === 0) {
      logger.warning("⚠️  Nessun componente trovato per pulizia");
      return true;
    }

    logger.log(`🔍 Scansione ${components.length} componenti...`, "cyan");
    
    let cleanedCount = 0;
    let totalSize = 0;

    components.forEach(component => {
      const componentPath = path.join(process.cwd(), component);
      const nodeModulesPath = path.join(componentPath, "node_modules");
      
      if (fs.existsSync(nodeModulesPath)) {
        try {
          // Calculate size before deletion
          const size = getDirectorySize(nodeModulesPath);
          totalSize += size;
          
          // Remove node_modules
          removeDirectoryRecursive(nodeModulesPath);
          cleanedCount++;
          
          logger.log(`✅ ${component}: rimosso node_modules (${formatBytes(size)})`, "green");
        } catch (error) {
          logger.warning(`⚠️  ${component}: impossibile rimuovere node_modules`);
        }
      } else {
        logger.log(`⚪ ${component}: node_modules non trovato`, "blue");
      }
    });

    logger.success(`✅ Puliti ${cleanedCount} componenti`);
    logger.info(`💾 Liberati ${formatBytes(totalSize)} di spazio disco`);
    logger.warning("💡 Tutti i pacchetti ora disponibili tramite root node_modules");

    return true;

  } catch (error) {
    logger.error("❌ Errore pulizia node_modules:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Get workspace status and information
 * @param {Object} projectConfig - Project configuration object
 * @returns {Object} Workspace status information
 */
function getWorkspaceStatus(projectConfig) {
  try {
    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    const rootNodeModulesPath = path.join(projectRoot, "node_modules");

    const status = {
      enabled: projectConfig.workspace?.enabled || false,
      initialized: projectConfig.workspace?.initialized || false,
      hasYarnLock: fs.existsSync(yarnLockPath),
      hasWorkspaces: false,
      workspaces: [],
      rootNodeModulesSize: 0,
      localNodeModulesCount: 0,
      existingWorkspace: false
    };

    // Check workspaces in package.json
    if (fs.existsSync(rootPackageJsonPath)) {
      try {
        const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
        if (rootPackageJson.workspaces) {
          status.hasWorkspaces = true;
          status.workspaces = rootPackageJson.workspaces;
          status.existingWorkspace = true;
          // If workspace exists in package.json, it should be considered enabled and initialized
          status.enabled = true;
          status.initialized = true;
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }

    // Calculate root node_modules size
    if (fs.existsSync(rootNodeModulesPath)) {
      status.rootNodeModulesSize = getDirectorySize(rootNodeModulesPath);
    }

    // Count local node_modules
    const { getComponentDirectories } = require("../utils/common");
    const components = getComponentDirectories(projectConfig);
    
    components.forEach(component => {
      const nodeModulesPath = path.join(process.cwd(), component, "node_modules");
      if (fs.existsSync(nodeModulesPath)) {
        status.localNodeModulesCount++;
      }
    });

    return status;

  } catch (error) {
    logger.error("❌ Errore ottenimento stato workspace:");
    logger.warning(`   ${error.message}`);
    return null;
  }
}

/**
 * Check if Yarn is available in the system
 * @returns {boolean} Yarn availability
 */
function checkYarnAvailability() {
  try {
    execSync("yarn --version", { stdio: "pipe" });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Automatically install Yarn globally
 * @returns {boolean} Success status
 */
function installYarnAutomatically() {
  try {
    logger.log("🔄 Installazione Yarn globalmente...", "cyan");
    execSync("npm install -g yarn", { stdio: "inherit" });
    
    // Verify installation
    if (checkYarnAvailability()) {
      logger.success("✅ Yarn installato con successo!");
      return true;
    } else {
      logger.error("❌ Yarn non installato dopo tentativo di installazione");
      return false;
    }
  } catch (error) {
    logger.error("❌ Errore installazione Yarn:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Update project config with workspace settings
 * @param {Object} projectConfig - Project configuration object
 * @param {boolean} enabled - Workspace enabled status
 * @param {boolean} initialized - Workspace initialized status
 * @param {Array} packagesPath - Array of package paths
 */
function updateProjectConfigWorkspace(projectConfig, enabled, initialized, packagesPath = []) {
  try {
    const projectRoot = process.cwd();
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    
    if (!fs.existsSync(configPath)) {
      logger.warning("⚠️  project-config.js non trovato");
      return false;
    }

    // Read current config
    let configContent = fs.readFileSync(configPath, "utf8");
    
    // Try regex replacement first
    let regexWorked = false;
    
    // Replace enabled field - look specifically in workspace section with multiline support
    const enabledBefore = configContent;
    configContent = configContent.replace(
      /(workspace:\s*\{[\s\S]*?enabled:\s*)(true|false)/,
      `$1${enabled}`
    );
    if (enabledBefore !== configContent) {
      regexWorked = true;
    }
    
    // Replace initialized field - look specifically in workspace section with multiline support
    const initializedBefore = configContent;
    configContent = configContent.replace(
      /(workspace:\s*\{[\s\S]*?initialized:\s*)(true|false)/,
      `$1${initialized}`
    );
    if (initializedBefore !== configContent) {
      regexWorked = true;
    }
    
    // If regex didn't work, try alternative approach
    if (!regexWorked) {
      logger.warning("⚠️  Regex non ha funzionato, provo approccio alternativo");
      
      // Try simple replacement
      configContent = configContent.replace(
        /enabled:\s*(true|false)/,
        `enabled: ${enabled}`
      );
      configContent = configContent.replace(
        /initialized:\s*(true|false)/,
        `initialized: ${initialized}`
      );
    }
    
    // Debug: log the changes
    logger.log(`🔧 Aggiornando workspace.enabled: ${enabled}`, "blue");
    logger.log(`🔧 Aggiornando workspace.initialized: ${initialized}`, "blue");
    
    // Check if changes were made
    const enabledChanged = configContent.includes(`enabled: ${enabled}`);
    const initializedChanged = configContent.includes(`initialized: ${initialized}`);
    
    if (enabledChanged) {
      logger.log(`workspace.enabled aggiornato a ${enabled}`, "green");
    } else {
      logger.warning(`⚠️  workspace.enabled non aggiornato (era già ${enabled}?)`);
    }
    
    if (initializedChanged) {
      logger.log(`workspace.initialized aggiornato a ${initialized}`, "green");
    } else {
      logger.warning(`⚠️  workspace.initialized non aggiornato (era già ${initialized}?)`);
    }
    
    // If still not working, try one more approach
    if (!enabledChanged || !initializedChanged) {
      logger.warning("⚠️  Tentativo finale con approccio diverso");
      
      // Try to replace the entire workspace section
      const workspaceSectionRegex = /workspace:\s*\{[\s\S]*?\}/;
      const newWorkspaceSection = `workspace: {
    enabled: ${enabled},
    initialized: ${initialized},
    packagesPath: ${JSON.stringify(packagesPath.length > 0 ? packagesPath : projectConfig.workspace?.packagesPath || [])},
    useYarn: true
  }`;
      
      if (workspaceSectionRegex.test(configContent)) {
        configContent = configContent.replace(workspaceSectionRegex, newWorkspaceSection);
        logger.log("✅ Sostituito intera sezione workspace", "green");
      }
    }
    
    // Replace packagesPath array (only if not using full section replacement)
    if (packagesPath.length > 0 && (enabledChanged && initializedChanged)) {
      configContent = configContent.replace(
        /(\s*packagesPath:\s*)\[[\s\S]*?\]/,
        `$1${JSON.stringify(packagesPath)}`
      );
    }
    
    // Write updated config
    fs.writeFileSync(configPath, configContent, "utf8");
    logger.success("Aggiornato project-config.js");
    
    // Verify the changes by reading the file back
    try {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve(configPath)];
      const updatedConfig = require(configPath);
      if (updatedConfig.workspace) {
        logger.log(`🔍 Verifica: workspace.enabled = ${updatedConfig.workspace.enabled}`, "blue");
        logger.log(`🔍 Verifica: workspace.initialized = ${updatedConfig.workspace.initialized}`, "blue");
        
        // If still not correct, try one more time with direct object manipulation
        if (updatedConfig.workspace.enabled !== enabled || updatedConfig.workspace.initialized !== initialized) {
          logger.warning("⚠️  Configurazione non aggiornata correttamente, provo approccio finale");
          
          // Read the file again and try direct replacement
          let finalConfigContent = fs.readFileSync(configPath, "utf8");
          
          // Direct string replacement as last resort
          finalConfigContent = finalConfigContent.replace(
            `enabled: ${updatedConfig.workspace.enabled}`,
            `enabled: ${enabled}`
          );
          finalConfigContent = finalConfigContent.replace(
            `initialized: ${updatedConfig.workspace.initialized}`,
            `initialized: ${initialized}`
          );
          
          fs.writeFileSync(configPath, finalConfigContent, "utf8");
          logger.log("✅ Tentativo finale completato", "green");
        }
      }
    } catch (error) {
      logger.warning("⚠️  Impossibile verificare le modifiche");
    }
    
    return true;

  } catch (error) {
    logger.error("❌ Errore aggiornamento configurazione:");
    logger.warning(`   ${error.message}`);
    return false;
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

/**
 * Format bytes to human readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Sync root package.json with workspace mode
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function syncRootPackageJson(projectConfig) {
  try {
    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warning("⚠️  Root package.json non trovato");
      return false;
    }

    let rootPackageJson = {};
    try {
      rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
    } catch (error) {
      logger.error("❌ Errore lettura root package.json");
      return false;
    }

    const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;
    
    if (isWorkspaceMode) {
      // Enable workspace mode - add workspaces if not present
      if (!rootPackageJson.workspaces) {
        const { getComponentDirectories } = require("../utils/common");
        const components = getComponentDirectories(projectConfig);
        
        if (components.length > 0) {
          // Use correct workspace paths without /* suffix
          const workspaces = components.map(comp => {
            // Convert Windows paths to Unix format for Yarn
            return comp.replace(/\\/g, "/");
          });
          
          rootPackageJson.workspaces = workspaces;
          rootPackageJson.private = true;
          
          fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
          logger.success("✅ Aggiunto workspaces a root package.json");
          
          // Force yarn install to create proper workspace structure
          logger.log("🔄 Esecuzione yarn install per inizializzare workspace...", "cyan");
          try {
            execSync("yarn install", { 
              stdio: "inherit", 
              cwd: projectRoot 
            });
            logger.success("✅ Workspace inizializzato correttamente");
          } catch (error) {
            logger.warning("⚠️  Errore durante yarn install, ma configurazione aggiornata");
          }
        }
      }
    } else {
      // Disable workspace mode - remove workspaces if present
      if (rootPackageJson.workspaces) {
        delete rootPackageJson.workspaces;
        delete rootPackageJson.private;
        
        fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
        logger.success("✅ Rimosso workspaces da root package.json");
        
        // Remove yarn.lock when disabling workspace
        const yarnLockPath = path.join(projectRoot, "yarn.lock");
        if (fs.existsSync(yarnLockPath)) {
          try {
            fs.unlinkSync(yarnLockPath);
            logger.log("🗑️  Rimosso yarn.lock", "yellow");
          } catch (error) {
            logger.warning("⚠️  Impossibile rimuovere yarn.lock");
          }
        }
      }
    }
    
    return true;
    
  } catch (error) {
    logger.error("❌ Errore sincronizzazione root package.json:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Remove directory recursively
 * @param {string} dirPath - Directory path to remove
 */
function removeDirectoryRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  
  const items = fs.readdirSync(dirPath);
  items.forEach(item => {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      removeDirectoryRecursive(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  });
  
  fs.rmdirSync(dirPath);
}

/**
 * Force update workspace configuration
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function forceUpdateWorkspaceConfig(projectConfig) {
  try {
    logger.section("🔧 Aggiornamento forzato configurazione workspace");
    
    const actualStatus = getWorkspaceStatus(projectConfig);
    if (actualStatus && actualStatus.enabled && actualStatus.initialized) {
      const success = updateProjectConfigWorkspace(projectConfig, true, true, actualStatus.workspaces || []);
      if (success) {
        logger.success("Configurazione workspace aggiornata forzatamente");
        return true;
      }
    } else {
      logger.warning("⚠️  Workspace non attivo, nulla da aggiornare");
    }
    
    return false;
  } catch (error) {
    logger.error("❌ Errore aggiornamento forzato configurazione:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

/**
 * Sync workspace configuration with current project structure
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function syncWorkspaceWithProjects(projectConfig) {
  try {
    logger.section("🔄 Sincronizzazione workspace con struttura progetti corrente");
    
    // Check if workspace is enabled
    const actualStatus = getWorkspaceStatus(projectConfig);
    if (!actualStatus || !actualStatus.enabled) {
      logger.warning("⚠️  Workspace non attivo, nulla da sincronizzare");
      return false;
    }
    
    // Get current components
    const { getComponentDirectories } = require("../utils/common");
    const currentComponents = getComponentDirectories(projectConfig);
    
    if (currentComponents.length === 0) {
      logger.warning("⚠️  Nessun progetto trovato per la sincronizzazione");
      return false;
    }
    
    // Get current workspaces from package.json
    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.error("❌ Root package.json non trovato");
      return false;
    }
    
    const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
    const currentWorkspaces = rootPackageJson.workspaces || [];
    
    // Convert components to workspace format
    const newWorkspaces = currentComponents.map(component => {
      // Convert backslashes to forward slashes for consistency
      return component.replace(/\\/g, '/');
    });
    
    // Check if workspaces need updating
    const workspacesChanged = JSON.stringify(currentWorkspaces.sort()) !== JSON.stringify(newWorkspaces.sort());
    
    if (!workspacesChanged) {
      logger.log("Workspaces già sincronizzati", "green");
      return true;
    }
    
    logger.log(`📦 Trovati ${currentComponents.length} progetti:`, "blue");
    currentComponents.forEach((component, index) => {
      logger.log(`   ${index + 1}. ${component}`, "blue");
    });
    
    logger.log("🔄 Aggiorno workspaces in package.json...", "cyan");
    
    // Update package.json
    rootPackageJson.workspaces = newWorkspaces;
    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
    logger.success("✅ Root package.json aggiornato");
    
    // Update project-config.js
    const success = updateProjectConfigWorkspace(projectConfig, true, true, currentComponents);
    if (success) {
      logger.success("✅ project-config.js aggiornato");
    }
    
    // Run yarn install to update workspace
    logger.log("🔄 Eseguo yarn install per aggiornare workspace...", "cyan");
    try {
      execSync("yarn install", {
        cwd: projectRoot,
        stdio: "inherit"
      });
      logger.success("Workspace aggiornato con successo");
    } catch (error) {
      logger.warning("⚠️  Errore durante yarn install, ma configurazione aggiornata");
    }
    
    return true;
    
  } catch (error) {
    logger.error("❌ Errore sincronizzazione workspace:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

module.exports = {
  initializeWorkspace,
  disableWorkspace,
  cleanLocalNodeModules,
  getWorkspaceStatus,
  checkYarnAvailability,
  installYarnAutomatically,
  updateProjectConfigWorkspace,
  formatBytes,
  syncRootPackageJson,
  forceUpdateWorkspaceConfig,
  syncWorkspaceWithProjects
};
