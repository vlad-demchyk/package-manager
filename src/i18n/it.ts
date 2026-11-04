import type { Catalogue } from './en.js';

export const it: Catalogue = {
  'report.title': 'Report packman',
  'report.workspace': 'Workspace',
  'report.projects': 'Progetti',
  'report.groups': 'Gruppi di versioni',
  'report.baseline': 'base',
  'report.findings': 'Rilievi',
  'report.workspaceFindings': 'Rilievi del workspace',
  'report.noFindings': 'Nessun rilievo.',
  'report.node': 'Node',
  'report.nodeSelected': 'installato {version} ({manager})',
  'report.nodeNone': 'nessuna versione installata compatibile',
  'report.nodeRecommended': 'consigliato {version}',
  'report.stacks': 'Stack',
  'report.exposure': 'Esecuzione',
  'report.network': 'Chiamate di rete',
  'report.fixes': 'Correzioni',
  'report.summary': '{critical} critici, {error} errori, {warning} avvisi, {info} informativi',
  'report.data':
    'Dati: matrice SPFx {spfx}, calendario Node {node}, CVE Node {nodeVulns}, npm advisories {advisories}',
  'report.advisoriesSkipped': 'non verificato ({reason})',
  'report.installedNodes': 'Versioni di Node installate',
  'exposure.browser': 'nel browser',
  'exposure.server': 'sul server',
  'exposure.build': 'solo sulla macchina di build',
  'exposure.unknown': 'sconosciuto',
  'severity.critical': 'critico',
  'severity.error': 'errore',
  'severity.warning': 'avviso',
  'severity.info': 'info',

  'npm.rangeSpec': '{count} dipendenze usano intervalli invece di versioni esatte',
  'npm.prereleaseSpec': 'Versioni pre-release, nightly o canary nelle dipendenze',
  'npm.unboundedSpec': 'Versioni illimitate (*, latest) rendono le installazioni imprevedibili',
  'npm.lockfileMissing': 'Nessun lockfile: le installazioni non sono riproducibili',
  'npm.lockfileV1': 'Lockfile v1 (npm 5-6): rigenerarlo con npm 7+ per metadati completi',
  'npm.treeBroken':
    '{count} pacchetti del lockfile risolvono una dipendenza fuori dal range: a runtime caricano la copia sbagliata',
  'npm.treePeer': '{count} requisiti peer di pacchetti annidati non soddisfatti dal lockfile',
  'verified.recorded':
    'Set verificati salvati: {projects} progetti, {stores} store condivisi (.packman/verified).',
  'npm.unverifiedVersions':
    '{count} versioni del lockfile diverse dal set con cui {script} è passato ({date}): non verificate da una build',
  'npm.lockfileDrift': 'Lockfile non allineato con package.json ({count} pacchetti)',
  'npm.notInstalled': 'Dipendenze non installate',
  'npm.installedDrift': 'Pacchetti installati diversi da package.json ({count})',
  'npm.familyMismatch': 'I pacchetti della famiglia "{family}" non sono allineati ({policy})',
  'npm.peerUnsatisfied': '{count} requisiti di peer dependency non soddisfatti',
  'npm.deprecated': '{count} dipendenze dirette sono deprecate',
  'npm.duplicateMajors':
    '{count} pacchetti che devono essere unici sono installati in più versioni',
  'npm.duplicateDeclaration': '{count} pacchetti dichiarati in più sezioni',
  'npm.undeclaredImport': '{count} pacchetti importati ma non dichiarati in package.json',
  'npm.unusedDependency': '{count} dipendenze dichiarate ma mai importate',

  'spfx.versionUnknown': 'SPFx rilevato ma la versione non è determinabile',
  'spfx.yoRcMismatch':
    '.yo-rc.json indica il generator {generator}, i pacchetti indicano SPFx {version}',
  'spfx.notInMatrix': 'SPFx {version} non è nella matrice di compatibilità',
  'spfx.withdrawn': 'SPFx {version} è stata ritirata da Microsoft',
  'spfx.prerelease': 'I pacchetti SPFx pre-release non devono andare in produzione: {packages}',
  'spfx.lockstepMismatch':
    '{count} pacchetti SPFx non sono su SPFx {version} (runtime e build devono coincidere)',
  'spfx.lockstepRange':
    '{count} pacchetti SPFx usano intervalli; i pacchetti SPFx {version} devono essere esatti',
  'spfx.toolchainMixed': 'Sono configurati sia gulp sia Heft',
  'spfx.gulpUnsupported': 'SPFx {version} non supporta la toolchain gulp',
  'spfx.heftTooEarly': 'Heft rilevato su SPFx {version}; Heft è supportato dalla 1.22.0',
  'spfx.compilerMismatch': 'SPFx {version} richiede {expected}, trovato {actual}',
  'spfx.typescriptCompilerMismatch':
    'typescript {typescript} è dichiarato ma il compilatore usa TypeScript {compilerTs}',
  'spfx.compilerWithHeft': 'rush-stack-compiler non è usato dalla toolchain Heft',
  'spfx.typescriptMismatch': 'typescript {actual} non corrisponde a {expected}',
  'spfx.reactMismatch': 'SPFx {version} richiede React esattamente {react}',
  'spfx.typesReactMismatch': '@types/react non corrisponde alla major di React di SPFx {version}',
  'spfx.libraryNewer':
    '{library} {version} è compilata per SPFx {target}, più recente di SPFx {spfx} del progetto (usare {suggested})',
  'spfx.libraryOlder':
    '{library} {version} è compilata per SPFx {target}, il progetto usa SPFx {spfx} (valutare {suggested})',
  'spfx.pnpjsMajor':
    'PnPjs v{major} non è la major consigliata per SPFx {spfx} (consigliata v{recommended})',
  'spfx.upgradeAvailable': 'SPFx {version} può essere aggiornata (ultima {latest})',

  'react.typesMajor': '@types/react {types} non corrisponde a react {react}',
  'typescript.v7Api':
    'TypeScript {version} non ha API programmatica; questi strumenti richiedono ancora TypeScript 6',
  'eslint.legacyIgnored': 'ESLint {version} ignora {file}; migrare a eslint.config.js',

  'node.pinConflict':
    'Il pin di Node {pin} ({file}) è in conflitto con {range} richiesto da {source}',
  'node.enginesMissing': 'Manca engines.node; lo stack richiede {range}',
  'node.enginesConflict': 'engines.node {engines} esclude {range} richiesto da {source}',
  'node.enginesTooWide':
    'engines.node {engines} ammette versioni fuori da {range} richiesto da {source}',
  'node.notInstalled': 'Nessun Node installato soddisfa {ranges} (consigliato {recommended})',
  'node.eol': 'Node {version} ha raggiunto il fine vita il {end} (consigliato {recommended})',
  'node.patchedAvailable':
    'Node {version} ha vulnerabilità note; {recommended} è corretto e compatibile',
  'node.eolNotAssessed': 'EOL: {count} CVE note, le successive non valutate né corrette',

  'security.packageVulns':
    '{count} pacchetti vulnerabili ({direct} diretti, {network} nel codice di rete)',
  'security.nodeVuln': 'Node {version}: {count} vulnerabilità note ({context})',

  'policy.pinViolation':
    'Gruppo "{group}": {name} deve essere {version} ({count} progetti diversi)',
  'policy.groupDivergence': 'Gruppo "{group}": {name} ha {count} versioni, allineare a {target}',
  'policy.nodeFragmentation': 'I progetti richiedono {count} linee diverse di Node',

  'constraint.package': '{name} {version} non soddisfa {range} richiesto da {source}',

  'fix.syncYoRc': 'Aggiornare .yo-rc.json a {version}',
  'fix.alignSpfxPackages': 'Impostare tutti i pacchetti SPFx a {version}',
  'fix.replaceCompiler': 'Usare {compiler}',
  'fix.removeCompiler': 'Rimuovere rush-stack-compiler',
  'fix.setVersion': 'Impostare {name} a {version}',
  'fix.pinReact': 'Fissare react e react-dom a {react}',
  'fix.alignTypesReact': 'Allineare @types/react e @types/react-dom',
  'fix.pinInstalled': 'Fissare gli intervalli alle versioni installate',
  'fix.alignFamily': 'Allineare la famiglia {family} a {version}',
  'fix.declareImports': 'Dichiarare i pacchetti importati con la versione del lockfile',
  'fix.removeUnused': 'Rimuovere le dipendenze non usate',
  'fix.setEngines': 'Impostare engines.node a {range}',
  'fix.updatePin': 'Scrivere {version} in {file}',
  'fix.alignGroup': 'Allineare {name} a {version}',

  'tui.tab.overview': 'Panoramica',
  'tui.tab.projects': 'Progetti',
  'tui.tab.versions': 'Versioni',
  'tui.tab.node': 'Node',
  'tui.tab.outdated': 'Obsoleti',
  'tui.tab.store': 'Store',
  'tui.key.profiles': 'profili',
  'tui.nothingToChange': 'Niente da cambiare per questa riga.',
  'tui.noProfileFixes':
    'Nessuna differenza dai profili da correggere (profili in packman.config.json).',
  'tui.profilesSelected': '{count} correzioni dei profili selezionate: verificarle in Correzioni.',
  'tui.profilesCleared': '{count} correzioni dei profili deselezionate.',
  'tui.outdatedLoading': 'Interrogazione del registry npm…',
  'tui.outdatedUnavailable':
    'Interrogazione del registry non disponibile qui: eseguire packman outdated.',
  'tui.inMajor': 'più recente nella major',
  'tui.storeLinked': '{count}/{total} collegati',
  'tui.storeHint':
    'Collegare con: packman store link -g {key} --union (installa, poi sostituisce node_modules)',
  'tui.storeOthers':
    '{candidates} gruppi da allineare prima, {excluded} progetti esclusi: packman store plan',
  'fix.bumpInMajor': 'Aggiornare {name} a {version}',
  'tui.tab.fixes': 'Correzioni',
  'tui.minSeverity': 'mostra {severity} e superiori',
  'tui.key.move': 'sposta',
  'tui.key.tabs': 'schede',
  'tui.key.open': 'apri',
  'tui.key.back': 'indietro',
  'tui.key.select': 'seleziona correzione',
  'tui.key.severity': 'gravità',
  'tui.key.apply': 'applica',
  'tui.key.reload': 'ricarica',
  'tui.key.quit': 'esci',
  'tui.nodeUsers': '{count} progetti',
  'tui.noSelection': 'Nessuna correzione selezionata: premere spazio su un rilievo con correzione.',
  'store.none': "Nessun gruppo di progetti identici può ancora condividere un'installazione.",
  'store.groupNotFound': 'Gruppo {group} non trovato; eseguire `packman store plan`.',
  'store.linkPlan': "{count} progetti condivideranno un'installazione con Node {node}:",
  'store.confirmLink': 'Installare lo store e collegare questi progetti?',
  'store.linked': '{count} progetti collegati a {dir}',
  'store.unlinked':
    '{count} collegamenti rimossi, {restored} backup manifest/lock ripristinati; eseguire install per ricreare i moduli locali',
  'store.noLinks': 'Nessun progetto collegato.',
  'store.alignFirst': 'allineare prima: {packages}',
  'init.exists': '{file} esiste già; usare --force per sovrascriverlo.',
  'init.created': 'Creato {file}',
  'profile.versions': '{count} dipendenze diverse dal profilo {profile}',
  'profile.misplaced': '{count} dipendenze nella sezione sbagliata per il profilo {profile}',
  'profile.missing': 'Mancano {count} dipendenze richieste dal profilo {profile}',
  'profile.deprecated': '{count} dipendenze deprecate dal profilo {profile} sono ancora dichiarate',
  'profile.scripts': '{count} script diversi dal profilo {profile}',
  'profile.engines': '{count} engines diversi dal profilo {profile}',
  'profile.overrides': '{count} overrides diversi dal profilo {profile}',
  'profile.tsconfig': '{count} impostazioni di tsconfig.json diverse dal profilo {profile}',
  'profile.tsconfigInvalid': 'tsconfig.json non è leggibile',
  'fix.applyProfile': 'Applicare il profilo {profile}',
  'npm.unusedDevDependency':
    '{count} devDependencies non usate da codice, file di configurazione o script',
  'spfx.unusedRuntime':
    '{count} pacchetti runtime SPFx dichiarati ma non importati (residui del template)',
  'fix.mergeDuplicates': 'Mantenere una sola dichiarazione con la versione più alta',
  'spfx.tslintLeftover': 'tslint.json residuo: SPFx {version} usa ESLint',
  'fix.deleteFile': 'Eliminare {file}',
  'spfx.coreMissing':
    '{count} pacchetti richiesti da SPFx {version} non sono dichiarati (build o runtime ne dipendono)',
  'fix.addCore': 'Aggiungere i pacchetti core di SPFx {version}',
  'spfx.coreTransitive':
    '{count} pacchetti richiesti da SPFx {version} sono presenti solo come dipendenze di altri pacchetti; dichiararli',
  'spfx.coreUnverified':
    'Nessun lockfile né node_modules: {count} pacchetti richiesti da SPFx {version} non sono dichiarati e non sono verificabili',
  'install.linkedSkipped': 'collegato allo store, saltato',
  'install.confirm': 'Eseguire npm in {count} progetti?',
  'clean.nothing': 'Niente da pulire.',
  'clean.confirm': 'Rimuovere {count} elementi?',
  'clean.done': '{count} elementi rimossi',
  'reinstall.confirm': 'Pulire e reinstallare {count} progetti?',
  'update.noProfiles':
    'Nessun profilo in packman.config.json: crearne uno con `packman profile generate --name <nome> --write`.',
  'profile.notWritten': 'Non scritto: aggiungere --write per salvarlo in packman.config.json.',
  'store.seeded':
    'Risoluzione dal set verificato del {date} (Node {node}); --refresh risolve da zero.',
  'store.unverified':
    '{count} versioni diverse dal set verificato, non ancora verificate da una build:',
  'install.drift':
    '{project}: package-lock.json non corrisponde a package.json; eseguire packman relock e verificare le modifiche (npm sceglierebbe le versioni da solo).',
  'store.peers':
    '{count} requisiti peer non soddisfatti dalle versioni del gruppo; correggerli nei progetti:',
  'cli.notANumber': '{value} non è un numero intero maggiore o uguale a 0.',
  'data.usingUpdated': 'in uso la copia aggiornata',
  'data.usingBundled': 'in uso la copia inclusa',
  'data.dir': 'Cartella dei dati aggiornati: {dir}',
  'data.file': '{name}: {before} -> {after}',
  'data.noChanges': 'nessuna modifica',
  'data.notWritten': 'Non scritto: eseguire senza --dry-run per salvare i dati aggiornati.',
  'data.written': 'Salvato in {dir}; i file inclusi non sono stati modificati.',
  'profile.tsconfigSource': 'tsconfig.json preso da {project}',
  'profile.tsconfigSourceMissing':
    'Nessun tsconfig.json leggibile per {project} (id di progetto o latest-ts) {reason}',
  'profile.written': 'Profilo {name} scritto in {file}',
  'align.package': 'Allineamento di {name} a {version}',
  'align.unknownProject': 'Progetto sconosciuto {project}',
  'align.closest': 'Progetti con più versioni in comune con {project}:',
  'align.usage':
    'Usare --base <progetto> [--to <progetto>] oppure --package <nome> [--version <versione>].',
  'outdated.none': 'Tutto aggiornato.',
  'list.total': '{count} progetti',
  'ignore.empty': '(vuoto)',
  'log.pruned': '{count} voci rimosse',
  'log.empty': 'Nessuna operazione registrata.',
  'fix.alignToProject': 'Allineare {base} a {target}',
  'cli.description':
    'Rileva gli stack, verifica compatibilità e vulnerabilità, allinea le versioni tra molti progetti.',
  'cli.noProjects': 'Nessun progetto trovato in {root}',
  'cli.dryRun':
    'Prova a secco: nulla è stato scritto. Rieseguire con --apply per scrivere le modifiche.',
  'cli.applied': '{count} file modificati. Backup in {dir}',
  'cli.noFixes': 'Niente da correggere.',
  'cli.confirm': 'Applicare {count} modifiche a {files} file?',
  'cli.aborted': 'Annullato.',
  'target.node': 'Node {version} differisce dal target del repository {target}',
  'target.stack': '{stack} {version} differisce dal target del repository {target}',
  'target.repository':
    'Il più recente {stack} già nel repository: {version} ({project}); upgrade allinea gli altri',
  'upgrade.title': 'Piano di migrazione (predefinito: progetto esistente più recente)',
  'upgrade.fixProject': 'Migrare a {version} e allineare lo stack',
  'upgrade.fixPolicy': 'Salvare target, profili e gruppi comuni del repository',
  'upgrade.order': 'Ordine di compilazione: {projects}',
  'upgrade.blocked': '{count} blocchi richiedono modifiche prima di applicare la migrazione.',
  'upgrade.noProjects': 'Nessun progetto selezionato da migrare.',
  'upgrade.jsonReadOnly':
    '--json mostra un piano senza scritture; usare --apply senza --json per applicarlo.',
  'upgrade.nodeMissing':
    'Node {version} non è installato; installarlo prima di eseguire npm o verificare le build.',
  'upgrade.nodeIncompatible': 'Nessun Node comune soddisfa tutti gli stack target: {ranges}',
  'upgrade.unknownVersion': 'Impossibile determinare la versione esistente di {stack}.',
  'upgrade.unknownSpfx': 'SPFx {version} non ha dati di migrazione verificati.',
  'upgrade.downgrade':
    'Questo ridurrebbe {from} a {to}; scegliere il progetto esistente più recente.',
  'upgrade.linked': '{project} è già collegato; scollegarlo prima di cambiare le dipendenze.',
  'upgrade.controls':
    '{name}@{version} è compilato per SPFx {built}; nessuna versione verificata selezionata per {target}.',
  'upgrade.platform': "L'ambiente SharePoint {environment} non supporta SPFx {version}.",
  'upgrade.reactApi':
    'React {version} richiede la migrazione di ReactDom.render/unmount alla root API nel codice.',
  'upgrade.pnpMajor': 'PnPjs {from} -> {to}: verificare le API e la build.',
  'upgrade.pnpAsyncTarget':
    'Con target {target} in tsconfig `for await` sulle query PnPjs non compila (TS2495): portare target a ES2018+ oppure impostare downlevelIteration (aggiungendo lib es2018.asynciterable se Symbol.asyncIterator non è noto).',
  'upgrade.pnpApi':
    'Il codice usa API/import PnPjs rimossi; migrare getAll/getPaged/Graph paged agli iteratori asincroni e sostituire common/odata.',
  'upgrade.customGulp':
    '{file} contiene task Gulp personalizzati; portarli a Heft prima di applicare.',
  'upgrade.customScript': 'Lo script {name} richiede un equivalente Heft manuale: {command}',
  'upgrade.customEslint':
    '{file} contiene impostazioni ESLint legacy personalizzate; migrarle alla configurazione flat prima di applicare.',
  'upgrade.customSass':
    'Le opzioni personalizzate di config/sass.json richiedono la mappatura allo schema Heft Sass.',
  'upgrade.packageVersion':
    'Nessuna versione verificata di {name} compatibile con {range} nei lock o nella cache; riprovare online.',
  'upgrade.frameworkReview':
    '{stack} {from} -> {to}: verificare codice/configurazioni ed eseguire la build.',
  'upgrade.profileConflict':
    'Il profilo {name} dichiara {dependency}@{spec}; il profilo generato imporrà {wanted}. Verificare il vecchio profilo.',
  'upgrade.cycle':
    'Il ciclo delle dipendenze locali include {project}; definire manualmente l’ordine di build.',
  'upgrade.noBuild': '{project} non ha uno script build/test per la verifica.',
  'upgrade.sharedNotice':
    'Una sola installazione condivisa; node_modules locali eliminati dopo il successo. Backup solo di manifest e lock.',
  'upgrade.sharedBlocked':
    'I progetti non formano un gruppo comune; verificare conflitti, script e percorsi locali o selezionare una famiglia.',
  'upgrade.sharedNpm':
    'La migrazione condivisa richiede lock npm; convertire prima i lock yarn/pnpm.',
};
