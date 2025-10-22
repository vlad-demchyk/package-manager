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
ℹ️  2. Disabilita Workspace
ℹ️  3. 🧹 Pulisci node_modules locali (risparmio memoria)
⚠️  0. Torna al menu sperimentale
```

## 🔧 Operazioni Workspace

### 1. Inizializzazione Workspace

L'inizializzazione del Workspace:

1. **Rileva automaticamente** tutti i componenti del progetto
2. **Crea/aggiorna** il `package.json` root con la configurazione `workspaces`
3. **Installa Yarn** automaticamente se non presente
4. **Esegue** `yarn install` per installare tutti i pacchetti centralmente
5. **Aggiorna** la configurazione del package manager

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

### 4. Disabilitazione Workspace

Ripristina la modalità standard con `node_modules` locali:

1. **Rimuove** la configurazione `workspaces` dal `package.json`
2. **Elimina** il file `yarn.lock`
3. **Aggiorna** la configurazione del package manager
4. **Ripristina** la modalità standard

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
  "scripts": {
    "install:workspace": "yarn install",
    "install:all": "yarn workspaces run install",
    "clean:workspace": "yarn workspaces run clean"
  }
}
```

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
1. **Aggiorna** le dipendenze nei singoli `package.json`
2. **Esegui** `yarn install` per sincronizzare
3. **Pulisci** i `node_modules` locali se necessario
4. **Verifica** lo stato del Workspace

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
```

### Errori di Dipendenze
```bash
# Pulisci tutto e reinstalla
yarn install --force

# O disabilita e riabilita il Workspace
# Dal menu: Gestione Monorepo Workspace > Disabilita Workspace
# Poi: Gestione Monorepo Workspace > Abilita Workspace
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
