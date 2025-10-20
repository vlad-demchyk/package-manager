#!/usr/bin/env node

/**
 * Package Manager - CLI Entry Point (Shortcut)
 * Executable for 'pm' command
 */

const path = require("path");
const fs = require("fs");

// Trova il modulo installato in node_modules
const projectRoot = process.cwd();
const nodeModulesPath = path.join(projectRoot, "node_modules", "@vlad-demchyk", "package-manager");

// Verifica se il modulo è installato in node_modules
if (!fs.existsSync(nodeModulesPath)) {
  console.error("❌ Modulo @vlad-demchyk/package-manager non trovato in node_modules!");
  console.error("   Il modulo non è stato installato correttamente.");
  console.error(
    "   Esegui: npm install @vlad-demchyk/package-manager"
  );
  process.exit(1);
}

// Verifica se la cartella package-manager esiste (per i file di configurazione)
const packageManagerDir = path.join(projectRoot, "package-manager");
if (!fs.existsSync(packageManagerDir)) {
  console.error("❌ Cartella package-manager non trovata!");
  console.error("   Esegui prima: npx packman install");
  process.exit(1);
}

// Carica e avvia il modulo principale da node_modules
try {
  const mainModule = require(path.join(nodeModulesPath, "install.js"));
  mainModule.startPackageManager().catch((error) => {
    console.error("❌ Errore durante l'esecuzione:", error.message);
    process.exit(1);
  });
} catch (error) {
  console.error("❌ Errore durante il caricamento del modulo:", error.message);
  process.exit(1);
}
