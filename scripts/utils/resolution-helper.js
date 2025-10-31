/**
 * Resolution helper for Yarn workspace
 * Detects and manages dependency version conflicts using resolutions
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * Detect version conflicts after yarn install
 * Analyzes yarn.lock to find packages with incompatible versions
 * 
 * @param {string} projectRoot - Project root directory
 * @param {Object} targetVersions - Target versions to enforce (e.g., { "@azure/logger": "^1.0.0" or "1.0.0" })
 * @returns {Object} Detected conflicts with installed versions
 */
function detectVersionConflicts(projectRoot, targetVersions = {}) {
  try {
    const yarnLockPath = path.join(projectRoot, "yarn.lock");
    if (!fs.existsSync(yarnLockPath)) {
      return { conflicts: [], installed: {} };
    }

    const yarnLockContent = fs.readFileSync(yarnLockPath, "utf8");
    const conflicts = [];
    const installed = {};

    // Parse yarn.lock for installed versions
    for (const [packageName, targetVersionRange] of Object.entries(targetVersions)) {
      if (!targetVersionRange) continue;
      
      // Extract base version from range (e.g., "^1.0.0" -> "1.0.0", "1.0.0" -> "1.0.0")
      const baseVersion = targetVersionRange.replace(/^[\^~>=<]+\s*/, "").split("-")[0];
      
      // Find package entries in yarn.lock
      // Format: "package-name@version-range":
      //   version "actual-version"
      const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const packagePattern = new RegExp(
        `"${escapedPackageName}@[^"]+"[\\s\\S]*?version "([^"]+)"`,
        "g"
      );
      
      const matches = [...yarnLockContent.matchAll(packagePattern)];
      
      if (matches.length > 0) {
        const versions = matches
          .map(m => m[1])
          .filter(Boolean);
        
        const uniqueVersions = [...new Set(versions)];
        installed[packageName] = uniqueVersions;
        
        // Check if installed versions match target
        // If target is a range (^1.0.0), check if installed versions are compatible
        // If target is exact (1.0.0), check for exact match
        let hasConflict = false;
        
        if (targetVersionRange.startsWith("^") || targetVersionRange.startsWith("~")) {
          // Range version - check if all installed versions are compatible
          // For now, we'll check if base version matches or if newer minor version
          const targetMajor = parseInt(baseVersion.split(".")[0]);
          const targetMinor = parseInt(baseVersion.split(".")[1] || "0");
          
          for (const installedVersion of uniqueVersions) {
            const installedParts = installedVersion.split(".");
            const installedMajor = parseInt(installedParts[0]);
            const installedMinor = parseInt(installedParts[1] || "0");
            
            // For ^ (caret): allow same major, minor can be higher
            // For ~ (tilde): allow same major.minor, patch can be higher
            if (targetVersionRange.startsWith("^")) {
              if (installedMajor !== targetMajor || installedMinor < targetMinor) {
                hasConflict = true;
                break;
              }
            } else if (targetVersionRange.startsWith("~")) {
              if (installedMajor !== targetMajor || 
                  installedMinor !== targetMinor) {
                hasConflict = true;
                break;
              }
            }
          }
        } else {
          // Exact version or no prefix - check for exact match
          if (!uniqueVersions.includes(baseVersion) && uniqueVersions.length > 0) {
            hasConflict = true;
          }
        }
        
        if (hasConflict) {
          conflicts.push({
            package: packageName,
            target: targetVersionRange,
            targetBase: baseVersion,
            installed: uniqueVersions,
            needsResolution: true
          });
        }
      }
    }

    return { conflicts, installed };
  } catch (error) {
    logger.warning(`⚠️  Errore rilevamento conflitti: ${error.message}`);
    return { conflicts: [], installed: {} };
  }
}

/**
 * Add resolutions to root package.json to force specific versions
 * @param {string} projectRoot - Project root directory
 * @param {Object} resolutions - Resolutions to add (e.g., { "@azure/logger": "^1.0.0" })
 * @param {boolean} merge - Merge with existing resolutions or replace
 * @returns {boolean} Success status
 */
function addResolutions(projectRoot, resolutions, merge = true) {
  try {
    const rootPackageJsonPath = path.join(projectRoot, "package.json");
    
    if (!fs.existsSync(rootPackageJsonPath)) {
      logger.warning("⚠️  Root package.json non trovato");
      return false;
    }

    const rootPackageJson = JSON.parse(fs.readFileSync(rootPackageJsonPath, "utf8"));
    
    if (!rootPackageJson.resolutions) {
      rootPackageJson.resolutions = {};
    }

    if (merge) {
      // Merge with existing resolutions
      Object.assign(rootPackageJson.resolutions, resolutions);
    } else {
      // Replace existing resolutions
      rootPackageJson.resolutions = resolutions;
    }

    fs.writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2));
    logger.log("🔧 Aggiornato resolutions in root package.json", "yellow");
    
    return true;
  } catch (error) {
    logger.error(`❌ Errore aggiunta resolutions: ${error.message}`);
    return false;
  }
}

