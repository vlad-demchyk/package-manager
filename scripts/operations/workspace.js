/**
 * Workspace operations for Yarn Workspaces monorepo management
 * Experimental feature for centralized package management
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const logger = require("../utils/logger");
const { formatBytes, getDirectorySize } = require("../utils/common");

/**
 * Initialize Yarn Workspace for the project
 * @param {Object} projectConfig - Project configuration object
 * @param {boolean} force - Force initialization even if already initialized
 * @returns {boolean} Success status
 */
function initializeWorkspace(projectConfig, force = false) {
  try {
    logger.section("🏢 Inizializzazione Yarn Workspace");
    
    // Check if workspace is already initialized (unless forcing)
    if (!force) {
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
    } else {
      logger.info("🔄 Modalità forzata: reinizializzazione workspace...");
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
    
    // Filter out package-manager from components
    const { filterOutPackageManager } = require("../utils/common");
    const filteredComponents = filterOutPackageManager(components);
    
    if (filteredComponents.length === 0) {
      logger.error("❌ Nessun componente valido trovato dopo esclusione package-manager");
      return false;
    }
    
    if (filteredComponents.length < components.length) {
      const excluded = components.length - filteredComponents.length;
      logger.log(`🚫 Esclusi ${excluded} componenti (package-manager)`, "yellow");
    }
    
    // Read existing root package.json
    let rootPackageJson = {};
    let hasPackageManagerDep = false;
    if (fs.existsSync(rootPackageJsonPath)) {
      try {
        rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
        logger.log("📄 Uso package.json esistente", "blue");
        
        // Check if package-manager is in dependencies
        if (rootPackageJson.dependencies && rootPackageJson.dependencies["@vlad-demchyk/package-manager"]) {
          hasPackageManagerDep = true;
          logger.log("🔍 Trovato @vlad-demchyk/package-manager nelle dependencies", "blue");
        }
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

    // Configure workspaces (use filtered components)
    const workspaces = filteredComponents.map(comp => {
      // Convert Windows paths to Unix format for Yarn
      return comp.replace(/\\/g, "/");
    });

    // Remove workspaces from package-manager's own package.json if it exists
    const packageManagerPath = path.join(projectRoot, "package-manager");
    const packageManagerPackageJsonPath = path.join(packageManagerPath, "package.json");
    if (fs.existsSync(packageManagerPackageJsonPath)) {
      try {
        const pmPackageJson = JSON.parse(fs.readFileSync(packageManagerPackageJsonPath, "utf8"));
        if (pmPackageJson.workspaces) {
          delete pmPackageJson.workspaces;
          fs.writeFileSync(packageManagerPackageJsonPath, JSON.stringify(pmPackageJson, null, 2));
          logger.log("🔧 Rimossi workspaces dal package.json di package-manager", "yellow");
        }
      } catch (error) {
        logger.warning("⚠️  Impossibile aggiornare package.json di package-manager");
      }
    }
    
    // Also check node_modules location
    const nodeModulesPackageManagerPath = path.join(projectRoot, "node_modules", "@vlad-demchyk", "package-manager");
    const nodeModulesPackageManagerJsonPath = path.join(nodeModulesPackageManagerPath, "package.json");
    if (fs.existsSync(nodeModulesPackageManagerJsonPath)) {
      try {
        const pmPackageJson = JSON.parse(fs.readFileSync(nodeModulesPackageManagerJsonPath, "utf8"));
        if (pmPackageJson.workspaces) {
          delete pmPackageJson.workspaces;
          fs.writeFileSync(nodeModulesPackageManagerJsonPath, JSON.stringify(pmPackageJson, null, 2));
          logger.log("🔧 Rimossi workspaces dal package.json di package-manager in node_modules", "yellow");
        }
      } catch (error) {
        // Ignore - might be read-only
      }
      
      // Note: We don't remove package-lock.json from package-manager
      // because it's managed separately by npm and should not interfere with workspace
    }
    
    // Update root package.json
    rootPackageJson.workspaces = workspaces;
    rootPackageJson.private = true;
    
    // Temporarily remove package-manager from root dependencies to avoid installation
    // We'll restore it after workspace setup if it was there
    let packageManagerDepVersion = null;
    if (hasPackageManagerDep && rootPackageJson.dependencies) {
      packageManagerDepVersion = rootPackageJson.dependencies["@vlad-demchyk/package-manager"];
      delete rootPackageJson.dependencies["@vlad-demchyk/package-manager"];
      
      // If dependencies object is empty, we can optionally remove it
      if (Object.keys(rootPackageJson.dependencies).length === 0) {
        // Keep it but empty - some projects might need it
      }
      logger.log("🔧 Temporaneamente rimosso @vlad-demchyk/package-manager da root dependencies", "yellow");
      logger.info("💡 Package-manager verrà gestito separatamente per evitare conflitti");
    }
    
    // Create .yarnrc.yml to exclude package-manager from hoisting
    const yarnrcPath = path.join(projectRoot, ".yarnrc.yml");
    const yarnrcContent = `# Yarn configuration for package-manager workspace
nodeLinker: node-modules

# Exclude package-manager from hoisting to avoid conflicts
# Package-manager is managed separately via npm and should not interfere with workspace
nohoist:
  - "@vlad-demchyk/package-manager"
  - "@vlad-demchyk/package-manager/**"
  - "**/@vlad-demchyk/package-manager"
  - "**/@vlad-demchyk/package-manager/**"

# Disable telemetry
enableTelemetry: false
`;
    
    try {
      fs.writeFileSync(yarnrcPath, yarnrcContent);
      logger.log("🔧 Creato .yarnrc.yml con esclusioni per package-manager", "yellow");
    } catch (error) {
      logger.warning("⚠️  Impossibile creare .yarnrc.yml");
    }
    
    // Create .yarnignore to completely ignore package-manager directory
    const yarnIgnorePath = path.join(projectRoot, ".yarnignore");
    const yarnIgnoreContent = `# Ignore package-manager directory completely
# Package-manager is managed separately via npm
package-manager/
**/package-manager/
node_modules/@vlad-demchyk/package-manager/
**/node_modules/@vlad-demchyk/package-manager/
`;
    
    try {
      fs.writeFileSync(yarnIgnorePath, yarnIgnoreContent);
      logger.log("🔧 Creato .yarnignore per ignorare package-manager", "yellow");
    } catch (error) {
      logger.warning("⚠️  Impossibile creare .yarnignore");
    }
    
    // Add workspace scripts
    if (!rootPackageJson.scripts) {
      rootPackageJson.scripts = {};
    }
    rootPackageJson.scripts["install:workspace"] = "yarn install";
    rootPackageJson.scripts["install:all"] = "yarn workspaces run install";
    rootPackageJson.scripts["clean:workspace"] = "yarn workspaces run clean";

    // Save updated package.json (without package-manager dependency)
    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
    logger.success("Aggiornato root package.json con workspaces");
    
    // Note: We don't restore package-manager dependency because:
    // 1. It's already installed in node_modules from previous setup
    // 2. Adding it back would cause yarn to try installing it as a workspace dependency
    // 3. The package-manager should work independently of workspace mode
    if (packageManagerDepVersion) {
      logger.info("💡 @vlad-demchyk/package-manager rimosso da dependencies per workspace mode");
      logger.info("💡 Se necessario, puoi aggiungerlo manualmente dopo l'inizializzazione");
    }

    // Update project config with workspace settings (use filtered components)
    updateProjectConfigWorkspace(projectConfig, true, true, filteredComponents);

    // IMPORTANT: Clean package-lock.json from all components before workspace install
    // This prevents conflicts between npm lock files and yarn workspace
    // Especially important if dependencies were updated in standard mode before workspace init
    // Note: node_modules are NOT removed - they are simply ignored in workspace mode
    //       User can manually clean them using the workspace cleaning function
    logger.section("🧹 Pulizia file lock dai componenti");
    logger.info("💡 Rimozione package-lock.json dai componenti per evitare conflitti con Yarn workspace");
    logger.warning("⚠️  Yarn workspace non può utilizzare package-lock.json - usa yarn.lock");
    logger.info("ℹ️  node_modules locali non vengono rimossi - vengono ignorati in workspace mode");
    logger.info("💡 Puoi pulirli manualmente usando la funzione di pulizia workspace");
    
    const { removeFile } = require("../utils/common");
    let cleanedLocks = 0;
    
    for (const component of filteredComponents) {
      const componentPath = path.join(projectRoot, component);
      
      // Remove package-lock.json from component
      const packageLockPath = path.join(componentPath, projectConfig.files.packageLock);
      if (fs.existsSync(packageLockPath)) {
        if (removeFile(packageLockPath)) {
          cleanedLocks++;
          logger.log(`   ✅ Rimosso package-lock.json da ${component}`, "green");
        }
      }
    }
    
    // Also remove root package-lock.json if exists (conflict with yarn.lock)
    const rootPackageLockPath = path.join(projectRoot, "package-lock.json");
    if (fs.existsSync(rootPackageLockPath)) {
      if (removeFile(rootPackageLockPath)) {
        cleanedLocks++;
        logger.log(`   ✅ Rimosso package-lock.json da root`, "green");
      }
    }
    
    if (cleanedLocks > 0) {
      logger.success(`✅ Rimossi ${cleanedLocks} file package-lock.json`);
      logger.info("💡 Yarn workspace utilizzerà yarn.lock per gestire le dipendenze");
    } else {
      logger.log("ℹ️  Nessun package-lock.json da pulire", "blue");
    }

    // Check Node.js version and add resolutions BEFORE yarn install
    // This ensures Yarn installs compatible versions from the start
    const currentNodeVersion = process.version.replace("v", "");
    const { autoFixVersionConflicts, detectVersionConflicts, suggestResolutionsForNodeVersion } = require("../utils/resolution-helper");
    logger.log("🔍 Verifica compatibilità versioni...", "blue");
    
    // Add resolutions BEFORE install to prevent incompatible versions
    const suggestedResolutions = suggestResolutionsForNodeVersion(projectRoot, currentNodeVersion);
    if (Object.keys(suggestedResolutions).length > 0) {
      logger.log("📦 Aggiungo resolutions per prevenire versioni incompatibili...", "blue");
      const { addResolutions } = require("../utils/resolution-helper");
      addResolutions(projectRoot, suggestedResolutions);
      logger.success("✅ Resolutions configurati - Yarn installerà versioni compatibili");
    }

    // Run yarn install
    logger.log("🔄 Esecuzione yarn install per workspace...", "cyan");
    logger.info("💡 Nota: in workspace mode Yarn può selezionare versioni diverse rispetto a installazioni locali");
    logger.info("💡 Questo è normale - le resolutions nel root package.json aiutano a mantenere compatibilità");
    logger.info("💡 Yarn workspace aggrega tutte le dipendenze e può scegliere versioni più nuove");
    
    try {
      // Try normal yarn install first (resolutions should handle compatibility)
      logger.log("🔄 Tentativo installazione con resolutions...", "blue");
      execSync("yarn install", {
        stdio: "inherit",
        cwd: projectRoot
      });
      
      // After install, verify that compatible versions were installed
      logger.log("🔍 Verifica versioni installate...", "blue");
      const conflicts = detectVersionConflicts(projectRoot, suggestedResolutions);
      
      if (conflicts.conflicts && conflicts.conflicts.length > 0) {
        logger.warning("⚠️  Rilevati conflitti di versione dopo installazione");
        logger.info("💡 Alcune versioni installate differiscono dalle resolutions");
        
        // Re-add resolutions and reinstall
        logger.log("🔄 Aggiungo resolutions più specifici e riinstallo...", "yellow");
        const { addResolutions } = require("../utils/resolution-helper");
        
        // Use exact versions instead of ranges
        const exactResolutions = {};
        for (const conflict of conflicts.conflicts) {
          exactResolutions[conflict.package] = conflict.target; // Use target version exactly
        }
        
        addResolutions(projectRoot, exactResolutions);
        
        // Reinstall with exact versions
        logger.log("🔄 Riesecuzione yarn install con resolutions esatti...", "blue");
        execSync("yarn install", {
          stdio: "inherit",
          cwd: projectRoot
        });
        logger.success("✅ Reinstallazione completata con versioni corrette");
      } else {
        logger.success("✅ Tutte le versioni installate sono compatibili");
      }
      
      logger.success("Workspace inizializzato con successo!");
      
      // Post-install cleanup: ensure package-manager is not part of workspace
      cleanupPackageManagerFromWorkspace(projectRoot);
      
      return true;
    } catch (error) {
      // If engine compatibility error, try with --ignore-engines
      // This is common with Yarn workspace + Node.js 18 because Yarn aggregates dependencies
      // and may select newer versions that require Node.js 20+, even though individual
      // npm installs work fine with Node.js 18
      if (error.message.includes("The engine \"node\" is incompatible") || 
          error.message.includes("incompatible")) {
        logger.warning("⚠️  Conflitto di versione Node.js rilevato");
        logger.info("💡 In workspace mode Yarn può selezionare versioni più nuove rispetto a installazioni locali");
        logger.log("🔄 Tentativo con --ignore-engines per compatibilità Node.js 18...", "blue");
        try {
          execSync("yarn install --ignore-engines", {
            stdio: "inherit",
            cwd: projectRoot
          });
          logger.success("Workspace inizializzato con successo (ignorando engine checks)!");
          logger.warning("⚠️  Installato con --ignore-engines per compatibilità Node.js 18");
          logger.info("💡 Le dipendenze funzioneranno normalmente - questo è equivalente a --legacy-peer-deps di npm");
          
          // Post-install cleanup: ensure package-manager is not part of workspace
          cleanupPackageManagerFromWorkspace(projectRoot);
          
          return true;
        } catch (ignoreError) {
          logger.error("❌ Anche con --ignore-engines fallito:");
          logger.warning(`   ${ignoreError.message}`);
        }
      }
      logger.error("❌ Errore durante yarn install:");
      logger.warning(`   ${error.message}`);
      
      // Check for Node.js version compatibility issues
      if (error.message.includes("The engine \"node\" is incompatible")) {
        logger.error("🚨 Problema di compatibilità Node.js in workspace mode!");
        logger.warning("⚠️  Questo accade perché Yarn workspace aggrega tutte le dipendenze");
        logger.info("💡 Differenza tra installazione locale e workspace:");
        logger.info("   📦 Locale (npm): ogni progetto gestisce le proprie dipendenze");
        logger.info("   🏢 Workspace (yarn): tutte le dipendenze sono aggregate e risolte insieme");
        logger.info("   🔄 Yarn può scegliere versioni più nuove che richiedono Node.js 20+");
        logger.info("💡 Soluzioni possibili:");
        logger.info("   1. Usa Node.js 20+ (raccomandato per SPFx moderni)");
        logger.info("   2. Il sistema userà --ignore-engines (equivalente a --legacy-peer-deps)");
        logger.info("   3. Le resolutions nel root package.json forzano versioni compatibili");
      }
      
      // Still try to cleanup even on error
      cleanupPackageManagerFromWorkspace(projectRoot);
      
      logger.warning("⚠️  Workspace NON inizializzato a causa di errori");
      logger.info("💡 Risolvi i problemi di dipendenze e riprova l'inizializzazione");
      return false;
    }

  } catch (error) {
    logger.error("❌ Errore inizializzazione workspace:");
    logger.warning(`   ${error.message}`);
    logger.warning("⚠️  Workspace NON inizializzato a causa di errori");
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
    
      // Remove .yarnrc.yml if it exists
      const yarnrcPath = path.join(projectRoot, ".yarnrc.yml");
      if (fs.existsSync(yarnrcPath)) {
        try {
          fs.unlinkSync(yarnrcPath);
          logger.log("🗑️  Rimosso .yarnrc.yml", "yellow");
        } catch (error) {
          logger.warning("⚠️  Impossibile rimuovere .yarnrc.yml");
        }
      }
      
      // Remove .yarnignore if it exists
      const yarnIgnorePath = path.join(projectRoot, ".yarnignore");
      if (fs.existsSync(yarnIgnorePath)) {
        try {
          fs.unlinkSync(yarnIgnorePath);
          logger.log("🗑️  Rimosso .yarnignore", "yellow");
        } catch (error) {
          logger.warning("⚠️  Impossibile rimuovere .yarnignore");
        }
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

    // Remove root node_modules (but preserve package-manager)
    const { removeDirectoryRecursive } = require("../utils/common");
    const rootNodeModulesPath = path.join(projectRoot, "node_modules");
    if (fs.existsSync(rootNodeModulesPath)) {
      try {
        // Check if package-manager exists in node_modules
        const packageManagerPath = path.join(rootNodeModulesPath, "@vlad-demchyk", "package-manager");
        const packageManagerExists = fs.existsSync(packageManagerPath);
        
        if (packageManagerExists) {
          logger.log("🔒 Preservando package-manager in root node_modules", "blue");
          // Remove everything except package-manager
          const items = fs.readdirSync(rootNodeModulesPath);
          items.forEach(item => {
            if (item !== "@vlad-demchyk") {
              const itemPath = path.join(rootNodeModulesPath, item);
              try {
                removeDirectoryRecursive(itemPath);
              } catch (error) {
                logger.warning(`⚠️  Impossibile rimuovere ${item}`);
              }
            }
          });
          logger.log("🗑️  Rimosso root node_modules (eccetto package-manager)", "yellow");
        } else {
          removeDirectoryRecursive(rootNodeModulesPath);
          logger.log("🗑️  Rimosso root node_modules", "yellow");
        }
      } catch (error) {
        logger.warning("⚠️  Impossibile rimuovere root node_modules");
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
          // If workspace exists in package.json, it should be considered enabled
          status.enabled = true;
          // But only initialized if yarn.lock exists (successful install)
          status.initialized = status.hasYarnLock;
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
        
        // Filter out package-manager
        const { filterOutPackageManager } = require("../utils/common");
        const filteredComponents = filterOutPackageManager(components);
        
        if (filteredComponents.length > 0) {
          // Use correct workspace paths without /* suffix
          const workspaces = filteredComponents.map(comp => {
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
 * Clean up package-manager from workspace after yarn install
 * Removes any dependencies that might have been installed for package-manager
 * @param {string} projectRoot - Project root directory
 */
function cleanupPackageManagerFromWorkspace(projectRoot) {
  try {
    const { removeDirectoryRecursive } = require("../utils/common");
    const pmNodeModulesPath = path.join(projectRoot, "node_modules", "@vlad-demchyk", "package-manager", "node_modules");
    
    if (fs.existsSync(pmNodeModulesPath)) {
      // Check if there are dependencies installed for package-manager
      const items = fs.readdirSync(pmNodeModulesPath);
      if (items.length > 0) {
        logger.log("🧹 Pulizia dipendenze package-manager da workspace...", "yellow");
        try {
          removeDirectoryRecursive(pmNodeModulesPath);
          logger.log("✅ Rimosse dipendenze package-manager da workspace", "green");
        } catch (error) {
          logger.warning(`⚠️  Impossibile rimuovere node_modules di package-manager: ${error.message}`);
        }
      }
    }
    
    // Note: We don't remove package-lock.json from package-manager
    // It's managed separately by npm and doesn't interfere with yarn workspace
  } catch (error) {
    // Ignore cleanup errors
  }
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
    const { getComponentDirectories, filterOutPackageManager } = require("../utils/common");
    const allComponents = getComponentDirectories(projectConfig);
    
    // Filter out package-manager
    const currentComponents = filterOutPackageManager(allComponents);
    
    if (currentComponents.length === 0) {
      logger.warning("⚠️  Nessun progetto valido trovato dopo esclusione package-manager");
      return false;
    }
    
    if (allComponents.length > currentComponents.length) {
      logger.log(`🚫 Esclusi ${allComponents.length - currentComponents.length} componenti (package-manager)`, "yellow");
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
    
    // Convert components to workspace format (use filtered components)
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
    
    // Update project-config.js (use filtered components)
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
  syncRootPackageJson,
  forceUpdateWorkspaceConfig,
  syncWorkspaceWithProjects
};
