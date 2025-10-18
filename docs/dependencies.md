# Configurazione Dipendenze

Guida per configurare e gestire le dipendenze del progetto.

## 📁 File di Configurazione

### dependencies-config.js
File principale per la configurazione delle dipendenze. Contiene:
- Dipendenze base (sempre aggiunte)
- Dipendenze condizionali (aggiunte solo se utilizzate)
- Dipendenze di sviluppo
- Dipendenze obsolete (rimosse automaticamente)

## 🤖 Автогенерація залежностей

Якщо у вас вже є багатокомпонентний проект з існуючими `package.json`, ви можете автоматично згенерувати `dependencies-config.js`:

1. Встановіть модуль: `npm install https://github.com/vlad-demchyk/package-manager`
2. Запустіть: `npx packman update`
3. Коли система виявить порожній `dependencies-config.js`, вона запропонує автогенерацію
4. Система проаналізує всі `package.json` в компонентах
5. Знайде найвищу версію кожної залежності
6. Покаже результат для підтвердження
7. Збереже конфігурацію якщо ви підтвердите

### Приклад виводу

```
⚠️  dependencies-config.js порожній!
💡 Бажаєте згенерувати автоматично з існуючих проектів? (y/N): y

📦 Аналіз 5 компонентів...
✅ Знайдено 25 унікальних залежностей

📦 Згенеровані залежності:

BASE_DEPENDENCIES:
  "react": "^18.2.0"
  "typescript": "~5.3.3"
  "axios": "^1.4.0"

DEV_DEPENDENCIES:
  "eslint": "8.57.1"
  "@types/react": "^18.0.0"

📊 Статистика:
  Базових залежностей: 15
  Dev залежностей: 10

Зберегти цю конфігурацію? (y/N): y
✅ Конфігурацію збережено!
```

### Вибір версії

Система обирає найвищу версію з усіх знайдених:
- Для semver (^1.2.0, ~1.2.0) - порівнює числові версії
- Для git urls - використовує останню знайдену
- Для file: paths - пропускає з попередженням

## 🔧 Struttura Configurazione

### Dipendenze Base (sempre aggiunte)
```javascript
const BASE_DEPENDENCIES = {
  "@microsoft/sp-core-library": "1.21.1",
  "@microsoft/sp-lodash-subset": "1.21.1",
  "@microsoft/sp-office-ui-fabric-core": "1.21.1",
  "@microsoft/sp-property-pane": "1.21.1",
  "@microsoft/sp-webpart-base": "1.21.1"
};
```

### Dipendenze Condizionali (aggiunte solo se utilizzate)
```javascript
const CONDITIONAL_DEPENDENCIES = {
  "@pnp/sp": {
    version: "^4.16.0",
    patterns: ["@pnp/sp", "spfi", "SPFx"],
    description: "Libreria PnP SPFx"
  },
  "jquery": {
    version: "^2.2.4",
    patterns: ["jquery", "$", "require(\"jquery\")", "import.*jquery"],
    description: "Libreria jQuery"
  },
  "moment": {
    version: "^2.29.4",
    patterns: ["moment", "require.*moment", "import.*moment"],
    description: "Libreria Moment.js"
  }
};
```

### Dipendenze di Sviluppo
```javascript
const DEV_DEPENDENCIES = {
  "@microsoft/sp-build-web": "1.21.1",
  "@microsoft/sp-tslint-rules": "1.21.1",
  "@microsoft/sp-module-interfaces": "1.21.1",
  "@microsoft/rush-stack-compiler-5.3": "0.1.0",
  "gulp": "~4.0.2",
  "ajv": "^6.12.5",
  "eslint": "8.57.1",
  "eslint-plugin-react-hooks": "4.3.0",
  "@types/webpack-env": "~1.15.2",
  "typescript": "~5.3.3"
};
```

### Dipendenze Obsolete (rimosse automaticamente)
```javascript
const DEPRECATED_DEPENDENCIES = ['
  "@microsoft/rush-stack-compiler-3.7",
"@microsoft/sp-webpart-workbench",
  "old-package-name"
];
```

## 🎯 Controllo Intelligente

Lo script analizza automaticamente l'utilizzo delle dipendenze:

- ✅ **Trovato utilizzo** - aggiunge la dipendenza
- ⏭️ **Saltata non utilizzata** - non aggiunge la dipendenza
- 🗑️ **Rimossa obsoleta** - rimuove da package.json

### Esempio di Output
```
🔍 Analisi utilizzo dipendenze per c106-header...
✅ Trovato utilizzo: Libreria PnP SPFx (@pnp/sp)
✅ Trovato utilizzo: Libreria jQuery (jquery)
⏭️  Saltata dipendenza non utilizzata: Libreria Moment.js (moment)
✅ Aggiornato package.json per c106-header (8 dipendenze)
```

