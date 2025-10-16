# Configurazione e Installazione del Modulo

Guida completa per installare e configurare il Package Manager Module in un nuovo progetto.

## 📁 Struttura del Modulo

```
package-manager/
├── README.md                    # Documentazione principale
├── module-setup.md              # Questa guida
├── project-config.js            # Configurazione del progetto
├── dependencies-config.js       # Configurazione delle dipendenze
├── ToEXTRACT/                   # File da copiare nella root del progetto
│   ├── package-manager.js       # Entry point principale
│   ├── package-manager.bat      # Wrapper Windows
│   └── package-manager.sh       # Wrapper Unix/Linux/macOS
├── scripts/
│   ├── core.js                  # Script principale del manager
│   ├── update-configs.js        # Script per aggiornare configurazioni
│   └── clean-only.js            # Script per pulizia
├── wrappers/
│   ├── package-manager.bat/.sh  # Wrapper per Windows/Unix
│   ├── update-configs.bat/.sh   # Wrapper per update
│   └── clean-only.bat/.sh       # Wrapper per clean
└── docs/
    ├── dependencies.md          # Documentazione dipendenze
    ├── manager-usage.md         # Guida all'uso del manager
    └── scripts-usage.md         # Panoramica script
```

## 🚀 Installazione in un Nuovo Progetto

### 1. Copia del Modulo

Copia l'intera cartella `package-manager/` nella root del tuo progetto:

```bash
# Esempio di copia
cp -r package-manager/ /path/to/your/project/
```

### 2. File da Copiare nella Root del Progetto

Dopo aver copiato il modulo, devi copiare i file dalla cartella `ToEXTRACT/` nella root del progetto:

```bash
# File principali dalla cartella ToEXTRACT/
cp package-manager/ToEXTRACT/package-manager.js /path/to/your/project/
cp package-manager/ToEXTRACT/package-manager.bat /path/to/your/project/
cp package-manager/ToEXTRACT/package-manager.sh /path/to/your/project/
```

### 3. Struttura Finale del Progetto

```
your-project/
├── package-manager.js          # ← COPIA QUI
├── package-manager.bat         # ← COPIA QUI  
├── package-manager.sh          # ← COPIA QUI
├── package-manager/            # ← COPIA TUTTA LA CARTELLA
│   ├── README.md
│   ├── module-setup.md
│   ├── project-config.js
│   ├── dependencies-config.js
│   ├── scripts/
│   ├── wrappers/
│   └── docs/
└── your-components/            # I tuoi componenti
    ├── component1/
    ├── component2/
    └── ...
```

### 4. Comandi di Copia

#### Windows (PowerShell)
```powershell
# Copia file principali dalla cartella ToEXTRACT/
Copy-Item "package-manager\ToEXTRACT\package-manager.js" "C:\path\to\your\project\"
Copy-Item "package-manager\ToEXTRACT\package-manager.bat" "C:\path\to\your\project\"
Copy-Item "package-manager\ToEXTRACT\package-manager.sh" "C:\path\to\your\project\"

# Copia cartella modulo
Copy-Item "package-manager" "C:\path\to\your\project\" -Recurse
```

#### Unix/Linux/macOS
```bash
# Copia file principali dalla cartella ToEXTRACT/
cp package-manager/ToEXTRACT/package-manager.js /path/to/your/project/
cp package-manager/ToEXTRACT/package-manager.bat /path/to/your/project/
cp package-manager/ToEXTRACT/package-manager.sh /path/to/your/project/

# Copia cartella modulo
cp -r package-manager/ /path/to/your/project/
```

## ⚙️ Configurazione del Progetto

### 1. Configurazione Base (project-config.js)

Modifica `package-manager/project-config.js` per adattarlo al tuo progetto:

```javascript
module.exports = {
  // Configurazione del progetto
  project: {
    name: "Il Tuo Progetto",           // Nome del tuo progetto
    version: "1.0.0",                  // Versione
    description: "Descrizione progetto" // Descrizione
  },
  
  // Configurazione ricerca componenti
  components: {
    // Scegli il metodo di filtraggio componenti
    filterByPrefix: {
      enabled: true,
      prefix: "tuo-prefisso-"          // Cambia il prefisso
    }
  }
};
```

