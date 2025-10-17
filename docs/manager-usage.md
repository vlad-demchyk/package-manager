# Guida all'Uso del Package Manager

Guida completa per utilizzare il Package Manager con interfaccia interattiva e comandi da terminale.

## 🎯 Panoramica

Il Package Manager offre due modalità di utilizzo:
- **Modalità interattiva** - Menu user-friendly
- **Modalità comando** - Comandi da terminale

## 🖥️ Modalità Interattiva

### Avvio
```bash
# Entry point principale
node package-manager.js

# Scorciatoie
node packman.js
node pm.js
```

### Menu Principale
```
📋 Gestore Pacchetti Cherry 106:
1. 📦 Installazione pacchetti
2. 🔄 Reinstallazione pacchetti (clean install)
3. 🧹 Pulizia/rimozione pacchetti
4. ⚙️  Aggiornamento configurazioni (globale)
5. 🔍 Controllo dipendenze non utilizzate
0. 🚪 Esci
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
⚙️  Aggiornamento configurazioni per tutte le web parts...
⚠️  Questo aggiornerà le configurazioni per TUTTE le web parts!
Continua? (y/N):
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
node package-manager.js <comando> [opzioni] [modalità]

# Con scorciatoie
node packman.js <comando> [opzioni] [modalità]
node pm.js <comando> [opzioni] [modalità]
```

### Comandi Disponibili

#### 📦 Installazione
```bash
# Installa per tutte le web parts (modalità normale)
node package-manager.js install
# O con scorciatoie:
node packman.js install
node pm.js install

# Installa per un singolo componente
node package-manager.js install --single c106-header
# O con scorciatoie:
node packman.js install --single c106-header
node pm.js install --single c106-header

# Installa per tutte eccetto quelle specificate
node package-manager.js install --exclude c106-header c106-footer
# O con scorciatoie:
node packman.js install --exclude c106-header c106-footer
node pm.js install --exclude c106-header c106-footer

# Installa con --legacy-peer-deps
node package-manager.js install --single c106-header legacy
node package-manager.js install --exclude c106-header c106-footer legacy
# O con scorciatoie:
node packman.js install --single c106-header legacy
node packman.js install --exclude c106-header c106-footer legacy
node pm.js install --single c106-header legacy
node pm.js install --exclude c106-header c106-footer legacy

# Installa con --force
node package-manager.js install --single c106-header force
# O con scorciatoie:
node packman.js install --single c106-header force
node pm.js install --single c106-header force
node package-manager.js install --exclude c106-header c106-footer force
```

#### 🔄 Reinstallazione
```bash
# Reinstalla completamente per tutte le web parts
node package-manager.js reinstall

# Reinstalla per un singolo componente
node package-manager.js reinstall --single c106-header

# Reinstalla per tutte eccetto quelle specificate
node package-manager.js reinstall --exclude c106-header c106-footer

# Reinstalla con --legacy-peer-deps
node package-manager.js reinstall --single c106-header legacy
node package-manager.js reinstall --exclude c106-header c106-footer legacy

# Reinstalla con --force
node package-manager.js reinstall --single c106-header force
node package-manager.js reinstall --exclude c106-header c106-footer force
```

#### 🧹 Pulizia
```bash
# Pulisci tutte le web parts
node package-manager.js clean

# Pulisci un singolo componente
node package-manager.js clean --single c106-header

# Pulisci tutte eccetto quelle specificate
node package-manager.js clean --exclude c106-header c106-footer
```

#### ⚙️ Aggiornamento
```bash
# Aggiorna configurazioni per tutte le web parts (sempre globale)
node package-manager.js update
```

#### 🔍 Controllo Dipendenze
```bash
# Controlla dipendenze non utilizzate per tutti i componenti
node package-manager.js depcheck

# Controlla un singolo componente
node package-manager.js depcheck --single c106-header

# Controlla tutti eccetto quelli specificati
node package-manager.js depcheck --exclude c106-header c106-footer

# Controlla e rimuovi dipendenze non utilizzate
node package-manager.js depcheck --remove

# Combinazioni
node package-manager.js depcheck --single c106-header --remove
node package-manager.js depcheck --exclude c106-header --remove

# Comandi automatici (senza conferma)
node package-manager.js depcheck --single c106-header clean
node package-manager.js depcheck --exclude c106-header c106-footer clean
node package-manager.js depcheck clean
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
node package-manager.js install --single c106-header
# O con scorciatoie:
node packman.js install --single c106-header
node pm.js install --single c106-header

# Installa con legacy per risolvere conflitti
node package-manager.js install --single c106-header legacy
# O con scorciatoie:
node packman.js install --single c106-header legacy
node pm.js install --single c106-header legacy
```

