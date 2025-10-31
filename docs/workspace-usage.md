# Guida all'Uso del Workspace Mode

Guida completa per utilizzare la modalità Workspace (Yarn Workspaces) per la gestione centralizzata dei pacchetti.

## 🎯 Panoramica

La modalità Workspace è una **funzione sperimentale** che permette di gestire centralmente tutti i pacchetti del progetto utilizzando Yarn Workspaces. Questa modalità offre:

- **Gestione centralizzata**: Un solo `node_modules` per tutto il progetto
- **Risparmio di spazio**: Eliminazione dei `node_modules` locali
- **Sincronizzazione**: Tutti i componenti utilizzano le stesse versioni dei pacchetti
- **Performance**: Installazione più veloce e gestione semplificata

## 🚀 Attivazione del Workspace Mode

### Durante la Configurazione Iniziale

Al primo avvio del package manager, ti verrà chiesto se vuoi abilitare il Workspace mode:

```
🔬 FUNZIONE SPERIMENTALE - Yarn Workspace
Questa funzione permette di gestire centralmente i pacchetti
⚠️  Attenzione: questa funzione è in fase di test
ℹ️  Richiede Yarn per funzionare correttamente

Vuoi configurare Yarn Workspace per gestione centralizzata? (s/n, default: n):
```

### Attivazione Manuale

Se non hai abilitato il Workspace mode durante la configurazione iniziale, puoi attivarlo successivamente:

1. Vai al **Menu Sperimentale** (opzione 6)
2. Seleziona **Gestione Monorepo Workspace** (opzione 3)
3. Scegli **Abilita Workspace (inizializza)** (opzione 1)

## 🏢 Menu Workspace

Il menu Workspace offre diverse opzioni in base allo stato attuale:

### Workspace Disabilitato
```
🏢 Gestione Monorepo Workspace
⚠️  Funzione sperimentale per gestione centralizzata pacchetti
ℹ️  ❌ Workspace disabilitato

ℹ️  1. Abilita Workspace (inizializza)
ℹ️  2. Mostra stato Workspace
⚠️  0. Torna al menu sperimentale
```

### Workspace Abilitato ma Non Inizializzato
```
🏢 Gestione Monorepo Workspace
⚠️  Funzione sperimentale per gestione centralizzata pacchetti
ℹ️  ✅ Workspace abilitato
⚠️  ⚠️  Workspace non inizializzato

ℹ️  1. Inizializza Workspace
ℹ️  2. Disabilita Workspace
ℹ️  3. Mostra stato Workspace
⚠️  0. Torna al menu sperimentale
```

### Workspace Attivo e Inizializzato
```
🏢 Gestione Monorepo Workspace
⚠️  Funzione sperimentale per gestione centralizzata pacchetti
ℹ️  ✅ Workspace abilitato
ℹ️  ✅ Workspace inizializzato

ℹ️  1. Mostra stato Workspace
ℹ️  2. 🔄 Reinizializza Workspace (forza) ← NUOVO
ℹ️  3. Disabilita Workspace
ℹ️  4. 🧹 Pulisci node_modules locali (risparmio memoria)
ℹ️  5. 🔄 Sincronizza workspace con progetti attuali
⚠️  0. Torna al menu sperimentale
```

## 🔧 Operazioni Workspace

### 1. Inizializzazione Workspace

L'inizializzazione del Workspace esegue automaticamente:

1. **Rileva automaticamente** tutti i componenti del progetto (escludendo package-manager)
2. **Rimuove** tutti i `package-lock.json` dai componenti e root (per evitare conflitti)
3. **Aggiunge resolutions** in root `package.json` per compatibilità Node.js (se necessario)
4. **Crea/aggiorna** il `package.json` root con la configurazione `workspaces`
5. **Crea** `.yarnrc.yml` e `.yarnignore` per escludere package-manager
6. **Installa Yarn** automaticamente se non presente
7. **Esegue** `yarn install` per installare tutti i pacchetti centralmente
8. **Verifica** le versioni installate e corregge eventuali conflitti
9. **Aggiorna** la configurazione del package manager

#### ⚠️ Importante: Pulizia Automatica

Durante l'inizializzazione, il sistema **rimuove automaticamente** tutti i `package-lock.json`:
- ✅ Dai componenti workspace
- ✅ Dal root (se presente)

**Nota**: I `node_modules` locali **NON vengono rimossi** - vengono semplicemente ignorati dal workspace. Puoi pulirli manualmente usando la funzione di pulizia workspace.

#### 🔧 Risoluzione Automatica Compatibilità

Il sistema **automaticamente**:
- ✅ Rileva la versione Node.js
- ✅ Aggiunge `resolutions` in root `package.json` per versioni compatibili
- ✅ Verifica le versioni installate dopo `yarn install`
- ✅ Corregge automaticamente eventuali conflitti

Questo previene problemi di compatibilità quando Yarn workspace seleziona versioni più recenti che richiedono Node.js 20+, anche se i progetti individuali funzionano con Node.js 18.

