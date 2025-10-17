#!/usr/bin/env node

/**
 * Gestore Pacchetti Cherry 106 - Entry Point
 * Versione modulare con configurazione esterna
 */

const path = require('path');
const fs = require('fs');

// Colori per console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  // Cerchiamo la cartella package-manager
  const packageManagerDir = path.join(__dirname, 'package-manager');
  
  if (!fs.existsSync(packageManagerDir)) {
    log('❌ Cartella package-manager non trovata!', 'red');
    log('   Assicurati che la cartella package-manager si trovi nella root del progetto.', 'yellow');
    process.exit(1);
  }
  
  // Carichiamo la configurazione del progetto
  const projectConfigPath = path.join(packageManagerDir, 'project-config.js');
  if (!fs.existsSync(projectConfigPath)) {
    log('❌ File project-config.js non trovato!', 'red');
    log('   Assicurati che il file project-config.js si trovi nella cartella package-manager.', 'yellow');
    process.exit(1);
  }
  
  // Avviamo lo script principale
  const mainScript = path.join(packageManagerDir, 'scripts', 'core.js');
  if (!fs.existsSync(mainScript)) {
    log('❌ Script principale core.js non trovato!', 'red');
    log('   Assicurati che il file core.js si trovi nella cartella package-manager/scripts.', 'yellow');
    process.exit(1);
  }
  
  try {
    // Carichiamo e avviamo lo script principale
    const coreModule = require(mainScript);
    
    // Passiamo gli argomenti della riga di comando
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      // Modalità interattiva
      await coreModule.main();
    } else {
      // Modalità riga di comando
      await coreModule.parseAndExecuteCommand(args);
    }
    
  } catch (error) {
    log('❌ Errore durante l\'avvio:', 'red');
    log(`   ${error.message}`, 'yellow');
    
    if (error.code === 'MODULE_NOT_FOUND') {
      log('   Assicurati che tutti i file necessari si trovino nella cartella package-manager.', 'blue');
    }
    
        process.exit(1);
  }
}

// Avvio della funzione principale
if (require.main === module) {
  main().catch(error => {
    log('❌ Errore durante l\'esecuzione:', 'red');
    log(`   ${error.message}`, 'yellow');
    process.exit(1);
  });
}

module.exports = { main };