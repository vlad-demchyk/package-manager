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

  function extractImports(content) {
    const imports = new Set();
    const importPatterns = [
      /import\s+[^'"`]*?from\s*['"`]([^'"`]+)['"`]/g,
      /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /\bdefine\(\s*\[([^\]]+)\]/g,
    ];

    for (const rx of importPatterns) {
      let m;
      while ((m = rx.exec(content))) {
        if (rx === importPatterns[3]) {
          // AMD array
          const arr = m[1].split(",").map((s) => s.trim().replace(/['"`]/g, ""));
          arr.forEach(name => {
            if (name && !name.startsWith(".") && !name.startsWith("/")) {
              const root = name.split("/")[0].startsWith("@") 
                ? name.split("/").slice(0, 2).join("/") 
                : name.split("/")[0];
              if (root) imports.add(root);
            }
          });
        } else {
          const name = m[1].trim().replace(/['"`]/g, "");
          if (name && !name.startsWith(".") && !name.startsWith("/")) {
            const root = name.split("/")[0].startsWith("@") 
              ? name.split("/").slice(0, 2).join("/") 
              : name.split("/")[0];
            if (root) imports.add(root);
          }
        }
      }
    }
    return Array.from(imports);
  }

  function scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const imports = extractImports(content);

      patterns.forEach((pattern) => {
        // Перевірка через імпорти (точніше)
        if (imports.includes(pattern)) {
          results.add(pattern);
        }
        // Fallback: простий пошук для старих форматів з patterns
        else if (content.includes(pattern)) {
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

  Object.entries(conditionalDeps).forEach(([depName, version]) => {
    // Se è un oggetto (vecchio formato), usa la logica originale
    if (typeof version === "object" && version !== null) {
      const patterns = version.patterns || [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps.push({
          name: depName,
          version: version.version,
          patterns: foundPatterns,
          description: version.description,
        });
      }
    } else {
      // Se è una stringa (nuovo formato), usa solo il nome del pacchetto
      const patterns = [depName];
      const foundPatterns = scanDirectoryForPatterns(componentPath, patterns);

      if (foundPatterns.length > 0) {
        usedDeps.push({
          name: depName,
          version: version,
          patterns: foundPatterns,
          description: `Used in project`,
        });
      }
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
