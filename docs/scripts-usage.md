# Panoramica e Utilizzo degli Script

Guida completa per tutti gli script disponibili nel modulo Package Manager.

## 📁 Script Principali

### 1. install.js (Script di Installazione Cross-Platform)
**Script automatico** - Installano automaticamente il modulo nel progetto su tutte le piattaforme.

#### Posizione
```
package-manager/install.js  # Cross-platform (Windows, Unix/Linux/macOS)
```

#### Funzionalità
- **Configurazione interattiva** del progetto durante l'installazione
- **Personalizzazione** del metodo di identificazione componenti
- Copia automaticamente i file da `root-files/` nella root del progetto
- Verifica la presenza dei file necessari
- Sovrascrive i file esistenti se necessario
- Rende eseguibili i file .sh su sistemi Unix-like
- Fornisce statistiche dettagliate (copiati/sovrascritti)
- Cross-platform (Windows, Unix/Linux, macOS)
- Gestione errori avanzata

#### Utilizzo
```bash
# Tutte le piattaforme
cd package-manager
node install.js
```

#### Output Esempio
```
🚀 Installazione Package Manager Module...

🔧 Configurazione iniziale del modulo...
🔧 Configurazione del progetto...

📝 Nome del progetto: My Awesome Project
📝 Descrizione del progetto (opzionale): Gestore per web parts personalizzate

🎯 Metodo di identificazione componenti:
1. Per prefisso (es: c106-, my-app-)
2. Per struttura cartella (package.json + cartelle specifiche)
3. Per lista cartelle specifiche
4. Per espressione regolare
5. Salta configurazione (usa impostazioni predefinite)

Scegli metodo (1-5): 1
🔤 Prefisso componenti (es: c106-): my-app-
✅ Configurazione salvata in project-config.js

📁 Copia file nella root del progetto...
✅ package-manager.js copiato
🔄 package-manager.bat sovrascritto
✅ package-manager.sh copiato

🎉 Installazione completata!

📊 Statistiche:
   ✅ File copiati: 2
   🔄 File sovrascritti: 1

📋 Prossimi passi:
   ✅ Configurazione progetto completata
   2. Configura package-manager/dependencies-config.js (opzionale)
   3. Testa: packman update

💡 Per utilizzare il manager:
   - Modalità interattiva: packman
   - Comando diretto: packman update
   - Wrapper Windows: package-manager.bat
   - Wrapper Unix/Linux/macOS: ./package-manager.sh
```

### 2. package-manager.js (Entry Point)
**File principale** - Punto di ingresso per tutto il sistema.

#### Posizione
```
root-files/package-manager.js  # File da copiare nella root del progetto
```

#### Funzionalità
- Carica la configurazione del progetto
- Avvia lo script principale (core.js)
- Gestisce modalità interattiva e comando
- Fornisce interfaccia unificata

#### Utilizzo
```bash
# Modalità interattiva
packman

# Modalità comando
packman install --single c106-header
packman update
packman clean
```

#### Struttura
```javascript
// Carica configurazione
const projectConfig = require('./package-manager/project-config.js');

// Avvia script principale
const coreModule = require('./package-manager/scripts/core.js');

// Gestisce argomenti
if (args.length === 0) {
  coreModule.main(); // Modalità interattiva
} else {
  coreModule.parseAndExecuteCommand(args); // Modalità comando
}
```