```
📋 🏢 Inizializzazione Workspace
⚠️  ⚠️  Questa operazione modificherà la struttura del progetto
ℹ️  Verrà creato un root package.json con workspaces
ℹ️  Tutti i pacchetti saranno gestiti centralmente
Continuare? (y/N):
```

### 2. Stato Workspace

Mostra informazioni dettagliate sullo stato del Workspace:

```
📋 📊 Stato Workspace
📋 Informazioni Workspace:
   Abilitato: ✅ Sì
   Inizializzato: ✅ Sì
   Yarn Lock: ✅ Presente
   Workspaces: ✅ Configurati
   Numero workspaces: 3
   Workspaces:
     1. project-a/*
     2. level1\project-b/*
     3. level1\level2\project-c/*
   Root node_modules: 837.57 KB
   Node_modules locali: 0
```

### 3. Pulizia Node Modules Locali

Rimuove tutti i `node_modules` locali per risparmiare spazio:

```
🧹 Pulizia node_modules locali
🔍 Scansione 3 componenti...
✅ project-a: rimosso node_modules (245.67 KB)
✅ level1\project-b: rimosso node_modules (189.23 KB)
✅ level1\level2\project-c: rimosso node_modules (156.89 KB)
✅ Puliti 3 componenti
💾 Liberati 591.79 KB di spazio disco
💡 Tutti i pacchetti ora disponibili tramite root node_modules
```

### 4. Reinizializzazione Workspace (Nuovo)

Permette di reinstallare completamente il workspace:

```
🔄 Reinizializzazione Workspace

⚠️  Questa operazione rimuoverà la configurazione workspace esistente
ℹ️  Verrà rimosso yarn.lock e root node_modules
ℹ️  Verrà ricreata la configurazione workspace

Continuare con la reinizializzazione? (y/N):
```

Dopo la conferma, ti verrà chiesto:
```
💡 Opzioni di reinizializzazione:
   - Normale: verifica se workspace è già inizializzato
   - Forza: ignora controlli e reinizializza comunque

Usare modalità FORZA? (y/N):
```

**Modalità Normale**: Verifica se workspace è già inizializzato prima di procedere  
**Modalità Force**: Ignora tutti i controlli e reinizializza comunque

### 5. Disabilitazione Workspace

Ripristina la modalità standard con `node_modules` locali:

1. **Rimuove** la configurazione `workspaces` dal `package.json`
2. **Rimuove** i file `.yarnrc.yml` e `.yarnignore`
3. **Elimina** il file `yarn.lock`
4. **Rimuove** root `node_modules` (preservando package-manager se presente)
5. **Aggiorna** la configurazione del package manager
6. **Ripristina** la modalità standard

## 📁 Struttura del Progetto

### Prima dell'Attivazione Workspace
```
progetto/
├── project-a/
│   ├── package.json
│   └── node_modules/     # Dipendenze locali
├── level1/
│   └── project-b/
│       ├── package.json
│       └── node_modules/ # Dipendenze locali
└── level1/level2/
    └── project-c/
        ├── package.json
        └── node_modules/ # Dipendenze locali
```

### Dopo l'Attivazione Workspace
```
progetto/
├── package.json          # Root package.json con workspaces
├── yarn.lock            # Lock file centralizzato
├── node_modules/        # Dipendenze centralizzate
├── project-a/
│   └── package.json     # Senza node_modules locale
├── level1/
│   └── project-b/
│       └── package.json # Senza node_modules locale
└── level1/level2/
    └── project-c/
        └── package.json # Senza node_modules locale
```

## ⚙️ Configurazione Workspace

### Root package.json
```json
{
  "name": "progetto-workspace",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "project-a/*",
    "level1/project-b/*",
    "level1/level2/project-c/*"
  ],
  "resolutions": {
    "@azure/logger": "^1.0.0"
  },
  "scripts": {
    "install:workspace": "yarn install",
    "install:all": "yarn workspaces run install",
    "clean:workspace": "yarn workspaces run clean"
  }
}
```

**Nota sulle resolutions**: Il campo `resolutions` viene aggiunto automaticamente dal sistema per garantire compatibilità con Node.js 18. Queste resolutions forzano versioni specifiche dei pacchetti per evitare conflitti quando Yarn workspace seleziona versioni più recenti.

### Project Config
```javascript
// Configurazione workspace
workspace: {
  enabled: true,
  initialized: true,
  packagesPath: ["project-a/*", "level1/project-b/*", "level1/level2/project-c/*"],
  useYarn: true
}
```

## 🔄 Workflow Workspace

### Setup Iniziale
1. **Configura** il progetto con il package manager
2. **Abilita** il Workspace mode durante la configurazione
3. **Inizializza** il Workspace dal menu sperimentale
4. **Verifica** lo stato del Workspace

### Sviluppo Quotidiano
1. **Aggiorna** le dipendenze nei singoli `package.json` (modalità standard)
2. **⚠️ IMPORTANTE**: Prima di inizializzare workspace dopo aggiornamenti:
   - Il sistema **rimuove automaticamente** tutti i `package-lock.json` durante l'inizializzazione
   - Questo previene conflitti tra npm lock files e yarn workspace
