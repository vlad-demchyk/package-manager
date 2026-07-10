/**
 * Azioni condivise tra la modalità CLI (argomenti da riga di comando,
 * parseAndExecuteCommand) e i menu interattivi (install-menu.js,
 * npm-tools-menu.js, ecc.). Centralizzarle qui evita dipendenze circolari
 * tra core.js e i moduli menu.
 */

const path = require("path");

const logger = require("../utils/logger");
const cliContext = require("./context");
const {
  cleanComponent: cleanComponentFromModule,
  cleanAllComponents: cleanAllComponentsFromModule,
} = require("../operations/cleaner");
const { getComponentDirectories } = require("../utils/common");

// Delegata a cliContext: punto unico di reload di project-config.js
// (vedi commento su cliContext.reloadProjectConfig per i dettagli).
function reloadProjectConfig() {
  return cliContext.reloadProjectConfig();
}

function cleanComponent(componentPath) {
  return cleanComponentFromModule(componentPath, cliContext.getProjectConfig());
}

function cleanAllComponents(excludeList = [], cleanMode = "lock-and-modules") {
  return cleanAllComponentsFromModule(excludeList, cliContext.getProjectConfig(), cleanMode);
}

function installPackages(componentPath, mode = "normal") {
  const currentProjectConfig = reloadProjectConfig();

  const { detectWorkspaceConfiguration } = require("../utils/workspace-detector");
  const workspaceDetection = detectWorkspaceConfiguration(process.cwd());

  const { resolveLockFileConflicts } = require("../operations/cleaner");
  resolveLockFileConflicts(currentProjectConfig);

  let isWorkspaceMode = currentProjectConfig.workspace?.enabled && currentProjectConfig.workspace?.initialized;

  if (workspaceDetection && workspaceDetection.hasWorkspaceConfig && workspaceDetection.hasYarnLock && !isWorkspaceMode) {
    logger.section("🔍 Rilevamento automatico Yarn Workspace");
    logger.info("📦 Trovati workspaces in root package.json");
    logger.info(`📊 Numero workspace: ${workspaceDetection.workspaceCount}`);
    logger.info(`📁 Package manager: ${workspaceDetection.packageManager}`);

    const { updateProjectConfigWorkspace, syncRootPackageJson } = require("../operations/workspace");
    updateProjectConfigWorkspace(currentProjectConfig, true, true, workspaceDetection.workspaces);
    syncRootPackageJson(currentProjectConfig);

    logger.success("✅ Modalità Workspace abilitata automaticamente!");
    isWorkspaceMode = true;
  }

  if (isWorkspaceMode) {
    const { installAllComponentsWorkspace } = require("../operations/workspace-install");
    return installAllComponentsWorkspace(currentProjectConfig, mode);
  }

  const { installPackagesStandard } = require("../operations/standard-install");
  return installPackagesStandard(componentPath, mode, currentProjectConfig);
}

function installAllComponents(mode = "normal") {
  const currentProjectConfig = reloadProjectConfig();

  const isWorkspaceMode = currentProjectConfig.workspace?.enabled && currentProjectConfig.workspace?.initialized;

  if (isWorkspaceMode) {
    const { installAllComponentsWorkspace } = require("../operations/workspace-install");
    return installAllComponentsWorkspace(currentProjectConfig, mode);
  }

  const { installAllComponentsStandard } = require("../operations/standard-install");
  return installAllComponentsStandard(mode, currentProjectConfig);
}

async function updateAllConfigs(scope = "all", components = []) {
  const updateScript = require("../update-configs");
  return await updateScript.updateAllConfigs(scope, components);
}

function executeInstallCommand(scope, components, mode) {
  const projectConfig = cliContext.getProjectConfig();

  switch (scope) {
    case "all":
      installAllComponents(mode);
      break;
    case "single":
      if (components.length > 0) {
        installPackages(path.join(process.cwd(), components[0]), mode);
      } else {
        logger.error("Nessun componente specificato per --single");
      }
      break;
    case "exclude": {
      const allComponents = getComponentDirectories(projectConfig);
      const filteredComponents = allComponents.filter((comp) => !components.includes(comp));
      if (filteredComponents.length > 0) {
        logger.log(
          `🚀 Installazione per ${filteredComponents.length} componenti (escluso: ${components.join(", ")})...`,
          "cyan"
        );
        filteredComponents.forEach((component) => {
          installPackages(path.join(process.cwd(), component), mode);
        });
      } else {
        logger.error("Tutti i componenti esclusi dall'installazione");
      }
      break;
    }
  }

  // Ritorna al menu dopo l'installazione (no-op in modalità CLI non interattiva)
  setTimeout(() => {
    cliContext.returnToMainMenu();
  }, 100);
}

