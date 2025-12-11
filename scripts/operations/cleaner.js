/**
 * Operazioni di pulizia componenti
 * Rimuove node_modules, package-lock.json e tslint.json
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Import shared logger and common utilities
const logger = require("../utils/logger");
const { 
  isWindows, 
  getNpmCommand, 
  getComponentDirectories,
  loadPackageJson,
  fileExists,
  getProjectRoot,
  removeDirectory,
  removeFile,
  removeDirectoryRecursive,
  formatBytes,
  getDirectorySize
} = require("../utils/common");

function cleanComponent(componentPath, projectConfig, cleanMode = "lock-and-modules") {
  const componentName = path.basename(componentPath);
  let cleanedItems = [];

  logger.log(`🧹 Pulizia ${componentName}...`, "yellow", projectConfig);

  // Check if project is configured as Yarn Workspace
  const { detectWorkspaceConfiguration } = require("../utils/workspace-detector");
  const workspaceDetection = detectWorkspaceConfiguration(process.cwd());
  
  if (workspaceDetection && workspaceDetection.hasWorkspaceConfig && workspaceDetection.hasYarnLock) {
    logger.warning(`⚠️  Progetto configurato come Yarn Workspace!`);
    logger.info(`💡 Pulizia file lock conflittuali...`);
    
    // Remove package-lock.json from root if exists (conflict with yarn.lock)
    const rootPackageLockPath = path.join(process.cwd(), "package-lock.json");
    if (removeFile(rootPackageLockPath)) {
      cleanedItems.push("root package-lock.json");
      logger.log(`✅ Rimosso package-lock.json conflittuale da root`, "green");
    }
  }

  // Rimuoviamo node_modules solo se cleanMode è "lock-and-modules"
  if (cleanMode === "lock-and-modules") {
    const nodeModulesPath = path.join(
      componentPath,
      projectConfig.files.nodeModules
    );
    if (removeDirectory(nodeModulesPath)) {
      cleanedItems.push(projectConfig.files.nodeModules);
    }
  }

  // Rimuoviamo package-lock.json (sempre, in entrambi i modi)
  const packageLockPath = path.join(
    componentPath,
    projectConfig.files.packageLock
  );
  if (removeFile(packageLockPath)) {
    cleanedItems.push(projectConfig.files.packageLock);
  }

  // Rimuoviamo tslint.json solo se cleanMode è "lock-and-modules"
  if (cleanMode === "lock-and-modules") {
    const tslintPath = path.join(componentPath, projectConfig.files.tslint);
    if (removeFile(tslintPath)) {
      cleanedItems.push(projectConfig.files.tslint);
    }
  }

  if (cleanedItems.length > 0) {
    logger.log(
      `✅ Pulito ${componentName}: ${cleanedItems.join(", ")}`,
      "green",
      projectConfig
    );
    return true; // Successfully cleaned
  } else {
    logger.log(`ℹ️  ${componentName} già pulito`, "blue", projectConfig);
    return true; // Already clean, considered success
  }
}

function cleanAllComponents(excludeList = [], projectConfig, cleanMode = "lock-and-modules") {
  // Check if workspace mode is enabled
  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;
  
  if (isWorkspaceMode) {
    return cleanWorkspaceComponents(excludeList, projectConfig, cleanMode);
  } else {
    return cleanStandardComponents(excludeList, projectConfig, cleanMode);
  }
}

function cleanStandardComponents(excludeList = [], projectConfig, cleanMode = "lock-and-modules") {
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
      projectConfig,
      cleanMode
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

/**
 * Auto-detect and resolve lock file conflicts
 * @param {Object} projectConfig - Project configuration object
 * @returns {boolean} Success status
 */