### 2. Configurazione delle Dipendenze (dependencies-config.js)

Modifica `package-manager/dependencies-config.js` per le tue dipendenze:

```javascript
// Dipendenze base (sempre aggiunte)
const BASE_DEPENDENCIES = {
  "react": "^18.0.0",
  "typescript": "^4.9.0"
  // Aggiungi le tue dipendenze base
};

// Dipendenze condizionali (aggiunte solo se utilizzate)
const CONDITIONAL_DEPENDENCIES = {
  "lodash": {
    version: "^4.17.21",
    patterns: ["import.*lodash", "require.*lodash"],
    description: "Libreria Lodash"
  }
  // Aggiungi le tue dipendenze condizionali
};
```

## ⚙️ Metodi di Filtraggio Componenti

Il modulo supporta 4 metodi per identificare i componenti:

### 1. Per Prefisso (Raccomandato)
```javascript
filterByPrefix: {
  enabled: true,
  prefix: "my-app-"
}
```

### 2. Per Struttura
```javascript
filterByStructure: {
  enabled: true,
  requiredFiles: ["package.json", "tsconfig.json"],
  requiredFolders: ["src", "config"]
}
```

### 3. Per Lista
```javascript
filterByList: {
  enabled: true,
  folders: ["component1", "component2", "component3"]
}
```

### 4. Per Regex
```javascript
filterByRegex: {
  enabled: true,
  pattern: /^microservice-\w+$/
}
```

## 📋 Checklist per Nuovo Progetto

- [ ] Copiata cartella `package-manager/`
- [ ] Copiati file nella root: `package-manager.js`, `package-manager.bat`, `package-manager.sh`
- [ ] Configurato `project-config.js` con nome e metodo filtraggio
- [ ] Configurato `dependencies-config.js` con le dipendenze del progetto
- [ ] Testato comando: `node package-manager.js update`

## ⚠️ Note Importanti

1. **Non modificare** i file copiati nella root del progetto
2. **Modifica solo** i file di configurazione dentro `package-manager/`
3. **Mantieni** la struttura delle cartelle del modulo
4. **Testa** sempre dopo la copia con: `node package-manager.js update`

## 🔧 Dopo la Copia

1. Configura `package-manager/project-config.js`
2. Configura `package-manager/dependencies-config.js`
3. Testa il modulo: `node package-manager.js update`
4. Verifica che i componenti vengano rilevati correttamente

## 🔧 Personalizzazione Avanzata

### Aggiunta Nuove Dipendenze Condizionali

```javascript
// In dependencies-config.js
"tua-libreria": {
  version: "^1.0.0",
  patterns: ["import.*tua-libreria", "require.*tua-libreria"],
  description: "La tua libreria personalizzata"
}
```

### Modifica Script NPM Standard

```javascript
// In dependencies-config.js
const STANDARD_SCRIPTS = {
  "build": "gulp bundle",
  "test": "jest",
  "lint": "eslint src/"
  // Aggiungi i tuoi script
};
```

## 🆘 Risoluzione Problemi

### Errore: "Cartella package-manager non trovata"
- Verifica che la cartella `package-manager/` sia nella root del progetto
- Verifica che `package-manager.js` sia nella root del progetto

### Errore: "File project-config.js non trovato"
- Verifica che `project-config.js` sia nella cartella `package-manager/`

### Nessun componente trovato
- Controlla la configurazione in `project-config.js`
- Verifica che i componenti abbiano `package.json`
- Testa diversi metodi di filtraggio

## 📚 Documentazione Aggiuntiva

- **[dependencies.md](docs/dependencies.md)** - Configurazione dettagliata dipendenze
- **[manager-usage.md](docs/manager-usage.md)** - Guida completa all'uso
- **[scripts-usage.md](docs/scripts-usage.md)** - Esempi di configurazione

## 🔄 Aggiornamenti

Per aggiornare il modulo:

1. Backup della tua configurazione
2. Sostituisci i file del modulo
3. Ripristina la tua configurazione
4. Testa il funzionamento

---

**Nota**: Questo modulo è progettato per essere universale e facilmente adattabile a qualsiasi progetto multi-componente.