/**
 * Menu di visualizzazione/pulizia dei log delle operazioni.
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("../cli/context");

function showLogsMenu() {
  const projectRoot = cliContext.getProjectRoot();
  logger.section("📝 Gestione Log delle Operazioni");

  const logsDir = path.join(projectRoot, "package-manager", "logs");
  const rl = cliContext.getRl();

  if (!fs.existsSync(logsDir)) {
    logger.warning("📁 Cartella logs non trovata");
    logger.info("I log verranno creati automaticamente durante le operazioni");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");

    if (!rl) return;
    rl.question("", () => {
      logger.info("Tornando al menu principale...");
      setTimeout(() => {
        cliContext.returnToMainMenu();
      }, 500);
    });
    return;
  }

  const logFiles = fs
    .readdirSync(logsDir)
    .filter((file) => file.startsWith("session-") && file.endsWith(".log"))
    .map((file) => ({
      name: file,
      path: path.join(logsDir, file),
      stats: fs.statSync(path.join(logsDir, file)),
    }))
    .sort((a, b) => b.stats.mtime - a.stats.mtime);

  if (logFiles.length === 0) {
    logger.warning("📁 Nessun file di log trovato");
    logger.info("I log verranno creati durante le operazioni");
    logger.warning("🔙 Premi INVIO per tornare al menu principale...");

    if (!rl) return;
    rl.question("", () => {
      logger.info("Tornando al menu principale...");
      setTimeout(() => {
        cliContext.returnToMainMenu();
      }, 500);
    });
    return;
  }

  logger.info(`📁 Trovati ${logFiles.length} file di log:`);
  logFiles.forEach((file, index) => {
    const date = file.stats.mtime.toLocaleString();
    const size = (file.stats.size / 1024).toFixed(1);
    logger.log(`   ${index + 1}. ${file.name} (${date}, ${size} KB)`, "blue");
  });

  logger.info("1. Visualizza log più recente");
  logger.info("2. Visualizza log specifico");
  logger.info("3. Pulisci log vecchi (mantiene solo gli ultimi 10)");
  logger.warning("0. 🔙 Torna al menu principale");

  if (!rl) return;
  rl.question("\nScegli opzione: ", (answer) => {
    switch (answer.trim()) {
      case "1":
        showLogContent(logFiles[0].path);
        break;
      case "2":
        showLogSelection(logFiles);
        break;
      case "3":
        cleanupLogs();
        break;
      case "0":
        logger.info("Tornando al menu principale...");
        setTimeout(() => {
          cliContext.returnToMainMenu();
        }, 500);
        break;
      default:
        logger.log("❌ Scelta non valida. Riprova.", "red");
        setTimeout(() => {
          showLogsMenu();
        }, 1000);
    }
  });
}

function showLogContent(logPath) {
  logger.section(`📄 Contenuto Log: ${path.basename(logPath)}`);
  const rl = cliContext.getRl();

  try {
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.split("\n");

    logger.info(`📊 Totale righe: ${lines.length}`);
    logger.info("📄 Ultime 50 righe del log:");
    logger.log("─".repeat(80), "blue");

    const lastLines = lines.slice(-50);
    lastLines.forEach((line) => {
      if (line.trim()) {
        logger.log(line, "white");
      }
    });

    logger.log("─".repeat(80), "blue");
    logger.warning("🔙 Premi INVIO per tornare al menu log...");

    if (!rl) return;
    rl.question("", () => {
      showLogsMenu();
    });
  } catch (error) {
    logger.error(`Errore leggendo log: ${error.message}`);
    logger.warning("🔙 Premi INVIO per tornare al menu log...");

    if (!rl) return;
    rl.question("", () => {
      showLogsMenu();
    });
  }
}

function showLogSelection(logFiles) {
  logger.section("📄 Seleziona Log da Visualizzare");

  logFiles.forEach((file, index) => {
    const date = file.stats.mtime.toLocaleString();
    const size = (file.stats.size / 1024).toFixed(1);
    logger.log(`   ${index + 1}. ${file.name} (${date}, ${size} KB)`, "blue");
  });

  logger.warning("0. 🔙 Torna al menu log");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("\nScegli numero log: ", (answer) => {
    const index = parseInt(answer) - 1;
    if (index >= 0 && index < logFiles.length) {
      showLogContent(logFiles[index].path);
    } else if (answer.trim() === "0") {
      showLogsMenu();
    } else {
      logger.log("❌ Scelta non valida. Riprova.", "red");
      setTimeout(() => {
        showLogSelection(logFiles);
      }, 1000);
    }
  });
}

function cleanupLogs() {
  const projectRoot = cliContext.getProjectRoot();
  logger.section("🧹 Pulizia Log Vecchi");

  try {
    logger.cleanupOldLogs(projectRoot, 10);
    logger.success("✅ Pulizia log completata");
    logger.info("Mantenuti solo gli ultimi 10 file di log");
  } catch (error) {
    logger.error(`Errore durante la pulizia: ${error.message}`);
  }

  logger.warning("🔙 Premi INVIO per tornare al menu log...");

  const rl = cliContext.getRl();
  if (!rl) return;
  rl.question("", () => {
    showLogsMenu();
  });
}

module.exports = {
  showLogsMenu,
  showLogContent,
  showLogSelection,
  cleanupLogs,
};
