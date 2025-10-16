#!/usr/bin/env node

/**
 * Script cross-platform solo per pulizia componenti
 * Rimuove node_modules, package-lock.json e tslint.json
 * Versione modulare con configurazione esterna
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Carica configurazione progetto
const projectConfig = require('../project-config');

// Funzioni di utilità
function log(message, color = 'reset') {
  const colors = projectConfig.logging.colors;
  console.log(`${colors[color]}${message}${colors.reset}`);
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

function isWindows() {
  return process.platform === 'win32';
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

function main() {
  log(`🧹 Script pulizia componenti ${projectConfig.project.name}`, 'bright');
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log('❌ Specifica componenti per pulizia o usa --all', 'red');
    log('Utilizzo:', 'blue');
    log('  node clean-only.js --all', 'blue');
    log('  node clean-only.js component1 component2', 'blue');
    log('  node clean-only.js --exclude component1 component2', 'blue');
    process.exit(1);
  }
  
  const components = getComponentDirectories();
  
  if (components.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    process.exit(1);
  }
  
  let targetComponents = [];
  
  if (args[0] === '--all') {
    targetComponents = components;
    log(`🧹 Pulizia tutti i ${components.length} componenti...`, 'cyan');
  } else if (args[0] === '--exclude') {
    const excludeList = args.slice(1);
    targetComponents = components.filter(component => !excludeList.includes(component));
    log(`🧹 Pulizia ${targetComponents.length} componenti (escluso: ${excludeList.join(', ')})...`, 'cyan');
  } else {
    targetComponents = args.filter(component => components.includes(component));
    const notFound = args.filter(component => !components.includes(component));
    
    if (notFound.length > 0) {
      log(`⚠️  Componenti non trovati: ${notFound.join(', ')}`, 'yellow');
    }
    
    if (targetComponents.length === 0) {
      log('❌ Nessun componente valido trovato per la pulizia', 'red');
      process.exit(1);
    }
    
    log(`🧹 Pulizia ${targetComponents.length} componenti: ${targetComponents.join(', ')}`, 'cyan');
  }
  
  let successCount = 0;
  const totalCount = targetComponents.length;
  
  targetComponents.forEach((component, index) => {
    log(`\n[${index + 1}/${totalCount}] Elaborazione ${component}...`, 'magenta');
    const success = cleanComponent(path.join(process.cwd(), component));
    if (success) successCount++;
  });
  
  log(`\n📊 Risultato pulizia:`, 'cyan');
  log(`   ✅ Pulito con successo: ${successCount}/${totalCount}`, 'green');
  log(`   ❌ Errori: ${totalCount - successCount}/${totalCount}`, totalCount - successCount > 0 ? 'red' : 'green');
  
  if (successCount === totalCount) {
    log('\n🎉 Tutti i componenti puliti con successo!', 'green');
  }
}

// Avvio script
if (require.main === module) {
  main();
}

module.exports = {
  cleanComponent,
  getComponentDirectories,
  cleanAllComponents
};
