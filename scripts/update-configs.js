#!/usr/bin/env node

/**
 * Script cross-platform per aggiornare package.json e tsconfig.json
 * basato sulle dipendenze del calendario per tutti i componenti
 * Versione modulare con configurazione esterna
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Carica configurazione progetto
const projectConfig = require('../project-config');

// Import configurazione dipendenze
const {
  getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines
} = require('../dependencies-config');

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

function getAllSourceFiles(componentPath) {
  const srcPath = path.join(componentPath, 'src');
  const files = [];
  
  if (!fs.existsSync(srcPath)) {
    return files;
  }
  
  function scanDirectory(dir) {
    const items = fs.readdirSync(dir);
    
    items.forEach(item => {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx') || item.endsWith('.js') || item.endsWith('.jsx'))) {
        files.push(fullPath);
      }
    });
  }
  
  scanDirectory(srcPath);
  return files;
}

function analyzeDependencyUsage(componentPath, dependencyName, patterns) {
  const sourceFiles = getAllSourceFiles(componentPath);
  
  for (const filePath of sourceFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      
      for (const pattern of patterns) {
        // Creiamo regex per ricerca
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content)) {
          return true;
        }
      }
    } catch (error) {
      // Ignoriamo errori di lettura file
      continue;
    }
  }
  
  return false;
}

function getUsedDependencies(componentPath) {
  const usedDeps = new Set();
  
  // Otteniamo le dipendenze dalla configurazione
  const COMMON_DEPENDENCIES = getBaseDependencies();
  const CONDITIONAL_DEPENDENCIES = getConditionalDependencies();
  
  // Aggiungiamo sempre le dipendenze base SPFx
  Object.keys(COMMON_DEPENDENCIES).forEach(dep => {
    if (!CONDITIONAL_DEPENDENCIES[dep]) {
      usedDeps.add(dep);
    }
  });
  
  // Controlliamo le dipendenze condizionali
  Object.entries(CONDITIONAL_DEPENDENCIES).forEach(([depName, config]) => {
    if (analyzeDependencyUsage(componentPath, depName, config.patterns)) {
      usedDeps.add(depName);
      log(`✅ Trovato utilizzo: ${config.description} (${depName})`, 'green');
    } else {
      log(`⏭️  Saltata dipendenza non utilizzata: ${config.description} (${depName})`, 'yellow');
    }
  });
  
  return usedDeps;
}

function updatePackageJson(componentPath) {
  const packageJsonPath = path.join(componentPath, projectConfig.files.packageJson);
  
  if (!fs.existsSync(packageJsonPath)) {
    log(`❌ ${projectConfig.files.packageJson} non trovato in ${componentPath}`, 'red');
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    log(`🔍 Analisi utilizzo dipendenze per ${path.basename(componentPath)}...`, 'cyan');
    
    // Otteniamo le dipendenze dalla configurazione
    const COMMON_DEPENDENCIES = getBaseDependencies();
    const COMMON_DEV_DEPENDENCIES = getDevDependencies();
    const DEPRECATED_DEPENDENCIES = getDeprecatedDependencies();
    const STANDARD_SCRIPTS = getStandardScripts();
    
    // Otteniamo lista dipendenze utilizzate
    const usedDeps = getUsedDependencies(componentPath);
    
    // Rimuoviamo dipendenze deprecate
    if (packageJson.dependencies) {
      DEPRECATED_DEPENDENCIES.forEach(dep => {
        if (packageJson.dependencies[dep]) {
          delete packageJson.dependencies[dep];
          log(`🗑️  Rimossa dipendenza deprecata: ${dep}`, 'yellow');
        }
      });
    }
    
    if (packageJson.devDependencies) {
      DEPRECATED_DEPENDENCIES.forEach(dep => {
        if (packageJson.devDependencies[dep]) {
          delete packageJson.devDependencies[dep];
          log(`🗑️  Rimossa dipendenza dev deprecata: ${dep}`, 'yellow');
        }
      });
    }
    
    // Aggiorniamo dipendenze solo per quelle utilizzate
    if (!packageJson.dependencies) packageJson.dependencies = {};
    
    // Aggiungiamo solo dipendenze utilizzate
    usedDeps.forEach(depName => {
      if (COMMON_DEPENDENCIES[depName]) {
        packageJson.dependencies[depName] = COMMON_DEPENDENCIES[depName];
      }
    });
    
    // Aggiorniamo dipendenze dev (aggiungiamo sempre tutte)
    if (!packageJson.devDependencies) packageJson.devDependencies = {};
    Object.assign(packageJson.devDependencies, COMMON_DEV_DEPENDENCIES);
    
    // Aggiorniamo script
    if (!packageJson.scripts) packageJson.scripts = {};
    Object.assign(packageJson.scripts, STANDARD_SCRIPTS);
    
    // Aggiorniamo engines
    packageJson.engines = getNodeEngines();
    
    // Salviamo package.json aggiornato
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
    log(`✅ Aggiornato package.json per ${path.basename(componentPath)} (${usedDeps.size} dipendenze)`, 'green');
    return true;
    
  } catch (error) {
    log(`❌ Errore aggiornando package.json per ${path.basename(componentPath)}: ${error.message}`, 'red');
    return false;
  }
}

function updateTsConfig(componentPath) {
  const tsConfigPath = path.join(componentPath, projectConfig.files.tsConfig);
  
  try {
    const STANDARD_TSCONFIG = getStandardTsConfig();
    fs.writeFileSync(tsConfigPath, JSON.stringify(STANDARD_TSCONFIG, null, 2));
    log(`✅ Aggiornato tsconfig.json per ${path.basename(componentPath)}`, 'green');
    return true;
  } catch (error) {
    log(`❌ Errore aggiornando tsconfig.json per ${path.basename(componentPath)}: ${error.message}`, 'red');
    return false;
  }
}

function removeTslintJson(componentPath) {
  const tslintPath = path.join(componentPath, projectConfig.files.tslint);
  
  if (fs.existsSync(tslintPath)) {
    try {
      fs.unlinkSync(tslintPath);
      log(`✅ Rimosso tslint.json per ${path.basename(componentPath)}`, 'yellow');
      return true;
    } catch (error) {
      log(`❌ Errore rimuovendo tslint.json per ${path.basename(componentPath)}: ${error.message}`, 'red');
      return false;
    }
  }
  return true;
}

function updateAllConfigs() {
  log('🚀 Avvio aggiornamento configurazioni componenti...', 'cyan');
  
  const componentDirs = getComponentDirectories();
  
  if (componentDirs.length === 0) {
    log('❌ Nessun componente trovato', 'red');
    return false;
  }
  
  log(`📁 Trovati ${componentDirs.length} componenti:`, 'blue');
  componentDirs.forEach(dir => log(`   - ${dir}`, 'blue'));
  
  let successCount = 0;
  let totalCount = componentDirs.length;
  
  componentDirs.forEach(componentDir => {
    const fullPath = path.join(process.cwd(), componentDir);
    log(`\n🔧 Elaborazione ${componentDir}...`, 'magenta');
    
    const packageSuccess = updatePackageJson(fullPath);
    const tsConfigSuccess = updateTsConfig(fullPath);
    const tslintSuccess = removeTslintJson(fullPath);
    
    if (packageSuccess && tsConfigSuccess && tslintSuccess) {
      successCount++;
    }
  });
  
  log(`\n📊 Risultato:`, 'cyan');
  log(`   ✅ Aggiornati con successo: ${successCount}/${totalCount}`, 'green');
  log(`   ❌ Errori: ${totalCount - successCount}/${totalCount}`, totalCount - successCount > 0 ? 'red' : 'green');
  
  if (successCount === totalCount) {
    log('\n🎉 Tutte le configurazioni aggiornate con successo!', 'green');
    return true;
  } else {
    log('\n⚠️  Alcune configurazioni non sono state aggiornate. Controlla gli errori sopra.', 'yellow');
    return false;
  }
}

function main() {
  const success = updateAllConfigs();
  process.exit(success ? 0 : 1);
}

// Avvio script
if (require.main === module) {
  main();
}

module.exports = {
  updatePackageJson,
  updateTsConfig,
  removeTslintJson,
  getComponentDirectories,
  updateAllConfigs
};
