#!/usr/bin/env node

/**
 * Core script per il gestore pacchetti Cherry 106
 * Versione modulare con configurazione esterna
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// Carica configurazione progetto
const projectConfig = require('../project-config');

// Variabili globali per readline
let rl = null;
let askQuestion = null;

// Funzioni di utilità
function log(message, color = 'reset') {
  const colors = projectConfig.logging.colors;
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function isWindows() {
  return process.platform === 'win32';
}

function getNpmCommand() {
  return isWindows() ? projectConfig.commands.npm.windows : projectConfig.commands.npm.unix;
}

function getComponentDirectories() {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);
  
  return items.filter(item => {
    const fullPath = path.join(currentDir, item);
    
    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }
    
    // Controllo per prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        return false;
      }
    }
    
    // Controllo per struttura
    if (projectConfig.components.filterByStructure.enabled) {
      const requiredFiles = projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders = projectConfig.components.filterByStructure.requiredFolders;
      
      for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, file))) {
          return false;
        }
      }
      
      for (const folder of requiredFolders) {
        const folderPath = path.join(fullPath, folder);
        if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
          return false;
        }
      }
    }
    
    // Controllo per lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        return false;
      }
    }
    
    // Controllo per regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        return false;
      }
    }
    
    // Controlliamo sempre la presenza di package.json
    return fs.existsSync(path.join(fullPath, projectConfig.files.packageJson));
  });
}

function removeDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      if (isWindows()) {
        execSync(`rmdir /s /q "${dirPath}"`, { stdio: 'ignore' });
      } else {
        execSync(`rm -rf "${dirPath}"`, { stdio: 'ignore' });
      }
      return true;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }
  return true;
}

function cleanComponent(componentPath) {
  const componentName = path.basename(componentPath);
  let cleanedItems = [];
  
  log(`🧹 Pulizia ${componentName}...`, 'yellow');
  
  // Rimuoviamo node_modules
  const nodeModulesPath = path.join(componentPath, projectConfig.files.nodeModules);
  if (removeDirectory(nodeModulesPath)) {
    cleanedItems.push(projectConfig.files.nodeModules);
  }
  
  // Rimuoviamo package-lock.json
  const packageLockPath = path.join(componentPath, projectConfig.files.packageLock);
  if (removeFile(packageLockPath)) {
    cleanedItems.push(projectConfig.files.packageLock);
  }
  
  // Rimuoviamo tslint.json
  const tslintPath = path.join(componentPath, projectConfig.files.tslint);
  if (removeFile(tslintPath)) {
    cleanedItems.push(projectConfig.files.tslint);
  }
  
  if (cleanedItems.length > 0) {
    log(`✅ Pulito ${componentName}: ${cleanedItems.join(', ')}`, 'green');
    return true;
  } else {
    log(`ℹ️  ${componentName} già pulito`, 'blue');
    return true;
  }
}

function installPackages(componentPath, mode = 'normal') {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, projectConfig.files.packageJson);
  
  if (!fs.existsSync(packageJsonPath)) {
    log(`❌ ${projectConfig.files.packageJson} non trovato in ${componentName}`, 'red');
    return false;
  }
  
  log(`📦 Installazione pacchetti per ${componentName} (modalità: ${mode})...`, 'cyan');
  
  try {
    process.chdir(componentPath);
    
    let npmArgs = ['install'];
    
    switch (mode) {
      case 'clean':
        log(`🧹 Pulizia ${componentName}...`, 'yellow');
        removeDirectory(projectConfig.files.nodeModules);
        removeFile(projectConfig.files.packageLock);
        log(`✅ Pulito ${componentName}`, 'green');
        break;
        
      case 'legacy':
        npmArgs.push('--legacy-peer-deps');
        log(`⚠️  Usando --legacy-peer-deps per ${componentName}`, 'yellow');
        break;
        
      case 'force':
        npmArgs.push('--force');
        log(`⚠️  Usando --force per ${componentName}`, 'yellow');
        break;
    }
    
    log(`🔄 Avvio: ${getNpmCommand()} ${npmArgs.join(' ')}`, 'blue');
    
    const result = execSync(`${getNpmCommand()} ${npmArgs.join(' ')}`, {
      stdio: 'inherit',
      cwd: componentPath
    });
    
    log(`✅ Installati con successo i pacchetti per ${componentName}`, 'green');
    return true;
    
  } catch (error) {
    log(`❌ Errore durante l'installazione dei pacchetti per ${componentName}: ${error.message}`, 'red');
    return false;
  } finally {
    // Torniamo alla directory root
    process.chdir(path.join(__dirname, '../..'));
  }
}

// Funzioni per aggiornamento configurazioni
function updateAllConfigs() {
  const updateScript = require('./update-configs');
  return updateScript.updateAllConfigs();
}

// Funzioni per pulizia
function cleanAllComponents(excludeList = []) {
  const components = getComponentDirectories();
  
  if (components.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    return;
  }
  
  const filteredComponents = components.filter(component => !excludeList.includes(component));
  
  if (filteredComponents.length === 0) {
    log('❌ Tutti i componenti esclusi dalla pulizia', 'red');
    return;
  }
  
  log(`🧹 Pulizia ${filteredComponents.length} componenti...`, 'cyan');
  
  if (excludeList.length > 0) {
    log(`🚫 Escluso dalla pulizia: ${excludeList.join(', ')}`, 'yellow');
  }
  
  let successCount = 0;
  const totalCount = filteredComponents.length;
  
  filteredComponents.forEach((component, index) => {
    log(`\n[${index + 1}/${totalCount}] Elaborazione ${component}...`, 'magenta');
    const success = cleanComponent(path.join(process.cwd(), component));
    if (success) successCount++;
  });
  
  log(`\n📊 Risultato pulizia:`, 'cyan');
  log(`   ✅ Pulito con successo: ${successCount}/${totalCount}`, 'green');
  log(`   ❌ Errori: ${totalCount - successCount}/${totalCount}`, totalCount - successCount > 0 ? 'red' : 'green');
}

function installAllComponents(mode = 'normal') {
  const components = getComponentDirectories();
  
  if (components.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    return;
  }
  
  log(`🚀 Installazione pacchetti per tutti i ${components.length} componenti...`, 'cyan');
  
  let successCount = 0;
  const totalCount = components.length;
  
  components.forEach((component, index) => {
    log(`\n[${index + 1}/${totalCount}] Elaborazione ${component}...`, 'magenta');
    const success = installPackages(path.join(process.cwd(), component), mode);
    if (success) successCount++;
  });
  
  log(`\n📊 Risultato:`, 'cyan');
  log(`   ✅ Successo: ${successCount}/${totalCount}`, 'green');
  log(`   ❌ Errori: ${totalCount - successCount}/${totalCount}`, totalCount - successCount > 0 ? 'red' : 'green');
}

// Funzioni per parsing comandi
function parseAndExecuteCommand(args) {
  const currentDir = process.cwd();
  const currentDirName = path.basename(currentDir);
  
  // Перевіряємо, чи користувач знаходиться в папці package-manager
  if (currentDirName === 'package-manager') {
    log('⚠️  Ви знаходитесь в папці модуля package-manager!', 'yellow');
    log('');
    log('📁 Для виконання команд проекту потрібно повернутися в корінь проекту:', 'cyan');
    log('   cd ..', 'blue');
    log('');
    log('💡 Після цього ви зможете використовувати:', 'cyan');
    log('   node package-manager.js', 'blue');
    log('   node package-manager.js update', 'blue');
    log('   node package-manager.js install --single component-name', 'blue');
    log('');
    log('🔧 Або залишіться тут для налаштування модуля:', 'cyan');
    log('   node install.js', 'blue');
    log('');
    log('❓ Потрібна допомога?', 'cyan');
    log('   Читайте документацію: package-manager/README.md', 'blue');
    process.exit(0);
  }
  
  const command = args[0];
  
  let mode = 'normal';
  let scope = 'all';
  let components = [];
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--single') {
      scope = 'single';
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Skip next argument
      } else {
        log('❌ --single richiede il nome del componente', 'red');
        process.exit(1);
      }
    } else if (arg === '--exclude') {
      scope = 'exclude';
      components = [];
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith('--')) {
          break; // Stop at next flag
        }
        components.push(args[j]);
      }
      i += components.length; // Skip processed arguments
    } else if (['normal', 'legacy', 'force'].includes(arg)) {
      mode = arg;
    }
  }
  
  switch (command) {
    case 'install':
      executeInstallCommand(scope, components, mode);
      break;
    case 'reinstall':
      executeReinstallCommand(scope, components, mode);
      break;
    case 'clean':
      executeCleanCommand(scope, components);
      break;
    case 'update':
      if (scope !== 'all') {
        log('⚠️  Il comando update supporta solo l\'aggiornamento globale di tutti i componenti', 'yellow');
        log('   Questo garantisce che tutte le versioni rimangano sincronizzate', 'blue');
      }
      executeUpdateCommand();
      break;
    default:
      showUsage();
      process.exit(1);
  }
}

function executeInstallCommand(scope, components, mode) {
  switch (scope) {
    case 'all':
      installAllComponents(mode);
      break;
    case 'single':
      if (components.length > 0) {
        installPackages(path.join(process.cwd(), components[0]), mode);
      } else {
        log('❌ Nessun componente specificato per --single', 'red');
      }
      break;
    case 'exclude':
      const allComponents = getComponentDirectories();
      const filteredComponents = allComponents.filter(comp => !components.includes(comp));
      if (filteredComponents.length > 0) {
        log(`🚀 Installazione per ${filteredComponents.length} componenti (escluso: ${components.join(', ')})...`, 'cyan');
        filteredComponents.forEach(component => {
          installPackages(path.join(process.cwd(), component), mode);
        });
      } else {
        log('❌ Tutti i componenti esclusi dall\'installazione', 'red');
      }
      break;
  }
}

function executeReinstallCommand(scope, components, mode) {
  // Prima pulizia, poi installazione
  executeCleanCommand(scope, components);
  executeInstallCommand(scope, components, mode);
}

function executeCleanCommand(scope, components) {
  switch (scope) {
    case 'all':
      cleanAllComponents();
      break;
    case 'single':
      if (components.length > 0) {
        cleanComponent(path.join(process.cwd(), components[0]));
      } else {
        log('❌ Nessun componente specificato per --single', 'red');
      }
      break;
    case 'exclude':
      cleanAllComponents(components);
      break;
  }
}

function executeUpdateCommand() {
  // Update è sempre globale per mantenere sincronizzate le versioni
  updateAllConfigs();
}

function showUsage() {
  log('❌ Comando non valido. Utilizzo:', 'red');
  log('', 'reset');
  log('📦 Installazione:', 'cyan');
  log('  node package-manager.js install [--single component] [--exclude comp1 comp2] [normal|legacy|force]', 'blue');
  log('', 'reset');
  log('🔄 Reinstallazione (clean install):', 'cyan');
  log('  node package-manager.js reinstall [--single component] [--exclude comp1 comp2] [normal|legacy|force]', 'blue');
  log('', 'reset');
  log('🧹 Pulizia:', 'cyan');
  log('  node package-manager.js clean [--single component] [--exclude comp1 comp2]', 'blue');
  log('', 'reset');
  log('⚙️ Aggiornamento configurazioni:', 'cyan');
  log('  node package-manager.js update', 'blue');
  log('  (sempre globale per mantenere versioni sincronizzate)', 'yellow');
  log('', 'reset');
  log('📝 Esempi:', 'yellow');
  log('  node package-manager.js install --exclude c106-header c106-footer', 'green');
  log('  node package-manager.js install --single c106-header force', 'green');
  log('  node package-manager.js reinstall --exclude c106-header legacy', 'green');
  log('  node package-manager.js clean --single c106-header', 'green');
  log('  node package-manager.js update', 'green');
  log('', 'reset');
  log('🎯 Modalità interattiva:', 'cyan');
  log('  node package-manager.js', 'blue');
}

// Funzioni per menu interattivo
function showMenu() {
  log('\n📋 Gestore Pacchetti Cherry 106:', 'cyan');
  log('1. 📦 Installazione pacchetti', 'blue');
  log('2. 🔄 Reinstallazione pacchetti (clean install)', 'blue');
  log('3. 🧹 Pulizia/rimozione pacchetti', 'yellow');
  log('4. ⚙️  Aggiornamento configurazioni (globale)', 'green');
  log('0. 🚪 Esci', 'red');
}

function showComponentList() {
  const components = getComponentDirectories();
  log('\n📁 Componenti disponibili:', 'cyan');
  components.forEach((component, index) => {
    log(`${index + 1}. ${component}`, 'blue');
  });
  log(`0. 🔙 Torna al menu principale`, 'yellow');
  return components;
}

function showInstallMenu() {
  log('\n📦 Modalità installazione:', 'cyan');
  log('1. Installa per tutti i componenti', 'blue');
  log('2. Installa per un componente', 'blue');
  log('3. Installa per tutti eccetto quelli specificati', 'blue');
  log('0. 🔙 Torna al menu principale', 'yellow');
  
  if (!rl) return;
  
  rl.question('Scegli modalità installazione (0-3): ', (installAnswer) => {
    switch (installAnswer.trim()) {
      case '0':
        log('🔙 Tornando al menu principale...', 'blue');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case '1':
        showInstallModeMenu('all', []);
        break;
      case '2':
        showComponentSelectionMenu('single');
        break;
      case '3':
        showExcludeSelectionMenu();
        break;
      default:
        log('❌ Scelta non valida per installazione', 'red');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function showInstallModeMenu(scope, components) {
  log('\n⚙️ Modalità installazione:', 'cyan');
  log('1. Normale', 'blue');
  log('2. --legacy-peer-deps', 'yellow');
  log('3. --force', 'yellow');
  log('0. 🔙 Torna al menu principale', 'yellow');
  
  if (!rl) return;
  
  rl.question('Scegli modalità (0-3): ', (modeAnswer) => {
    let mode = 'normal';
    switch (modeAnswer.trim()) {
      case '0':
        log('🔙 Tornando al menu principale...', 'blue');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
      case '1':
        mode = 'normal';
        break;
      case '2':
        mode = 'legacy';
        break;
      case '3':
        mode = 'force';
        break;
      default:
        log('❌ Modalità non valida', 'red');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        return;
    }
    
    if (scope === 'all') {
      log('\n⚠️  Questo installerà i pacchetti per TUTTI i componenti!', 'yellow');
      rl.question('Continua? (y/N): ', (confirm) => {
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          executeInstallCommand(scope, components, mode);
        }
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
      });
    } else {
      executeInstallCommand(scope, components, mode);
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 100);
    }
  });
}

function showComponentSelectionMenu(scope) {
  const components = showComponentList();
  
  if (components.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    setTimeout(() => {
      if (askQuestion) askQuestion();
    }, 100);
    return;
  }
  
  if (!rl) return;
  
  rl.question('\nInserisci numero componente (0 per tornare al menu): ', (answer) => {
    if (answer.trim() === '0') {
      log('🔙 Tornando al menu principale...', 'blue');
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 100);
      return;
    }
    
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < components.length) {
      const selectedComponent = components[index];
      log(`\n🎯 Selezionato: ${selectedComponent}`, 'green');
      showInstallModeMenu(scope, [selectedComponent]);
    } else {
      log('❌ Numero componente non valido', 'red');
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 100);
    }
  });
}

function showExcludeSelectionMenu() {
  if (!rl) return;
  
  rl.question('Inserisci nomi componenti da escludere (separati da spazio): ', (excludeAnswer) => {
    const excludeList = excludeAnswer.trim().split(/\s+/).filter(name => name.length > 0);
    if (excludeList.length > 0) {
      log(`\n⚠️  Questo installerà per tutti i componenti eccetto: ${excludeList.join(', ')}`, 'yellow');
      rl.question('Continua? (y/N): ', (confirm) => {
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          showInstallModeMenu('exclude', excludeList);
        } else {
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        }
      });
    } else {
      log('❌ Nessun componente specificato per esclusione', 'red');
      setTimeout(() => {
        if (askQuestion) askQuestion();
      }, 100);
    }
  });
}

function showReinstallMenu() {
  log('\n🔄 Modalità reinstallazione:', 'cyan');
  log('1. Reinstalla per tutti i componenti', 'blue');
  log('2. Reinstalla per un componente', 'blue');
  log('3. Reinstalla per tutti eccetto quelli specificati', 'blue');
  log('0. 🔙 Torna al menu principale', 'yellow');
  
  if (!rl) return;
  
  rl.question('Scegli modalità reinstallazione (0-3): ', (reinstallAnswer) => {
    switch (reinstallAnswer.trim()) {
      case '0':
        log('🔙 Tornando al menu principale...', 'blue');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case '1':
        log('\n⚠️  Questo rimuoverà tutti i file node_modules e package-lock.json!', 'yellow');
        rl.question('Continua? (y/N): ', (confirm) => {
          if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
            showInstallModeMenu('all', []);
          } else {
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
        break;
      case '2':
        showComponentSelectionMenu('single');
        break;
      case '3':
        showExcludeSelectionMenu();
        break;
      default:
        log('❌ Scelta non valida per reinstallazione', 'red');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function showCleanMenu() {
  log('\n🧹 Modalità pulizia:', 'yellow');
  log('1. Pulisci tutti i componenti', 'blue');
  log('2. Pulisci un componente', 'blue');
  log('3. Pulisci tutti eccetto quelli specificati', 'blue');
  log('0. 🔙 Torna al menu principale', 'yellow');
  
  if (!rl) return;
  
  rl.question('Scegli opzione pulizia (0-3): ', (cleanAnswer) => {
    switch (cleanAnswer.trim()) {
      case '0':
        log('🔙 Tornando al menu principale...', 'blue');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
        break;
      case '1':
        log('\n⚠️  Questo rimuoverà node_modules, package-lock.json e tslint.json da TUTTI i componenti!', 'yellow');
        rl.question('Continua? (y/N): ', (confirm) => {
          if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
            cleanAllComponents();
          }
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        });
        break;
      case '2':
        const components = showComponentList();
        if (components.length === 0) {
          log('❌ Nessun componente trovato', 'red');
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
          return;
        }
        
        rl.question('\nInserisci numero componente per pulizia (0 per tornare al menu): ', (answer) => {
          if (answer.trim() === '0') {
            log('🔙 Tornando al menu principale...', 'blue');
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
            return;
          }
          
          const index = parseInt(answer) - 1;
          
          if (index >= 0 && index < components.length) {
            const selectedComponent = components[index];
            log(`\n🎯 Selezionato per pulizia: ${selectedComponent}`, 'green');
            cleanComponent(path.join(process.cwd(), selectedComponent));
            log('\n✅ Pulizia completata!', 'green');
          } else {
            log('❌ Numero componente non valido', 'red');
          }
          
          setTimeout(() => {
            if (askQuestion) askQuestion();
          }, 100);
        });
        break;
      case '3':
        rl.question('Inserisci nomi componenti da escludere (separati da spazio): ', (excludeAnswer) => {
          const excludeList = excludeAnswer.trim().split(/\s+/).filter(name => name.length > 0);
          if (excludeList.length > 0) {
            log(`\n⚠️  Questo rimuoverà file da tutti i componenti eccetto: ${excludeList.join(', ')}`, 'yellow');
            rl.question('Continua? (y/N): ', (confirm) => {
              if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
                cleanAllComponents(excludeList);
              }
              setTimeout(() => {
                if (askQuestion) askQuestion();
              }, 100);
            });
          } else {
            log('❌ Nessun componente specificato per esclusione', 'red');
            setTimeout(() => {
              if (askQuestion) askQuestion();
            }, 100);
          }
        });
        break;
      default:
        log('❌ Scelta non valida per pulizia', 'red');
        setTimeout(() => {
          if (askQuestion) askQuestion();
        }, 100);
    }
  });
}

function main() {
  log(`🚀 ${projectConfig.project.name} - ${projectConfig.project.description}`, 'bright');
  
  const args = process.argv.slice(2);
  
  // Se sono passati argomenti da riga di comando
  if (args.length > 0) {
    parseAndExecuteCommand(args);
    return;
  }
  
  // Modalità interattiva
  try {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Gestione errori readline
    rl.on('error', (err) => {
      log(`❌ Errore readline: ${err.message}`, 'red');
    });
    
    rl.on('close', () => {
      log('\n👋 Interfaccia chiusa', 'blue');
      process.exit(0);
    });
    
    // Gestione SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      log('\n\n👋 Arrivederci!', 'green');
      if (rl) rl.close();
      process.exit(0);
    });
    
    askQuestion = function() {
      if (rl && rl.closed) {
        return;
      }
      
      // Aspetta un momento prima di mostrare il menu per evitare conflitti
      setTimeout(() => {
        if (rl && rl.closed) {
          return;
        }
        showMenu();
        if (rl) {
          rl.question('\nScegli opzione (0-4): ', (answer) => {
            switch (answer.trim()) {
              case '1':
                showInstallMenu();
                break;
              case '2':
                showReinstallMenu();
                break;
              case '3':
                showCleanMenu();
                break;
              case '4':
                log('\n⚙️  Aggiornamento configurazioni per tutti i componenti...', 'cyan');
                log('⚠️  Questo aggiornerà le configurazioni per TUTTI i componenti!', 'yellow');
                if (rl) {
                  rl.question('Continua? (y/N): ', (confirm) => {
                    if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
                      updateAllConfigs();
                    }
                    setTimeout(() => {
                      if (askQuestion) askQuestion();
                    }, 100);
                  });
                }
                break;
              case '0':
                log('👋 Arrivederci!', 'green');
                if (rl) rl.close();
                break;
              default:
                log('❌ Scelta non valida. Riprova.', 'red');
                setTimeout(() => {
                  if (askQuestion) askQuestion();
                }, 100);
            }
          });
        }
      }, 50); // Piccolo delay per evitare conflitti
    };
    
    askQuestion();
    
  } catch (error) {
    log(`❌ Errore durante l'inizializzazione: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Avvio script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  getComponentDirectories,
  installPackages,
  cleanComponent,
  installAllComponents,
  cleanAllComponents,
  updateAllConfigs
};
