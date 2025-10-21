/**
 * Analisi uso dipendenze nei componenti
 * Scansiona il codice per determinare quali dipendenze sono effettivamente utilizzate
 */

const fs = require("fs");
const path = require("path");

// Import shared logger
const logger = require("../utils/logger");

function getComponentDirectories(projectConfig) {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);
  
  // console.log(`🔍 getComponentDirectories: ${currentDir}`);
  // console.log(`🔍 Items trovati: ${items.length}`);
  // console.log(`🔍 Items: ${items.slice(0, 5).join(', ')}...`);

  return items.filter((item) => {
    const fullPath = path.join(currentDir, item);

    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }
    
    // Debug per i primi 3 componenti
    // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
    //   console.log(`🔍 Controllo ${item}:`);
    // }

    // Controllo per prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
        //   console.log(`   ❌ Prefisso non match: ${item} (prefisso: ${projectConfig.components.filterByPrefix.prefix})`);
        // }
        return false;
      }
    }

    // Controllo per struttura
    if (projectConfig.components.filterByStructure.enabled) {
      const requiredFiles =
        projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders =
        projectConfig.components.filterByStructure.requiredFolders;

      for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, file))) {
          // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
          //   console.log(`   ❌ File mancante: ${file} in ${item}`);
          // }
          return false;
        }
      }

      for (const folder of requiredFolders) {
        const folderPath = path.join(fullPath, folder);
        if (
          !fs.existsSync(folderPath) ||
          !fs.statSync(folderPath).isDirectory()
        ) {
          // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
          //   console.log(`   ❌ Folder mancante: ${folder} in ${item}`);
          // }
          return false;
        }
      }
    }

    // Controllo per lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
        //   console.log(`   ❌ Lista non match: ${item}`);
        // }
        return false;
      }
    }

    // Controllo per regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
        //   console.log(`   ❌ Regex non match: ${item}`);
        // }
        return false;
      }
    }

    // Controlliamo sempre la presenza di package.json
    const packageJsonPath = path.join(fullPath, projectConfig.files.packageJson);
    const hasPackageJson = fs.existsSync(packageJsonPath);
    
    // Debug per il primo componente
    // if (item === "c106-breadcrumbs") {
    //   console.log(`🔍 Debug ${item}:`);
    //   console.log(`   📁 fullPath: ${fullPath}`);
    //   console.log(`   📄 packageJsonPath: ${packageJsonPath}`);
    //   console.log(`   ✅ Esiste: ${hasPackageJson}`);
    // }
    
    // if (item.startsWith("c106-") && item !== "c106-breadcrumbs") {
    //   console.log(`   ✅ package.json: ${hasPackageJson}`);
    // }
    
    return hasPackageJson;
  });
}

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