function executeReinstallCommand(scope, components, mode, cleanMode = "lock-and-modules") {
  // Prima pulizia, poi installazione
  executeCleanCommand(scope, components, cleanMode);
  executeInstallCommand(scope, components, mode);
  // executeInstallCommand already handles the setTimeout for returning to menu
}

function executeCleanCommand(scope, components, cleanMode = "lock-and-modules") {
  const projectConfig = reloadProjectConfig();

  const isWorkspaceMode = projectConfig.workspace?.enabled && projectConfig.workspace?.initialized;

  switch (scope) {
    case "all":
      cleanAllComponents(null, cleanMode);
      break;
    case "single":
      if (components.length > 0) {
        if (isWorkspaceMode) {
          const { cleanSingleWorkspaceComponent } = require("../operations/cleaner");
          const success = cleanSingleWorkspaceComponent(components[0], projectConfig, cleanMode);
          if (!success) {
            logger.error(`Errore pulizia workspace ${components[0]}`);
          }
        } else {
          cleanComponent(path.join(process.cwd(), components[0]));
        }
      } else {
        logger.error("Nessun componente specificato per --single");
      }
      break;
    case "exclude":
      if (isWorkspaceMode) {
        const { cleanWorkspaceComponents } = require("../operations/cleaner");
        cleanWorkspaceComponents(components, projectConfig, cleanMode);
      } else {
        cleanAllComponents(components, cleanMode);
      }
      break;
  }

  // Ritorna al menu dopo la pulizia
  setTimeout(() => {
    cliContext.returnToMainMenu();
  }, 100);
}

async function executeUpdateCommand(scope = "all", components = []) {
  const success = await updateAllConfigs(scope, components);

  if (!success) {
    logger.log("🔄 Ritorno al menu principale...", "cyan");
  }

  // Ritorna al menu dopo l'aggiornamento
  setTimeout(() => {
    cliContext.returnToMainMenu();
  }, 100);
}

async function executeDepcheckCommand(scope, components, args, onComplete = null) {
  // Pulisce la cache del modulo per assicurarsi di usare la versione più recente
  delete require.cache[require.resolve("../validation/depcheck")];
  const depcheckScript = require("../validation/depcheck");

  let depcheckArgs = [];

  if (scope === "single" && components.length > 0) {
    depcheckArgs.push("--single", components[0]);
  } else if (scope === "exclude" && components.length > 0) {
    depcheckArgs.push("--exclude", ...components);
  }

  if (args && args.length > 0) {
    depcheckArgs.push(...args);
  }

  await depcheckScript.parseAndExecuteCommand(depcheckArgs, onComplete);
}

async function executeDepcheckCleanCommand(scope, components, args, onComplete = null) {
  delete require.cache[require.resolve("../validation/depcheck")];
  const depcheckScript = require("../validation/depcheck");

  let depcheckArgs = [];

  if (scope === "single" && components.length > 0) {
    depcheckArgs.push("--single", components[0]);
  } else if (scope === "exclude" && components.length > 0) {
    depcheckArgs.push("--exclude", ...components);
  }

  depcheckArgs.push("clean");

  if (args && args.length > 0) {
    depcheckArgs.push(...args);
  }

  await depcheckScript.parseAndExecuteCommand(depcheckArgs, onComplete);
}

module.exports = {
  reloadProjectConfig,
  cleanComponent,
  cleanAllComponents,
  installPackages,
  installAllComponents,
  updateAllConfigs,
  executeInstallCommand,
  executeReinstallCommand,
  executeCleanCommand,
  executeUpdateCommand,
  executeDepcheckCommand,
  executeDepcheckCleanCommand,
};
