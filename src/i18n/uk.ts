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
  'spfx.upgradeAvailable': 'SPFx {version} можна оновити (остання {latest})',

  'react.typesMajor': '@types/react {types} не відповідає react {react}',
  'typescript.v7Api':
    'TypeScript {version} не має програмного API; ці інструменти досі потребують TypeScript 6',
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

  'security.packageVulns':
    'Вразливих пакетів: {count} (прямих {direct}, у мережевому коді {network})',
  'security.nodeVuln': 'Node {version}: відомих вразливостей {count} ({context})',

  'policy.pinViolation':
    'Група "{group}": {name} має бути {version} (відрізняється в {count} проєктах)',
  'policy.groupDivergence': 'Група "{group}": {name} має {count} версій, вирівняти до {target}',
  'policy.nodeFragmentation': 'Проєкти потребують {count} різних гілок Node',

  'constraint.package': '{name} {version} не задовольняє {range}, якого вимагає {source}',

  'fix.syncYoRc': 'Оновити .yo-rc.json до {version}',
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
  'tui.storeLinked': 'привʼязано {count}/{total}',
  'tui.storeHint':
    'Привʼязати: packman store link -g {key} --union (встановлює, потім замінює node_modules)',
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
  'store.none': 'Поки жодна група ідентичних проєктів не може мати спільну установку.',
  'store.groupNotFound': 'Групу {group} не знайдено; запустіть `packman store plan`.',
  'store.linkPlan': '{count} проєктів матимуть одну установку, зібрану з Node {node}:',
  'store.confirmLink': 'Встановити сховище і привʼязати ці проєкти?',
  'store.linked': 'Привʼязано проєктів: {count} до {dir}',
  'store.unlinked':
    'Прибрано посилань: {count}, відновлено маніфести/lock: {restored}; виконайте install для локальної установки',
  'store.noLinks': 'Привʼязаних проєктів немає.',
  'store.alignFirst': 'спершу вирівняйте: {packages}',
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
  'install.linkedSkipped': 'привʼязано до сховища, пропущено',
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
};
