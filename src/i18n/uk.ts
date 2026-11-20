import type { Catalogue } from './en.js';

export const uk: Catalogue = {
  'report.title': 'Звіт packman',
  'report.workspace': 'Робочий простір',
  'report.projects': 'Проєкти',
  'report.groups': 'Групи версій',
  'report.baseline': 'база',
  'report.findings': 'Знахідки',
  'report.workspaceFindings': 'Знахідки робочого простору',
  'report.noFindings': 'Знахідок немає.',
  'report.node': 'Node',
  'report.nodeSelected': 'встановлено {version} ({manager})',
  'report.nodeNone': 'жодна встановлена версія не підходить',
  'report.nodeRecommended': 'рекомендовано {version}',
  'report.stacks': 'Стеки',
  'report.exposure': 'Виконується',
  'report.network': 'Мережеві виклики',
  'report.fixes': 'Виправлення',
  'report.summary':
    'критичних {critical}, помилок {error}, попереджень {warning}, інформаційних {info}',
  'report.dataStale': '(даним {days} днів: packman data update)',
  'report.data':
    'Дані: матриця SPFx {spfx}, розклад Node {node}, CVE Node {nodeVulns}, npm advisories {advisories}',
  'report.advisoriesSkipped': 'не перевірено ({reason})',
  'report.installedNodes': 'Встановлені версії Node',
  'exposure.browser': 'у браузері',
  'exposure.server': 'на сервері',
  'exposure.build': 'лише на машині збірки',
  'exposure.unknown': 'невідомо',
  'severity.critical': 'критично',
  'severity.error': 'помилка',
  'severity.warning': 'попередження',
  'severity.info': 'інфо',

  'npm.rangeSpec': '{count} залежностей задано діапазоном замість точної версії',
  'npm.prereleaseSpec': 'У залежностях є pre-release, nightly або canary версії',
  'npm.unboundedSpec': 'Необмежені версії (*, latest) роблять установку непередбачуваною',
  'npm.lockfileMissing': 'Немає lock-файлу: установка не відтворювана',
  'npm.lockfileV1': 'Lock-файл v1 (npm 5-6): перегенеруйте npm 7+ для повних метаданих',
  'npm.treeBroken':
    '{count} пакетів у lock-файлі отримують залежність поза своїм діапазоном: під час роботи завантажать не ту копію',
  'npm.treePeer': '{count} peer-вимог вкладених пакетів не задоволено деревом lock-файлу',
  'verified.recorded':
    'Збережено перевірені набори: {projects} проєктів, {stores} спільних сховищ (.packman/verified).',
  'npm.unverifiedVersions':
    '{count} версій у lock-файлі відрізняються від набору, з яким {script} пройшов ({date}): не перевірені збіркою',
  'npm.lockfileDrift': 'Lock-файл не відповідає package.json ({count} пакетів)',
  'npm.notInstalled': 'Залежності не встановлені',
  'npm.installedDrift': 'Встановлені пакети відрізняються від package.json ({count})',
  'npm.familyMismatch': 'Пакети родини "{family}" не вирівняні ({policy})',
  'npm.peerUnsatisfied': 'Не виконано {count} вимог peer-залежностей',
  'npm.deprecated': '{count} прямих залежностей позначено як deprecated',
  'npm.duplicateMajors':
    '{count} пакетів, що мають бути в одному екземплярі, встановлено в кількох версіях',
  'npm.duplicateDeclaration': '{count} пакетів оголошено в кількох секціях',
  'npm.undeclaredImport': '{count} пакетів імпортуються, але не оголошені в package.json',
  'npm.unusedDependency': '{count} залежностей оголошено, але ніде не імпортовано',

  'spfx.versionUnknown': 'SPFx знайдено, але його версію визначити не вдалося',
  'spfx.yoRcMismatch': '.yo-rc.json вказує генератор {generator}, а пакети вказують SPFx {version}',
  'spfx.notInMatrix': 'SPFx {version} немає в матриці сумісності',
  'spfx.withdrawn': 'SPFx {version} відкликано Microsoft',
  'spfx.prerelease': 'Pre-release пакети SPFx не можна випускати в production: {packages}',
  'spfx.lockstepMismatch':
    '{count} пакетів SPFx не на версії {version} (runtime і build мають збігатися)',
  'spfx.lockstepRange':
    '{count} пакетів SPFx задано діапазоном; пакети SPFx {version} мають бути точними',
  'spfx.toolchainMixed': 'Налаштовано одночасно gulp і Heft',
  'spfx.gulpUnsupported': 'SPFx {version} не підтримує тулчейн gulp',
  'spfx.heftTooEarly': 'Heft на SPFx {version}; Heft підтримується з 1.22.0',
  'spfx.compilerMismatch': 'SPFx {version} очікує {expected}, знайдено {actual}',
  'spfx.typescriptCompilerMismatch':
    'Оголошено typescript {typescript}, але компілятор збирає TypeScript {compilerTs}',
  'spfx.compilerWithHeft': 'rush-stack-compiler не використовується тулчейном Heft',
  'spfx.typescriptMismatch': 'typescript {actual} не відповідає очікуваному {expected}',
  'spfx.reactMismatch': 'SPFx {version} вимагає React рівно {react}',
  'spfx.typesReactMismatch': '@types/react не відповідає major-версії React для SPFx {version}',
  'spfx.libraryNewer':
    '{library} {version} зібрано під SPFx {target}, новішу за SPFx проєкту {spfx} (використайте {suggested})',
  'spfx.libraryOlder':
    '{library} {version} зібрано під SPFx {target}, проєкт на SPFx {spfx} (розгляньте {suggested})',
  'spfx.pnpjsMajor':
    'PnPjs v{major} не рекомендована для SPFx {spfx} (рекомендовано v{recommended})',
  'spfx.upgradeAvailable': 'SPFx {version} можна оновити (остання перевірена {latest})',
  'spfx.upgradeAvailableUnverified':
    'SPFx {version} можна оновити (npm latest {npm}, ще не перевірена; остання перевірена {latest})',
  'spfx.unverifiedPatch':
    'SPFx {version} новіша за перевірену матрицю ({verifiedAt}): припущено обмеження {base}, ще не перевірено',

  'react.typesMajor': '@types/react {types} не відповідає react {react}',
  'typescript.v7Api':
    'TypeScript {version} не має програмного API; ці інструменти досі потребують TypeScript 6',
  'eslint.unknownRule':
    '{file} задає {count} правил, яких немає в @typescript-eslint/eslint-plugin {version}: кожен файл їх показує, а збірки --ship падають',
  'eslint.unknownRuleSuppressed':
    '{file} задає {count} правил, яких немає в @typescript-eslint/eslint-plugin {version}: кожен файл їх показує (gulpfile придушує попередження, тож збірки проходять)',
  'eslint.caughtErrors':
    '{file}: @typescript-eslint/no-unused-vars без caughtErrors перевіряє змінні catch у плагіні {version} (типове значення змінилось з none на all)',
  'fix.migrateRules': 'Перенести прибрані правила в {file} на правила, що їх замінили',
  'fix.keepCaughtErrors': 'Не перевіряти змінні catch у {file} (caughtErrors: none)',
  'eslint.legacyIgnored': 'ESLint {version} ігнорує {file}; перейдіть на eslint.config.js',

  'node.pinConflict': 'Закріплення Node {pin} ({file}) суперечить {range}, якого вимагає {source}',
  'node.enginesMissing': 'Немає engines.node; стек вимагає {range}',
  'node.enginesConflict': 'engines.node {engines} виключає {range}, якого вимагає {source}',
  'node.enginesTooWide':
    'engines.node {engines} допускає версії поза {range}, якого вимагає {source}',
  'node.notInstalled':
    'Жоден встановлений Node не задовольняє {ranges} (рекомендовано {recommended})',
  'node.eol': 'Підтримку Node {version} завершено {end} (рекомендовано {recommended})',
  'node.patchedAvailable':
    'Node {version} має відомі вразливості; {recommended} виправлений і сумісний',
  'node.eolNotAssessed': 'EOL: відомих CVE {count}, новіші не оцінюються і не виправляються',

  'remediation.unknown': 'немає даних registry для пакета (offline без кешу): план невідомий',
  'remediation.noFix':
    'виправленої версії {package} після {version} не опубліковано: оновленням не усувається; приберіть або замініть пакет, що його тягне',
  'remediation.blockedDirect':
    'виправлена {target} поза межами, які дозволяє стек ({sources}): усувається лише зміною цілі стека',
  'remediation.parentBlocked':
    'реліз батьківського пакета з виправленою версією ({parent}) заблокований: {sources}',
  'remediation.majorBlockedByStack':
    'виправлено лише в {target}, новій major; {root} зафіксований {source}: у цьому стеку не усувається',
  'remediation.peerBlocked': 'виправлену {target} відкидають peer-діапазони ({peers})',
  'remediation.notNpm':
    '{package} потребує override, а packman пише їх лише для npm lockfile (lockfile: {kind})',
  'remediation.override':
    'залежні пакети ({dependents}) оголошують діапазони без виправленої версії: npm overrides примусово ставлять її в межах тієї ж major',
  'remediation.overrideMajor':
    'залежні пакети ({dependents}) оголошують діапазони без виправленої версії, а {target} є новою major: override може їх зламати',
  'remediation.overrideUnderStack':
    'примусово під {root} ({source}): стек тримає батьківський пакет, тож override змінює код, який постачає стек; перевірте збірку',
  'remediation.relock':
    'усі залежні пакети вже дозволяють {package}@{target}; lockfile тримає вразливу версію, доки її не зафіксовано і lock не перегенеровано',
  'remediation.relockManual':
    'усі залежні пакети вже дозволяють {package}@{target}: оновіть lockfile (npm update {package})',
  'remediation.noChain':
    'жоден пакет lockfile не вимагає {package} (зайва копія): перевстановіть або перегенеруйте lock, щоб її прибрати',
  'remediation.direct': 'оголошена залежність: оновити до {package}@{target}',
  'remediation.parent':
    'оновити оголошений батьківський пакет ({parents}) до релізу, що вимагає виправлену версію',
  'audit.planTitle': 'План усунення ({count} вразливих пакетів)',
  'audit.planSummary':
    'план: {fixable} з виправленням, з них {relock} через relock, {blocked} заблоковано стеком або peer, {noFix} без виправленої версії, {unknown} невідомо',
  'audit.buildNote':
    'Успішна збірка їх не усуває: вразливий код і далі встановлений або постачається.',
  'security.packageVulns':
    'Вразливих пакетів: {count} (прямих {direct}, у мережевому коді {network})',
  'security.nodeVuln': 'Node {version}: відомих вразливостей {count} ({context})',

  'policy.pinViolation':
    'Група "{group}": {name} має бути {version} (відрізняється в {count} проєктах)',
  'policy.groupDivergence': 'Група "{group}": {name} має {count} версій, вирівняти до {target}',
  'policy.nodeFragmentation': 'Проєкти потребують {count} різних гілок Node',

  'constraint.package': '{name} {version} не задовольняє {range}, якого вимагає {source}',

  // API breaks
  'api.oldUsage':
    '{package} визначено як {version}, але {count} місць досі використовують API версій до {since} ({title})',
  'api.newUsage':
    '{package} визначено як {version}, але {count} місць використовують API, що зʼявилось у {since} ({title})',
  'api.split':
    '{package}: {old} проєктів нижче {since} і {new} на новішому боці; {work} ще використовують старий API і потребують змін у коді, щоб зійтися',
  'api.fixBreaks':
    '{count} змін версій перетинають задокументований розрив API; код нижче треба змінити разом із ними:',
  'upgrade.apiMigration':
    '{package} {from} -> {to}: {count} місць використовують API версії, яку покидаєте; див. потрібні зміни коду нижче.',
  'upgrade.codeChanges': 'Потрібні зміни коду:',
  'compat.title': '{package} у {project}',
  'compat.current': 'поточна: {evidence}; у {section}',
  'compat.notDeclared': 'поточна: не оголошено в цьому проєкті',
  'versions.source.declared': 'оголошена',
  'versions.source.locked': 'у lock-файлі',
  'versions.source.installed': 'встановлена',
  'versions.summary': 'найновіша {latest}, найчастіша {version} ({count}/{total})',
  'versions.none': 'немає',
  'versions.unknown': 'невідомо в {count}/{total} ({reason})',
  'versions.noLockfile': 'без lock-файлу',
  'versions.noModules': 'без node_modules',
  'versions.drift': 'оголошені версії і версії з lock-файлу розходяться',
  'compat.target': 'ціль: {version}',
  'compat.constraints': 'Діапазони стеку',
  'compat.peers': 'Peer-діапазони пакетів із lock-файлу',
  'compat.engines': 'Node:',
  'compat.breaks': 'Розриви API між поточною і цільовою',
  'compat.breaksAhead': 'Розриви API попереду поточної версії',
  'compat.none': 'немає',
  'compat.path': 'Шлях: {path}',
  'compat.needProject':
    'compat дивиться на один проєкт; -p вибрав {count}: {projects}. Вкажіть -p <id або glob>, що вибирає рівно один.',
  'upgrade.noOldApi': 'у просканованих джерелах не знайдено відомого використання старого API',

  'fix.syncYoRc': 'Оновити .yo-rc.json до {version}',
  'fix.securityRemediation': 'Усунути {package}: виправлена {target} ({status})',
  'fix.alignSpfxPackages': 'Встановити всі пакети SPFx на {version}',
  'fix.replaceCompiler': 'Використати {compiler}',
  'fix.removeCompiler': 'Прибрати rush-stack-compiler',
  'fix.setVersion': 'Встановити {name} на {version}',
  'fix.pinReact': 'Закріпити react і react-dom на {react}',
  'fix.alignTypesReact': 'Вирівняти @types/react і @types/react-dom',
  'fix.pinInstalled': 'Закріпити діапазони на встановлених версіях',
  'fix.alignFamily': 'Вирівняти родину {family} до {version}',
  'fix.declareImports': 'Оголосити імпортовані пакети із заблокованою версією',
  'fix.removeUnused': 'Прибрати невикористані залежності',
  'fix.setEngines': 'Встановити engines.node на {range}',
  'fix.updatePin': 'Записати {version} у {file}',
  'fix.alignGroup': 'Вирівняти {name} до {version}',

  'tui.tab.overview': 'Огляд',
  'tui.tab.projects': 'Проєкти',
  'tui.tab.versions': 'Версії',
  'tui.tab.node': 'Node',
  'tui.tab.outdated': 'Застарілі',
  'tui.tab.store': 'Сховище',
  'tui.key.profiles': 'профілі',
  'tui.nothingToChange': 'Для цього рядка нічого змінювати.',
  'tui.noProfileFixes': 'Немає відхилень від профілів (профілі в packman.config.json).',
  'tui.profilesSelected': 'Вибрано {count} виправлень профілів: перегляньте їх у Виправленнях.',
  'tui.profilesCleared': 'Знято вибір з {count} виправлень профілів.',
  'tui.outdatedLoading': 'Запит до npm-реєстру…',
  'tui.outdatedUnavailable': 'Запит до реєстру тут недоступний: запустіть packman outdated.',
  'tui.inMajor': 'найновіша в major',
  'tui.bumpBlocked': '{version} не дозволена: {reason}',
  'tui.key.addRemove': 'додати/видалити пакет',
  'tui.key.build': 'збірка',
  'tui.key.sync': 'sync',
  'tui.job.pickProject':
    'Спершу виберіть проєкт на вкладці Проєкти (+ додати, - видалити, b збірка).',
  'tui.job.unavailable': 'Керовані операції тут недоступні: використайте команди CLI.',
  'tui.job.planning': 'Планування… поки нічого не записується.',
  'tui.job.back': 'Esc: назад',
  'tui.job.blocked': 'Запустити не можна: спершу виправте позначене !. Esc: назад',
  'tui.job.confirm':
    'Запустити? y запускає (Esc або Ctrl+C скасовує під час роботи, sync відкочує), Esc повертає назад',
  'tui.job.anyKey': 'Натисніть будь-яку клавішу, щоб повернутися до TUI.',
  'tui.job.running': 'Виконується поза TUI; Esc або Ctrl+C скасовує поточний крок.',
  'tui.job.exit': 'код виходу {code}: {state}',
  'tui.job.cancelled': 'скасовано',
  'tui.job.done': 'готово',
  'tui.job.failed': 'не вдалося',
  'tui.job.remaining':
    'Лишилось: {counts}; безпечних виправлень {fixes}, застарілих привʼязаних проєктів {stale}',
  'tui.job.needInput': 'Вкажіть хоча б один пакет і проєкт.',
  'tui.job.scopeInstall': '{project}: npm install з Node {node}',
  'tui.job.scopeNoGroup':
    '{project}: привʼязаний, але жодна група store не підходить; store не перебудовується',
  'tui.job.scopeStore': 'store {key} перебудовується і перепривʼязується для {projects}',
  'tui.job.scopeFiles': 'змінюється файлів: {count}',
  'tui.job.scopeBuild': '{project}: npm run {script} з Node {node}',
  'tui.job.scopeProjects': 'змінені проєкти: {projects}',
  'tui.job.scopeSyncPasses':
    'далі заміни store, збірки й нові проходи до стабільності та фінальна перевірка',
  'tui.job.prompt.add':
    'Додати до {project} (назва або назва@діапазон через пробіл; Enter планує, Esc скасовує):',
  'tui.job.prompt.remove': 'Видалити з {project} (назви; Enter планує, Esc скасовує):',
  'tui.job.title.add': 'Додати {packages} до {project}',
  'tui.job.title.remove': 'Видалити {packages} з {project}',
  'tui.job.title.build': 'Збірка {project} (npm run {script})',
  'tui.job.title.sync': 'Sync: безпечні виправлення, заміни store, збірки, фінальна перевірка',
  'tui.storeLinked': 'привʼязано {count}/{total}',
  'tui.storeHint':
    'Привʼязати: packman store link -g {key} --union (встановлює, потім замінює node_modules); змінити привʼязаний проєкт: packman add <pkg> -p <проєкт>',
  'tui.storeOthers':
    '{candidates} груп спершу треба вирівняти, {excluded} проєктів виключено: packman store plan',
  'fix.bumpInMajor': 'Оновити {name} до {version}',
  'tui.tab.fixes': 'Виправлення',
  'tui.minSeverity': 'показано {severity} і серйозніше',
  'tui.key.move': 'рух',
  'tui.key.tabs': 'вкладки',
  'tui.key.open': 'відкрити',
  'tui.key.back': 'назад',
  'tui.key.select': 'вибрати виправлення',
  'tui.key.severity': 'рівень',
  'tui.key.apply': 'застосувати',
  'tui.key.reload': 'оновити',
  'tui.key.quit': 'вихід',
  'tui.nodeUsers': 'проєктів: {count}',
  'tui.noSelection': 'Виправлення не вибрано: натисніть пробіл на знахідці з виправленням.',
  'sp.fromTest': 'Враховано запити, записані прогоном {run}.',
  'sp.propertySteps':
    'властивості: {steps} змін на {controls} контролах, {failed} зламали web part',
  'sp.propertySkipped': 'не перевірено: {controls}',
  'sp.propertyPaneClosed': 'властивості: панель властивостей не відкрилась, нічого не перевірено',
  'sp.noSite': 'Немає сайту SharePoint: передайте --site або задайте "site" у {file}.',
  'sp.signIn': 'Увійдіть у {site} у браузері, який відкрив packman; чекаю...',
  'sp.written': '{file} оновлено: типи колонок, варіанти й записи допишіть вручну.',
  'sp.upToDate': 'На сайті вже є все з фікстур.',
  'sp.dryRun': 'Пробний прогін: нічого не записано. Додайте --apply, щоб створити.',
  'sp.confirmSeed': 'Створити {count} списків, колонок, записів і файлів на {site}?',
  'sp.confirmClean': 'Видалити те, що packman створив на {site}?',
  'sp.noGulp': 'у проєкті не встановлено ні gulp, ні heft',
  'store.linkStale':
    'package.json змінився після привʼязки; у спільному сховищі ще немає нових версій',
  'store.linkDrift':
    'node_modules більше не відповідає спільному сховищу: у привʼязаному проєкті запускали npm',
  'store.driftMissing': 'бракує: {packages}',
  'store.driftReplaced': 'справжні копії замість лінків: {packages}',
  'store.driftExtra': 'не зі сховища: {packages}',
  'store.driftHint':
    'Не запускайте npm у привʼязаних проєктах. Оголосіть пакети в package.json, потім packman store plan --union і packman store link; повторна привʼязка переносить копії npm у .packman/trash.',
  'store.trashed':
    '{project}: копії npm перенесено в .packman/trash перед повторною привʼязкою: {packages}',
  'store.needGroup': 'Вкажіть --group <ключ> або --of <проєкт>.',
  'hooks.installed': 'хук додано: {file}',
  'hooks.foreign':
    'не змінено, цей хук написав не packman: {file}. Додайте в нього packman store status --check вручну.',
  'hooks.removed': 'хук прибрано: {file}',
  'spfx.tsconfigCompiler': 'tsconfig.json розширює {extends}, але проєкт збирається з {expected}',
  'fix.tsconfigExtends': 'Перевести extends у tsconfig.json на {compiler}',
  'store.none': 'Поки жодна група ідентичних проєктів не може мати спільну установку.',
  'store.groupNotFound': 'Групу {group} не знайдено; запустіть `packman store plan`.',
  'store.linkPlan': '{count} проєктів матимуть одну установку, зібрану з Node {node}:',
  'store.confirmLink': 'Встановити сховище і привʼязати ці проєкти?',
  'store.linked': 'Привʼязано проєктів: {count} до {dir}',
  'store.unlinked':
    'Прибрано посилань: {count}, відновлено маніфести/lock: {restored}; виконайте install для локальної установки',
  'store.noLinks': 'Привʼязаних проєктів немає.',
  'store.alignFirst': 'спершу вирівняйте: {packages}',
  'store.alignOrder':
    'порядок: `packman check`, потім `packman fix --apply`, потім `packman align --package <назва>`: fix оновлює пакети, чиї peer-діапазони відкинули б найпоширенішу версію',
  'init.exists': '{file} вже існує; використайте --force, щоб перезаписати.',
  'init.created': 'Створено {file}',
  'profile.versions': '{count} залежностей відрізняються від профілю {profile}',
  'profile.misplaced': '{count} залежностей у неправильній секції для профілю {profile}',
  'profile.missing': 'Бракує {count} залежностей, яких вимагає профіль {profile}',
  'profile.deprecated': '{count} застарілих залежностей із профілю {profile} досі оголошені',
  'profile.scripts': '{count} скриптів відрізняються від профілю {profile}',
  'profile.engines': '{count} engines відрізняються від профілю {profile}',
  'profile.overrides': '{count} overrides відрізняються від профілю {profile}',
  'profile.tsconfig': '{count} налаштувань tsconfig.json відрізняються від профілю {profile}',
  'profile.tsconfigInvalid': 'tsconfig.json не вдається розібрати',
  'fix.applyProfile': 'Застосувати профіль {profile}',
  'npm.unusedDevDependency':
    '{count} devDependencies не використовуються ні кодом, ні конфігами, ні скриптами',
  'spfx.unusedRuntime':
    '{count} runtime-пакетів SPFx оголошено, але не імпортовано (залишки шаблону)',
  'fix.mergeDuplicates': 'Залишити одне оголошення з найвищою версією',
  'spfx.tslintLeftover': 'Залишився tslint.json: SPFx {version} перевіряється ESLint',
  'fix.deleteFile': 'Видалити {file}',
  'spfx.coreMissing':
    'Не оголошено {count} пакетів, обовʼязкових для SPFx {version} (від них залежить збірка або виконання)',
  'fix.addCore': 'Додати пакети ядра SPFx {version}',
  'spfx.coreTransitive':
    '{count} пакетів, обовʼязкових для SPFx {version}, присутні лише як залежності інших пакетів; оголосіть їх',
  'spfx.coreUnverified':
    'Немає lock-файлу і node_modules: {count} обовʼязкових для SPFx {version} пакетів не оголошено, перевірити їх неможливо',
  'install.confirm': 'Запустити npm у {count} проєктах?',
  'clean.nothing': 'Нічого чистити.',
  'clean.confirm': 'Видалити {count} елементів?',
  'clean.done': 'Видалено елементів: {count}',
  'reinstall.confirm': 'Очистити й перевстановити {count} проєктів?',
  'update.noProfiles':
    'У packman.config.json немає профілів: створіть його через `packman profile generate --name <імʼя> --write`.',
  'profile.notWritten': 'Не записано: додайте --write, щоб зберегти в packman.config.json.',
  'store.seeded':
    'Розвʼязка від перевіреного набору {date} (Node {node}); --refresh розвʼязує заново.',
  'store.unverified':
    '{count} версій відрізняються від перевіреного набору і ще не перевірені збіркою:',
  'install.drift':
    '{project}: package-lock.json не відповідає package.json; запустіть packman relock і перегляньте зміни (інакше npm сам вибере версії).',
  'store.peers': '{count} peer-вимог не задоволено версіями групи; виправте їх у проєктах:',
  'cli.notANumber': '{value} не є цілим числом від 0.',
  'data.usingUpdated': 'використовується оновлена копія',
  'data.usingBundled': 'використовується вбудована копія',
  'data.spfxStatus':
    'SPFx: остання перевірена {verified} (матриця {verifiedAt}), npm latest {npm} ({source}); опубліковані, ще не перевірені: {unverified}',
  'data.dir': 'Тека оновлених даних: {dir}',
  'data.file': '{name}: {before} -> {after}',
  'data.noChanges': 'без змін',
  'data.notWritten': 'Не записано: запустіть без --dry-run, щоб зберегти оновлені дані.',
  'data.written': 'Збережено в {dir}; вбудовані файли не змінено.',
  'profile.tsconfigSource': 'tsconfig.json взято з {project}',
  'profile.tsconfigSourceMissing':
    'Немає читабельного tsconfig.json для {project} (id проєкту або latest-ts) {reason}',
  'profile.written': 'Профіль {name} записано в {file}',
  'align.package': 'Вирівнювання {name} до {version}',
  'align.peers':
    '{count} peer-діапазонів виключають {name}@{version}; спершу виконайте `packman fix --apply`, він оновлює пакети, що їх оголошують:',
  'align.unknownProject': 'Невідомий проєкт {project}',
  'align.closest': 'Проєкти з найбільшою кількістю спільних версій із {project}:',
  'align.usage':
    'Використайте --base <проєкт> [--to <проєкт>] або --package <назва> [--version <версія>].',
  'outdated.none': 'Усе актуально.',
  'list.total': 'Проєктів: {count}',
  'ignore.empty': '(порожньо)',
  'log.pruned': 'Видалено записів: {count}',
  'log.empty': 'Операцій не записано.',
  'fix.alignToProject': 'Вирівняти {base} за {target}',
  'cli.description':
    'Визначає стеки, перевіряє сумісність і вразливості, вирівнює версії в багатьох проєктах.',
  'cli.noProjects': 'У {root} проєктів не знайдено',
  'cli.dryRun': 'Пробний запуск: нічого не записано. Запустіть з --apply, щоб записати зміни.',
  'cli.applied': 'Змінено файлів: {count}. Резервні копії в {dir}',
  'cli.noFixes': 'Нічого виправляти.',
  'cli.confirm': 'Застосувати {count} змін у {files} файлах?',
  'cli.aborted': 'Скасовано.',
  'target.node': 'Node {version} відрізняється від цілі репозиторію {target}',
  'target.stack': '{stack} {version} відрізняється від цілі репозиторію {target}',
  'target.repository':
    'Найновіший {stack} у цьому репозиторії: {version} ({project}); upgrade вирівняє решту',
  'upgrade.title': 'План міграції репозиторію (типово: найновіший наявний проєкт)',
  'upgrade.fixProject': 'Перевести на {version} і вирівняти стек проєкту',
  'upgrade.fixPolicy': 'Зберегти цілі репозиторію, профілі й спільні групи',
  'upgrade.order': 'Порядок збірки: {projects}',
  'upgrade.blocked': 'Блокерів: {count}. Перед застосуванням міграції потрібні виправлення.',
  'upgrade.noProjects': 'Немає вибраних проєктів для міграції.',
  'upgrade.jsonReadOnly':
    '--json показує план без запису; для застосування використайте --apply без --json.',
  'upgrade.nodeMissing':
    'Node {version} не встановлено; встановіть його перед запуском npm або перевіркою збірки.',
  'upgrade.nodeIncompatible': 'Немає спільного Node для всіх цільових стеків: {ranges}',
  'upgrade.unknownVersion': 'Не вдалося визначити наявну версію {stack}.',
  'upgrade.unknownSpfx': 'Для SPFx {version} немає перевірених даних міграції.',
  'upgrade.spfxUnverified':
    'SPFx {version} опублікована в npm, але ще не перевірена в матриці ({verifiedAt}): план припускає обмеження {base}; прочитайте release notes перед застосуванням.',
  'upgrade.spfxNoTarget':
    'Жоден відомий packman опублікований реліз SPFx не відповідає {to} (перевірена матриця {verifiedAt}). Найближча перевірена версія: {nearest}.',
  'upgrade.spfxUnconfirmed':
    'SPFx {to} немає в перевіреній матриці ({verifiedAt}), і npm registry не зміг її підтвердити (offline?). Найближча перевірена версія: {nearest}; повторіть онлайн, щоб спланувати {to} як ще не перевірений patch.',
  'upgrade.downgrade': 'Це понизить {from} до {to}; виберіть найновіший наявний проєкт.',
  'upgrade.linked': '{project} уже підʼєднано; перед зміною залежностей відʼєднайте його.',
  'upgrade.controls':
    '{name}@{version} розраховано на SPFx {built}; не вибрано перевіреної сумісної версії для {target}.',
  'upgrade.platform': 'Середовище SharePoint {environment} не підтримує SPFx {version}.',
  'upgrade.reactApi':
    'Для React {version} треба перевести ReactDom.render/unmount у коді на root API.',
  'upgrade.pnpMajor': 'PnPjs {from} -> {to}: перевірте зміни API й збірку.',
  'upgrade.pnpAsyncTarget':
    'З target {target} у tsconfig `for await` по запитах PnPjs не компілюється (TS2495): підніміть target до ES2018+ або увімкніть downlevelIteration (додавши lib es2018.asynciterable, якщо Symbol.asyncIterator невідомий).',
  'upgrade.pnpApi':
    'Код використовує прибрані API/імпорти PnPjs; замініть getAll/getPaged/Graph paged на async iterator та імпорти common/odata.',
  'upgrade.customGulp':
    '{file} містить власні задачі Gulp; перед застосуванням перенесіть їх у Heft.',
  'upgrade.customScript': 'Скрипту {name} потрібен ручний еквівалент Heft: {command}',
  'upgrade.customEslint':
    '{file} має власні налаштування старого ESLint; перед застосуванням перенесіть їх у цільовий flat config.',
  'upgrade.customSass': 'Власні параметри config/sass.json треба перенести на схему Heft Sass.',
  'upgrade.packageVersion':
    'Немає перевіреної версії {name}, сумісної з {range}, у lock-файлах чи кеші; повторіть онлайн.',
  'upgrade.frameworkReview':
    '{stack} {from} -> {to}: перевірте зміни коду/конфігів і виконайте збірку.',
  'upgrade.profileConflict':
    'Профіль {name} задає {dependency}@{spec}; згенерований профіль задаватиме {wanted}. Перевірте старий профіль.',
  'upgrade.cycle':
    'Цикл залежностей локальних проєктів охоплює {project}; узгодьте порядок збірки.',
  'upgrade.noBuild': 'У {project} немає скрипту build/test для перевірки.',
  'upgrade.sharedNotice':
    'Одна спільна установка; локальні node_modules видаляться після успіху. Резервуються лише маніфести й lock-файли.',
  'upgrade.sharedBlocked':
    'Вибрані проєкти не утворюють одну спільну групу; перевірте конфлікти залежностей, скрипти й локальні шляхи або виберіть одне сімейство.',
  'upgrade.sharedNpm':
    'Спільна міграція потребує npm lock-файлів; спочатку перетворіть yarn/pnpm lock.',
  'fix.addPackage': 'Додати {name}@{version} у {project}',
  'fix.removePackages': 'Прибрати {count} пакетів із {project}',
  'add.plan': '{project}: {name}@{version} -> {section} ({source}: {detail})',
  'add.blocked':
    '{count} перевірок не пройшло; нічого не записано. Виправте їх або вкажіть версію явно.',
  'add.unknownProject': 'Жоден проєкт не відповідає {project}; передайте -p <id або glob>.',
  'add.notDeclared': '{project}: {name} не оголошено, нічого прибирати.',
  'add.linkedRebuild':
    '{project} привʼязано до спільного сховища: npm у проєкті не запускається; сховище групи {group} перебудовується і всі {count} учасників перелінковуються.',
  'add.linkedNoGroup':
    '{project} більше не вписується в спільну групу ({reason}); сховище не перебудовано. Варіанти: взяти версію групи, вирівняти пакет у всій групі (packman align --package <назва>) або packman store unlink -p {project} --restore і packman install.',
  'add.installing': '{project}: npm install (node {node})',
  'add.noInstall':
    'Маніфести записано; запустіть packman install (або packman store link --of <проєкт> --union для привʼязаних проєктів).',
  'add.stillUsed':
    '{project}: {name} ще використовується ({places}); видалення зламає збірку або інструменти.',
  'add.verifyUnlinked':
    '{project} має власні node_modules: --verify {script} стосується лише привʼязаних проєктів, нічого не запущено.',
  'install.refreshIgnored': '--refresh не діє без --sync-store.',
  'install.linkedStale':
    'привʼязано до сховища, package.json змінився: виконайте packman add/remove або packman store link --of {project} --union',
  'install.linkedOk':
    'привʼязано до сховища, актуально (packman add <pkg> -p {project}, щоб змінити)',
  'install.syncStore': 'перебудова сховища для {count} змінених привʼязаних проєктів',
  'sync.linkedHint':
    'привʼязано до сховища, package.json змінено: packman sync --apply перебудує сховище, перепривʼяже, збере і перевірить знову',
  'sync.cancelling': 'Скасування: зупиняю поточний крок npm, потім відновлюю попередній стан…',
  'sync.phasePreflight': 'Попередня перевірка: версії Node',
  'sync.phaseFix': 'Прохід {pass}/{max}: виправлення',
  'sync.phaseCheck': 'Фінальна перевірка',
  'sync.stepNode': 'перевірка Node',
  'sync.stepPass': 'прохід {pass}',
  'sync.stepCycle': 'прохід {pass}: виправлення затримано (цикл)',
  'sync.stepFix': 'прохід {pass}: виправлення записано',
  'sync.stepStore': 'прохід {pass}: сховище {project}',
  'sync.stepProject': 'прохід {pass}: встановлення і збірка {project}',
  'sync.stepCheck': 'фінальна перевірка',
  'sync.stable': 'дозволених виправлень не лишилось, застарілих привʼязаних проєктів немає',
  'sync.preview': '{fixes} виправлень, {groups} привʼязаних груп до перебудови (пробний прогін)',
  'sync.previewNext':
    'Пробний прогін: нічого не записано. З --apply кожен прохід записує виправлення, перемикає привʼязані сховища (підготовка, перепривʼязка, збірка; відкат за помилки) і перевіряє знову до стабільного стану.',
  'sync.wouldSwitch': 'сховище перебудовується і перемикається для: {projects}',
  'sync.notWritten': 'виправлення не записано (відхилено або помилка)',
  'sync.fixesApplied': '{count} виправлень у {files} файлах',
  'sync.noGroup': '{project} не має спільної групи з цими маніфестами ({reason})',
  'sync.switch.prepare':
    'Готую сховище {key} для {count} проєктів (поточні привʼязки працюють далі)',
  'sync.switch.switch': 'Перемикаю {count} проєктів на сховище {key}',
  'sync.switch.verify': 'Збираю {count} проєктів на сховищі {key}',
  'sync.switch.rollback': 'Відновлюю попередні привʼязки, маніфести і lock-файли',
  'sync.switched': '{count} проєктів на {dir}',
  'sync.rolledBack': '{phase}: помилка, попередній стан відновлено: {error}',
  'sync.switchFailed': '{phase}: помилка, стан лишено для аналізу: {error}',
  'sync.noNode': 'немає встановленого Node для {project}',
  'sync.nodeMissing':
    'Node {version} не встановлено (потрібен для {projects}). Підготуйте командою: {command}',
  'sync.nodePrepare': 'виконайте {command} або передайте --install-node',
  'sync.nodeStillMissing': 'Node {version} досі не знайдено',
  'sync.noFixesLeft': 'дозволених виправлень не лишилось',
  'sync.fixesLeft': 'лишилось {count} дозволених виправлень',
  'sync.notStable':
    'нестабільно після {passes} проходів: лишилось {count} дозволених виправлень, {stale} застарілих привʼязаних проєктів',
  'sync.summary': 'Підсумок',
  'sync.complete': 'Завершено.',
  'sync.incomplete':
    'Незавершено: крок завершився помилкою, був скасований або лишив роботу; див. вище.',
  'upgrade.linkedSwitch':
    'Привʼязана група: міграція готує нове сховище, перемикає всі {count} проєктів і відновлює попередні привʼязки, якщо крок не вдався (без unlink і без npm у проєктах).',
  'upgrade.linkedPartial':
    'Сховище вибраних привʼязаних проєктів використовують також {projects}; додайте їх (сховище перемикається цілим).',
  'upgrade.linkedMixed':
    '{projects} мають власні node_modules, а інші привʼязані; передайте --shared, щоб привʼязати і їх, або виберіть лише привʼязану групу через -p.',
  'upgrade.majorDowngradeKept':
    '{name} лишається {current}: запланована {wanted} ({reason}) знизила б major, а цільовий стек цього не вимагає. За потреби вирівняйте вручну.',
  'upgrade.majorDowngradeRequired':
    '{name} {current} -> {wanted} знижує major, бо цього вимагає {target}; перевірте зміни API (breaking).',
  'rollback.plan':
    'Останнє перемикання сховища ({at}): {count} проєктів з {from} назад на {to}; {files} файлів (маніфести, lock, змінені) відновлюються з його знімка.',
  'rollback.refused': 'Відкат не виконано: стан змінився після того перемикання (див. вище).',
  'rollback.confirm': 'Відновити попередні привʼязки і файли?',
  'rollback.done': '{count} проєктів знову на попередніх привʼязках.',
};