### 3. core.js (Script Principale)
**Entry point sottile** - Setup iniziale (config + logging), parsing dei comandi
CLI non interattivi (`parseAndExecuteCommand`) e avvio del processo. La logica
del menu interattivo e delle singole funzionalità vive nei moduli descritti in
["Architettura interna degli script"](#-architettura-interna-degli-script) qui sotto.

#### Funzionalità
- Setup configurazione progetto e logging su file
- Parsing comandi CLI (`install`, `reinstall`, `clean`, `update`, `depcheck`)
- Punto di ingresso (`main()`, richiamato da `package-manager.js`)

#### Posizione
```
package-manager/scripts/core.js
```

#### Utilizzo
```bash
# Chiamato automaticamente da package-manager.js
packman
```

## 🧩 Architettura interna degli script

Per mantenere ogni file di dimensioni gestibili, la logica è divisa in moduli
per responsabilità. Chi deve modificare/estendere una funzionalità del menu
interattivo dovrebbe partire da qui invece che da `core.js`:

```
scripts/
├── core.js                    # Setup + parsing CLI non interattivo + entry point
├── cli/
│   ├── context.js             # Stato condiviso: istanza readline, projectConfig,
│   │                          # handler per tornare al menu principale
│   ├── actions.js             # Azioni condivise tra CLI e menu (install/clean/
│   │                          # update/depcheck) — evita dipendenze circolari
│   ├── prompt.js               # Helper per domande readline (riusa l'istanza
│   │                          # condivisa quando disponibile)
│   └── menu-runner.js         # main(), showMenu(), showUsage(): il menu
│                               # principale e il ciclo di vita di readline
├── menus/                     # Un file per ciascuna sezione del menu interattivo
│   ├── component-list.js      # Elenco componenti (semplice/dettagliato)
│   ├── update-menu.js         # Menu "Aggiornamento configurazioni"
│   ├── install-menu.js        # Menu installazione/reinstallazione/pulizia
│   ├── logs-menu.js           # Menu log delle operazioni
│   ├── experimental-menu.js   # Menu EXPERIMENTAL (orchestratore sottile)
│   ├── recursive-search-menu.js   # Ricerca ricorsiva progetti on/off
│   ├── depcheck-menu.js       # Controllo dipendenze non utilizzate + whitelist
│   ├── workspace-menu.js      # Gestione Monorepo Workspace (Yarn Workspaces)
│   ├── npm-tools-menu.js      # Lock files, npm outdated/audit, skipLibCheck
│   ├── dependencies-config-menu.js  # Pulizia prefissi/duplicati in dependencies-config.js
│   ├── version-alignment-menu.js    # Allineamento versioni dipendenze tra progetti (coppia base/target)
│   ├── generate-config-menu.js      # Genera dependencies-config.js in sola lettura (menu principale, voce 7)
│   └── compare-projects-menu.js     # Confronto versioni tra TUTTI i progetti (menu principale, voce 8)
├── dependencies/               # Logica di analisi/generazione/aggiornamento dipendenze
├── operations/                  # Installazione/pulizia standard e workspace
├── utils/                        # Utility condivise (version-utils, common, logger, ...)
└── validation/                   # depcheck
```

Regole di massima seguite in questa struttura:
- I moduli `menus/*` non si richiedono mai direttamente a vicenda in modo
  circolare: per tornare al menu principale usano `cliContext.returnToMainMenu()`,
  e per navigare verso `experimental-menu.js` (che a sua volta richiede molti
  `menus/*`) usano un `require()` "lazy" dentro la funzione, non in testa al file.
- Tutte le azioni "pesanti" (install/clean/update/depcheck) condivise tra CLI e
  menu interattivo vivono in `cli/actions.js`, non duplicate nei singoli menu.
- L'accesso a `projectConfig` e all'istanza `readline` condivisa passa sempre
  da `cliContext` (`scripts/cli/context.js`), non da variabili globali locali
  ai singoli file.

### 4. update-configs.js (Aggiornamento Configurazioni)
**Script specializzato** - Aggiorna package.json e tsconfig.json.

#### Funzionalità
- Analizza utilizzo dipendenze
- Aggiorna package.json
- Aggiorna tsconfig.json
- Rimuove dipendenze obsolete
- Controllo intelligente

#### Posizione
```
package-manager/scripts/update-configs.js
```

#### Utilizzo
```bash
# Tramite package manager (raccomandato)
packman update

# Direttamente
node package-manager/scripts/update-configs.js
```

#### Esempio Output
```
🚀 Avvio aggiornamento configurazioni componenti...
📁 Trovati 29 componenti:
   - c106-applicativi
   - c106-breadcrumbs
   ...

🔧 Elaborazione c106-header...
🔍 Analisi utilizzo dipendenze per c106-header...
✅ Trovato utilizzo: Libreria PnP SPFx (@pnp/sp)
✅ Trovato utilizzo: Libreria jQuery (jquery)
⏭️  Saltata dipendenza non utilizzata: Libreria Moment.js (moment)
✅ Aggiornato package.json per c106-header (8 dipendenze)
✅ Aggiornato tsconfig.json per c106-header
```

### 5. clean-only.js (Solo Pulizia)
**Script specializzato** - Rimuove node_modules e file temporanei.

#### Funzionalità
- Rimuove node_modules/
- Rimuove package-lock.json
- Rimuove tslint.json (se trovato)
- Pulizia selettiva

#### Posizione
```
package-manager/scripts/clean-only.js
```

#### Utilizzo
```bash
# Tramite package manager (raccomandato)
packman clean

# Direttamente
node package-manager/scripts/clean-only.js --all
node package-manager/scripts/clean-only.js c106-header c106-footer
node package-manager/scripts/clean-only.js --exclude c106-header c106-footer
```

### 6. depcheck.js (Controllo Dipendenze Non Utilizzate)
**Script specializzato** - Analizza e rimuove dipendenze non utilizzate.

#### Funzionalità
- Analizza utilizzo dipendenze nel codice
- Rileva dipendenze non utilizzate
- Rimozione sicura con conferma
- Supporto per tutti i tipi di import (require, import, etc.)
- Analisi ricorsiva di directory
- Esclusione automatica di file di sistema

#### Posizione
```
package-manager/scripts/depcheck.js
```

#### Utilizzo
```bash
# Tramite package manager (raccomandato)
packman depcheck
packman depcheck --single c106-header
packman depcheck --exclude c106-header c106-footer
packman depcheck --remove

# Comandi automatici (senza conferma)
packman depcheck --single c106-header clean
packman depcheck --exclude c106-header c106-footer clean
packman depcheck clean

# Direttamente
node package-manager/scripts/depcheck.js
node package-manager/scripts/depcheck.js --single c106-header
node package-manager/scripts/depcheck.js --remove
```

#### Esempio Output
```
🔍 Controllo dipendenze non utilizzate per 3 componenti...

🔍 Analisi dipendenze per c106-header...
📦 c106-header:
   ❌ Non utilizzate (2): moment, select2

🔍 Analisi dipendenze per c106-footer...
✅ c106-footer: tutte le dipendenze sono utilizzate

🔍 Analisi dipendenze per c106-calendario...
📦 c106-calendario:
   ❌ Non utilizzate (1): jquery

📊 Risultato controllo:
   🔍 Componenti controllati: 3
   ❌ Dipendenze non utilizzate trovate: 3

💡 Per rimuovere le dipendenze non utilizzate utilizzare:
   packman depcheck --remove
```

## 🔧 Wrapper Scripts

### File da Copiare nella Root (root-files/)
```
package-manager/root-files/
├── package-manager.js       # Entry point principale
├── packman.js               # Scorciatoia
└── pm.js                    # Scorciatoia
```

#### Utilizzo
```bash
# Entry point principale
packman

# Scorciatoie
node packman.js
node pm.js
```

## ⚙️ File di Configurazione

### 1. project-config.js
**Configurazione del progetto** - Definisce come identificare i componenti.

#### Posizione
```
package-manager/project-config.js
```

#### Struttura
```javascript
module.exports = {
  project: {
    name: "Cherry 106 SharePoint",
    version: "1.0.0",
    description: "Progetto SharePoint multi-componente"
  },
  
  components: {
    filterByPrefix: {
      enabled: true,
      prefix: "c106-"
    }
  }
};
```

#### Metodi di Filtraggio
```javascript
// 1. Per Prefisso
filterByPrefix: {
  enabled: true,
  prefix: "c106-"
}

// 2. Per Struttura
filterByStructure: {
  enabled: true,
  requiredFiles: ["package.json", "tsconfig.json"],
  requiredFolders: ["src", "config"]
}

// 3. Per Lista
filterByList: {
  enabled: true,
  folders: ["c106-header", "c106-footer", "c106-calendario"]
}

// 4. Per Regex
filterByRegex: {
  enabled: true,
  pattern: /^c106-\w+$/
}
```

### 2. dependencies-config.js
**Configurazione dipendenze** - Definisce tutte le dipendenze del progetto.

#### Posizione
```
package-manager/dependencies-config.js
```

#### Struttura
```javascript
// Dipendenze base (sempre aggiunte)
const BASE_DEPENDENCIES = {
  "@microsoft/sp-core-library": "1.21.1",
  // ...
};

// Dipendenze condizionali (aggiunte solo se utilizzate)
const CONDITIONAL_DEPENDENCIES = {
  "@pnp/sp": {
    version: "^4.16.0",
    patterns: ["@pnp/sp", "spfi", "SPFx"],
    description: "Libreria PnP SPFx"
  },
  // ...
};

// Dipendenze dev
const DEV_DEPENDENCIES = {
  "eslint": "8.57.1",
  // ...
};

// Dipendenze obsolete (rimosse)
const DEPRECATED_DEPENDENCIES = [
  "@microsoft/rush-stack-compiler-3.7",
  // ...
];
```

## 🚀 Esempi di Utilizzo

### Setup Iniziale
```bash
# 1. Aggiorna configurazioni
packman update

# 2. Installa tutto
packman install

# 3. Testa un componente
packman install --single c106-header
```

### Sviluppo Quotidiano
```bash
# Installa solo componenti necessari
packman install --exclude c106-calendario c106-organigramma

# Pulisci quando necessario
packman clean --single c106-header
```

### Risoluzione Problemi
```bash
# 1. Pulisci tutto
packman clean

# 2. Aggiorna configurazioni
packman update

# 3. Reinstalla con legacy
packman reinstall legacy
```

### Utilizzo Script Diretti
```bash
# Aggiorna configurazioni direttamente
node package-manager/scripts/update-configs.js

# Pulisci direttamente
node package-manager/scripts/clean-only.js --all

# Pulisci componenti specifici
node package-manager/scripts/clean-only.js c106-header c106-footer

# Controlla dipendenze non utilizzate
node package-manager/scripts/depcheck.js

# Controlla e rimuovi dipendenze non utilizzate
node package-manager/scripts/depcheck.js --remove

# Comandi automatici (senza conferma)
packman depcheck --single c106-header clean
packman depcheck --exclude c106-header c106-footer clean
```

## 🔄 Workflow Tipici

### 1. Aggiornamento Dipendenze
```bash
# 1. Modifica dependencies-config.js
# 2. Aggiorna configurazioni
packman update

# 3. Installa per test
packman install --single c106-header

# 4. Se tutto ok, installa tutto
packman install
```

### 2. Pulizia Progetto
```bash
# 1. Pulisci tutto
packman clean

# 2. Aggiorna configurazioni
packman update

# 3. Reinstalla
packman install
```

### 3. Pulizia Dipendenze
```bash
# 1. Controlla dipendenze non utilizzate
packman depcheck

# 2. Rimuovi quelle non utilizzate (dopo verifica)
packman depcheck --remove

# 3. Aggiorna configurazioni
packman update

# 4. Reinstalla dipendenze
packman reinstall
```

### 4. Pulizia Automatica Dipendenze
```bash
# 1. Rimuovi automaticamente per un componente
packman depcheck --single c106-header clean

# 2. Rimuovi automaticamente per tutti eccetto quelli specificati
packman depcheck --exclude c106-header c106-footer clean

# 3. Rimuovi automaticamente per tutti i componenti
packman depcheck clean
```

### 5. Setup Nuovo Progetto
```bash
# 1. Copia modulo
cp -r package-manager/ /path/to/new/project/

# 2. Installa automaticamente (cross-platform)
cd /path/to/new/project/package-manager
node install.js

# 3. Configura project-config.js
# 4. Configura dependencies-config.js

# 5. Testa
packman update
```

## 🎯 Comandi Rapidi

### Aggiornamento Rapido
```bash
packman update
```

### Installazione Test
```bash
packman install --single c106-header
```

### Pulizia Rapida
```bash
packman clean --single c106-header
```

### Reinstallazione Problematica
```bash
packman reinstall --single c106-header legacy
```

### Controllo Dipendenze
```bash
packman depcheck
```

### Pulizia Dipendenze
```bash
packman depcheck --remove
```

### Pulizia Automatica Dipendenze
```bash
packman depcheck --single c106-header clean
packman depcheck --exclude c106-header c106-footer clean
packman depcheck clean
```

## ⚠️ Note Importanti

1. **Sempre eseguire dalla root del progetto**
2. **package-manager.js è il punto di ingresso principale**
3. **Gli script diretti sono per casi specifici**
4. **I wrapper forniscono compatibilità cross-platform**
5. **Le configurazioni sono centralizzate e modulari**

## 🔧 Personalizzazione

### Aggiunta Nuovo Script
1. Crea script in `package-manager/scripts/`
2. Aggiungi wrapper in `package-manager/wrappers/`
3. Integra in `core.js` se necessario

### Modifica Configurazione
1. Modifica `project-config.js` per filtraggio componenti
2. Modifica `dependencies-config.js` per dipendenze
3. Testa con `packman update`

### Aggiunta Nuovo Metodo Filtraggio
1. Aggiungi logica in `core.js`
2. Documenta in `project-config.js`
3. Testa con diversi progetti