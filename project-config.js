module.exports = {
  // Configurazione del progetto
  project: {
    name: "Cherry 106",
    version: "1.0.0",
    description: "Gestore pacchetti per web parts Cherry 106"
  },
  
  // Configurazione ricerca componenti
  components: {
    // Metodo 1: Per prefisso (attuale)
    filterByPrefix: {
      enabled: true,
      prefix: "c106-"
    },
    
    // Metodo 2: Per struttura cartella
    filterByStructure: {
      enabled: false,
      requiredFiles: ["package.json", "tsconfig.json"],
      requiredFolders: ["src", "config"]
    },
    
    // Metodo 3: Per lista cartelle
    filterByList: {
      enabled: false,
      folders: ["component1", "component2", "component3"]
    },
    
    // Metodo 4: Per regex
    filterByRegex: {
      enabled: false,
      pattern: /^my-app-\w+$/
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
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m'
    }
  }
};
