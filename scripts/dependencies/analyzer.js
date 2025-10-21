/**
 * Analisi uso dipendenze nei componenti
 * Scansiona il codice per determinare quali dipendenze sono effettivamente utilizzate
 */

const fs = require("fs");
const path = require("path");

// Import shared logger and common utilities
const logger = require("../utils/logger");
const { getComponentDirectories } = require("../utils/common");


function scanDirectoryForPatterns(
  dirPath,
  patterns,
  extensions = [".js", ".ts", ".tsx", ".jsx"]
) {
  const results = new Set();

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      patterns.forEach((pattern) => {
        if (content.includes(pattern)) {
          results.add(pattern);
        }
      });
    } catch (error) {
      // Ignora errori di lettura file
    }
  }

  function scanDirectory(currentPath) {
    try {
      const items = fs.readdirSync(currentPath);

      items.forEach((item) => {
        const fullPath = path.join(currentPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Salta node_modules e altre cartelle da ignorare
          if (!["node_modules", ".git", "dist", "build"].includes(item)) {
            scanDirectory(fullPath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(item);
          if (extensions.includes(ext)) {
            scanFile(fullPath);
          }
        }
      });
    } catch (error) {
      // Ignora errori di accesso directory
    }
  }

  scanDirectory(dirPath);
  return Array.from(results);
}

function analyzeDependencyUsage(componentPath, conditionalDeps, projectConfig) {
  const usedDeps = [];

  Object.entries(conditionalDeps).forEach(([depName, depConfig]) => {
    const patterns = depConfig.patterns || [depName];
    const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

    if (foundPatterns.length > 0) {
      usedDeps.push({
        name: depName,
        version: depConfig.version,
        patterns: foundPatterns,
        description: depConfig.description,
      });
    }
  });

  return usedDeps;
}

function getUsedDependencies(conditionalDeps, projectConfig) {
  const componentDirs = getComponentDirectories(projectConfig);
  const allUsedDeps = {};

  componentDirs.forEach((componentDir) => {
    const componentPath = path.join(process.cwd(), componentDir);
    const usedDeps = analyzeDependencyUsage(
      componentPath,
      conditionalDeps,
      projectConfig
    );

    usedDeps.forEach((dep) => {
      if (!allUsedDeps[dep.name]) {
        allUsedDeps[dep.name] = dep;
      }
    });
  });

  return allUsedDeps;
}

module.exports = {
  getComponentDirectories,
  analyzeDependencyUsage,
  getUsedDependencies,
  scanDirectoryForPatterns,
};
