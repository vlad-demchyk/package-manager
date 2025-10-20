# 🔍 Controllo Dipendenze Non Utilizzate (Depcheck)

Guida completa per l'utilizzo del sistema di controllo delle dipendenze non utilizzate nel Package Manager Cherry 106.

## 📋 Panoramica

Il sistema depcheck analizza automaticamente tutti i componenti del progetto per identificare le dipendenze installate ma non utilizzate nel codice. Questo aiuta a mantenere il progetto pulito e ridurre le dimensioni dei bundle.

## 🚀 Avvio Rapido

### Modalità Interattiva
```bash
# Avvia il menu interattivo del package manager
packman
# Seleziona opzione 2: "Controllo dipendenze non utilizzate"
```

### Comandi Diretti
```bash
# Controlla tutti i componenti
packman depcheck

# Controlla un componente specifico
packman depcheck --single c106-header

# Controlla tutti tranne quelli specificati
packman depcheck --exclude c106-header c106-footer

# Controlla e rimuovi automaticamente le dipendenze non utilizzate
packman depcheck --remove

# Combinazioni
packman depcheck --single c106-header --remove
packman depcheck --exclude c106-header --remove
```

### Scorciatoie
```bash
# Con scorciatoie
node packman.js depcheck --remove
node pm.js depcheck --remove
```

## 📝 Opzioni Disponibili

| Opzione | Descrizione | Esempio |
|---------|-------------|---------|
| `--single <component>` | Controlla solo il componente specificato | `--single c106-header` |
| `--exclude <comp1> <comp2>` | Esclude componenti dal controllo | `--exclude c106-header c106-footer` |
| `--remove` | Rimuove automaticamente le dipendenze non utilizzate | `--remove` |

## 🔍 Come Funziona

### 1. Analisi dei File
Il sistema analizza tutti i file JavaScript/TypeScript nei componenti:
- `.js`, `.ts`, `.tsx`, `.jsx`
- Scansiona ricorsivamente le cartelle `src/` e altre directory
- Esclude automaticamente `node_modules`, `.git`, `dist`, `lib`, `temp`, `release`

### 2. Rilevamento Utilizzo
Per ogni dipendenza, cerca i seguenti pattern:
- `require('package-name')`
- `import ... from 'package-name'`
- `import 'package-name'`
- `from 'package-name'`
- Riferimenti diretti nel codice

### 3. Report dei Risultati
- ✅ **Dipendenze utilizzate**: Elenco delle dipendenze effettivamente utilizzate
- ❌ **Dipendenze non utilizzate**: Elenco delle dipendenze che possono essere rimosse
- 📊 **Statistiche**: Conteggio totale e per componente

## 🛡️ Sicurezza e Conferme

### Modalità Sicura (Default)
```bash
packman depcheck
```
- Mostra solo il report delle dipendenze non utilizzate

### Comandi Automatici (Senza Conferma)
```bash
# Rimuovi automaticamente per un componente
packman depcheck --single c106-header clean

# Rimuovi automaticamente per tutti eccetto quelli specificati
packman depcheck --exclude c106-header c106-footer clean

# Rimuovi automaticamente per tutti i componenti
packman depcheck clean
```
- **NON rimuove** automaticamente nulla
- Richiede conferma esplicita per ogni rimozione

### Modalità Rimozione Automatica
```bash
packman depcheck --remove
```
- Mostra il report
- Richiede conferma per ogni componente
- Procede con la rimozione solo dopo conferma

## 📊 Esempio di Output

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

## ⚠️ Avvertenze e Best Practices

### ⚠️ Prima di Rimuovere
1. **Backup**: Assicurati di avere un backup del progetto
2. **Test**: Esegui i test dopo la rimozione
3. **Build**: Verifica che il progetto si compili correttamente
4. **Runtime**: Controlla che non ci siano errori a runtime

### 🎯 Dipendenze da Non Rimuovere
- Dipendenze utilizzate solo in file di configurazione
- Dipendenze utilizzate in script di build
- Dipendenze utilizzate in file HTML/template
- Dipendenze utilizzate in file CSS/SCSS

### 🔧 Personalizzazione
Il sistema può essere personalizzato modificando:
- `package-manager/scripts/depcheck.js` - Logica di analisi
- `package-manager/dependencies-config.js` - Configurazione dipendenze

## 🐛 Risoluzione Problemi

### Problema: "Nessun componente trovato"
**Soluzione**: Verifica la configurazione in `package-manager/project-config.js`

### Problema: "Dipendenze rimosse per errore"
**Soluzione**: 
1. Ripristina da backup
2. Reinstalla le dipendenze: `packman install`

### Problema: "Analisi troppo lenta"
**Soluzione**: 
1. Escludi componenti non necessari: `--exclude component-name`
2. Controlla un componente alla volta: `--single component-name`

## 🔄 Integrazione con Altri Comandi

### Workflow Completo
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

### Automazione
```bash
# Script per pulizia completa
#!/bin/bash
echo "🔍 Controllo dipendenze non utilizzate..."
packman depcheck --remove
echo "⚙️ Aggiornamento configurazioni..."
packman update
echo "✅ Pulizia completata!"
```

## 📚 Riferimenti

- [Documentazione principale](README.md)
- [Configurazione dipendenze](dependencies.md)
- [Guida all'uso del manager](manager-usage.md)
- [Panoramica script](scripts-usage.md)

---

**Nota**: Questo strumento è progettato per essere sicuro e richiede sempre conferma prima di rimuovere dipendenze. Tuttavia, è sempre consigliabile eseguire un backup prima di utilizzare la funzionalità di rimozione automatica.
