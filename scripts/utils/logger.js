#!/usr/bin/env node

/**
 * Shared Logger Module
 * Modulo centralizzato di logging per tutti gli script package-manager
 */

const fs = require("fs");
const path = require("path");

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
let logToFile = false;
let logFilePath = null;
let currentSessionId = null;

/**
 * Imposta la modalità verbose
 * @param {boolean} value - true per logging dettagliato
 */
function setVerbose(value) {
  verbose = value;
}

/**
 * Abilita il logging su file
 * @param {boolean} enable - true per abilitare il logging su file
 * @param {string} projectRoot - percorso root del progetto
 */
function enableFileLogging(enable, projectRoot = process.cwd()) {
  logToFile = enable;
  
  if (enable) {
    // Crea la cartella logs se non esiste
    const logsDir = path.join(projectRoot, "package-manager", "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Genera un ID sessione unico
    currentSessionId = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Crea il percorso del file di log
    logFilePath = path.join(logsDir, `session-${currentSessionId}.log`);
    
    // Inizializza il file di log
    const timestamp = new Date().toISOString();
    const header = `\n=== PACKAGE MANAGER SESSION STARTED ===\nTimestamp: ${timestamp}\nSession ID: ${currentSessionId}\nProject Root: ${projectRoot}\n${'='.repeat(50)}\n\n`;
    
    try {
      fs.writeFileSync(logFilePath, header, 'utf8');
    } catch (error) {
      console.error(`Errore creando file di log: ${error.message}`);
      logToFile = false;
    }
  }
}

/**
 * Ottiene il percorso del file di log corrente
 * @returns {string|null} percorso del file di log o null se non abilitato
 */
function getLogFilePath() {
  return logFilePath;
}

/**
 * Ottiene l'ID della sessione corrente
 * @returns {string|null} ID della sessione o null se non abilitato
 */
function getCurrentSessionId() {
  return currentSessionId;
}

/**
 * Scrive un messaggio nel file di log
 * @param {string} message - messaggio da scrivere
 * @param {string} level - livello del log (INFO, WARN, ERROR, etc.)
 */
function writeToLogFile(message, level = 'INFO') {
  if (!logToFile || !logFilePath) return;
  
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
  } catch (error) {
    console.error(`Errore scrivendo nel file di log: ${error.message}`);
  }
}

/**
 * Pulisce i log vecchi (mantiene solo gli ultimi N file)
 * @param {string} projectRoot - percorso root del progetto
 * @param {number} keepFiles - numero di file da mantenere (default: 10)
 */
function cleanupOldLogs(projectRoot = process.cwd(), keepFiles = 10) {
  try {
    const logsDir = path.join(projectRoot, "package-manager", "logs");
    if (!fs.existsSync(logsDir)) return;
    
    const files = fs.readdirSync(logsDir)
      .filter(file => file.startsWith('session-') && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(logsDir, file),
        stats: fs.statSync(path.join(logsDir, file))
      }))
      .sort((a, b) => b.stats.mtime - a.stats.mtime);
    
    // Rimuovi i file più vecchi
    if (files.length > keepFiles) {
      const filesToDelete = files.slice(keepFiles);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`🗑️  Rimosso log vecchio: ${file.name}`);
        } catch (error) {
          console.error(`Errore rimuovendo ${file.name}: ${error.message}`);
        }
      });
    }
  } catch (error) {
    console.error(`Errore pulendo i log: ${error.message}`);
  }
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

  // Scrivi nel file di log se abilitato
  if (logToFile) {
    writeToLogFile(message, 'INFO');
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
  if (logToFile) {
    writeToLogFile(`❌ ${message}`, 'ERROR');
  }
  log(`❌ ${message}`, "red", true);
}

/**
 * Logging delle operazioni riuscite (sempre in verde)
 * @param {string} message - Messaggio di successo
 */
function success(message) {
  if (logToFile) {
    writeToLogFile(`✅ ${message}`, 'SUCCESS');
  }
  log(`✅ ${message}`, "green");
}

/**
 * Logging degli avvisi (sempre in giallo)
 * @param {string} message - Messaggio di avviso
 */
function warning(message) {
  if (logToFile) {
    writeToLogFile(`⚠️  ${message}`, 'WARN');
  }
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
  
  // Funzioni di file logging
  enableFileLogging,
  getLogFilePath,
  getCurrentSessionId,
  writeToLogFile,
  cleanupOldLogs,

  // Colori (per uso esterno)
  colors,
};
