/**
 * Allineamento versioni dipendenze tra progetti
 *
 * Permette di scegliere un progetto "base", trovare altri progetti che
 * condividono almeno una dipendenza con la stessa versione esatta, e
 * allineare (sovrascrivere) le versioni divergenti del progetto base
 * su quelle di un progetto scelto come riferimento.
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const { getComponentDirectories, loadPackageJson, removeFile } = require("../utils/common");
const { cleanVersion } = require("../utils/version-utils");

/**
 * Legge dependencies + devDependencies di un componente.
 * @param {string} componentDir - Percorso relativo del componente (rispetto alla root)
 * @returns {{dependencies: Object, devDependencies: Object}|null}
 */
function getComponentPackageInfo(componentDir) {
  const componentPath = path.join(process.cwd(), componentDir);
  const pkg = loadPackageJson(componentPath);
  if (!pkg) return null;

  return {
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
  };
}

/**
 * Carica dependencies + devDependencies per tutti i componenti del progetto.
 * @param {Object} projectConfig
 * @returns {Object} Map { componentName: { dependencies, devDependencies } }
 */
function loadComponentsData(projectConfig) {
  const componentDirs = getComponentDirectories(projectConfig);
  const data = {};

  componentDirs.forEach((componentDir) => {
    const info = getComponentPackageInfo(componentDir);
    if (info) {
      data[componentDir] = info;
    }
  });

  return data;
}

/**
 * Ottiene la versione di una dipendenza in un componente, indipendentemente
 * dalla sezione in cui si trova (dependencies ha priorità su devDependencies).
 */
function getVersionAndSection(componentInfo, depName) {
  if (componentInfo.dependencies && componentInfo.dependencies[depName] !== undefined) {
    return { version: componentInfo.dependencies[depName], section: "dependencies" };
  }
  if (componentInfo.devDependencies && componentInfo.devDependencies[depName] !== undefined) {
    return { version: componentInfo.devDependencies[depName], section: "devDependencies" };
  }
  return { version: undefined, section: null };
}

/**
 * Restituisce l'unione dei nomi di dipendenza presenti in un componente.
 */
function getAllDependencyNames(componentInfo) {
  return new Set([
    ...Object.keys(componentInfo.dependencies || {}),
    ...Object.keys(componentInfo.devDependencies || {}),
  ]);
}

/**
 * Trova, per un progetto base, gli altri progetti che condividono almeno
 * una dipendenza con ESATTAMENTE la stessa versione.
 * Modalità di navigazione "per nome progetto".
 *
 * @param {string} baseComponent - Nome/percorso del componente base
 * @param {Object} componentsData - Output di loadComponentsData()
 * @returns {Array<{component: string, matchCount: number, matches: Array<{name: string, version: string}>}>}
 * ordinato per numero di corrispondenze decrescente
 */
function findMatchingProjectsByName(baseComponent, componentsData) {
  const baseInfo = componentsData[baseComponent];
  if (!baseInfo) return [];

  const baseDepNames = getAllDependencyNames(baseInfo);
  const results = [];

  Object.keys(componentsData).forEach((otherComponent) => {
    if (otherComponent === baseComponent) return;

    const otherInfo = componentsData[otherComponent];
    const matches = [];

    baseDepNames.forEach((depName) => {
      const base = getVersionAndSection(baseInfo, depName);
      const other = getVersionAndSection(otherInfo, depName);

      if (base.version !== undefined && other.version !== undefined && base.version === other.version) {
        matches.push({ name: depName, version: base.version });
      }
    });

    if (matches.length > 0) {
      results.push({ component: otherComponent, matchCount: matches.length, matches });
    }
  });

  results.sort((a, b) => b.matchCount - a.matchCount || a.component.localeCompare(b.component));
  return results;
}

/**
 * Trova, per un progetto base, quali sue dipendenze hanno almeno un altro
 * progetto con la stessa versione esatta. Modalità di navigazione "per pacchetto".
 *
 * @param {string} baseComponent
 * @param {Object} componentsData
 * @returns {Array<{name: string, version: string, components: string[]}>}
 * ordinato per numero di progetti corrispondenti decrescente
 */
function findMatchingPackagesForComponent(baseComponent, componentsData) {
  const baseInfo = componentsData[baseComponent];
  if (!baseInfo) return [];

  const baseDepNames = Array.from(getAllDependencyNames(baseInfo)).sort();
  const results = [];

  baseDepNames.forEach((depName) => {
    const base = getVersionAndSection(baseInfo, depName);
    if (base.version === undefined) return;

    const matchingComponents = [];
    Object.keys(componentsData).forEach((otherComponent) => {
      if (otherComponent === baseComponent) return;
      const other = getVersionAndSection(componentsData[otherComponent], depName);
      if (other.version !== undefined && other.version === base.version) {
        matchingComponents.push(otherComponent);
      }
    });

    if (matchingComponents.length > 0) {
      results.push({
        name: depName,
        version: base.version,
        components: matchingComponents.sort(),
      });
    }
  });

  results.sort((a, b) => b.components.length - a.components.length || a.name.localeCompare(b.name));
  return results;
}

/**
 * Calcola il confronto completo (diff) tra le dipendenze di due componenti.
 *
 * @param {Object} baseInfo
 * @param {Object} targetInfo
 * @returns {Array<{name, baseVersion, baseSection, targetVersion, targetSection, status}>}
 * status: "same" | "different" | "onlyBase" | "onlyTarget"
 * Ordinato: prima "different", poi "onlyBase"/"onlyTarget", poi "same" (alfabetico all'interno del gruppo)
 */