### Installazione per Sviluppo
```bash
# Installa tutto tranne componenti pesanti
node package-manager.js install --exclude c106-calendario c106-organigramma
# O con scorciatoie:
node packman.js install --exclude c106-calendario c106-organigramma
node pm.js install --exclude c106-calendario c106-organigramma

# Installa tutto con legacy
node package-manager.js install legacy
# O con scorciatoie:
node packman.js install legacy
node pm.js install legacy
```

### Pulizia per Liberare Spazio
```bash
# Pulisci tutto
node package-manager.js clean
# O con scorciatoie:
node packman.js clean
node pm.js clean

# Pulisci tutto tranne componenti importanti
node package-manager.js clean --exclude c106-header c106-footer
# O con scorciatoie:
node packman.js clean --exclude c106-header c106-footer
node pm.js clean --exclude c106-header c106-footer
```

### Reinstallazione per Problemi
```bash
# Reinstalla un componente problematico
node package-manager.js reinstall --single c106-header
# O con scorciatoie:
node packman.js reinstall --single c106-header
node pm.js reinstall --single c106-header

# Reinstalla tutto con legacy
node package-manager.js reinstall legacy
# O con scorciatoie:
node packman.js reinstall legacy
node pm.js reinstall legacy
```

### Controllo e Pulizia Dipendenze
```bash
# Controlla dipendenze non utilizzate
node package-manager.js depcheck
# O con scorciatoie:
node packman.js depcheck
node pm.js depcheck

# Controlla un componente specifico
node package-manager.js depcheck --single c106-header
# O con scorciatoie:
node packman.js depcheck --single c106-header
node pm.js depcheck --single c106-header

# Rimuovi dipendenze non utilizzate (con conferma)
node package-manager.js depcheck --remove
# O con scorciatoie:
node packman.js depcheck --remove
node pm.js depcheck --remove

# Rimuovi automaticamente (senza conferma)
node package-manager.js depcheck --single c106-header clean
node package-manager.js depcheck --exclude c106-header c106-footer clean
node package-manager.js depcheck clean
```

## 🔧 Modalità di Installazione

### 1. Normale (predefinita)
```bash
npm install
# O con scorciatoie:
node packman.js install
node pm.js install
```
- **Quando usare**: Prima installazione, dipendenze aggiornate
- **Vantaggi**: Veloce, sicuro, standard

### 2. Legacy (--legacy-peer-deps)
```bash
npm install --legacy-peer-deps
# O con scorciatoie:
node packman.js install legacy
node pm.js install legacy
```
- **Quando usare**: Conflitti peer dependencies, progetti vecchi
- **Vantaggi**: Risolve conflitti di versioni

### 3. Forzato (--force)
```bash
npm install --force
# O con scorciatoie:
node packman.js install force
node pm.js install force
```
- **Quando usare**: Legacy non funziona, conflitti gravi
- **Rischi**: Possibili problemi di compatibilità

## 🎯 Workflow Tipici

### Setup Iniziale
```bash
# 1. Aggiorna configurazioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 2. Installa tutto
node package-manager.js install
# O con scorciatoie:
node packman.js install
node pm.js install

# 3. Testa un componente
node package-manager.js install --single c106-header
# O con scorciatoie:
node packman.js install --single c106-header
node pm.js install --single c106-header
```

### Sviluppo Quotidiano
```bash
# Installa solo componenti necessari
node package-manager.js install --exclude c106-calendario c106-organigramma
# O con scorciatoie:
node packman.js install --exclude c106-calendario c106-organigramma
node pm.js install --exclude c106-calendario c106-organigramma

# Pulisci quando necessario
node package-manager.js clean --single c106-header
# O con scorciatoie:
node packman.js clean --single c106-header
node pm.js clean --single c106-header
```

