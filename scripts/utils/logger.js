#!/usr/bin/env node

/**
 * Shared Logger Module
 * Modulo centralizzato di logging per tutti gli script package-manager
 */

// Colori per la console
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// Impostazioni globali di logging
let verbose = false;
let silent = false;

/**
 * Imposta la modalità verbose
 * @param {boolean} value - true per logging dettagliato
 */
function setVerbose(value) {
  verbose = value;
}

/**
 * Imposta la modalità silent
 * @param {boolean} value - true per nascondere tutti i messaggi
 */
function setSilent(value) {
  silent = value;
}

/**
 * Verifica se la modalità verbose è attiva
 * @returns {boolean}
 */
function isVerbose() {
  return verbose;
}

/**
 * Verifica se la modalità silent è attiva
 * @returns {boolean}
 */
function isSilent() {
  return silent;
}

/**
 * Funzione principale di logging
 * @param {string} message - Messaggio da visualizzare
 * @param {string} color - Colore del messaggio (opzionale)
 * @param {boolean} force - Forza la visualizzazione anche in modalità silent
 */
function log(message, color = null, force = false) {
  if (silent && !force) {
    return;
  }

  if (color && colors[color]) {
    console.log(`${colors[color]}${message}${colors.reset}`);
  } else {
    console.log(message);
  }
}

/**
 * Logging degli errori (sempre in rosso)
 * @param {string} message - Messaggio di errore
 */
function error(message) {
  log(`❌ ${message}`, "red", true);
}

/**
 * Logging delle operazioni riuscite (sempre in verde)
 * @param {string} message - Messaggio di successo
 */
function success(message) {
  log(`✅ ${message}`, "green");
}

/**
 * Logging degli avvisi (sempre in giallo)
 * @param {string} message - Messaggio di avviso
 */
function warning(message) {
  log(`⚠️  ${message}`, "yellow");
}

/**
 * Logging delle informazioni (sempre in blu)
 * @param {string} message - Messaggio informativo
 */
function info(message) {
  log(`ℹ️  ${message}`, "blue");
}

/**
 * Logging dei processi (sempre in ciano)
 * @param {string} message - Messaggio di processo
 */
function process(message) {
  log(`🔧 ${message}`, "cyan");
}

/**
 * Logging dettagliato (solo in modalità verbose)
 * @param {string} message - Messaggio dettagliato
 * @param {string} color - Colore del messaggio (opzionale)
 */
function debug(message, color = "cyan") {
  if (verbose) {
    log(`   🔍 DEBUG: ${message}`, color);
  }
}

/**
 * Logging degli header delle sezioni
 * @param {string} message - Header della sezione
 */
function section(message) {
  log(`\n📋 ${message}`, "bright");
}

/**
 * Logging dei passaggi del processo
 * @param {string} message - Messaggio del passaggio
 * @param {number} step - Numero del passaggio (opzionale)
 */
function step(message, step = null) {
  const prefix = step ? `${step}. ` : "";
  log(`${prefix}${message}`, "blue");
}

/**
 * Logging dei risultati
 * @param {string} message - Messaggio del risultato
 * @param {boolean} isSuccess - Se il risultato è di successo
 */
function result(message, isSuccess = true) {
  const color = isSuccess ? "green" : "red";
  const icon = isSuccess ? "✅" : "❌";
  log(`${icon} ${message}`, color);
}

/**
 * Logging delle liste
 * @param {Array} items - Array di elementi da visualizzare
 * @param {string} title - Titolo della lista (opzionale)
 * @param {string} color - Colore (opzionale)
 */
function list(items, title = null, color = "blue") {
  if (title) {
    log(`\n📝 ${title}:`, color);
  }

  items.forEach((item, index) => {
    log(`   ${index + 1}. ${item}`, color);
  });
}

/**
 * Logging del progresso
 * @param {string} message - Messaggio del progresso
 * @param {number} current - Passaggio corrente
 * @param {number} total - Numero totale di passaggi
 */
function progress(message, current, total) {
  const percentage = Math.round((current / total) * 100);
  log(`🔄 ${message} (${current}/${total} - ${percentage}%)`, "yellow");
}

/**
 * Logging con timestamp
 * @param {string} message - Messaggio
 * @param {string} color - Colore (opzionale)
 */
function timestamp(message, color = null) {
  const now = new Date().toISOString();
  log(`[${now}] ${message}`, color);
}

// Esporta tutte le funzioni
module.exports = {
  // Funzioni principali
  log,
  error,
  success,
  warning,
  info,
  process,
  debug,
  section,
  step,
  result,
  list,
  progress,
  timestamp,

  // Impostazioni
  setVerbose,
  setSilent,
  isVerbose,
  isSilent,

  // Colori (per uso esterno)
  colors,
};