function resolveLockFileConflicts(projectConfig) {
  try {
    logger.section("🔍 Rilevamento automatico conflitti file lock");
    
    const { detectWorkspaceConfiguration } = require("../utils/workspace-detector");
    const workspaceDetection = detectWorkspaceConfiguration(process.cwd());
    
    if (!workspaceDetection) {
      logger.info("ℹ️  Workspace non rilevato, nessun conflitto");
      return true;
    }
    
    const projectRoot = process.cwd();
    const packageLockPath = path.join(projectRoot, "package-lock.json");
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    
    let conflictsResolved = 0;
    
    // Check for package-lock.json conflict with yarn.lock
    if (workspaceDetection.hasYarnLock && fs.existsSync(packageLockPath)) {
      logger.warning("⚠️  Rilevato conflitto: package-lock.json + yarn.lock");
      logger.info("💡 Rimuovo package-lock.json per evitare conflitti");
      
      if (removeFile(packageLockPath)) {
        conflictsResolved++;
        logger.success("✅ Rimosso package-lock.json conflittuale");
      } else {
        logger.error("❌ Impossibile rimuovere package-lock.json");
        return false;
      }
    }
    
    // Check for yarn.lock conflict with package-lock.json
    if (workspaceDetection.hasNpmLock && fs.existsSync(yarnLockPath)) {
      logger.warning("⚠️  Rilevato conflitto: yarn.lock + package-lock.json");
      logger.info("💡 Rimuovo yarn.lock per evitare conflitti");
      
      if (removeFile(yarnLockPath)) {
        conflictsResolved++;
        logger.success("✅ Rimosso yarn.lock conflittuale");
      } else {
        logger.error("❌ Impossibile rimuovere yarn.lock");
        return false;
      }
    }
    
    if (conflictsResolved > 0) {
      logger.success(`✅ Risolti ${conflictsResolved} conflitti file lock`);
      logger.info("💡 Ora è possibile installare i pacchetti in sicurezza");
    } else {
      logger.info("ℹ️  Nessun conflitto file lock rilevato");
    }
    
    return true;
    
  } catch (error) {
    logger.error("❌ Errore risoluzione conflitti file lock:");
    logger.warning(`   ${error.message}`);
    return false;
  }
}