function computeVersionDiff(baseInfo, targetInfo) {
  const allNames = new Set([
    ...getAllDependencyNames(baseInfo),
    ...getAllDependencyNames(targetInfo),
  ]);

  const statusOrder = { different: 0, onlyBase: 1, onlyTarget: 1, same: 2 };
  const rows = [];

  allNames.forEach((name) => {
    const base = getVersionAndSection(baseInfo, name);
    const target = getVersionAndSection(targetInfo, name);

    let status;
    if (base.version === undefined) {
      status = "onlyTarget";
    } else if (target.version === undefined) {
      status = "onlyBase";
    } else if (base.version === target.version) {
      status = "same";
    } else {
      status = "different";
    }

    rows.push({
      name,
      baseVersion: base.version,
      baseSection: base.section,
      targetVersion: target.version,
      targetSection: target.section,
      status,
    });
  });

  rows.sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Calcola una matrice di confronto delle versioni tra TUTTI i progetti
 * (non solo una coppia base/target). Utile per avere una vista d'insieme
 * di quali dipendenze sono divergenti nell'intero repository, a partire dai
 * `package.json` reali (indipendentemente da dependencies-config.js).
 *
 * @param {Object} componentsData - Output di loadComponentsData()
 * @returns {{
 *   components: string[],
 *   packages: Array<{
 *     name: string,
 *     versions: Object<string, string|undefined>,
 *     uniqueVersions: string[],
 *     presentIn: number,
 *     status: "same"|"diverging"
 *   }>
 * }}
 * status "diverging": il pacchetto ha più di una versione univoca tra i
 * progetti in cui è presente. status "same": stessa versione ovunque sia
 * presente (anche se presente solo in un sottoinsieme dei progetti).
 */
function computeAllProjectsVersionMatrix(componentsData) {
  const components = Object.keys(componentsData).sort();
  const allNames = new Set();
  components.forEach((component) => {
    getAllDependencyNames(componentsData[component]).forEach((name) => allNames.add(name));
  });

  const packages = Array.from(allNames)
    .sort()
    .map((name) => {
      const versions = {};
      components.forEach((component) => {
        const { version } = getVersionAndSection(componentsData[component], name);
        versions[component] = version;
      });

      const presentVersions = Object.values(versions).filter((v) => v !== undefined);
      const uniqueVersions = Array.from(new Set(presentVersions));
      const status = uniqueVersions.length > 1 ? "diverging" : "same";

      return { name, versions, uniqueVersions, presentIn: presentVersions.length, status };
    });

  packages.sort((a, b) => {
    if (a.status !== b.status) return a.status === "diverging" ? -1 : 1;
    return b.presentIn - a.presentIn || a.name.localeCompare(b.name);
  });

  return { components, packages };
}

/**
 * Applica l'allineamento delle versioni al package.json del componente base.
 * Aggiorna solo le dipendenze indicate, mantenendo la sezione (dependencies/
 * devDependencies) in cui si trovano già nel componente base.
 *
 * @param {string} baseComponent - Nome/percorso del componente base
 * @param {Array<{name: string, section: string, newVersion: string}>} alignments
 * @param {boolean} removeLockFile - Se rimuovere package-lock.json dopo l'allineamento
 * @param {boolean} pinExactVersion - Se true, rimuove i prefissi di range semver
 *   (^, ~, >=, <=, >, <) da `newVersion` prima di scriverlo, così viene fissata
 *   esattamente la versione indicata invece del range originale.
 * @returns {{success: boolean, applied: Array, error?: string}}
 */
function applyVersionAlignment(baseComponent, alignments, removeLockFile = true, pinExactVersion = false) {
  const componentPath = path.join(process.cwd(), baseComponent);
  const packageJsonPath = path.join(componentPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return { success: false, applied: [], error: "package.json non trovato" };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const applied = [];

    alignments.forEach(({ name, section, newVersion }) => {
      const targetSection = section === "devDependencies" ? "devDependencies" : "dependencies";
      if (!packageJson[targetSection]) {
        packageJson[targetSection] = {};
      }
      const oldVersion = packageJson[targetSection][name];
      const finalVersion = pinExactVersion ? cleanVersion(newVersion) : newVersion;
      packageJson[targetSection][name] = finalVersion;
      applied.push({ name, section: targetSection, oldVersion, newVersion: finalVersion });
    });

    if (applied.length === 0) {
      return { success: true, applied: [] };
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

    if (removeLockFile) {
      const packageLockPath = path.join(componentPath, "package-lock.json");
      if (fs.existsSync(packageLockPath)) {
        removeFile(packageLockPath);
        logger.log(`🗑️  Rimosso package-lock.json per ${baseComponent}`, "yellow");
      }
    }

    return { success: true, applied };
  } catch (error) {
    return { success: false, applied: [], error: error.message };
  }
}

module.exports = {
  loadComponentsData,
  getComponentPackageInfo,
  getVersionAndSection,
  getAllDependencyNames,
  findMatchingProjectsByName,
  findMatchingPackagesForComponent,
  computeVersionDiff,
  computeAllProjectsVersionMatrix,
  applyVersionAlignment,
};
