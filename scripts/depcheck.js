#!/usr/bin/env node

/**
 * Script per trovare e rimuovere dipendenze non utilizzate
 * Versione con analisi approfondita e integrazione con package-manager
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Carica la configurazione del progetto
const projectConfig = require('../project-config');

// Variabili globali per readline
let rl = null;

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

// Ottieni la lista dei componenti
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

// Funzione per lettura ricorsiva dei file
function getAllFiles(dirPath, extensions = ['.js', '.ts', '.tsx', '.jsx', '.json']) {
  let files = [];
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Saltiamo node_modules e altre cartelle di sistema
        if (!['node_modules', '.git', 'dist', 'lib', 'temp', 'release', '.vscode', '.idea'].includes(item)) {
          files = files.concat(getAllFiles(fullPath, extensions));
        }
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        if (extensions.includes(ext) && 
            !item.endsWith('package.json') && 
            !item.endsWith('package-lock.json')) {
          files.push(fullPath);
        }
        
        // Aggiungiamo file di configurazione
        const configFiles = ['tsconfig.json', 'eslint.config.js', '.eslintrc.js', 'gulpfile.js', 'webpack.config.js'];
        if (configFiles.includes(item)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    // Ignoriamo errori di accesso alle cartelle
  }
  
  return files;
}

// Configurazione per diversi tipi di progetti
const PROJECT_RULES = {
  // Predefinito - SharePoint/SPFx
  default: {
    devDependencies: {
      alwaysUsed: [
        '@types/',
        'gulp', 'webpack', 'typescript', 'eslint', 'tslint',
        '@microsoft/sp-', '@microsoft/rush-stack-',
        'ajv', 'eslint-plugin-', 'tslint-to-eslint-config'
      ]
    }
  },
  
  // Progetto React/Next.js
  react: {
    devDependencies: {
      alwaysUsed: [
        '@types/react', '@types/react-dom', 'react-scripts', 'next',
        'webpack', 'typescript', 'eslint', '@types/',
        'babel-', 'jest', 'testing-library'
      ]
    }
  },
  
  // Progetto Vue.js
  vue: {
    devDependencies: {
      alwaysUsed: [
        '@vue/cli', 'vue-loader', '@vue/compiler-sfc', 'vite',
        'webpack', 'typescript', 'eslint', '@types/',
        'babel-', 'jest'
      ]
    }
  },
  
  // Progetto Angular
  angular: {
    devDependencies: {
      alwaysUsed: [
        '@angular/cli', '@angular-devkit', 'ng',
        'typescript', 'eslint', '@types/',
        'karma', 'jasmine', 'protractor'
      ]
    }
  },
  
  // Progetto Node.js/Express
  nodejs: {
    devDependencies: {
      alwaysUsed: [
        'nodemon', 'ts-node', 'typescript', 'eslint', '@types/',
        'jest', 'supertest', 'mocha', 'chai'
      ]
    }
  }
};

// Funzione per ottenere le regole del progetto
function getProjectRules() {
  const projectType = projectConfig.project.type || 'default';
  return PROJECT_RULES[projectType] || PROJECT_RULES.default;
}

// Funzione per analizzare l'uso di una dipendenza in un file
function analyzeDependencyUsage(filePath, dependencyName, isDevDependency = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const rules = getProjectRules();
    
    // Regole speciali per devDependencies
    if (isDevDependency && rules.devDependencies) {
      const alwaysUsed = rules.devDependencies.alwaysUsed || [];
      
      // Controlliamo se la dipendenza è sempre considerata utilizzata
      for (const pattern of alwaysUsed) {
        if (dependencyName.includes(pattern) || dependencyName.startsWith(pattern)) {
          return true;
        }
      }
    }
    
    // Diversi modi di import e utilizzo
    const patterns = [
      // ES6 imports
      new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, 'gi'),
      new RegExp(`import\\s+['"]${dependencyName}['"]`, 'gi'),
      new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s+['"]${dependencyName}['"]`, 'gi'),
      
      // CommonJS requires
      new RegExp(`require\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, 'gi'),
      new RegExp(`require\\(['"]${dependencyName}['"]\\)`, 'gi'),
      
      // Dynamic imports
      new RegExp(`import\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, 'gi'),
      
      // Riferimenti diretti (per corrispondenze parziali)
      new RegExp(`['"]${dependencyName}['"]`, 'gi'),
      
      // Per pacchetti con sottopacchetti (es. @pnp/sp)
      new RegExp(`['"]${dependencyName}/`, 'gi'),
      
      // Per pacchetti con trattini e underscore
      new RegExp(`['"]${dependencyName.replace(/[-_]/g, '[-_]?')}['"]`, 'gi'),
      
      // Corrispondenze parziali per nomi complessi
      new RegExp(`['"]${dependencyName.split('-')[0]}['"]`, 'gi'),
      new RegExp(`['"]${dependencyName.split('_')[0]}['"]`, 'gi'),
    ];
    
    // Controlliamo ogni pattern
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        return true;
      }
    }
    
    // Controllo aggiuntivo per file di configurazione
    const fileName = path.basename(filePath);
    
    // Controllo per tsconfig.json
    if (fileName === 'tsconfig.json') {
      try {
        const jsonContent = JSON.parse(content);
        
        // Controlliamo in compilerOptions.types
        if (jsonContent.compilerOptions && jsonContent.compilerOptions.types) {
          if (jsonContent.compilerOptions.types.includes(dependencyName)) {
            return true;
          }
        }
        
        // Controlliamo in compilerOptions.typeRoots
        if (jsonContent.compilerOptions && jsonContent.compilerOptions.typeRoots) {
          for (const typeRoot of jsonContent.compilerOptions.typeRoots) {
            if (typeRoot.includes(dependencyName)) {
              return true;
            }
          }
        }
      } catch (jsonError) {
        // Ignoriamo errori di parsing JSON
      }
    }
    
    // Controllo per gulpfile.js
    if (fileName === 'gulpfile.js') {
      // Gulp è sempre utilizzato in gulpfile.js
      if (dependencyName === 'gulp') {
        return true;
      }
      
      // Controlliamo l'uso di altri build tools
      const buildTools = ['@microsoft/sp-build-web', 'webpack', 'typescript'];
      if (buildTools.some(tool => dependencyName.includes(tool))) {
        return true;
      }
    }
    
    // Controllo per configurazioni eslint
    if (fileName.includes('eslint') || fileName.includes('.eslintrc')) {
      if (dependencyName.includes('eslint')) {
        return true;
      }
    }
    
    // Controllo per configurazioni webpack
    if (fileName.includes('webpack')) {
      if (dependencyName.includes('webpack')) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// Funzione per analizzare le dipendenze di un componente
function analyzeComponentDependencies(componentPath) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    log(`❌ package.json non trovato in ${componentName}`, 'red');
    return { used: [], unused: [], error: true };
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    if (Object.keys(dependencies).length === 0) {
      return { used: [], unused: [], error: false };
    }
    
    log(`🔍 Analisi dipendenze per ${componentName}...`, 'cyan');
    
    // Otteniamo tutti i file per l'analisi
    const files = getAllFiles(componentPath);
    log(`   📁 Analizzati ${files.length} file`, 'blue');
    
    const usedDependencies = [];
    const unusedDependencies = [];
    
    // Analizziamo ogni dipendenza
    for (const [depName, depVersion] of Object.entries(dependencies)) {
      let isUsed = false;
      
      // Determiniamo se è una devDependency
      const isDevDependency = packageJson.devDependencies && packageJson.devDependencies[depName];
      
      // Controlliamo l'uso in ogni file
      for (const file of files) {
        if (analyzeDependencyUsage(file, depName, isDevDependency)) {
          isUsed = true;
          break;
        }
      }
      
      if (isUsed) {
        usedDependencies.push({ name: depName, version: depVersion });
      } else {
        unusedDependencies.push({ name: depName, version: depVersion });
      }
    }
    
    return { used: usedDependencies, unused: unusedDependencies, error: false };
    
  } catch (error) {
    log(`❌ Errore nell'analisi ${componentName}: ${error.message}`, 'red');
    return { used: [], unused: [], error: true };
  }
}

// Funzione per rimuovere dipendenze non utilizzate
function removeUnusedDependencies(componentPath, unusedDependencies) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, 'package.json');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Rimuoviamo da dependencies e devDependencies
    for (const dep of unusedDependencies) {
      if (packageJson.dependencies && packageJson.dependencies[dep.name]) {
        delete packageJson.dependencies[dep.name];
      }
      if (packageJson.devDependencies && packageJson.devDependencies[dep.name]) {
        delete packageJson.devDependencies[dep.name];
      }
    }
    
    // Salviamo il package.json aggiornato
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    // Controlliamo se Node.js è installato
    try {
      execSync('node --version', { stdio: 'ignore' });
      
      // Se Node.js è installato, rimuoviamo i pacchetti
      log(`🗑️  Rimozione pacchetti per ${componentName}...`, 'yellow');
      
      const packagesToRemove = unusedDependencies.map(dep => dep.name).join(' ');
      const npmCommand = `${getNpmCommand()} uninstall ${packagesToRemove} --ignore-scripts`;
      
      try {
        execSync(npmCommand, { 
          cwd: componentPath,
          stdio: 'inherit'
        });
        log(`✅ Pacchetti rimossi per ${componentName}`, 'green');
      } catch (npmError) {
        log(`⚠️  Errore nella rimozione dei pacchetti per ${componentName}: ${npmError.message}`, 'yellow');
        log(`   package.json aggiornato, ma i pacchetti sono rimasti in node_modules`, 'yellow');
      }
      
    } catch (nodeError) {
      // Node.js non è installato, puliamo solo package.json
      log(`⚠️  Node.js non installato, pulito solo package.json per ${componentName}`, 'yellow');
    }
    
    return true;
    
  } catch (error) {
    log(`❌ Errore nella rimozione delle dipendenze per ${componentName}: ${error.message}`, 'red');
    return false;
  }
}

// Funzione per eseguire il comando depcheck
async function executeDepcheckCommand(scope, components, args, onComplete = null) {
  const allComponents = getComponentDirectories();
  let targetComponents = [];
  
  // Determiniamo i componenti target
  switch (scope) {
    case 'all':
      targetComponents = allComponents;
      break;
    case 'single':
      if (components.length > 0) {
        targetComponents = [components[0]];
      }
      break;
    case 'exclude':
      targetComponents = allComponents.filter(comp => !components.includes(comp));
      break;
  }
  
  if (targetComponents.length === 0) {
    log('❌ Nessun componente trovato per l\'analisi', 'red');
    if (onComplete) onComplete();
    return;
  }
  
  log(`🔍 Controllo dipendenze per ${targetComponents.length} componenti...`, 'cyan');
  
  let totalUnused = 0;
  let componentsWithUnused = 0;
  const allUnusedDependencies = [];
  
  // Analizziamo ogni componente
  for (const component of targetComponents) {
    const componentPath = path.join(process.cwd(), component);
    const result = analyzeComponentDependencies(componentPath);
    
    if (result.error) {
      continue;
    }
    
    if (result.unused.length > 0) {
      componentsWithUnused++;
      totalUnused += result.unused.length;
      
      log(`📦 ${component}:`, 'blue');
      log(`   ❌ Non utilizzate (${result.unused.length}): ${result.unused.map(dep => dep.name).join(', ')}`, 'red');
      
      allUnusedDependencies.push({
        component: component,
        path: componentPath,
        unused: result.unused
      });
    } else {
      log(`✅ ${component}: tutte le dipendenze sono utilizzate`, 'green');
    }
  }
  
  // Mostra il risultato
  log(`\n📊 Risultato controllo:`, 'cyan');
  log(`   🔍 Componenti analizzati: ${targetComponents.length}`, 'blue');
  log(`   ❌ Dipendenze non utilizzate: ${totalUnused}`, totalUnused > 0 ? 'red' : 'green');
  log(`   📦 Componenti con dipendenze non utilizzate: ${componentsWithUnused}`, componentsWithUnused > 0 ? 'red' : 'green');
  
  // Se ci sono dipendenze non utilizzate e non è specificato clean
  if (totalUnused > 0 && !args.includes('clean')) {
    log(`\n💡 Per rimuovere le dipendenze non utilizzate usa:`, 'yellow');
    log(`   node package-manager.js depcheck --remove`, 'blue');
    log(`   node package-manager.js depcheck clean`, 'blue');
  }
  
  // Se è specificato clean, rimuoviamo automaticamente
  if (args.includes('clean') && totalUnused > 0) {
    log(`\n🗑️  Rimozione automatica delle dipendenze non utilizzate...`, 'yellow');
    
    for (const item of allUnusedDependencies) {
      log(`\n🔧 Rimozione dipendenze per ${item.component}...`, 'cyan');
      const success = removeUnusedDependencies(item.path, item.unused);
      
      if (success) {
        log(`✅ Dipendenze rimosse per ${item.component}`, 'green');
      } else {
        log(`❌ Errore nella rimozione delle dipendenze per ${item.component}`, 'red');
      }
    }
    
    log(`\n🎉 Rimozione completata!`, 'green');
  }
  
  if (onComplete) onComplete();
}

// Funzione per il parsing e l'esecuzione dei comandi
async function parseAndExecuteCommand(args, onComplete = null) {
  let scope = 'all';
  let components = [];
  
  // Parsiamo gli argomenti
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--single') {
      scope = 'single';
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Saltiamo il prossimo argomento
      }
    } else if (arg === '--exclude') {
      scope = 'exclude';
      components = [];
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith('--')) {
          break; // Ci fermiamo al prossimo flag
        }
        components.push(args[j]);
      }
      i += components.length; // Saltiamo gli argomenti processati
    }
  }
  
  // Eseguiamo il comando
  await executeDepcheckCommand(scope, components, args, onComplete);
}

// Funzione per la modalità interattiva
function showInteractiveMenu() {
  log('\n🔍 Controllo dipendenze non utilizzate:', 'cyan');
  log('1. Controlla tutti i componenti', 'blue');
  log('2. Controlla un componente', 'blue');
  log('3. Controlla tutti tranne quelli specificati', 'blue');
  log('4. Controlla e rimuovi per tutti i componenti (automatico)', 'red');
  log('0. 🔙 Torna al menu principale', 'yellow');
  
  if (!rl) return;
  
  rl.question('Scegli un\'opzione (0-4): ', (answer) => {
    switch (answer.trim()) {
      case '0':
        log('🔙 Tornando al menu principale...', 'blue');
        if (onComplete) onComplete();
        break;
      case '1':
        log('\n🔍 Controllo dipendenze per tutti i componenti...', 'cyan');
        executeDepcheckCommand('all', [], [], () => {
          if (rl) {
            log('\n⚠️  Rimuovere le dipendenze non utilizzate per tutti i componenti?', 'yellow');
            rl.question('Continuare? (y/N): ', (confirm) => {
              if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
                log('\n🔍 Rimozione dipendenze per tutti i componenti...', 'cyan');
                executeDepcheckCommand('all', [], ['clean'], () => {
                  if (onComplete) onComplete();
                });
              } else {
                log('❌ Operazione annullata', 'red');
                if (onComplete) onComplete();
              }
            });
          }
        });
        break;
      case '2':
        showComponentSelection();
        break;
      case '3':
        showExcludeSelection();
        break;
      case '4':
        log('\n🔍 Controllo e rimozione automatica delle dipendenze per tutti i componenti...', 'cyan');
        executeDepcheckCommand('all', [], ['clean'], () => {
          if (onComplete) onComplete();
        });
        break;
      default:
        log('❌ Scelta non valida', 'red');
        if (onComplete) onComplete();
    }
  });
}

// Funzione per la selezione del componente
function showComponentSelection() {
  const components = getComponentDirectories();
  
  if (components.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    if (onComplete) onComplete();
    return;
  }
  
  log('\n📁 Componenti disponibili:', 'cyan');
  components.forEach((component, index) => {
    log(`${index + 1}. ${component}`, 'blue');
  });
  log(`0. 🔙 Torna al menu principale`, 'yellow');
  
  if (!rl) return;
  
  rl.question('\nInserisci il numero del componente (0 per tornare): ', (answer) => {
    if (answer.trim() === '0') {
      log('🔙 Tornando al menu principale...', 'blue');
      if (onComplete) onComplete();
      return;
    }
    
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < components.length) {
      const selectedComponent = components[index];
      log(`\n🎯 Selezionato: ${selectedComponent}`, 'green');
      
      // Prima mostriamo le dipendenze non utilizzate
      log(`\n🔍 Analisi dipendenze per: ${selectedComponent}`, 'cyan');
      executeDepcheckCommand('single', [selectedComponent], [], () => {
        // Dopo l'analisi chiediamo conferma per la rimozione
        if (rl) {
          log(`\n⚠️  Rimuovere le dipendenze non utilizzate per: ${selectedComponent}?`, 'yellow');
          rl.question('Continuare? (y/N): ', (confirm) => {
            if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
              log(`\n🔍 Rimozione dipendenze per: ${selectedComponent}`, 'cyan');
              executeDepcheckCommand('single', [selectedComponent], ['clean'], () => {
                if (onComplete) onComplete();
              });
            } else {
              log('❌ Operazione annullata', 'red');
              if (onComplete) onComplete();
            }
          });
        }
      });
    } else {
      log('❌ Numero componente non valido', 'red');
      if (onComplete) onComplete();
    }
  });
}

// Funzione per la selezione delle esclusioni
function showExcludeSelection() {
  if (!rl) return;
  
  rl.question('Inserisci i nomi dei componenti da escludere (separati da spazio): ', (excludeAnswer) => {
    const excludeList = excludeAnswer.trim().split(/\s+/).filter(name => name.length > 0);
    if (excludeList.length > 0) {
      // Prima mostriamo le dipendenze non utilizzate
      log(`\n🔍 Analisi dipendenze per tutti i componenti tranne: ${excludeList.join(', ')}`, 'cyan');
      executeDepcheckCommand('exclude', excludeList, [], () => {
        // Dopo l'analisi chiediamo conferma per la rimozione
        if (rl) {
          log(`\n⚠️  Rimuovere le dipendenze non utilizzate per tutti i componenti tranne: ${excludeList.join(', ')}?`, 'yellow');
          rl.question('Continuare? (y/N): ', (confirm) => {
            if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
              log(`\n🔍 Rimozione dipendenze per tutti i componenti tranne: ${excludeList.join(', ')}`, 'cyan');
              executeDepcheckCommand('exclude', excludeList, ['clean'], () => {
                if (onComplete) onComplete();
              });
            } else {
              log('❌ Operazione annullata', 'red');
              if (onComplete) onComplete();
            }
          });
        }
      });
    } else {
      log('❌ Nessun componente specificato per l\'esclusione', 'red');
      if (onComplete) onComplete();
    }
  });
}

// Funzione principale
async function main() {
  log(`🚀 ${projectConfig.project.name} - Controllo dipendenze`, 'bright');
  
  const args = process.argv.slice(2);
  
  // Se sono passati argomenti dalla riga di comando
  if (args.length > 0) {
    await parseAndExecuteCommand(args);
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
    
    showInteractiveMenu();
    
  } catch (error) {
    log(`❌ Errore durante l'inizializzazione: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Avvio dello script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  analyzeComponentDependencies,
  removeUnusedDependencies,
  executeDepcheckCommand
};