function cleanWorkspaceComponents(excludeList = [], projectConfig, cleanMode = "lock-and-modules") {
  logger.section("🧹 Workspace Clean Mode");
  logger.info("📦 Pulizia in modalità workspace");
  logger.info("🔍 Rimuove solo lock files e tslint.json dai workspace, mantiene root node_modules");
  
  // Resolve lock file conflicts before cleaning
  logger.log("🔍 Chiamata resolveLockFileConflicts...", "blue");
  logger.log("🔍 Funzione resolveLockFileConflicts definita:", typeof resolveLockFileConflicts, "blue");
  try {
    // Call the function directly since it's defined in the same file
    const result = resolveLockFileConflicts(projectConfig);
    logger.log("✅ resolveLockFileConflicts completata, risultato:", result, "green");
  } catch (error) {
    logger.error("❌ Errore in resolveLockFileConflicts:");
    logger.warning(`   ${error.message}`);
  }
  
  const projectRoot = process.cwd();
  const { getComponentDirectories } = require("../utils/common");
  const components = getComponentDirectories(projectConfig);
  
  if (components.length === 0) {
    logger.warning("⚠️  Nessun workspace trovato per la pulizia");
    return;
  }

  // Filter components based on exclude list
  const filteredComponents = components.filter(
    (component) => !excludeList.includes(component)
  );

  if (filteredComponents.length === 0) {
    logger.log(
      "❌ Tutti i workspace esclusi dalla pulizia",
      "red"
    );
    return;
  }

  logger.log(`🧹 Pulizia ${filteredComponents.length} workspace...`, "cyan");

  if (excludeList.length > 0) {
    logger.log(
      `🚫 Escluso dalla pulizia: ${excludeList.join(", ")}`,
      "yellow"
    );
  }

  // Analyze shared dependencies across all workspaces
  logger.log("🔍 Analisi dipendenze condivise...", "cyan");
  const sharedAnalysis = analyzeSharedDependencies(filteredComponents, projectRoot);
  
  if (sharedAnalysis.sharedDependencies.dependencies.size > 0 || sharedAnalysis.sharedDependencies.devDependencies.size > 0) {
    logger.warning("Dipendenze condivise rilevate tra workspace:");
    if (sharedAnalysis.sharedDependencies.dependencies.size > 0) {
      logger.log(`   📦 Dependencies: ${Array.from(sharedAnalysis.sharedDependencies.dependencies).join(", ")}`, "yellow");
    }
    if (sharedAnalysis.sharedDependencies.devDependencies.size > 0) {
      logger.log(`   🔧 DevDependencies: ${Array.from(sharedAnalysis.sharedDependencies.devDependencies).join(", ")}`, "yellow");
    }
    logger.info("ℹ️  Queste dipendenze sono gestite centralmente dal root node_modules");
    logger.info("ℹ️  Non possono essere rimosse da singoli workspace per evitare conflitti");
  }

  let successCount = 0;
  const totalCount = filteredComponents.length;
  let totalSize = 0;

  filteredComponents.forEach((workspace, index) => {
    logger.log(
      `\n[${index + 1}/${totalCount}] Elaborazione ${workspace}...`,
      "magenta"
    );
    
    const workspacePath = path.join(projectRoot, workspace);
    const success = cleanWorkspaceComponent(workspacePath, workspace, sharedAnalysis, projectConfig, cleanMode);
    
    if (success) {
      successCount++;
    }
  });

  logger.log(`\n📊 Risultato pulizia workspace:`, "cyan");
  logger.log(
    `   ✅ Pulito con successo: ${successCount}/${totalCount}`,
    "green"
  );
  logger.log(
    `   ❌ Errori: ${totalCount - successCount}/${totalCount}`,
    totalCount - successCount > 0 ? "red" : "green"
  );
  
  if (totalSize > 0) {
    logger.info(`💾 Liberati ${formatBytes(totalSize)} di spazio disco`);
  }
  
  logger.warning("💡 Root node_modules mantenuto per workspace centralizzato");
  logger.info("I pacchetti sono disponibili tramite root node_modules");
}


/**
 * Analyze shared dependencies across all workspaces
 * @param {Array} components - Array of workspace components
 * @param {string} projectRoot - Project root path
 * @returns {Object} Analysis of shared dependencies
 */
function analyzeSharedDependencies(components, projectRoot) {
  const allDependencies = {
    dependencies: new Set(),
    devDependencies: new Set()
  };
  
  const workspaceDependencies = {};
  
  // Collect dependencies from all workspaces
  components.forEach(component => {
    const componentPath = path.join(projectRoot, component);
    const packageJsonPath = path.join(componentPath, "package.json");
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
        const componentDeps = {
          dependencies: new Set(),
          devDependencies: new Set()
        };
        
        // Collect dependencies
        if (packageJson.dependencies) {
          Object.keys(packageJson.dependencies).forEach(dep => {
            allDependencies.dependencies.add(dep);
            componentDeps.dependencies.add(dep);
          });
        }
        
        // Collect devDependencies
        if (packageJson.devDependencies) {
          Object.keys(packageJson.devDependencies).forEach(dep => {
            allDependencies.devDependencies.add(dep);
            componentDeps.devDependencies.add(dep);
          });
        }
        
        workspaceDependencies[component] = componentDeps;
      } catch (error) {
        logger.warning(`⚠️  Impossibile leggere package.json di ${component}`);
      }
    }
  });
  
  // Find shared dependencies
  const sharedDependencies = {
    dependencies: new Set(),
    devDependencies: new Set()
  };
  
  // Check which dependencies are used by multiple workspaces
  allDependencies.dependencies.forEach(dep => {
    let usageCount = 0;
    Object.values(workspaceDependencies).forEach(componentDeps => {
      if (componentDeps.dependencies.has(dep)) {
        usageCount++;
      }
    });
    if (usageCount > 1) {
      sharedDependencies.dependencies.add(dep);
    }
  });
  
  allDependencies.devDependencies.forEach(dep => {
    let usageCount = 0;
    Object.values(workspaceDependencies).forEach(componentDeps => {
      if (componentDeps.devDependencies.has(dep)) {
        usageCount++;
      }
    });
    if (usageCount > 1) {
      sharedDependencies.devDependencies.add(dep);
    }
  });
  
  return {
    allDependencies,
    sharedDependencies,
    workspaceDependencies
  };
}

