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
 * Get component directories based on project configuration
 * @param {Object} projectConfig - Project configuration object
 * @returns {string[]} Array of component directory names
 */
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
  loadPackageJson,
  fileExists,
  getProjectRoot
};
