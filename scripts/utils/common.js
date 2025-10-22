/**
 * Common utility functions shared across the package manager
 */

const fs = require("fs");
const path = require("path");

/**
 * Check if the current platform is Windows
 * @returns {boolean}
 */
function isWindows() {
  return process.platform === "win32";
}

/**
 * Get the appropriate npm command for the current platform
 * @param {Object} projectConfig - Project configuration object
 * @returns {string} npm command
 */
function getNpmCommand(projectConfig) {
  if (!projectConfig || !projectConfig.commands || !projectConfig.commands.npm) {
    // Fallback to default npm commands
    return isWindows() ? "npm.cmd" : "npm";
  }
  
  return isWindows()
    ? projectConfig.commands.npm.windows
    : projectConfig.commands.npm.unix;
}

/**
 * Get component directories recursively based on project configuration
 * @param {Object} projectConfig - Project configuration object
 * @param {number|null} maxDepth - Maximum search depth (null = unlimited)
 * @param {number} currentDepth - Current recursion depth
 * @returns {string[]} Array of component directory names
 */
function getComponentDirectoriesRecursive(projectConfig, maxDepth = null, currentDepth = 0, baseDir = null) {
  const components = [];
  const recursiveConfig = projectConfig.components.recursiveSearch;
  
  // Check depth limit
  if (maxDepth !== null && currentDepth > maxDepth) {
    return components;
  }
  
  const currentDir = baseDir || process.cwd();
  
  try {
    const items = fs.readdirSync(currentDir);
    
    // Get current level components using existing logic
    const currentLevelComponents = items.filter((item) => {
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
        const requiredFiles = projectConfig.components.filterByStructure.requiredFiles;
        const requiredFolders = projectConfig.components.filterByStructure.requiredFolders;

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
    
    // Add current level components with relative paths
    currentLevelComponents.forEach(comp => {
      const relativePath = path.relative(process.cwd(), path.join(currentDir, comp));
      components.push(relativePath);
    });
    
    // If recursive search enabled, scan subdirectories
    if (recursiveConfig && recursiveConfig.enabled) {
      items.forEach(item => {
        const fullPath = path.join(currentDir, item);
        
        // Skip excluded directories
        if (!fs.statSync(fullPath).isDirectory()) return;
        if (recursiveConfig.excludeDirs.includes(item)) return;
        if (currentLevelComponents.includes(item)) return; // Already found as component
        
        // Recursively search subdirectory
        const nestedComponents = getComponentDirectoriesRecursive(
          projectConfig,
          recursiveConfig.maxDepth,
          currentDepth + 1,
          fullPath
        );
        components.push(...nestedComponents);
      });
    }
  } catch (error) {
    // Ignore errors (permission denied, etc.)
  }
  
  return components;
}

/**
 * Get component directories for workspace mode
 * @param {Object} projectConfig - Project configuration object
 * @returns {string[]} Array of component directory names
 */
function getComponentDirectoriesWorkspace(projectConfig) {
  try {
    const projectRoot = process.cwd();
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    
    if (!fs.existsSync(rootPackageJsonPath)) {
      return [];
    }
    
    const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
    
    if (!rootPackageJson.workspaces || !Array.isArray(rootPackageJson.workspaces)) {
      return [];
    }
    
    const components = [];
    
    // Process workspace patterns
    rootPackageJson.workspaces.forEach(workspacePattern => {
      // Handle glob patterns (e.g., "packages/*", "apps/*")
      if (workspacePattern.includes("*")) {
        const glob = require("glob");
        const matches = glob.sync(workspacePattern, { cwd: projectRoot });
        matches.forEach(match => {
          const fullPath = path.join(projectRoot, match);
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            // Check if it has package.json
            const packageJsonPath = path.join(fullPath, "package.json");
            if (fs.existsSync(packageJsonPath)) {
              components.push(match);
            }
          }
        });
      } else {
        // Handle direct paths
        const fullPath = path.join(projectRoot, workspacePattern);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          const packageJsonPath = path.join(fullPath, "package.json");
          if (fs.existsSync(packageJsonPath)) {
            components.push(workspacePattern);
          }
        }
      }
    });
    
    return components;
    
  } catch (error) {
    console.error("Error getting workspace components:", error);
    return [];
  }
}

/**
 * Get component directories based on project configuration
 * @param {Object} projectConfig - Project configuration object
 * @returns {string[]} Array of component directory names
 */
function getComponentDirectories(projectConfig) {
  // Check if workspace mode is enabled
  if (projectConfig.workspace?.enabled && projectConfig.workspace?.initialized) {
    return getComponentDirectoriesWorkspace(projectConfig);
  }
  
  // Force reload project config if recursiveSearch is not defined
  if (!projectConfig.components.recursiveSearch) {
    try {
      const projectRoot = process.cwd();
      const configPath = path.join(projectRoot, "package-manager", "project-config.js");
      delete require.cache[require.resolve(configPath)];
      const freshConfig = require(configPath);
      projectConfig.components.recursiveSearch = freshConfig.components.recursiveSearch;
    } catch (error) {
      // Ignore errors, use existing config
    }
  }
  
  // Check if recursive search is enabled
  if (projectConfig.components.recursiveSearch && 
      projectConfig.components.recursiveSearch.enabled) {
    return getComponentDirectoriesRecursive(projectConfig);
  }
  
  // Original non-recursive logic
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
      const requiredFiles = projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders = projectConfig.components.filterByStructure.requiredFolders;

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

/**
 * Load and parse package.json from a directory
 * @param {string} dir - Directory path
 * @returns {Object|null} Parsed package.json or null if not found
 */
function loadPackageJson(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (error) {
    return null;
  }
}

/**
 * Check if a file exists in a directory
 * @param {string} dir - Directory path
 * @param {string} filename - File name to check
 * @returns {boolean}
 */
function fileExists(dir, filename) {
  return fs.existsSync(path.join(dir, filename));
}

/**
 * Get the project root directory
 * @returns {string}
 */
function getProjectRoot() {
  return process.cwd();
}

module.exports = {
  isWindows,
  getNpmCommand,
  getComponentDirectories,
  getComponentDirectoriesRecursive,
  getComponentDirectoriesWorkspace,
  loadPackageJson,
  fileExists,
  getProjectRoot
};
