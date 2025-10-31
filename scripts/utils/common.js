/**
 * Common utility functions shared across the package manager
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

      // Controllo per regex (supporta sia RegExp, sia stringa)
      if (projectConfig.components.filterByRegex.enabled) {
        const pat = projectConfig.components.filterByRegex.pattern;
        const re = pat instanceof RegExp ? pat : (typeof pat === "string" ? new RegExp(pat) : null);
        if (re && !re.test(item)) {
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
      const excludeDirs = Array.isArray(recursiveConfig.excludeDirs)
        ? recursiveConfig.excludeDirs
        : ["node_modules", "dist", "build", ".git", "coverage"];
      items.forEach(item => {
        const fullPath = path.join(currentDir, item);
        
        // Skip excluded directories
        if (!fs.statSync(fullPath).isDirectory()) return;
        if (excludeDirs.includes(item)) return;
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

    // Controllo per regex (supporta sia RegExp, sia stringa)
    if (projectConfig.components.filterByRegex.enabled) {
      const pat = projectConfig.components.filterByRegex.pattern;
      const re = pat instanceof RegExp ? pat : (typeof pat === "string" ? new RegExp(pat) : null);
      if (re && !re.test(item)) {
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

/**
 * Remove a directory recursively
 * @param {string} dirPath - Directory path to remove
 * @returns {boolean} Success status
 */
function removeDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  
  try {
    if (isWindows()) {
      execSync(`rmdir /s /q "${dirPath}"`, { stdio: "ignore" });
    } else {
      execSync(`rm -rf "${dirPath}"`, { stdio: "ignore" });
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Remove a file
 * @param {string} filePath - File path to remove
 * @returns {boolean} Success status
 */
function removeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Remove directory recursively (alternative implementation)
 * @param {string} dirPath - Directory path to remove
 */
function removeDirectoryRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }
  
  try {
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
  } catch (error) {
    // Ignore errors (permissions, etc.)
  }
}

/**
 * Filter out package-manager from component list
 * Package-manager should not be part of workspace or standard operations
 * @param {string[]} components - Array of component paths
 * @returns {string[]} Filtered component paths
 */
function filterOutPackageManager(components) {
  return components.filter(comp => {
    const normalized = comp.replace(/\\/g, "/").toLowerCase();
    return !normalized.includes("package-manager") && 
           !normalized.includes("node_modules") &&
           !normalized.includes("@vlad-demchyk/package-manager");
  });
}

/**
 * Get directory size in bytes recursively
 * @param {string} dirPath - Directory path
 * @returns {number} Size in bytes
 */
function getDirectorySize(dirPath) {
  let size = 0;
  
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }
    
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
    // Ignore errors (permissions, etc.)
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
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

module.exports = {
  isWindows,
  getNpmCommand,
  getComponentDirectories,
  getComponentDirectoriesRecursive,
  getComponentDirectoriesWorkspace,
  loadPackageJson,
  fileExists,
  getProjectRoot,
  removeDirectory,
  removeFile,
  removeDirectoryRecursive,
  filterOutPackageManager,
  getDirectorySize,
  formatBytes
};
