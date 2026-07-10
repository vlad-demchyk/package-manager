/**
 * Whitelist manuale per depcheck.
 *
 * depcheck (e lo scanner interno) rileva l'uso di un pacchetto cercando
 * pattern statici (import/require) nel codice sorgente. Alcuni pacchetti
 * sono usati in modi che questi pattern non riescono a rilevare (es. plugin
 * caricati per nome da un file di configurazione non-JS, dipendenze
 * richieste solo a runtime dinamicamente, pacchetti usati solo da script
 * CLI esterni, ecc.). Questo modulo gestisce un elenco per-progetto di
 * pacchetti che NON devono mai essere proposti per la rimozione, salvato in
 * `package-manager/project-config.js` -> `depcheck.ignore`.
 */

const fs = require("fs");
const path = require("path");

function getProjectConfigPath(projectRoot) {
  return path.join(projectRoot, "package-manager", "project-config.js");
}

function getIgnoreList(projectConfig) {
  return Array.isArray(projectConfig?.depcheck?.ignore)
    ? projectConfig.depcheck.ignore
    : [];
}

/**
 * Aggiunge la sezione `depcheck: { ignore: [] }` al project-config.js se manca.
 * Non tocca il resto del file: inserisce la sezione come primissima proprietà
 * di module.exports, per evitare problemi di virgole finali con l'ultima
 * proprietà esistente.
 */
function ensureDepcheckSectionExists(projectRoot) {
  const configPath = getProjectConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) {
    return { success: false, reason: "config-not-found" };
  }

  const content = fs.readFileSync(configPath, "utf8");
  if (/\bdepcheck\s*:/.test(content)) {
    return { success: true, alreadyPresent: true };
  }

  if (!content.includes("module.exports = {")) {
    return { success: false, reason: "unexpected-format" };
  }

  const insertion =
    "module.exports = {\n" +
    "  // Pacchetti che depcheck non deve MAI proporre per la rimozione.\n" +
    "  // Usalo per i pacchetti che sai essere usati ma che i pattern statici\n" +
    "  // (import/require) non riescono a rilevare.\n" +
    "  depcheck: {\n" +
    "    ignore: []\n" +
    "  },\n";

  const updated = content.replace("module.exports = {", insertion);
  fs.writeFileSync(configPath, updated, "utf8");
  return { success: true, alreadyPresent: false };
}

const IGNORE_ARRAY_REGEX = /(depcheck\s*:\s*{\s*ignore\s*:\s*\[)([^\]]*)(\])/;

function writeIgnoreList(projectRoot, packageNames) {
  const configPath = getProjectConfigPath(projectRoot);
  const content = fs.readFileSync(configPath, "utf8");

  if (!IGNORE_ARRAY_REGEX.test(content)) {
    return { success: false, reason: "section-not-found" };
  }

  const itemsRaw = packageNames.map((name) => JSON.stringify(name)).join(", ");
  const updated = content.replace(IGNORE_ARRAY_REGEX, `$1${itemsRaw}$3`);
  fs.writeFileSync(configPath, updated, "utf8");
  return { success: true };
}

function addToIgnoreList(projectRoot, projectConfig, packageName) {
  const name = String(packageName || "").trim();
  if (!name) return { success: false, reason: "empty-name" };

  ensureDepcheckSectionExists(projectRoot);

  const current = getIgnoreList(projectConfig);
  if (current.includes(name)) {
    return { success: false, reason: "already-present" };
  }

  const updatedList = [...current, name];
  const result = writeIgnoreList(projectRoot, updatedList);
  if (!result.success) return result;

  if (!projectConfig.depcheck) projectConfig.depcheck = {};
  projectConfig.depcheck.ignore = updatedList;
  return { success: true, list: updatedList };
}

function removeFromIgnoreList(projectRoot, projectConfig, packageName) {
  const name = String(packageName || "").trim();
  const current = getIgnoreList(projectConfig);
  if (!current.includes(name)) {
    return { success: false, reason: "not-present" };
  }

  const updatedList = current.filter((p) => p !== name);
  const result = writeIgnoreList(projectRoot, updatedList);
  if (!result.success) return result;

  if (!projectConfig.depcheck) projectConfig.depcheck = {};
  projectConfig.depcheck.ignore = updatedList;
  return { success: true, list: updatedList };
}

module.exports = {
  getProjectConfigPath,
  getIgnoreList,
  ensureDepcheckSectionExists,
  addToIgnoreList,
  removeFromIgnoreList,
};
