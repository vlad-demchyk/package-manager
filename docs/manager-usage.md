# Guida all'Uso del Package Manager

Guida completa per utilizzare il Package Manager con interfaccia interattiva e comandi da terminale.

## 🎯 Panoramica

Il Package Manager offre tre modalità di utilizzo:
- **Modalità interattiva** - Menu user-friendly
- **Modalità comando** - Comandi da terminale
- **Modalità Workspace** - Gestione centralizzata con Yarn Workspaces (sperimentale)

## 🖥️ Modalità Interattiva

### Avvio
```bash
# Dopo l'installazione npm, i comandi sono disponibili globalmente
packman

# Scorciatoia
pm
```

### Menu Principale
```
📋 Gestore Pacchetti Cherry 106:
ℹ️  🔍 Modalità ricerca: RICORSIVA - Scansiona progetti in sottocartelle
ℹ️  📊 Profondità massima: 3 livelli
ℹ️  📦 Modalità installazione: STANDARD (node_modules locali)
✅ 1. ⚙️  Aggiornamento configurazioni (importante ad impostare dependencies-config.js)
ℹ️  2. 📦 Installazione pacchetti
ℹ️  3. 🔄 Reinstallazione pacchetti (clean install)
⚠️  4. 🧹 Pulizia/rimozione pacchetti
ℹ️  5. 📝 Visualizza log delle operazioni
⚠️  6. 🔬 EXPERIMENTAL - Funzioni sperimentali
ℹ️  9. 📁 Mostra tutti i componenti trovati
❌ 0. 🚪Esci
```

### Menu Workspace (Sperimentale)
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

### 1. 📦 Installazione Pacchetti

#### Ambito di Installazione
```
📦 Installazione pacchetti:
1. Tutte le web parts
2. Una web part specifica
3. Tutte eccetto quelle specificate
0. Torna al menu principale
```

#### Modalità di Installazione
```
🎯 Modalità installazione:
1. Normale (npm install)
2. Legacy (npm install --legacy-peer-deps)
3. Forzato (npm install --force)
0. Torna al menu principale
```

### 2. 🔄 Reinstallazione Pacchetti

#### Ambito di Reinstallazione
```
🔄 Reinstallazione pacchetti (clean install):
1. Tutte le web parts
2. Una web part specifica
3. Tutte eccetto quelle specificate
0. Torna al menu principale
```

#### Modalità di Reinstallazione
```
🎯 Modalità reinstallazione:
1. Normale (clean + npm install)
2. Legacy (clean + npm install --legacy-peer-deps)
3. Forzato (clean + npm install --force)
0. Torna al menu principale
```

### 3. 🧹 Pulizia/Rimozione Pacchetti

#### Ambito di Pulizia
```
🧹 Pulizia/rimozione pacchetti:
1. Tutte le web parts
2. Una web part specifica
3. Tutte eccetto quelle specificate
0. Torna al menu principale
```

### 4. ⚙️ Aggiornamento Configurazioni

```
⚙️  Aggiornamento configurazioni:
1. Tutte le web parts
2. Una web part specifica
3. Tutte eccetto quelle specificate
0. Torna al menu principale
```

### 5. 🔍 Controllo Dipendenze Non Utilizzate

#### Menu Controllo Dipendenze
```
🔍 Controllo dipendenze non utilizzate:
1. Controlla tutti i componenti
2. Controlla un componente
3. Controlla tutti eccetto quelli specificati
4. Controlla e rimuovi dipendenze non utilizzate
0. 🔙 Torna al menu principale
```

#### Funzionalità
- **Analisi intelligente**: Scansiona tutti i file JS/TS per rilevare l'utilizzo delle dipendenze
- **Rilevamento pattern**: Supporta require(), import, e riferimenti diretti
- **Rimozione sicura**: Richiede sempre conferma prima di rimuovere dipendenze
- **Report dettagliato**: Mostra statistiche complete per ogni componente

## 💻 Modalità Comando

### Sintassi Generale
```bash
# Forma completa
packman <comando> [opzioni] [modalità]

# Con scorciatoia
pm <comando> [opzioni] [modalità]
```

### Comandi Disponibili

