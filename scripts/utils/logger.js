#!/usr/bin/env node

/**
 * Shared Logger Module
 * Централізований модуль логування для всіх скриптів package-manager
 */

// Кольори для консолі
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// Глобальні налаштування логування
let verbose = false;
let silent = false;

/**
 * Встановлює режим verbose
 * @param {boolean} value - true для детального логування
 */
function setVerbose(value) {
  verbose = value;
}

/**
 * Встановлює режим silent
 * @param {boolean} value - true для приховування всіх повідомлень
 */
function setSilent(value) {
  silent = value;
}

/**
 * Перевіряє чи увімкнений verbose режим
 * @returns {boolean}
 */
function isVerbose() {
  return verbose;
}

/**
 * Перевіряє чи увімкнений silent режим
 * @returns {boolean}
 */
function isSilent() {
  return silent;
}

/**
 * Основна функція логування
 * @param {string} message - Повідомлення для виводу
 * @param {string} color - Колір повідомлення (опціонально)
 * @param {boolean} force - Примусово вивести навіть в silent режимі
 */
function log(message, color = null, force = false) {
  if (silent && !force) {
    return;
  }

  if (color && colors[color]) {
    console.log(`${colors[color]}${message}${colors.reset}`);
  } else {
    console.log(message);
  }
}

/**
 * Логування помилок (завжди червоним кольором)
 * @param {string} message - Повідомлення про помилку
 */
function error(message) {
  log(`❌ ${message}`, "red", true);
}

/**
 * Логування успішних операцій (завжди зеленим кольором)
 * @param {string} message - Повідомлення про успіх
 */
function success(message) {
  log(`✅ ${message}`, "green");
}

/**
 * Логування попереджень (завжди жовтим кольором)
 * @param {string} message - Повідомлення-попередження
 */
function warning(message) {
  log(`⚠️  ${message}`, "yellow");
}

/**
 * Логування інформації (завжди синім кольором)
 * @param {string} message - Інформаційне повідомлення
 */
function info(message) {
  log(`ℹ️  ${message}`, "blue");
}

/**
 * Логування процесів (завжди ціан кольором)
 * @param {string} message - Повідомлення про процес
 */
function process(message) {
  log(`🔧 ${message}`, "cyan");
}

/**
 * Детальне логування (тільки в verbose режимі)
 * @param {string} message - Детальне повідомлення
 * @param {string} color - Колір повідомлення (опціонально)
 */
function debug(message, color = "cyan") {
  if (verbose) {
    log(`   🔍 DEBUG: ${message}`, color);
  }
}

/**
 * Логування заголовків секцій
 * @param {string} message - Заголовок секції
 */
function section(message) {
  log(`\n📋 ${message}`, "bright");
}

/**
 * Логування кроків процесу
 * @param {string} message - Повідомлення про крок
 * @param {number} step - Номер кроку (опціонально)
 */
function step(message, step = null) {
  const prefix = step ? `${step}. ` : "";
  log(`${prefix}${message}`, "blue");
}

/**
 * Логування результатів
 * @param {string} message - Повідомлення про результат
 * @param {boolean} isSuccess - Чи успішний результат
 */
function result(message, isSuccess = true) {
  const color = isSuccess ? "green" : "red";
  const icon = isSuccess ? "✅" : "❌";
  log(`${icon} ${message}`, color);
}

/**
 * Логування списків
 * @param {Array} items - Масив елементів для виводу
 * @param {string} title - Заголовок списку (опціонально)
 * @param {string} color - Колір (опціонально)
 */
function list(items, title = null, color = "blue") {
  if (title) {
    log(`\n📝 ${title}:`, color);
  }

  items.forEach((item, index) => {
    log(`   ${index + 1}. ${item}`, color);
  });
}

/**
 * Логування прогресу
 * @param {string} message - Повідомлення про прогрес
 * @param {number} current - Поточний крок
 * @param {number} total - Загальна кількість кроків
 */
function progress(message, current, total) {
  const percentage = Math.round((current / total) * 100);
  log(`🔄 ${message} (${current}/${total} - ${percentage}%)`, "yellow");
}

/**
 * Логування з таймстампом
 * @param {string} message - Повідомлення
 * @param {string} color - Колір (опціонально)
 */
function timestamp(message, color = null) {
  const now = new Date().toISOString();
  log(`[${now}] ${message}`, color);
}

// Експорт всіх функцій
module.exports = {
  // Основні функції
  log,
  error,
  success,
  warning,
  info,
  process,
  debug,
  section,
  step,
  result,
  list,
  progress,
  timestamp,

  // Налаштування
  setVerbose,
  setSilent,
  isVerbose,
  isSilent,

  // Кольори (для зовнішнього використання)
  colors,
};
