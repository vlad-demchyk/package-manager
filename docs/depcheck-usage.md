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

### 1. Rilevamento Intelligente del Tipo di Progetto
Il sistema rileva automaticamente il tipo di progetto analizzando:
- **Dipendenze**: `package.json` dependencies e devDependencies
- **File di configurazione**: `angular.json`, `next.config.js`, `vite.config.js`, ecc.
- **Scripts**: comandi di build e sviluppo
- **Struttura**: presenza di file specifici del framework

**Tipi supportati**: Angular, React, Next.js, Nuxt.js, Vue.js, Svelte, SharePoint/SPFx, WordPress, Vite, Webpack, TypeScript

### 2. Analisi Avanzata dei File
Il sistema analizza tutti i file rilevanti nei componenti:
- **Codice**: `.js`, `.ts`, `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`
- **Configurazione**: `.json`, `.jsonc`, `.json5`, `.yml`, `.yaml`, `.toml`
- **Stili**: `.css`, `.scss`, `.sass`, `.less`, `.styl`
- **HTML**: `.html`, `.htm`, `.xhtml`
- **Documentazione**: `.md`, `.mdx` (per esempi di codice)

### 3. Rilevamento Utilizzo Avanzato
Per ogni dipendenza, cerca pattern multipli:
- **ES6 Imports**: `import ... from 'package'`, `import 'package'`
- **CommonJS**: `require('package')`, `require('package/sub')`
- **Dynamic Imports**: `import('package')`, `import('package/sub')`
- **AMD**: `define(['package'], ...)`
- **Webpack**: `require.ensure`, `require.context`
- **SystemJS**: `System.import('package')`
- **CSS**: `@import 'package'`, `url('package')`
- **HTML**: `src="package"`, `href="package"`
- **Template Literals**: `` `path/${package}/file` ``
- **Environment Variables**: `process.env.PACKAGE_*`

### 4. Analisi Configurazione Intelligente
Il sistema analizza oltre 30 tipi di file di configurazione:
- **Build Tools**: `webpack.config.js`, `vite.config.js`, `rollup.config.js`
- **Frameworks**: `angular.json`, `next.config.js`, `nuxt.config.js`
- **Linting**: `.eslintrc.*`, `eslint.config.js`, `.prettierrc`
- **Testing**: `jest.config.js`, `cypress.config.js`, `playwright.config.js`
- **CSS**: `tailwind.config.js`, `postcss.config.js`
- **TypeScript**: `tsconfig.json`, `jsconfig.json`
- **Environment**: `.env*`, `nodemon.json`

### 5. Regole di Sicurezza Contestuali
Il sistema applica regole specifiche per tipo di progetto:

**Angular**: Mantiene `@angular/*`, `rxjs`, `zone.js`
**React**: Mantiene `react`, `react-dom`, `react-scripts`
**Next.js**: Mantiene `next`, `react`, `react-dom`
**Vue.js**: Mantiene `vue`, `vue-router`, `vuex`
**SharePoint**: Mantiene `@microsoft/sp-*`, `gulp`, `webpack`
**WordPress**: Mantiene `wp-*`, `@wordpress/*`

### 6. Report dei Risultati Avanzati
- ✅ **Dipendenze utilizzate**: Con motivo (codice/confiurazione)
- ❌ **Dipendenze sicure da rimuovere**: Convalidato come non utilizzato
- ⚠️ **Dipendenze da rivedere manualmente**: Potenzialmente pericolose
- 🔧 **Dipendenze di configurazione**: Utilizzate solo nei file di config
- 📊 **Statistiche dettagliate**: Per tipo di progetto e categoria

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