3. **Inizializza/Reinizializza** il workspace se necessario
4. **Esegui** `yarn install` per sincronizzare (o usa il menu workspace)
5. **Pulisci** i `node_modules` locali se necessario (opzionale, per risparmio spazio)
6. **Verifica** lo stato del Workspace

### Risoluzione Problemi
1. **Controlla** lo stato del Workspace
2. **Reinizializza** se necessario
3. **Disabilita** e riabilita se ci sono problemi
4. **Pulisci** i `node_modules` locali

## 🎯 Vantaggi del Workspace Mode

### Risparmio di Spazio
- **Eliminazione duplicati**: Un solo `node_modules` per tutto il progetto
- **Condivisione dipendenze**: Stesse versioni per tutti i componenti
- **Ottimizzazione disco**: Riduzione significativa dello spazio utilizzato

### Gestione Semplificata
- **Installazione centralizzata**: Un solo comando per tutto
- **Sincronizzazione automatica**: Tutti i componenti sempre aggiornati
- **Risoluzione conflitti**: Yarn gestisce automaticamente le dipendenze

### Performance Migliorate
- **Installazione più veloce**: Meno pacchetti da scaricare
- **Cache condivisa**: Riutilizzo dei pacchetti già installati
- **Linking ottimizzato**: Yarn crea link simbolici efficienti

## ⚠️ Limitazioni e Considerazioni

### Requisiti
- **Yarn**: Richiesto per il funzionamento
- **Node.js**: Versione compatibile con Yarn
- **Struttura progetto**: Componenti con `package.json` validi

### Limitazioni
- **Funzione sperimentale**: In fase di test e sviluppo
- **Compatibilità**: Alcuni strumenti potrebbero non funzionare
- **Debugging**: Potrebbe essere più complesso identificare problemi

### Best Practices
- **Backup**: Crea sempre un backup prima di attivare
- **Test**: Testa il Workspace mode in un ambiente di sviluppo
- **Monitoraggio**: Controlla regolarmente lo stato del Workspace
- **Rollback**: Mantieni la possibilità di disabilitare se necessario

## 🆘 Risoluzione Problemi

### Workspace Non Si Inizializza
```bash
# Controlla se Yarn è installato
yarn --version

# Installa Yarn se necessario
npm install -g yarn

# Reinstalla il Workspace
# Dal menu: Gestione Monorepo Workspace > Inizializza Workspace

# Se workspace già inizializzato, usa Reinizializza con modalità Force
# Dal menu: Gestione Monorepo Workspace > Reinizializza Workspace (forza)
```

### Errori di Dipendenze / Conflitti Versione Node.js

**Problema**: Yarn workspace installa versioni incompatibili con Node.js 18

**Soluzione automatica**: Il sistema:
1. ✅ Rileva automaticamente la versione Node.js
2. ✅ Aggiunge `resolutions` in root `package.json`
3. ✅ Usa `--ignore-engines` se necessario
4. ✅ Verifica e corregge versioni dopo installazione

**Soluzione manuale**:
```bash
# Il sistema prova automaticamente con --ignore-engines
# Se necessario, puoi aggiungere manualmente resolutions in root package.json:
{
  "resolutions": {
    "@azure/logger": "^1.0.0"
  }
}

# Poi reinstallare
yarn install --ignore-engines

# O reinizializza il workspace
# Dal menu: Gestione Monorepo Workspace > Reinizializza Workspace
```

### Problemi di Performance
```bash
# Pulisci i node_modules locali
# Dal menu: Gestione Monorepo Workspace > Pulisci node_modules locali

# Verifica lo stato del Workspace
# Dal menu: Gestione Monorepo Workspace > Mostra stato Workspace
```

### Rollback a Modalità Standard
```bash
# Disabilita il Workspace
# Dal menu: Gestione Monorepo Workspace > Disabilita Workspace

# Reinstalla con npm
npm install
```

## 📊 Monitoraggio e Statistiche

Il Workspace mode fornisce statistiche dettagliate:

- **Stato Workspace**: Abilitato/Disabilitato, Inizializzato/Non inizializzato
- **Configurazione**: Numero di workspaces, percorsi configurati
- **Dipendenze**: Presenza di `yarn.lock`, dimensioni `node_modules`
- **Spazio**: Spazio liberato dai `node_modules` locali

## 🔮 Sviluppi Futuri

La funzione Workspace è in continua evoluzione:

- **Miglioramenti performance**: Ottimizzazioni per progetti grandi
- **Integrazione avanzata**: Supporto per più package manager
- **Debugging tools**: Strumenti per identificare problemi
- **Automazione**: Script automatici per gestione Workspace

## 📚 Risorse Aggiuntive

- [Yarn Workspaces Documentation](https://yarnpkg.com/features/workspaces)
- [Monorepo Best Practices](https://monorepo.tools/)
- [Package Manager Documentation](./manager-usage.md)
- [Dependencies Configuration](./dependencies.md)

---

**Nota**: Questa è una funzione sperimentale. Si consiglia di testarla in un ambiente di sviluppo prima di utilizzarla in produzione.
