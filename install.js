#!/usr/bin/env node

/**
 * Cross-platform Package Manager Module Installer
 * Installa automaticamente i file necessari nella root del progetto
 * e configura il modulo per il progetto specifico
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Colori per console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Funzione per creare interfaccia readline
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

// Funzione per fare domande all'utente
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Funzione per configurare il progetto
async function configureProject() {
  const rl = createReadlineInterface();
  
  log('🔧 Configurazione del progetto...', 'cyan');
  log('');
  
  const config = {
    project: {
      name: '',
      version: '1.0.0',
      description: ''
    },
    components: {
      filterByPrefix: { enabled: false, prefix: '' },
      filterByStructure: { enabled: false, requiredFiles: [], requiredFolders: [] },
      filterByList: { enabled: false, folders: [] },
      filterByRegex: { enabled: false, pattern: '' }
    }
  };
  
  try {
    // Nome del progetto
    const projectName = await askQuestion(rl, '📝 Nome del progetto: ');
    config.project.name = projectName || 'My Project';
    
    // Descrizione del progetto
    const projectDesc = await askQuestion(rl, '📝 Descrizione del progetto (opzionale): ');
    config.project.description = projectDesc || `Gestore pacchetti per ${config.project.name}`;
    
    log('');
    log('🎯 Metodo di identificazione componenti:', 'cyan');
    log('1. Per prefisso (es: c106-, my-app-)');
    log('2. Per struttura cartella (package.json + cartelle specifiche)');
    log('3. Per lista cartelle specifiche');
    log('4. Per espressione regolare');
    log('5. Salta configurazione (usa impostazioni predefinite)');
    log('');
    
    const methodChoice = await askQuestion(rl, 'Scegli metodo (1-5): ');
    
    switch (methodChoice) {
      case '1':
        const prefix = await askQuestion(rl, '🔤 Prefisso componenti (es: c106-): ');
        config.components.filterByPrefix = {
          enabled: true,
          prefix: prefix || 'c106-'
        };
        break;
        
      case '2':
        // Chiedi se il progetto usa TypeScript
        const useTypeScript = await askQuestion(rl, '🔧 Il progetto usa TypeScript? (s/n, default: s): ');
        const hasTypeScript = useTypeScript.toLowerCase() !== 'n' && useTypeScript.toLowerCase() !== 'no';
        
        // File base richiesti
        let baseFiles = ['package.json'];
        if (hasTypeScript) {
          baseFiles.push('tsconfig.json');
        }
        
        config.components.filterByStructure = {
          enabled: true,
          requiredFiles: baseFiles,
          requiredFolders: ['src']
        };
        
        const customFiles = await askQuestion(rl, `📄 File richiesti (separati da virgola, default: ${baseFiles.join(',')}): `);
        if (customFiles) {
          config.components.filterByStructure.requiredFiles = customFiles.split(',').map(f => f.trim());
        }
        
        const customFolders = await askQuestion(rl, '📁 Cartelle richieste (separate da virgola, default: src): ');
        if (customFolders) {
          config.components.filterByStructure.requiredFolders = customFolders.split(',').map(f => f.trim());
        }
        break;
        
      case '3':
        const folders = await askQuestion(rl, '📁 Lista cartelle componenti (separate da virgola): ');
        if (folders) {
          config.components.filterByList = {
            enabled: true,
            folders: folders.split(',').map(f => f.trim())
          };
        }
        break;
        
      case '4':
        const regex = await askQuestion(rl, '🔍 Espressione regolare (es: ^my-app-\\w+$): ');
        if (regex) {
          config.components.filterByRegex = {
            enabled: true,
            pattern: regex
          };
        }
        break;
        
      case '5':
      default:
        log('⏭️  Configurazione saltata - verranno usate le impostazioni predefinite', 'yellow');
        // Imposta configurazione predefinita per struttura cartelle
        // Verifica se il progetto usa TypeScript controllando la presenza di tsconfig.json
        const projectRoot = path.join(__dirname, '..');
        const hasTsConfig = fs.existsSync(path.join(projectRoot, 'tsconfig.json'));
        
        let defaultFiles = ['package.json'];
        if (hasTsConfig) {
          defaultFiles.push('tsconfig.json');
          log('🔧 Rilevato TypeScript nel progetto - incluso tsconfig.json nei filtri', 'cyan');
        } else {
          log('🔧 TypeScript non rilevato - solo package.json nei filtri', 'cyan');
        }
        
        config.components.filterByStructure = {
          enabled: true,
          requiredFiles: defaultFiles,
          requiredFolders: ['src']
        };
        break;
    }
    
    rl.close();
    return config;
    
  } catch (error) {
    rl.close();
    log('❌ Errore durante la configurazione:', 'red');
    log(`   ${error.message}`, 'yellow');
    return null;
  }
}

// Funzione per salvare la configurazione
function saveProjectConfig(config) {
  const configPath = path.join(__dirname, 'project-config.js');
  
  const configContent = `module.exports = {
  // Configurazione del progetto
  project: {
    name: "${config.project.name}",
    version: "${config.project.version}",
    description: "${config.project.description}"
  },
  
  // Configurazione ricerca componenti
  components: {
    // Metodo 1: Per prefisso
    filterByPrefix: {
      enabled: ${config.components.filterByPrefix.enabled},
      prefix: "${config.components.filterByPrefix.prefix}"
    },
    
    // Metodo 2: Per struttura cartella
    filterByStructure: {
      enabled: ${config.components.filterByStructure.enabled},
      requiredFiles: ${JSON.stringify(config.components.filterByStructure.requiredFiles)},
      requiredFolders: ${JSON.stringify(config.components.filterByStructure.requiredFolders)}
    },
    
    // Metodo 3: Per lista cartelle
    filterByList: {
      enabled: ${config.components.filterByList.enabled},
      folders: ${JSON.stringify(config.components.filterByList.folders)}
    },
    
    // Metodo 4: Per regex
    filterByRegex: {
      enabled: ${config.components.filterByRegex.enabled},
      pattern: ${config.components.filterByRegex.pattern ? `/${config.components.filterByRegex.pattern}/` : 'null'}
    }
  },
  
  // Configurazione file
  files: {
    packageJson: "package.json",
    tsConfig: "tsconfig.json",
    nodeModules: "node_modules",
    packageLock: "package-lock.json",
    tslint: "tslint.json"
  },
  
  // Configurazione comandi
  commands: {
    npm: {
      windows: "npm.cmd",
      unix: "npm"
    }
  },
  
  // Configurazione logging
  logging: {
    colors: {
      reset: '\\x1b[0m',
      bright: '\\x1b[1m',
      red: '\\x1b[31m',
      green: '\\x1b[32m',
      yellow: '\\x1b[33m',
      blue: '\\x1b[34m',
      magenta: '\\x1b[35m',
      cyan: '\\x1b[36m'
    }
  }
};`;

  try {
    fs.writeFileSync(configPath, configContent, 'utf8');
    log('✅ Configurazione salvata in project-config.js', 'green');
    return true;
  } catch (error) {
    log('❌ Errore salvataggio configurazione:', 'red');
    log(`   ${error.message}`, 'yellow');
    return false;
  }
}

async function main() {
  log('🚀 Installazione Package Manager Module...', 'cyan');
  log('');

  // Verifica che siamo nella cartella package-manager
  const rootFilesDir = path.join(__dirname, 'root-files');
  
  if (!fs.existsSync(rootFilesDir)) {
    log('❌ Errore: Cartella root-files non trovata!', 'red');
    log('   Assicurati di eseguire questo script dalla cartella package-manager/', 'yellow');
    process.exit(1);
  }

  // Configurazione del progetto
  log('🔧 Configurazione iniziale del modulo...', 'cyan');
  const projectConfig = await configureProject();
  
  if (projectConfig) {
    const configSaved = saveProjectConfig(projectConfig);
    if (!configSaved) {
      log('⚠️  Continuo con l\'installazione senza configurazione personalizzata', 'yellow');
    }
  } else {
    log('⚠️  Continuo con l\'installazione senza configurazione personalizzata', 'yellow');
  }
  
  log('');

  // Vai nella cartella parent (root del progetto)
  const projectRoot = path.join(__dirname, '..');
  
  // File da copiare
  const filesToCopy = [
    'package-manager.js',
    'package-manager.bat',
    'package-manager.sh',
    'packman.js',
    'packman.bat',
    'packman.sh',
    'pm.js',
    'pm.bat',
    'pm.sh'
  ];

  log('📁 Copia file nella root del progetto...', 'blue');

  let copiedCount = 0;
  let overwrittenCount = 0;

  filesToCopy.forEach(fileName => {
    const sourcePath = path.join(rootFilesDir, fileName);
    const targetPath = path.join(projectRoot, fileName);
    
    if (fs.existsSync(sourcePath)) {
      // Verifica se il file di destinazione esiste già
      const exists = fs.existsSync(targetPath);
      
      try {
        // Copia il file
        fs.copyFileSync(sourcePath, targetPath);
        
        // Rendi eseguibile il file .sh su sistemi Unix-like
        if (fileName.endsWith('.sh') && process.platform !== 'win32') {
          fs.chmodSync(targetPath, '755');
        }
        
        if (exists) {
          log(`🔄 ${fileName} sovrascritto`, 'yellow');
          overwrittenCount++;
        } else {
          log(`✅ ${fileName} copiato`, 'green');
          copiedCount++;
        }
        
      } catch (error) {
        log(`❌ Errore copiando ${fileName}: ${error.message}`, 'red');
      }
    } else {
      log(`❌ ${fileName} non trovato in root-files/`, 'red');
    }
  });

  log('');
  log('🎉 Installazione completata!', 'green');
  log('');
  
  // Statistiche
  if (copiedCount > 0 || overwrittenCount > 0) {
    log('📊 Statistiche:', 'cyan');
    if (copiedCount > 0) {
      log(`   ✅ File copiati: ${copiedCount}`, 'green');
    }
    if (overwrittenCount > 0) {
      log(`   🔄 File sovrascritti: ${overwrittenCount}`, 'yellow');
    }
    log('');
  }
  
  log('📋 Prossimi passi:', 'cyan');
  if (projectConfig) {
    log('   ✅ Configurazione progetto completata', 'green');
  } else {
    log('   1. Configura package-manager/project-config.js (opzionale)', 'blue');
  }
  log('   2. Configura package-manager/dependencies-config.js (opzionale)', 'blue');
  log('   3. Testa: node package-manager.js update', 'blue');
  log('');
  log('💡 Per utilizzare il manager:', 'cyan');
  log('   - Modalità interattiva: node package-manager.js', 'blue');
  log('   - Comando diretto: node package-manager.js update', 'blue');
  log('   - Wrapper Windows: package-manager.bat', 'blue');
  log('   - Wrapper Unix/Linux/macOS: ./package-manager.sh', 'blue');
  log('');
}

// Gestione errori
process.on('uncaughtException', (error) => {
  log('❌ Errore imprevisto:', 'red');
  log(`   ${error.message}`, 'yellow');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('❌ Errore di promessa non gestita:', 'red');
  log(`   ${reason}`, 'yellow');
  process.exit(1);
});

// Avvio della funzione principale
if (require.main === module) {
  main();
}

module.exports = { main };
