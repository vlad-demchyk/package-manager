/**
 * Helper generici per domande via readline, condivisi tra update-configs.js
 * e i moduli di gestione dipendenze (config-loader, overrides-manager, ecc.).
 *
 * IMPORTANTE: se la sessione interattiva principale (core.js) ha già una
 * readline.Interface attiva su process.stdin, la riutilizziamo invece di
 * crearne una seconda. Due interfacce readline attive contemporaneamente
 * sullo stesso stdin causano input persi o duplicati. Il wrapper restituito
 * ignora .close() perché la chiusura della sessione condivisa è responsabilità
 * di core.js, non della singola domanda.
 */

const readline = require("readline");
const cliContext = require("./context");

function createReadlineInterface() {
  const sharedRl = cliContext.getRl();
  if (sharedRl) {
    return {
      question: (question, callback) => sharedRl.question(question, callback),
      close: () => {},
    };
  }

  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(String(answer).trim());
    });
  });
}

module.exports = {
  createReadlineInterface,
  askQuestion,
};
