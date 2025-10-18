#!/usr/bin/env node

/**
 * Package Manager - CLI Entry Point (Shortcut)
 * Executable for 'pm' command
 */

const path = require("path");
const fs = require("fs");

// Trova la cartella package-manager nel progetto corrente
const projectRoot = process.cwd();
const packageManagerDir = path.join(projectRoot, "package-manager");

// Verifica se la cartella package-manager esiste
if (!fs.existsSync(packageManagerDir)) {
  console.error("❌ Cartella package-manager non trovata!");
  console.error("   Il modulo non è stato installato correttamente.");
  console.error(
    "   Esegui: npm install https://github.com/vlad-demchyk/package-manager"
  );
  process.exit(1);
}

// La configurazione verrà creata automaticamente se non esiste

// Carica e avvia il modulo principale
try {
  const mainModule = require("../install.js");
  mainModule.startPackageManager().catch((error) => {
    console.error("❌ Errore durante l'esecuzione:", error.message);
    process.exit(1);
  });
} catch (error) {
  console.error("❌ Errore durante il caricamento del modulo:", error.message);
  process.exit(1);
}
