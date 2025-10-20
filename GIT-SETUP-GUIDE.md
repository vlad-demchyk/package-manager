# 🚀 Custom Package Manager - Налаштування для Git

## 📋 Що це за проект

Custom Package Manager - це npm пакет для керування багатьма Node.js проектами в одній папці. Він автоматично аналізує папки з `package.json` та надає команди для встановлення, оновлення та очищення залежностей.

## 🎯 Основні можливості

- ✅ **Ручне налаштування** - інтерактивне меню під ваші потреби
- ✅ **Аналіз проектів** - автоматично знаходить папки з package.json
- ✅ **Керування залежностями** - встановлення, оновлення, очищення
- ✅ **Перевірка невикористаних залежностей** - depcheck функціональність
- ✅ **Cross-platform** - працює на Windows, macOS, Linux

## 🚀 Як завантажити на Git та використовувати

### 1. Підготовка до завантаження

```bash
# Переконайтеся, що всі файли готові
git status

# Додайте всі файли
git add .

# Зробіть коміт
git commit -m "Initial commit: Custom Package Manager npm package"

# Додайте remote origin (замініть на ваш URL)
git remote add origin https://github.com/yourusername/custom-packman.git

# Завантажте на Git
git push -u origin main
```

### 2. Оновіть package.json

Перед публікацією в npm оновіть наступні поля:

```json
{
  "name": "custom-packman",
  "author": "Your Name",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourusername/custom-packman.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/custom-packman/issues"
  },
  "homepage": "https://github.com/yourusername/custom-packman#readme"
}
```

### 3. Публікація в npm (опціонально)

```bash
# Увійдіть в npm
npm login

# Опублікуйте пакет
npm publish
```

## 📦 Як використовувати після завантаження

### Встановлення з Git

```bash
# В папці з вашими проектами
npm install git+https://github.com/yourusername/custom-packman.git
```

### Встановлення з npm (якщо опубліковано)

```bash
# В папці з вашими проектами
npm install custom-packman
```

### ⚠️ Важливо: Додайте postinstall hook

Для автоматичного встановлення після `npm install`, додайте в `package.json` вашого проекту:

```json
{
  "scripts": {
    "postinstall": "node node_modules/custom-packman/install.js"
  }
}
```

### Налаштування та використання

```bash
# Після npm install автоматично створюється папка package-manager/
# з усіма необхідними файлами та конфігурацією

# Використовуйте команди
packman update    # Оновлення конфігурацій
packman install   # Встановлення пакетів
packman depcheck  # Перевірка невикористаних залежностей
packman           # Інтерактивний режим
pm                # Короткий alias
```

## 📁 Структура після встановлення

```
your-projects-folder/
├── project1/                    # Ваші проекти
├── project2/
├── project3/
├── package-manager/             # Створюється автоматично
│   ├── scripts/                 # Основні скрипти
│   ├── docs/                    # Документація
│   ├── dependencies-config.js   # Конфігурація залежностей
│   ├── project-config.js        # Конфігурація проекту
│   └── README.md                # Документація
├── node_modules/
└── package.json
```

## 🔧 Процес встановлення

1. **Встановіть пакет** в папці з проектами
2. **Запустіть налаштування** - інтерактивне меню
3. **Налаштуйте проект** - виберіть метод фільтрації компонентів
4. **Готово!** - використовуйте команди packman/pm

## 📋 Команди

```bash
# Основні команди
packman update    # Оновлення конфігурацій
packman install   # Встановлення пакетів
packman depcheck  # Перевірка невикористаних залежностей
packman           # Інтерактивний режим

# Короткий alias
pm                # Те ж саме, що і packman
```

## 🎯 Переваги

- ✅ **Ручне налаштування** - інтерактивне меню під ваші потреби
- ✅ **Робота з кореню** - аналізує всі проекти в папці
- ✅ **Чиста структура** - всі файли менеджера в одній папці
- ✅ **Гнучкість** - працює з будь-якою кількістю проектів
- ✅ **Готовий до Git** - можна завантажити та використовувати

## 🎉 Результат

Тепер ваш package manager:
- ✅ **Працює з кореню** папки з проектами
- ✅ **Аналізує всі проекти** автоматично
- ✅ **Не засмічує** корінь проекту
- ✅ **Налаштовується** під ваші потреби
- ✅ **Готовий до Git** та публікації в npm

Ваш скрипт тепер готовий до завантаження на Git та використання! 🚀