#### 📦 Installazione
```bash
# Installa per tutte le web parts (modalità normale)
packman install
# O con scorciatoie:
pm install
pm install

# Installa per un singolo componente
packman install --single c106-header
# O con scorciatoie:
pm install --single c106-header
pm install --single c106-header

# Installa per tutte eccetto quelle specificate
packman install --exclude c106-header c106-footer
# O con scorciatoie:
pm install --exclude c106-header c106-footer
pm install --exclude c106-header c106-footer

# Installa con --legacy-peer-deps
packman install --single c106-header legacy
packman install --exclude c106-header c106-footer legacy
# O con scorciatoie:
pm install --single c106-header legacy
pm install --exclude c106-header c106-footer legacy
pm install --single c106-header legacy
pm install --exclude c106-header c106-footer legacy

# Installa con --force
packman install --single c106-header force
# O con scorciatoie:
pm install --single c106-header force
pm install --single c106-header force
packman install --exclude c106-header c106-footer force
```

#### 🔄 Reinstallazione
```bash
# Reinstalla completamente per tutte le web parts
packman reinstall

# Reinstalla per un singolo componente
packman reinstall --single c106-header

# Reinstalla per tutte eccetto quelle specificate
packman reinstall --exclude c106-header c106-footer

# Reinstalla con --legacy-peer-deps
packman reinstall --single c106-header legacy
packman reinstall --exclude c106-header c106-footer legacy

# Reinstalla con --force
packman reinstall --single c106-header force
packman reinstall --exclude c106-header c106-footer force
```

#### 🧹 Pulizia
```bash
# Pulisci tutte le web parts
packman clean

# Pulisci un singolo componente
packman clean --single c106-header

# Pulisci tutte eccetto quelle specificate
packman clean --exclude c106-header c106-footer
```

#### ⚙️ Aggiornamento
```bash
# Aggiorna configurazioni per tutte le web parts
packman update

# Aggiorna per un singolo componente
packman update --single c106-header

# Aggiorna per tutti eccetto quelli specificati
packman update --exclude c106-header c106-footer
```

#### 🔍 Controllo Dipendenze
```bash
# Controlla dipendenze non utilizzate per tutti i componenti
packman depcheck

# Controlla un singolo componente
packman depcheck --single c106-header

# Controlla tutti eccetto quelli specificati
packman depcheck --exclude c106-header c106-footer

# Controlla e rimuovi dipendenze non utilizzate
packman depcheck --remove

# Combinazioni
packman depcheck --single c106-header --remove
packman depcheck --exclude c106-header --remove

# Comandi automatici (senza conferma)
packman depcheck --single c106-header clean
packman depcheck --exclude c106-header c106-footer clean
packman depcheck clean
```

## 🎯 Opzioni e Flag

### Flag di Ambito
- `--single <nome>` - Applica l'operazione a un singolo componente
- `--exclude <nome1> <nome2> ...` - Applica l'operazione a tutti tranne quelli specificati

### Modalità di Installazione
- `normal` - Installazione standard (predefinita)
- `legacy` - Usa `--legacy-peer-deps`
- `force` - Usa `--force`

## 📋 Esempi Pratici

### Installazione per Test
```bash
# Installa solo c106-header per test
packman install --single c106-header
# O con scorciatoie:
pm install --single c106-header
pm install --single c106-header

# Installa con legacy per risolvere conflitti
packman install --single c106-header legacy
# O con scorciatoie:
pm install --single c106-header legacy
pm install --single c106-header legacy
```

### Installazione per Sviluppo
```bash
# Installa tutto tranne componenti pesanti
packman install --exclude c106-calendario c106-organigramma
# O con scorciatoie:
pm install --exclude c106-calendario c106-organigramma
pm install --exclude c106-calendario c106-organigramma

# Installa tutto con legacy
packman install legacy
# O con scorciatoie:
pm install legacy
pm install legacy
```

### Pulizia per Liberare Spazio
```bash
# Pulisci tutto
packman clean
# O con scorciatoie:
pm clean
pm clean

# Pulisci tutto tranne componenti importanti
packman clean --exclude c106-header c106-footer
# O con scorciatoie:
pm clean --exclude c106-header c106-footer
pm clean --exclude c106-header c106-footer
```

