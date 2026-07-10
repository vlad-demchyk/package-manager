/**
 * Contesto CLI condiviso.
 *
 * core.js crea un'unica interfaccia readline per l'intera sessione interattiva
 * e la registra qui. Altri moduli (update-configs.js, menu, ecc.) possono
 * riutilizzarla invece di creare una propria istanza readline: due istanze
 * readline attive contemporaneamente sullo stesso process.stdin causano
 * letture perse o duplicate degli input dell'utente.
 *
 * In modalità "solo riga di comando" (nessun menu interattivo) `rl` resta
 * `null`: i moduli che ne hanno bisogno devono creare un'istanza temporanea.
 */

const path = require("path");
const logger = require("../utils/logger");

let rl = null;
let projectConfig = null;
let mainMenuHandler = null;
const projectRoot = process.cwd();

function setRl(instance) {
  rl = instance;
}

function getRl() {
  return rl && !rl.closed ? rl : null;
}

function setProjectConfig(config) {
  projectConfig = config;
}

function getProjectConfig() {
  return projectConfig;
}

function getProjectRoot() {
  return projectRoot;
}

/**
 * Ricarica project-config.js da disco e aggiorna lo stato condiviso.
 *
 * Punto unico di ricarica: prima esisteva una copia quasi identica di questa
 * funzione in cli/actions.js, menus/workspace-menu.js e altri punti (menu-runner,
 * component-list), ognuna con la propria logica di invalidazione della cache.
 * Centralizzarla qui evita divergenze tra le implementazioni e garantisce che
 * chi chiama questa funzione riceva sempre l'oggetto config completo (mai un
 * oggetto parzialmente popolato), o il config precedente se il reload fallisce.
 *
 * @returns {Object} La configurazione ricaricata, oppure quella già in cache
 *   (o un oggetto vuoto) se il reload fallisce.
 */
function reloadProjectConfig() {
  try {
    const configPath = path.join(projectRoot, "package-manager", "project-config.js");
    delete require.cache[require.resolve(configPath)];
    const freshConfig = require(configPath);
    projectConfig = freshConfig;
    return freshConfig;
  } catch (error) {
    logger.warning("⚠️  Impossibile ricaricare la configurazione, uso la versione in cache");
    return projectConfig || {};
  }
}

/**
 * Registra la funzione che mostra/richiede di nuovo il menu principale
 * (definita in cli/menu-runner.js). I menu sparsi nei vari moduli non
 * conoscono menu-runner.js direttamente: usano solo returnToMainMenu(),
 * evitando dipendenze circolari tra i moduli menu.
 */
function setMainMenuHandler(fn) {
  mainMenuHandler = fn;
}

// Torna al menu principale, se una sessione interattiva è attiva. In modalità
// CLI (nessun menu interattivo) non fa nulla, come il precedente pattern
// "if (askQuestion) askQuestion();".
function returnToMainMenu() {
  if (typeof mainMenuHandler === "function") {
    mainMenuHandler();
  }
}

/**
 * Pone una domanda usando l'interfaccia readline condivisa, se attiva.
 * Non chiude MAI l'interfaccia condivisa (è gestita dalla sessione principale).
 */
function ask(promptText) {
  const activeRl = getRl();
  if (!activeRl) {
    throw new Error(
      "Nessuna interfaccia readline condivisa attiva: usa createStandaloneInterface()"
    );
  }
  return new Promise((resolve) => {
    activeRl.question(promptText, (answer) => resolve(String(answer).trim()));
  });
}

module.exports = {
  setRl,
  getRl,
  setProjectConfig,
  getProjectConfig,
  getProjectRoot,
  reloadProjectConfig,
  ask,
  setMainMenuHandler,
  returnToMainMenu,
};
