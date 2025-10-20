<!-- b7d84bb8-6ea3-4c11-bd70-8a3c4dbd025d 94ef13c7-179f-4ee2-9512-706eb27907f7 -->
# План: безпечний аналіз і видалення невикористовуваних залежностей

## Цілі

- Використати `npx depcheck --json` для базового аналізу.
- Додати «гальма безпеки»: зберігати залежності, потрібні для запуску/будівництва/конфігів.
- Інтерактивно підтверджувати видалення; підтримати `--yes` і `--dry-run`.
- Автоматично деінсталювати через npm з розділенням deps/devDeps.

## Файли

- РЕАЛІЗУВАТИ: `scripts/validation/depcheck.js` — CLI-модуль аналізу/видалення.
- ЧИТАТИ: `dependencies-config.js` (кастомні виключення якщо існує).
- ВИКОРИСТАТИ: `scripts/utils/logger.js` для виводу.
- (Опціонально) Додати npm-скрипт у `package.json`: `"depcheck:clean"`.

## Ключова логіка

1) Детекція «обов’язкових» залежностей (whitelist):

- На основі наявних файлів: `webpack.config.js`, `vite.config.*`, `babel`-конфіги, `jest.config.*`, `.eslintrc.*`, `vue.config.js`, `next.config.js`, `gulpfile.js`, `tsconfig.json`, тощо.
- На основі `package.json#scripts` (біни у скриптах: `vite`, `webpack`, `jest`, `next`, `react-scripts`, `vue-cli-service`, `gulp`, `ts-node`, тощо).
- На основі `dependencies-config.js` (списки keep/ignore).

2) Запуск `npx depcheck --json` з ігнором директорій: `node_modules`, `build`, `dist`, `out`, `.next`, `.nuxt`.

3) Постобробка результату:

- Об’єднати `unused.dependencies` і `unused.devDependencies`.
- Відфільтрувати whitelist (конфіги/скрипти/keep у конфігу).
- Додатково зберігати peer/optional deps.

4) Інтерактивність та безпечне видалення:

- Якщо без `--yes`: показати список, дозволити відмітити для видалення; підтримати `--dry-run`.
- Якщо `--yes`: видалити всі кандидати; `--dry-run` лише показує команди.
- Видаляти окремо для deps/devDeps: `npm uninstall <...>` або `npm uninstall -D <...>`.

## Інтерфейс CLI

- Нові підкоманди у `bin/pm.js`:
- `pm deps unused` — показати невикористовувані залежності (з фільтрами/whitelist).
- `pm deps prune` — видалити невикористовувані залежності (підтвердження/--yes/--dry-run).
- Прапорці: `--cwd`, `--yes`, `--dry-run`, `--json`, `--include-dev` (за замовчуванням так).
- Код виходу: 0 — немає кандидатів/успіх; 2 — помилка.

## Приклади викликів

- Аналіз без змін: `node scripts/validation/depcheck.js --dry-run`
- Автовидалення: `node scripts/validation/depcheck.js --yes`
- JSON-репорт: `node scripts/validation/depcheck.js --json --dry-run`

## Безпека

- Нічого не видаляти, якщо кандидат згадується у `scripts` або конфіг-файлах.
- Не торкатися `peerDependencies`/`optionalDependencies`.
- Якщо знайдено SPA-фреймворк (React/Vue/Next/Nuxt/Vite) — зберігати їх CLI/лоадери.

### To-dos

- [ ] Створити CLI у `scripts/validation/depcheck.js` з парсингом флагів
- [ ] Додати детекцію фреймворків і конфігів та формування whitelist
- [ ] Запустити `npx depcheck --json` і зібрати результат
- [ ] Відфільтрувати кандидати за whitelist, scripts, peer/optional
- [ ] Додати інтерактивність і виконати `npm uninstall` (+dry-run)
- [ ] Додати npm-скрипт `depcheck:clean` у package.json (опційно)