### Reinstallazione per Problemi
```bash
# Reinstalla un componente problematico
packman reinstall --single c106-header
# O con scorciatoie:
pm reinstall --single c106-header
pm reinstall --single c106-header

# Reinstalla tutto con legacy
packman reinstall legacy
# O con scorciatoie:
pm reinstall legacy
pm reinstall legacy
```

### Controllo e Pulizia Dipendenze
```bash
# Controlla dipendenze non utilizzate
packman depcheck
# O con scorciatoie:
pm depcheck
pm depcheck

# Controlla un componente specifico
packman depcheck --single c106-header
# O con scorciatoie:
pm depcheck --single c106-header
pm depcheck --single c106-header

# Rimuovi dipendenze non utilizzate (con conferma)
packman depcheck --remove
# O con scorciatoie:
pm depcheck --remove
pm depcheck --remove

# Rimuovi automaticamente (senza conferma)
packman depcheck --single c106-header clean
packman depcheck --exclude c106-header c106-footer clean
packman depcheck clean
```

## 🔧 Modalità di Installazione

### 1. Normale (predefinita)
```bash
npm install
# O con scorciatoie:
pm install
pm install
```
- **Quando usare**: Prima installazione, dipendenze aggiornate
- **Vantaggi**: Veloce, sicuro, standard

### 2. Legacy (--legacy-peer-deps)
```bash
npm install --legacy-peer-deps
# O con scorciatoie:
pm install legacy
pm install legacy
```
- **Quando usare**: Conflitti peer dependencies, progetti vecchi
- **Vantaggi**: Risolve conflitti di versioni

### 3. Forzato (--force)
```bash
npm install --force
# O con scorciatoie:
pm install force
pm install force
```
- **Quando usare**: Legacy non funziona, conflitti gravi
- **Rischi**: Possibili problemi di compatibilità

## 🎯 Workflow Tipici

### Setup Iniziale
```bash
# 1. Aggiorna configurazioni
packman update
# O con scorciatoie:
pm update
pm update

# 2. Installa tutto
packman install
# O con scorciatoie:
pm install
pm install

# 3. Testa un componente
packman install --single c106-header
# O con scorciatoie:
pm install --single c106-header
pm install --single c106-header
```

### Sviluppo Quotidiano
```bash
# Installa solo componenti necessari
packman install --exclude c106-calendario c106-organigramma
# O con scorciatoie:
pm install --exclude c106-calendario c106-organigramma
pm install --exclude c106-calendario c106-organigramma

# Pulisci quando necessario
packman clean --single c106-header
# O con scorciatoie:
pm clean --single c106-header
pm clean --single c106-header
```

### Risoluzione Problemi
```bash
# 1. Pulisci tutto
packman clean
# O con scorciatoie:
pm clean
pm clean

# 2. Aggiorna configurazioni
packman update
# O con scorciatoie:
pm update
pm update

# 3. Reinstalla con legacy
packman reinstall legacy
# O con scorciatoie:
pm reinstall legacy
pm reinstall legacy
```

### Pulizia Dipendenze
```bash
# 1. Controlla dipendenze non utilizzate
packman depcheck
# O con scorciatoie:
pm depcheck
pm depcheck

# 2. Rimuovi quelle non utilizzate (dopo verifica)
packman depcheck --remove
# O con scorciatoie:
pm depcheck --remove
pm depcheck --remove

# 3. Aggiorna configurazioni
packman update
# O con scorciatoie:
pm update
pm update

# 4. Reinstalla dipendenze
packman reinstall
# O con scorciatoie:
pm reinstall
pm reinstall
```

### Workflow Post-Aggiornamento Pacchetti
```bash
# 1. Dopo aver aggiornato i pacchetti, controlla dipendenze non utilizzate
packman depcheck
# O con scorciatoie:
pm depcheck
pm depcheck

# 2. Se ci sono dipendenze non utilizzate, rimuovile
packman depcheck clean
# O con scorciatoie:
pm depcheck clean
pm depcheck clean

# 3. Aggiorna le configurazioni per sincronizzare le versioni
packman update
# O con scorciatoie:
pm update
pm update

# 4. Reinstalla solo le dipendenze necessarie
packman reinstall
# O con scorciatoie:
pm reinstall
pm reinstall
```