### Risoluzione Problemi
```bash
# 1. Pulisci tutto
node package-manager.js clean
# O con scorciatoie:
node packman.js clean
node pm.js clean

# 2. Aggiorna configurazioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 3. Reinstalla con legacy
node package-manager.js reinstall legacy
# O con scorciatoie:
node packman.js reinstall legacy
node pm.js reinstall legacy
```

### Pulizia Dipendenze
```bash
# 1. Controlla dipendenze non utilizzate
node package-manager.js depcheck
# O con scorciatoie:
node packman.js depcheck
node pm.js depcheck

# 2. Rimuovi quelle non utilizzate (dopo verifica)
node package-manager.js depcheck --remove
# O con scorciatoie:
node packman.js depcheck --remove
node pm.js depcheck --remove

# 3. Aggiorna configurazioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 4. Reinstalla dipendenze
node package-manager.js reinstall
# O con scorciatoie:
node packman.js reinstall
node pm.js reinstall
```

### Workflow Post-Aggiornamento Pacchetti
```bash
# 1. Dopo aver aggiornato i pacchetti, controlla dipendenze non utilizzate
node package-manager.js depcheck
# O con scorciatoie:
node packman.js depcheck
node pm.js depcheck

# 2. Se ci sono dipendenze non utilizzate, rimuovile
node package-manager.js depcheck clean
# O con scorciatoie:
node packman.js depcheck clean
node pm.js depcheck clean

# 3. Aggiorna le configurazioni per sincronizzare le versioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 4. Reinstalla solo le dipendenze necessarie
node package-manager.js reinstall
# O con scorciatoie:
node packman.js reinstall
node pm.js reinstall
```

### Workflow per Cambiamenti Importanti
```bash
# Per cambiamenti molto importanti (es. aggiornamento major version):

# 1. Pulisci tutto per rimuovere cache e dipendenze obsolete
node package-manager.js clean
# O con scorciatoie:
node packman.js clean
node pm.js clean

# 2. Controlla e rimuovi dipendenze non utilizzate
node package-manager.js depcheck clean
# O con scorciatoie:
node packman.js depcheck clean
node pm.js depcheck clean

# 3. Aggiorna configurazioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 4. Reinstalla tutto con modalità legacy se necessario
node package-manager.js reinstall legacy
# O con scorciatoie:
node packman.js reinstall legacy
node pm.js reinstall legacy
```

## 🆘 Risoluzione Problemi

### Errore "Cannot find module"
```bash
# Prova prima con reinstallazione normale
node package-manager.js reinstall --single c106-header

# Se non funziona, prova con legacy
node package-manager.js reinstall --single c106-header legacy

# Ultima risorsa: force
node package-manager.js reinstall --single c106-header force
```

### Conflitti peer dependencies
```bash
# Installa con legacy peer deps
node package-manager.js install --single c106-header legacy

# O reinstalla con legacy
node package-manager.js reinstall --single c106-header legacy
```

### Problemi con cache npm
```bash
# Pulisci cache npm
npm cache clean --force

# Poi reinstalla
node package-manager.js reinstall --single c106-header
```

### Workflow completo per problemi gravi
```bash
# 1. Pulisci tutto
node package-manager.js clean
# O con scorciatoie:
node packman.js clean
node pm.js clean

# 2. Aggiorna configurazioni
node package-manager.js update
# O con scorciatoie:
node packman.js update
node pm.js update

# 3. Reinstalla con legacy
node package-manager.js reinstall legacy
# O con scorciatoie:
node packman.js reinstall legacy
node pm.js reinstall legacy

# 4. Se ancora non funziona, prova force
node package-manager.js reinstall force
# O con scorciatoie:
node packman.js reinstall force
node pm.js reinstall force
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

## ⚠️ Note Importanti

1. **Esegui dalla directory root del progetto**
2. **Assicurati che Node.js >= 18.20.8**
3. **Per i test usa solo un componente**
4. **Crea un backup prima di aggiornamenti massivi**
5. **L'aggiornamento è sempre globale per mantenere versioni sincronizzate**