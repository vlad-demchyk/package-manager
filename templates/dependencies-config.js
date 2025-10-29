/**
 * Configurazione dipendenze per Package Manager
 * Versione modulare con configurazione esterna
 */

// ============================================================================
// DIPENDENZE BASE (sempre aggiunte)
// ============================================================================
const BASE_DEPENDENCIES = {};

// ============================================================================
// DIPENDENZE CONDIZIONALI (aggiunte solo se utilizzate)
// ============================================================================
const CONDITIONAL_DEPENDENCIES = {};

// ============================================================================
// DIPENDENZE DEV (sempre aggiunte come devDependencies)
// ============================================================================
const DEV_DEPENDENCIES = {};

// ============================================================================
// DIPENDENZE DEV CONDIZIONALI (aggiunte solo se utilizzate come devDependencies)
// ============================================================================
const CONDITIONAL_DEV_DEPENDENCIES = {};

// ============================================================================
// DIPENDENZE DEPRECATE (rimosse da package.json)
// ============================================================================
const DEPRECATED_DEPENDENCIES = [
  // Esempio: "vecchio-nome-pacchetto"
];

// ============================================================================
// SCRIPT NPM STANDARD
// ============================================================================
const STANDARD_SCRIPTS = {
  // Esempio: "build": "tsc"
};

// ============================================================================
// TSCONFIG.JSON STANDARD
// ============================================================================
const STANDARD_TSCONFIG = {
  // Esempio: "compilerOptions": { "target": "es2016" }
};

// ============================================================================
// ENGINE NODE.JS
// ============================================================================
const NODE_ENGINES = {
  // Esempio: "node": ">=18.0.0 < 20.0.0"
};

// ============================================================================
// FUNZIONI PER ESPORTAZIONE (NON MODIFICARE)
// ============================================================================

function getAllDependencies() {
  const allDeps = { ...BASE_DEPENDENCIES };
  Object.entries(CONDITIONAL_DEPENDENCIES).forEach(([name, version]) => {
    allDeps[name] = version;
  });
  return allDeps;
}

function getBaseDependencies() {
  return { ...BASE_DEPENDENCIES };
}

function getConditionalDependencies() {
  return { ...CONDITIONAL_DEPENDENCIES };
}

function getDevDependencies() {
  return { ...DEV_DEPENDENCIES };
}

function getConditionalDevDependencies() {
  return { ...CONDITIONAL_DEV_DEPENDENCIES };
}

function getAllDevDependencies() {
  const allDevDeps = { ...DEV_DEPENDENCIES };
  Object.entries(CONDITIONAL_DEV_DEPENDENCIES).forEach(([name, version]) => {
    allDevDeps[name] = version;
  });
  return allDevDeps;
}

function getDeprecatedDependencies() {
  return [...DEPRECATED_DEPENDENCIES];
}

function getStandardScripts() {
  return { ...STANDARD_SCRIPTS };
}

function getStandardTsConfig() {
  return { ...STANDARD_TSCONFIG };
}

function getNodeEngines() {
  return { ...NODE_ENGINES };
}

module.exports = {
  BASE_DEPENDENCIES,
  CONDITIONAL_DEPENDENCIES,
  DEV_DEPENDENCIES,
  CONDITIONAL_DEV_DEPENDENCIES,
  DEPRECATED_DEPENDENCIES,
  STANDARD_SCRIPTS,
  STANDARD_TSCONFIG,
  NODE_ENGINES,
  getAllDependencies,
  getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getConditionalDevDependencies,
  getAllDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines,
};