/**
 * Suggest resolutions based on engine compatibility issues
 * Detects packages requiring Node.js 20+ when using Node.js 18
 * @param {string} projectRoot - Project root directory
 * @param {string} currentNodeVersion - Current Node.js version (e.g., "18.20.8")
 * @returns {Object} Suggested resolutions
 */
function suggestResolutionsForNodeVersion(projectRoot, currentNodeVersion) {
  const suggestions = {};
  const majorVersion = parseInt(currentNodeVersion.split(".")[0]);

  // Known packages that have versions incompatible with Node.js 18
  if (majorVersion < 20) {
    // @azure/logger 1.3.0+ requires Node.js 20+
    // Suggest using 1.0.x for Node.js 18 compatibility
    suggestions["@azure/logger"] = "^1.0.0";
  }

  return suggestions;
}

/**
 * Auto-fix version conflicts using resolutions
 * 
 * IMPORTANT: Yarn workspace behavior explanation:
 * - Yarn workspace AGGREGATES all dependencies from all workspace packages
 * - Yarn may select a NEWER compatible version even if a package.json specifies an older one
 * - This happens because Yarn resolves dependencies globally across all workspaces
 * - Example: If package A has @azure/logger@1.0.0 and package B has a dependency that requires @azure/logger@^1.3.0,
 *   Yarn will install 1.3.0 to satisfy BOTH packages (choosing the higher compatible version)
 * 
 * Solution: Use "resolutions" in root package.json to FORCE specific versions
 * - Resolutions override all dependency version selections
 * - This ensures consistent versions across the entire workspace
 * 
 * @param {string} projectRoot - Project root directory
 * @param {string} currentNodeVersion - Current Node.js version
 * @param {boolean} askUser - Whether to ask user before adding resolutions
 * @returns {boolean} Success status
 */
function autoFixVersionConflicts(projectRoot, currentNodeVersion, askUser = false) {
  try {
    const suggestions = suggestResolutionsForNodeVersion(projectRoot, currentNodeVersion);
    
    if (Object.keys(suggestions).length === 0) {
      return true; // No suggestions needed
    }

    logger.section("🔍 Rilevati potenziali conflitti di versione");
    logger.info("💡 IMPORTANTE: Yarn workspace può installare versioni diverse da quelle specificate");
    logger.info("💡 Questo è NORMALE - Yarn aggrega tutte le dipendenze e sceglie versioni compatibili");
    logger.warning("⚠️  Differenza chiave:");
    logger.info("   📦 npm (locale): ogni progetto gestisce le proprie dipendenze");
    logger.info("   🏢 Yarn workspace: tutte le dipendenze sono risolte insieme");
    logger.info("   🔄 Yarn può scegliere una versione più nuova se soddisfa più requisiti");
    logger.info("");
    logger.info("💡 Soluzione: resolutions in root package.json forzano versioni specifiche");
    
    for (const [pkg, version] of Object.entries(suggestions)) {
      logger.log(`   📦 ${pkg}: suggerito ${version} per compatibilità Node.js ${currentNodeVersion}`, "cyan");
    }

    if (askUser) {
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      return new Promise((resolve) => {
        rl.question("Aggiungere resolutions per forzare versioni compatibili? (y/N): ", (answer) => {
          rl.close();
          
          if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
            const success = addResolutions(projectRoot, suggestions);
            if (success) {
              logger.success("✅ Resolutions aggiunti");
              logger.info("💡 Esegui 'yarn install' per applicare le modifiche");
            }
            resolve(success);
          } else {
            logger.info("ℹ️  Resolutions non aggiunti");
            resolve(true);
          }
        });
      });
    } else {
      // Auto-add without asking
      const success = addResolutions(projectRoot, suggestions);
      if (success) {
        logger.success("✅ Resolutions aggiunti automaticamente per compatibilità Node.js");
        logger.info("💡 Questo previene l'installazione di versioni incompatibili");
      }
      return success;
    }
  } catch (error) {
    logger.error(`❌ Errore auto-fix conflitti: ${error.message}`);
    return false;
  }
}

module.exports = {
  detectVersionConflicts,
  addResolutions,
  suggestResolutionsForNodeVersion,
  autoFixVersionConflicts
};

