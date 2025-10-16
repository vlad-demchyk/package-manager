# Guida all'Uso del Package Manager

Guida completa per utilizzare il Package Manager con interfaccia interattiva e comandi da terminale.

## 🎯 Panoramica

Il Package Manager offre due modalità di utilizzo:
- **Modalità interattiva** - Menu user-friendly
- **Modalità comando** - Comandi da terminale

## 🖥️ Modalità Interattiva

### Avvio
```bash
# Windows
package-manager.bat
# O con scorciatoie:
packman.bat
pm.bat

# Unix/Linux/macOS
./package-manager.sh
# O con scorciatoie:
./packman.sh
./pm.sh

# O direttamente
node package-manager.js
# O con scorciatoie:
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

## 💻 Modalità Comando

### Sintassi Generale
```bash
# Forma completa
node package-manager.js <comando> [opzioni] [modalità]

# Con scorciatoie
node packman.js <comando> [opzioni] [modalità]
node pm.js <comando> [opzioni] [modalità]

# Con wrapper cross-platform
package-manager.bat <comando> [opzioni] [modalità]
packman.bat <comando> [opzioni] [modalità]
pm.bat <comando> [opzioni] [modalità]

./package-manager.sh <comando> [opzioni] [modalità]
./packman.sh <comando> [opzioni] [modalità]
./pm.sh <comando> [opzioni] [modalità]
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