## 🔄 Come Aggiornare le Versioni

### 1. Aggiorna versione esistente
```javascript
// In dependencies-config.js
"eslint": "8.57.1", // Versione vecchia
"eslint": "9.0.0",  // Versione nuova
```

### 2. Aggiungi nuova dipendenza condizionale
```javascript
// In dependencies-config.js, sezione CONDITIONAL_DEPENDENCIES
"react": {
  version: "^18.2.0",
  patterns: ["react", "import.*react", "require.*react"],
  description: "Libreria React"
}
```

### 3. Aggiungi dipendenza obsoleta per rimozione
```javascript
// In dependencies-config.js, sezione DEPRECATED_DEPENDENCIES
const DEPRECATED_DEPENDENCIES = [
  "@microsoft/rush-stack-compiler-3.7",
  "@microsoft/sp-webpart-workbench",
  "old-package-name" // Aggiungi qui
];
```

## 🚀 Applicazione Modifiche

Dopo aver modificato `dependencies-config.js`:

```bash
# Aggiorna tutte le configurazioni (sempre globale)
packman update
```

## 📋 Esempi Configurazioni

### Per Progetto React
```javascript
const BASE_DEPENDENCIES = {
  "react": "^18.0.0",
  "react-dom": "^18.0.0"
};

const CONDITIONAL_DEPENDENCIES = {
  "lodash": {
    version: "^4.17.21",
    patterns: ["lodash", "import.*lodash"],
    description: "Libreria Lodash"
  }
};
```

### Per Progetto Node.js
```javascript
const BASE_DEPENDENCIES = {
  "express": "^4.18.0",
  "cors": "^2.8.5"
};

const CONDITIONAL_DEPENDENCIES = {
  "mongoose": {
    version: "^7.0.0",
    patterns: ["mongoose", "import.*mongoose"],
    description: "MongoDB ODM"
  }
};
```

### Per Progetto Microservices
```javascript
const BASE_DEPENDENCIES = {
  "axios": "^1.4.0",
  "dotenv": "^16.0.0"
};

const CONDITIONAL_DEPENDENCIES = {
  "redis": {
    version: "^4.6.0",
    patterns: ["redis", "import.*redis"],
    description: "Redis Client"
  }
};
```

## 🔧 Script NPM Standard

```javascript
const STANDARD_SCRIPTS = {
  "build": "gulp bundle",
  "clean": "gulp clean",
  "test": "gulp test",
  "buildp": "gulp clean && gulp bundle --ship && gulp package-solution --ship"
};
```

## ⚙️ Configurazione TypeScript

```javascript
const STANDARD_TS_CONFIG = {
  "compilerOptions": {
    "target": "es5",
    "forceConsistentCasingInFileNames": true,
    "module": "esnext",
    "moduleResolution": "node",
    "jsx": "react",
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "inlineSources": false,
    "strictNullChecks": false,
    "noUnusedLocals": false,
    "typeRoots": [
      "./node_modules/@types",
      "./node_modules/@microsoft"
    ],
    "types": [
      "es6-promise",
      "webpack-env"
    ],
    "lib": [
      "es5",
      "dom",
      "es2015.collection",
      "es2015.iterable",
      "es2015.promise"
    ]
  }
};
```

## 🔄 Workflow Aggiornamento

1. **Apri** `dependencies-config.js`
2. **Modifica** versioni o aggiungi nuove dipendenze
3. **Esegui** `packman update`
4. **Controlla** il risultato nei log
5. **Installa** pacchetti: `packman install --single component-name`

## ⚠️ Note Importanti

- **Testa sempre** su un componente prima
- **Crea backup** prima di aggiornamenti massivi
- **Verifica compatibilità** delle versioni
- **Usa** `--legacy-peer-deps` in caso di conflitti
- **Pattern** devono essere specifici per evitare falsi positivi

## 🎯 Best Practices

### Pattern Efficaci
```javascript
// ✅ Buono - specifico
patterns: ["@pnp/sp", "spfi", "SPFx"]

// ❌ Cattivo - troppo generico
patterns: ["sp", "pnp"]
```

### Versioni
```javascript
// ✅ Buono - range specifico
version: "^4.16.0"

// ❌ Cattivo - troppo generico
version: "*"
```

### Descrizioni
```javascript
// ✅ Buono - descrittivo
description: "Libreria PnP SPFx per SharePoint"

// ❌ Cattivo - non descrittivo
description: "PnP"
```