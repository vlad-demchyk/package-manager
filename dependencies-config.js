/**
 * Configurazione dipendenze per componenti Cherry 106
 * Gestione centralizzata di versioni e liste dipendenze
 * Versione modulare con configurazione esterna
 */

// Dipendenze base SPFx (sempre aggiunte)
const BASE_DEPENDENCIES = {
  "@microsoft/sp-core-library": "1.21.1",
  "@microsoft/sp-lodash-subset": "1.21.1", 
  "@microsoft/sp-office-ui-fabric-core": "1.21.1",
  "@microsoft/sp-property-pane": "1.21.1",
  "@microsoft/sp-webpart-base": "1.21.1"
};

// Dipendenze da aggiungere solo se utilizzate
const CONDITIONAL_DEPENDENCIES = {
  // Dipendenze PnP
  "@pnp/sp": {
    version: "^4.16.0",
    patterns: ["@pnp/sp", "spfi", "SPFx"],
    description: "Libreria PnP SPFx"
  },
  "@pnp/spfx-property-controls": {
    version: "3.2.0",
    patterns: ["@pnp/spfx-property-controls", "PropertyFieldCodeEditor", "PropertyFieldNumber"],
    description: "PnP Property Controls"
  },
  
  // Librerie UI
  "jquery": {
    version: "^2.2.4",
    patterns: ["jquery", "$", "require(\"jquery\")", "import.*jquery"],
    description: "Libreria jQuery"
  },
  "moment": {
    version: "^2.29.4",
    patterns: ["moment", "import.*moment", "require.*moment"],
    description: "Libreria Moment.js"
  },
  
  // Specifiche Cherry
  "cherry-106-sharepoint-utils": {
    version: "git+https://bitbucket.org/crowdm/cherry-106-sharepoint-utils.git",
    patterns: ["cherry-106-sharepoint-utils", "SpfxCommonClient"],
    description: "Cherry 106 Utils"
  },
  "cherry-106-sharepoint-api": {
    version: "git+https://bitbucket.org/crowdm/cherry-106-sharepoint-api.git",
    patterns: ["cherry-106-sharepoint-api"],
    description: "Cherry 106 API"
  },
  "cherry-106-sharepoint-spfxapi": {
    version: "git+https://bitbucket.org/crowdm/cherry-106-sharepoint-spfx-api.git",
    patterns: ["cherry-106-sharepoint-spfxapi"],
    description: "Cherry 106 SPFx API"
  },
  
  // Librerie aggiuntive
  "axios": {
    version: "^0.21.1",
    patterns: ["axios", "import.*axios", "require.*axios"],
    description: "Client HTTP Axios"
  },
  "select2": {
    version: "^4.1.0-rc.0",
    patterns: ["select2", "import.*select2", "require.*select2"],
    description: "Libreria Select2"
  },
  "slick-carousel": {
    version: "^1.8.1",
    patterns: ["slick", "slick-carousel", "import.*slick", "require.*slick"],
    description: "Slick Carousel"
  },
  "jqueryui": {
    version: "^1.11.1",
    patterns: ["jqueryui", "jquery-ui", "import.*jqueryui", "require.*jqueryui"],
    description: "jQuery UI"
  },
  "sprintf-js": {
    version: "^1.1.2",
    patterns: ["sprintf", "sprintf-js", "import.*sprintf", "require.*sprintf"],
    description: "Libreria sprintf-js"
  }
};

// Dipendenze dev (sempre aggiunte)
const DEV_DEPENDENCIES = {
  "@microsoft/sp-build-web": "1.21.1",
  "@microsoft/sp-tslint-rules": "1.21.1",
  "@microsoft/sp-module-interfaces": "1.21.1",
  "@microsoft/rush-stack-compiler-5.3": "0.1.0",
  "gulp": "~4.0.2",
  "ajv": "^6.12.5",
  "eslint": "8.57.1", // Esempio: cambia in "9.0.0" per aggiornare
  "eslint-plugin-react-hooks": "4.3.0",
  "@types/webpack-env": "~1.15.2",
  "typescript": "~5.3.3"
};

// Dipendenze deprecate da rimuovere
const DEPRECATED_DEPENDENCIES = [
  "@microsoft/rush-stack-compiler-3.7",
  "@microsoft/sp-webpart-workbench"
];

// Script npm standard
const STANDARD_SCRIPTS = {
  "build": "gulp bundle",
  "clean": "gulp clean", 
  "test": "gulp test",
  "buildp": "gulp clean && gulp bundle --ship && gulp package-solution --ship"
};

// tsconfig.json standard
const STANDARD_TSCONFIG = {
  "extends": "./node_modules/@microsoft/rush-stack-compiler-5.3/includes/tsconfig-web.json",
  "compilerOptions": {
    "target": "es2016",
    "forceConsistentCasingInFileNames": true,
    "module": "esnext",
    "moduleResolution": "node",
    "jsx": "react",
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "outDir": "lib",
    "inlineSources": false,
    "strictNullChecks": false,
    "noUnusedLocals": false,
    "typeRoots": [
      "./node_modules/@types",
      "./node_modules/@microsoft"
    ],
    "types": [
      "webpack-env"
    ],
    "lib": [
      "es2016",
      "dom",
      "es2015.collection",
      "es2015.promise",
      "ES2016"
    ]
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx"
  ]
};

// Engine Node.js
const NODE_ENGINES = {
  "node": ">=18.20.8 < 23.0.0"
};

// Funzione per ottenere tutte le dipendenze (base + condizionali)
function getAllDependencies() {
  const allDeps = { ...BASE_DEPENDENCIES };
  
  Object.entries(CONDITIONAL_DEPENDENCIES).forEach(([name, config]) => {
    allDeps[name] = config.version;
  });
  
  return allDeps;
}

// Funzione per ottenere solo le dipendenze base
function getBaseDependencies() {
  return { ...BASE_DEPENDENCIES };
}

// Funzione per ottenere le dipendenze condizionali
function getConditionalDependencies() {
  return { ...CONDITIONAL_DEPENDENCIES };
}

// Funzione per ottenere le dipendenze dev
function getDevDependencies() {
  return { ...DEV_DEPENDENCIES };
}

// Funzione per ottenere le dipendenze deprecate
function getDeprecatedDependencies() {
  return [...DEPRECATED_DEPENDENCIES];
}

// Funzione per ottenere gli script standard
function getStandardScripts() {
  return { ...STANDARD_SCRIPTS };
}

// Funzione per ottenere il tsconfig standard
function getStandardTsConfig() {
  return { ...STANDARD_TSCONFIG };
}

// Funzione per ottenere gli engine Node.js
function getNodeEngines() {
  return { ...NODE_ENGINES };
}

// Esportazione per uso in altri script
module.exports = {
  // Costanti
  BASE_DEPENDENCIES,
  CONDITIONAL_DEPENDENCIES,
  DEV_DEPENDENCIES,
  DEPRECATED_DEPENDENCIES,
  STANDARD_SCRIPTS,
  STANDARD_TSCONFIG,
  NODE_ENGINES,
  
  // Funzioni
  getAllDependencies,
  getBaseDependencies,
  getConditionalDependencies,
  getDevDependencies,
  getDeprecatedDependencies,
  getStandardScripts,
  getStandardTsConfig,
  getNodeEngines
};