### Workflow per Cambiamenti Importanti
```bash
# Per cambiamenti molto importanti (es. aggiornamento major version):

# 1. Pulisci tutto per rimuovere cache e dipendenze obsolete
packman clean
# O con scorciatoie:
pm clean
pm clean

# 2. Controlla e rimuovi dipendenze non utilizzate
packman depcheck clean
# O con scorciatoie:
pm depcheck clean
pm depcheck clean

# 3. Aggiorna configurazioni
packman update
# O con scorciatoie:
pm update
pm update

# 4. Reinstalla tutto con modalità legacy se necessario
packman reinstall legacy
# O con scorciatoie:
pm reinstall legacy
pm reinstall legacy
```

## 🆘 Risoluzione Problemi

### Errore "Cannot find module"
```bash
# Prova prima con reinstallazione normale
packman reinstall --single c106-header

# Se non funziona, prova con legacy
packman reinstall --single c106-header legacy

# Ultima risorsa: force
packman reinstall --single c106-header force
```

### Conflitti peer dependencies
```bash
# Installa con legacy peer deps
packman install --single c106-header legacy

# O reinstalla con legacy
packman reinstall --single c106-header legacy
```

### Problemi con cache npm
```bash
# Pulisci cache npm
npm cache clean --force

# Poi reinstalla
packman reinstall --single c106-header
```

### Workflow completo per problemi gravi
```bash
# 1. Pulisci tutto
packman clean
# O con scorciatoie:
pm clean
pm clean

# 2. Aggiorna configurazioni
packman update
# O con scorciatoie:
pm update
pm update

# 3. Reinstalla con legacy
packman reinstall legacy
# O con scorciatoie:
pm reinstall legacy
pm reinstall legacy

# 4. Se ancora non funziona, prova force
packman reinstall force
# O con scorciatoie:
pm reinstall force
pm reinstall force
```

## 📊 Statistiche e Log

Il manager mostra automaticamente:
- ✅ Numero di componenti elaborati con successo
- ❌ Numero di errori
- 📁 Lista dei componenti trovati
- 🔄 Progresso di esecuzione

### Esempio di Output
```
📁 Trovati 29 componenti:
   - c106-applicativi
   - c106-breadcrumbs
   - c106-calendario
   ...

🔧 Elaborazione c106-header...
✅ Installati con successo i pacchetti per c106-header
✅ Installazione completata!

📊 Risultato:
   ✅ Elaborati con successo: 1/1
   ❌ Errori: 0/1
```

## 🏢 Modalità Workspace (Sperimentale)

### Panoramica
La modalità Workspace è una **funzione sperimentale** che permette di gestire centralmente tutti i pacchetti del progetto utilizzando Yarn Workspaces.

### Vantaggi
- **Gestione centralizzata**: Un solo `node_modules` per tutto il progetto
- **Risparmio di spazio**: Eliminazione dei `node_modules` locali
- **Sincronizzazione**: Tutti i componenti utilizzano le stesse versioni
- **Performance**: Installazione più veloce e gestione semplificata

### Attivazione
1. **Durante la configurazione**: Rispondi "s" alla domanda sul Workspace
2. **Dopo la configurazione**: Menu Sperimentale > Gestione Monorepo Workspace

### Operazioni Disponibili
- **Inizializzazione**: Configura il Workspace per il progetto
- **Stato**: Mostra informazioni dettagliate sul Workspace
- **Pulizia**: Rimuove i `node_modules` locali per risparmiare spazio
- **Disabilitazione**: Ripristina la modalità standard

### Documentazione Completa
Per informazioni dettagliate sulla modalità Workspace, consulta:
- [Guida Workspace Mode](./workspace-usage.md)

## ⚠️ Note Importanti

1. **Esegui dalla directory root del progetto**
2. **Assicurati che Node.js >= 18.20.8**
3. **Per i test usa solo un componente**
4. **Crea un backup prima di aggiornamenti massivi**
5. **L'aggiornamento è sempre globale per mantenere versioni sincronizzate**
6. **La modalità Workspace è sperimentale - testala in sviluppo prima di usarla in produzione**