/**
 * Clean single workspace component with shared dependency check
 * @param {string} componentPath - Path to component
 * @param {string} componentName - Name of component
 * @param {Object} sharedAnalysis - Shared dependencies analysis
 * @param {Object} projectConfig - Project configuration
 * @returns {boolean} Success status
 */
function cleanWorkspaceComponent(componentPath, componentName, sharedAnalysis, projectConfig, cleanMode = "lock-and-modules") {
  const packageJsonPath = path.join(componentPath, "package.json");
  
  if (!fs.existsSync(packageJsonPath)) {
    logger.warning(`⚠️  package.json non trovato per ${componentName}`);
    return false;
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const componentDeps = sharedAnalysis.workspaceDependencies[componentName];
    
    if (!componentDeps) {
      logger.warning(`⚠️  Impossibile analizzare dipendenze di ${componentName}`);
      return false;
    }
    
    let cleanedItems = [];
    let totalSize = 0;
    
    // Check for shared dependencies that cannot be removed
    const sharedDeps = [];
    const sharedDevDeps = [];
    
    componentDeps.dependencies.forEach(dep => {
      if (sharedAnalysis.sharedDependencies.dependencies.has(dep)) {
        sharedDeps.push(dep);
      }
    });
    
    componentDeps.devDependencies.forEach(dep => {
      if (sharedAnalysis.sharedDependencies.devDependencies.has(dep)) {
        sharedDevDeps.push(dep);
      }
    });
    
    if (sharedDeps.length > 0 || sharedDevDeps.length > 0) {
      logger.warning(`${componentName}: dipendenze condivise rilevate`);
      if (sharedDeps.length > 0) {
        logger.log(`   📦 Dependencies: ${sharedDeps.join(", ")}`, "yellow");
      }
      if (sharedDevDeps.length > 0) {
        logger.log(`   🔧 DevDependencies: ${sharedDevDeps.join(", ")}`, "yellow");
      }
      logger.log(`   ℹ️  Queste dipendenze sono gestite dal root node_modules`, "blue");
      logger.log(`   ℹ️  Non vengono rimosse per evitare conflitti con altri workspace`, "blue");
    }
    
    // Remove package-lock.json from workspace
    const packageLockPath = path.join(componentPath, "package-lock.json");
    if (fs.existsSync(packageLockPath)) {
      try {
        const stats = fs.statSync(packageLockPath);
        totalSize += stats.size;
        fs.unlinkSync(packageLockPath);
        cleanedItems.push("package-lock.json");
        logger.log(`✅ Rimosso package-lock.json da ${componentName}`, "green");
      } catch (error) {
        logger.warning(`⚠️  ${componentName}: impossibile rimuovere package-lock.json`);
      }
    }
    
    // Remove tslint.json from workspace (solo se cleanMode è "lock-and-modules")
    if (cleanMode === "lock-and-modules") {
      const tslintPath = path.join(componentPath, "tslint.json");
      if (fs.existsSync(tslintPath)) {
        try {
          const stats = fs.statSync(tslintPath);
          totalSize += stats.size;
          fs.unlinkSync(tslintPath);
          cleanedItems.push("tslint.json");
          logger.log(`✅ Rimosso tslint.json da ${componentName}`, "green");
        } catch (error) {
          logger.warning(`⚠️  ${componentName}: impossibile rimuovere tslint.json`);
        }
      }
    }
    
    // Remove local node_modules from workspace (solo se cleanMode è "lock-and-modules")
    if (cleanMode === "lock-and-modules") {
      const localNodeModulesPath = path.join(componentPath, "node_modules");
      if (fs.existsSync(localNodeModulesPath)) {
        try {
          const size = getDirectorySize(localNodeModulesPath);
          totalSize += size;
          removeDirectoryRecursive(localNodeModulesPath);
          cleanedItems.push("node_modules/");
          logger.log(`✅ Rimosso node_modules locale da ${componentName} (${formatBytes(size)})`, "green");
        } catch (error) {
          logger.warning(`⚠️  ${componentName}: impossibile rimuovere node_modules locale`);
        }
      }
    }
    
    if (cleanedItems.length > 0) {
      logger.log(`${componentName}: pulito (${cleanedItems.join(", ")})`, "green");
      if (totalSize > 0) {
        logger.info(`💾 Liberati ${formatBytes(totalSize)} di spazio disco`);
      }
      logger.info("ℹ️  Nota: Le dipendenze condivise rimangono nel root node_modules");
    } else {
      logger.log(`${componentName}: già pulito`, "blue");
    }
    
    return true;
    
  } catch (error) {
    logger.error(`❌ Errore pulizia ${componentName}: ${error.message}`);
    return false;
  }
}

