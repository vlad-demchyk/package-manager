#!/usr/bin/env node

/**
 * Script per il controllo delle dipendenze non utilizzate
 * Analogo universale di npx depcheck per qualsiasi progetto
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Carichiamo la configurazione del progetto
const projectConfig = require('../project-config');

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

// Funzione per ottenere la lista dei componenti
function getComponentDirectories() {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);
  
  return items.filter(item => {
    const fullPath = path.join(currentDir, item);
    
    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }
    
    // Controllo del prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        return false;
      }
    }
    
    // Controllo della struttura
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
    
    // Controllo della lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        return false;
      }
    }
    
    // Controllo regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        return false;
      }
    }
    
    // Controlliamo sempre la presenza di package.json
    return fs.existsSync(path.join(fullPath, projectConfig.files.packageJson));
  });
}

// Funzione per analizzare l'uso delle dipendenze nel file
function analyzeFileForDependencies(filePath, dependencies) {
  const usedDeps = new Set();
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Controlliamo ogni dipendenza
    for (const dep of dependencies) {
      // Diversi pattern per cercare l'uso
      const patterns = [
        new RegExp(`require\\(['"]${dep}['"]\\)`, 'g'),
        new RegExp(`import.*from\\s+['"]${dep}['"]`, 'g'),
        new RegExp(`import\\s+['"]${dep}['"]`, 'g'),
        new RegExp(`from\\s+['"]${dep}['"]`, 'g'),
        new RegExp(`\\b${dep}\\b`, 'g')
      ];
      
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          usedDeps.add(dep);
          break;
        }
      }
    }
  } catch (error) {
    // Ignoriamo gli errori di lettura dei file
  }
  
  return usedDeps;
}

// Funzione per analizzare file di configurazione
function analyzeConfigFileForDependencies(filePath, dependencies) {
  const usedDeps = new Set();
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath).toLowerCase();
    
    // Analisi per file JSON (tsconfig.json, package.json, config files)
    if (fileName.endsWith('.json')) {
      try {
        const jsonContent = JSON.parse(content);
        
        // Analisi tsconfig.json
        if (fileName === 'tsconfig.json') {
          // Controlla extends
          if (jsonContent.extends) {
            const extendsPath = jsonContent.extends;
            for (const dep of dependencies) {
              if (extendsPath.includes(dep)) {
                usedDeps.add(dep);
              }
            }
          }
          
          // Controlla types
          if (jsonContent.compilerOptions && jsonContent.compilerOptions.types) {
            for (const type of jsonContent.compilerOptions.types) {
              const typeDep = `@types/${type}`;
              if (dependencies.includes(typeDep)) {
                usedDeps.add(typeDep);
              }
            }
          }
          
          // Controlla typeRoots
          if (jsonContent.compilerOptions && jsonContent.compilerOptions.typeRoots) {
            for (const typeRoot of jsonContent.compilerOptions.typeRoots) {
              for (const dep of dependencies) {
                if (typeRoot.includes(dep)) {
                  usedDeps.add(dep);
                }
              }
            }
          }
        }
        
        // Analisi altri file JSON - solo per campi specifici
        if (fileName === 'package.json') {
          // Per package.json, controlliamo solo script e config
          if (jsonContent.scripts) {
            const scriptsString = JSON.stringify(jsonContent.scripts);
            for (const dep of dependencies) {
              if (scriptsString.includes(dep)) {
                usedDeps.add(dep);
              }
            }
          }
        } else {
          // Per altri file JSON, controlliamo solo campi specifici
          const relevantFields = ['extends', 'types', 'typeRoots', 'plugins', 'presets', 'env'];
          for (const field of relevantFields) {
            if (jsonContent[field]) {
              const fieldString = JSON.stringify(jsonContent[field]);
              for (const dep of dependencies) {
                if (fieldString.includes(dep)) {
                  usedDeps.add(dep);
                }
              }
            }
          }
        }
      } catch (jsonError) {
        // Se non è un JSON valido, analizziamo come testo
        for (const dep of dependencies) {
          if (content.includes(dep)) {
            usedDeps.add(dep);
          }
        }
      }
    }
    
    // Analisi per file JavaScript (gulpfile.js, webpack.config.js, etc.)
    if (fileName.endsWith('.js')) {
      for (const dep of dependencies) {
        // Pattern specifici per build tools - più precisi
        const buildPatterns = [
          new RegExp(`require\\(['"]${dep}['"]\\)`, 'g'),
          new RegExp(`import.*from\\s+['"]${dep}['"]`, 'g'),
          new RegExp(`import\\s+['"]${dep}['"]`, 'g'),
          new RegExp(`from\\s+['"]${dep}['"]`, 'g'),
          // Solo per build tools, non per tutti i file JS
          new RegExp(`['"]${dep}['"]`, 'g')
        ];
        
        for (const pattern of buildPatterns) {
          if (pattern.test(content)) {
            usedDeps.add(dep);
            break;
          }
        }
      }
    }
    
  } catch (error) {
    // Ignoriamo gli errori di lettura dei file
  }
  
  return usedDeps;
}

// Funzione per scansionare tutti i file nella directory
function scanDirectoryForDependencies(dirPath, dependencies) {
  const usedDeps = new Set();
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Saltiamo node_modules e altre cartelle di sistema
        if (['node_modules', '.git', 'dist', 'lib', 'temp', 'release'].includes(item)) {
          continue;
        }
        
        // Scansioniamo ricorsivamente le sottocartelle
        const subDeps = scanDirectoryForDependencies(fullPath, dependencies);
        subDeps.forEach(dep => usedDeps.add(dep));
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        const fileName = item.toLowerCase();
        
        // Controlliamo file di configurazione prima
        if (['.json'].includes(ext) || 
            ['gulpfile.js', 'webpack.config.js', 'rollup.config.js', 'vite.config.js'].includes(fileName)) {
          const configDeps = analyzeConfigFileForDependencies(fullPath, dependencies);
          configDeps.forEach(dep => usedDeps.add(dep));
        }
        // Poi controlliamo file JavaScript/TypeScript (escludendo quelli già processati come config)
        else if (['.js', '.ts', '.tsx', '.jsx'].includes(ext)) {
          const fileDeps = analyzeFileForDependencies(fullPath, dependencies);
          fileDeps.forEach(dep => usedDeps.add(dep));
        }
      }
    }
  } catch (error) {
    // Ignoriamo gli errori di accesso alle directory
  }
  
  return usedDeps;
}

// Funzione per controllare le dipendenze non utilizzate nel componente
function checkUnusedDependencies(componentPath) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, projectConfig.files.packageJson);
  
  if (!fs.existsSync(packageJsonPath)) {
    log(`❌ ${projectConfig.files.packageJson} non trovato in ${componentName}`, 'red');
    return { unused: [], missing: [], used: [] };
  }
  
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const depNames = Object.keys(dependencies);
    
    if (depNames.length === 0) {
      return { unused: [], missing: [], used: [] };
    }
    
    log(`🔍 Analisi dipendenze per ${componentName}...`, 'cyan');
    
    // Scansioniamo tutti i file in src e altre cartelle
    const srcPath = path.join(componentPath, 'src');
    const usedDeps = new Set();
    
    if (fs.existsSync(srcPath)) {
      const srcDeps = scanDirectoryForDependencies(srcPath, depNames);
      srcDeps.forEach(dep => usedDeps.add(dep));
    }
    
    // Controlliamo anche i file root del componente
    const rootDeps = scanDirectoryForDependencies(componentPath, depNames);
    rootDeps.forEach(dep => usedDeps.add(dep));
    
    // Determiniamo le dipendenze non utilizzate
    const unused = depNames.filter(dep => !usedDeps.has(dep));
    const used = Array.from(usedDeps);
    
    return { unused, missing: [], used };
    
  } catch (error) {
    log(`❌ Errore analisi ${componentName}: ${error.message}`, 'red');
    return { unused: [], missing: [], used: [] };
  }
}

// Funzione per rimuovere le dipendenze non utilizzate
async function removeUnusedDependencies(componentPath, unusedDeps, confirm = false) {
  const componentName = path.basename(componentPath);
  
  if (unusedDeps.length === 0) {
    log(`✅ Tutte le dipendenze sono utilizzate in ${componentName}`, 'green');
    return true;
  }
  
  if (!confirm) {
    log(`\n⚠️  Trovate ${unusedDeps.length} dipendenze non utilizzate in ${componentName}:`, 'yellow');
    unusedDeps.forEach((dep, index) => {
      log(`   ${index + 1}. ${dep}`, 'red');
    });
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question(`\nRimuovere queste dipendenze? (y/N): `, (answer) => {
        rl.close();
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          performRemoval(componentPath, unusedDeps, componentName).then(resolve);
        } else {
          log(`❌ Rimozione annullata per ${componentName}`, 'yellow');
          resolve(false);
        }
      });
    });
  } else {
    return performRemoval(componentPath, unusedDeps, componentName);
  }
}

// Funzione per eseguire la rimozione
async function performRemoval(componentPath, unusedDeps, componentName) {
  try {
    log(`🗑️  Rimozione dipendenze non utilizzate da ${componentName}...`, 'yellow');
    
    // Rimuoviamo le dipendenze tramite npm uninstall
    const depsToRemove = unusedDeps.join(' ');
    const command = `${getNpmCommand()} uninstall ${depsToRemove}`;
    
    log(`🔄 Esecuzione: ${command}`, 'blue');
    
    execSync(command, {
      stdio: 'inherit',
      cwd: componentPath
    });
    
    log(`✅ Rimosse con successo ${unusedDeps.length} dipendenze da ${componentName}`, 'green');
    return true;
    
  } catch (error) {
    log(`❌ Errore rimozione dipendenze da ${componentName}: ${error.message}`, 'red');
    return false;
  }
}

// Funzione principale per controllare tutti i componenti
async function checkAllComponents(scope = 'all', components = [], removeUnused = false, onComplete = null) {
  const allComponents = getComponentDirectories();
  
  if (allComponents.length === 0) {
    log('❌ Componenti non trovati', 'red');
    if (onComplete) onComplete();
    return;
  }
  
  let targetComponents = [];
  
  switch (scope) {
    case 'all':
      targetComponents = allComponents;
      break;
    case 'single':
      if (components.length > 0) {
        targetComponents = [components[0]];
      } else {
        log('❌ Componente non specificato per --single', 'red');
        if (onComplete) onComplete();
        return;
      }
      break;
    case 'exclude':
      targetComponents = allComponents.filter(comp => !components.includes(comp));
      break;
  }
  
  if (targetComponents.length === 0) {
    log('❌ Nessun componente da controllare', 'red');
    if (onComplete) onComplete();
    return;
  }
  
  log(`🔍 Controllo dipendenze non utilizzate per ${targetComponents.length} componenti...`, 'cyan');
  
  if (scope === 'exclude' && components.length > 0) {
    log(`🚫 Esclusi dal controllo: ${components.join(', ')}`, 'yellow');
  }
  
  let totalUnused = 0;
  let totalChecked = 0;
  
  // Controlliamo ogni componente
  for (const component of targetComponents) {
    const componentPath = path.join(process.cwd(), component);
    const result = checkUnusedDependencies(componentPath);
    
    totalChecked++;
    totalUnused += result.unused.length;
    
    if (result.unused.length > 0) {
      log(`\n📦 ${component}:`, 'magenta');
      log(`   ❌ Non utilizzate (${result.unused.length}): ${result.unused.join(', ')}`, 'red');
      
      if (removeUnused) {
        await removeUnusedDependencies(componentPath, result.unused, true);
      }
    } else {
      log(`✅ ${component}: tutte le dipendenze sono utilizzate`, 'green');
    }
  }
  
  log(`\n📊 Risultato controllo:`, 'cyan');
  log(`   🔍 Componenti controllati: ${totalChecked}`, 'blue');
  log(`   ❌ Dipendenze non utilizzate trovate: ${totalUnused}`, totalUnused > 0 ? 'red' : 'green');
  
  if (totalUnused > 0 && !removeUnused) {
    log(`\n💡 Per rimuovere le dipendenze non utilizzate utilizzare:`, 'yellow');
    log(`   node package-manager.js depcheck clean`, 'blue');
    log(`   node packman.js depcheck clean`, 'blue');
    log(`   node pm.js depcheck clean`, 'blue');
  }
  
  // Chiamiamo il callback per tornare al menu se fornito
  if (onComplete) {
    setTimeout(() => {
      onComplete();
    }, 100);
  }
}

// Funzione per il parsing dei comandi
async function parseAndExecuteCommand(args, onComplete = null) {
  const currentDir = process.cwd();
  const currentDirName = path.basename(currentDir);
  
  // Controlliamo se l'utente si trova nella cartella package-manager
  if (currentDirName === 'package-manager') {
    log('⚠️  Ti trovi nella cartella del modulo package-manager!', 'yellow');
    log('');
    log('📁 Per eseguire i comandi del progetto devi tornare alla root del progetto:', 'cyan');
    log('   cd ..', 'blue');
    log('');
    log('💡 Dopo potrai utilizzare:', 'cyan');
    log('   node package-manager.js depcheck', 'blue');
    log('   node package-manager.js depcheck --remove', 'blue');
    log('');
    process.exit(0);
  }
  
  let scope = 'all';
  let components = [];
  let removeUnused = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--single') {
      scope = 'single';
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Saltiamo il prossimo argomento
      } else {
        log('❌ --single richiede il nome del componente', 'red');
        if (onComplete) onComplete();
        return;
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
    } else if (arg === 'clean') {
      removeUnused = true;
    }
  }
  
  await checkAllComponents(scope, components, removeUnused, onComplete);
}

// Funzione per mostrare l'utilizzo
function showUsage() {
  log('❌ Comando non valido. Utilizzo:', 'red');
  log('', 'reset');
  log('🔍 Controllo dipendenze non utilizzate:', 'cyan');
  log('  node package-manager.js depcheck [--single component] [--exclude comp1 comp2] [clean]', 'blue');
  log('', 'reset');
  log('📝 Esempi:', 'yellow');
  log('  node package-manager.js depcheck', 'green');
  log('  node packman.js depcheck --single c106-header', 'green');
  log('  node pm.js depcheck --exclude c106-header c106-footer', 'green');
  log('  node package-manager.js depcheck clean', 'green');
  log('  node packman.js depcheck --single c106-header clean', 'green');
  log('', 'reset');
  log('💡 Opzioni:', 'cyan');
  log('  --single component  - controllare solo un componente', 'blue');
  log('  --exclude comp1 comp2 - escludere componenti dal controllo', 'blue');
  log('  clean              - rimuovere dipendenze non utilizzate automaticamente', 'red');
}

// Funzione per il menu interattivo
function showDepcheckMenu() {
  log('\n🔍 Controllo dipendenze non utilizzate:', 'cyan');
  log('1. Controllare tutti i componenti', 'blue');
  log('2. Controllare un componente', 'blue');
  log('3. Controllare tutti tranne quelli specificati', 'blue');
  log('4. Controllare e rimuovere non utilizzate', 'red');
  log('0. 🔙 Torna al menu principale', 'yellow');
}

// Funzione principale per chiamata da core.js
function main() {
  log(`🔍 Controllo dipendenze non utilizzate`, 'cyan');
  
  const args = process.argv.slice(2);
  
  // Eseguiamo sempre il comando (modalità interattiva gestita in core.js)
  if (args.length > 0) {
    parseAndExecuteCommand(args);
  } else {
    // Se chiamato senza argomenti, controlliamo tutti i componenti
    checkAllComponents('all', [], false);
  }
}

// Esportazione funzioni
module.exports = {
  main,
  parseAndExecuteCommand,
  checkUnusedDependencies,
  checkAllComponents,
  removeUnusedDependencies,
  showDepcheckMenu
};

// Avvio script
if (require.main === module) {
  main();
}