/**
 * Clean single workspace component with shared dependency analysis
 * @param {string} componentName - Name of component to clean
 * @param {Object} projectConfig - Project configuration
 * @returns {boolean} Success status
 */
function cleanSingleWorkspaceComponent(componentName, projectConfig, cleanMode = "lock-and-modules") {
  const projectRoot = process.cwd();
  const { getComponentDirectories } = require("../utils/common");
  const components = getComponentDirectories(projectConfig);
  
  if (!components.includes(componentName)) {
    logger.error(`❌ Workspace ${componentName} non trovato`);
    return false;
  }
  
  logger.section(`🧹 Pulizia Workspace: ${componentName}`);
  logger.info("📦 Pulizia singolo workspace con analisi dipendenze condivise");
  
  // Analyze shared dependencies across all workspaces
  logger.log("🔍 Analisi dipendenze condivise...", "cyan");
  const sharedAnalysis = analyzeSharedDependencies(components, projectRoot);
  
  if (sharedAnalysis.sharedDependencies.dependencies.size > 0 || sharedAnalysis.sharedDependencies.devDependencies.size > 0) {
    logger.warning("Dipendenze condivise rilevate tra workspace:");
    if (sharedAnalysis.sharedDependencies.dependencies.size > 0) {
      logger.log(`   📦 Dependencies: ${Array.from(sharedAnalysis.sharedDependencies.dependencies).join(", ")}`, "yellow");
    }
    if (sharedAnalysis.sharedDependencies.devDependencies.size > 0) {
      logger.log(`   🔧 DevDependencies: ${Array.from(sharedAnalysis.sharedDependencies.devDependencies).join(", ")}`, "yellow");
    }
    logger.info("ℹ️  Queste dipendenze sono gestite centralmente dal root node_modules");
    logger.info("ℹ️  Non possono essere rimosse da singoli workspace per evitare conflitti");
  }
  
  const workspacePath = path.join(projectRoot, componentName);
  const success = cleanWorkspaceComponent(workspacePath, componentName, sharedAnalysis, projectConfig, cleanMode);
  
  if (success) {
    logger.success(`Workspace ${componentName} pulito con successo`);
  } else {
    logger.error(`Errore pulizia workspace ${componentName}`);
  }
  
  return success;
}

module.exports = {
  cleanComponent,
  cleanAllComponents,
  cleanWorkspaceComponents,
  cleanStandardComponents,
  cleanSingleWorkspaceComponent,
  analyzeSharedDependencies,
  cleanWorkspaceComponent,
  resolveLockFileConflicts
};
