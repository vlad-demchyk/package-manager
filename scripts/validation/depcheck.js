#!/usr/bin/env node

/**
 * Script per il controllo delle dipendenze non utilizzate
 * Versione conservativa e sicura per tutti i tipi di progetti
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

// Import shared logger
const logger = require("../utils/logger");

// Carica la configurazione del progetto dinamicamente
const projectRoot = process.cwd();
const projectConfig = require(path.join(
  projectRoot,
  "package-manager/project-config"
));

// Variabili globali per readline
let rl = null;

// Розширений аналіз конфігураційних файлів для різних типів проектів
function isReferencedInConfigFiles(componentPath, dependencyName) {
  try {
    // Розширений список конфігураційних файлів
    const configFiles = [
      // Next.js
      "next.config.js", "next.config.ts", "next.config.mjs",
      
      // Angular
      "angular.json", "ng-package.json", "angular-cli.json",
      
      // Vue/Nuxt
      "nuxt.config.js", "nuxt.config.ts", "vue.config.js", "vue.config.ts",
      
      // Vite
      "vite.config.js", "vite.config.ts", "vite.config.mjs",
      
      // Webpack
      "webpack.config.js", "webpack.config.ts", "webpack.config.mjs",
      "webpack.common.js", "webpack.dev.js", "webpack.prod.js",
      
      // Rollup
      "rollup.config.js", "rollup.config.ts", "rollup.config.mjs",
      
      // Gulp/Grunt
      "gulpfile.js", "gulpfile.ts", "gruntfile.js", "gruntfile.ts",
      
      // CSS/Tailwind/PostCSS
      "tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs",
      "postcss.config.js", "postcss.config.mjs", "postcss.config.cjs",
      
      // Babel
      "babel.config.js", "babel.config.json", "babel.config.cjs",
      ".babelrc", ".babelrc.js", ".babelrc.json",
      
      // ESLint
      ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yaml",
      "eslint.config.js", "eslint.config.mjs",
      
      // TypeScript
      "tsconfig.json", "jsconfig.json", "tsconfig.app.json", "tsconfig.lib.json",
      
      // Testing
      "jest.config.js", "jest.config.ts", "jest.config.mjs",
      "cypress.config.js", "cypress.config.ts",
      "playwright.config.js", "playwright.config.ts",
      "vitest.config.js", "vitest.config.ts",
      "karma.conf.js", "karma.conf.ts",
      
      // Svelte
      "svelte.config.js", "svelte.config.ts",
      
      // Storybook
      ".storybook/main.js", ".storybook/main.ts",
      
      // Package.json
      "package.json",
      
      // Environment files
      ".env", ".env.local", ".env.development", ".env.production",
      
      // Other configs
      "nodemon.json", "nodemon.config.js",
      "prettier.config.js", "prettier.config.json",
      "stylelint.config.js", "stylelint.config.json"
    ];

    for (const fileName of configFiles) {
      const filePath = path.join(componentPath, fileName);
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const content = fs.readFileSync(filePath, "utf8");
        
        // Розширені паттерни пошуку для конфігураційних файлів
        const patterns = [
          // ES6 imports
          new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
          new RegExp(`import\\s+['"]${dependencyName}['"]`, "gi"),
          new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s+['"]${dependencyName}['"]`, "gi"),
          
          // CommonJS requires
          new RegExp(`require\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
          new RegExp(`require\\(['"]${dependencyName}['"]\\)`, "gi"),
          
          // Dynamic imports
          new RegExp(`import\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
          
          // Plugin configurations
          new RegExp(`['"]${dependencyName}['"]\\s*:`, "gi"),
          new RegExp(`:\\s*['"]${dependencyName}['"]`, "gi"),
          new RegExp(`plugins?\\s*:\\s*\\[[^\\]]*['"]${dependencyName}['"]`, "gi"),
          new RegExp(`['"]${dependencyName}['"]\\s*,`, "gi"),
          
          // Webpack specific
          new RegExp(`loader\\s*:\\s*['"]${dependencyName}['"]`, "gi"),
          new RegExp(`use\\s*:\\s*['"]${dependencyName}['"]`, "gi"),
          
          // Vite specific
          new RegExp(`plugin\\s*\\(\\s*['"]${dependencyName}['"]`, "gi"),
          
          // Angular specific
          new RegExp(`builder\\s*:\\s*['"]${dependencyName}['"]`, "gi"),
          
          // General references
          new RegExp(`['"]${dependencyName}['"]`, "gi"),
          new RegExp(`['"]${dependencyName}/`, "gi"),
          
          // Environment variables
          new RegExp(`${dependencyName.toUpperCase()}_`, "gi"),
          new RegExp(`${dependencyName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_`, "gi")
        ];

        for (const pattern of patterns) {
          if (pattern.test(content)) {
            return true;
          }
        }
      } catch (fileError) {
        // Якщо не можемо прочитати файл, пропускаємо його
        continue;
      }
    }

    return false;
  } catch (e) {
    // В разі помилки консервативно вважаємо залежність використаною
    return true;
  }
}

function isWindows() {
  return process.platform === "win32";
}

function getNpmCommand() {
  return isWindows()
    ? projectConfig.commands.npm.windows
    : projectConfig.commands.npm.unix;
}

// Ottieni la lista dei componenti
function getComponentDirectories() {
  const currentDir = process.cwd();
  const items = fs.readdirSync(currentDir);

  return items.filter((item) => {
    const fullPath = path.join(currentDir, item);

    if (!fs.statSync(fullPath).isDirectory()) {
      return false;
    }

    // Controllo per prefisso
    if (projectConfig.components.filterByPrefix.enabled) {
      if (!item.startsWith(projectConfig.components.filterByPrefix.prefix)) {
        return false;
      }
    }

    // Controllo per struttura
    if (projectConfig.components.filterByStructure.enabled) {
      const requiredFiles =
        projectConfig.components.filterByStructure.requiredFiles;
      const requiredFolders =
        projectConfig.components.filterByStructure.requiredFolders;

      for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(fullPath, file))) {
          return false;
        }
      }

      for (const folder of requiredFolders) {
        const folderPath = path.join(fullPath, folder);
        if (
          !fs.existsSync(folderPath) ||
          !fs.statSync(folderPath).isDirectory()
        ) {
          return false;
        }
      }
    }

    // Controllo per lista
    if (projectConfig.components.filterByList.enabled) {
      if (!projectConfig.components.filterByList.folders.includes(item)) {
        return false;
      }
    }

    // Controllo per regex
    if (projectConfig.components.filterByRegex.enabled) {
      if (!projectConfig.components.filterByRegex.pattern.test(item)) {
        return false;
      }
    }

    // Controlliamo sempre la presenza di package.json
    return fs.existsSync(path.join(fullPath, projectConfig.files.packageJson));
  });
}

// Розширена конфігурація безпеки для різних типів проектів
const SAFE_DEPENDENCY_RULES = {
  // Універсальні правила - завжди безпечні для видалення
  universal: {
    // Пакети тестування, які ніколи не використовуються в продакшн коді
    testPackages: [
      "@testing-library/dom", "@testing-library/jest-dom", "@testing-library/react",
      "@testing-library/user-event", "@testing-library/vue", "@testing-library/angular",
      "jest", "mocha", "chai", "karma", "jasmine", "protractor", "cypress", "playwright",
      "vitest", "@vitest/ui", "jsdom", "happy-dom", "puppeteer", "selenium-webdriver"
    ],

    // Пакети збірки, які тільки для розробки
    buildOnlyPackages: [
      "gh-pages", "ts-loader", "webpack-cli", "webpack-dev-server", "webpack-bundle-analyzer",
      "rollup", "rollup-plugin-", "vite", "@vitejs/", "esbuild", "terser", "uglify-js",
      "babel-loader", "css-loader", "style-loader", "file-loader", "url-loader"
    ],

    // Пакети для деплою
    deploymentPackages: ["gh-pages", "vercel", "netlify-cli", "surge", "now"],
    
    // Пакети для документації
    documentationPackages: ["typedoc", "jsdoc", "docusaurus", "gitbook"],
    
    // Пакети для лінтингу (якщо не використовуються в конфігах)
    lintingPackages: ["eslint", "prettier", "stylelint", "husky", "lint-staged"]
  },

  // Правила для SharePoint/SPFx
  sharepoint: {
    alwaysKeep: [
      "@microsoft/sp-", "@microsoft/rush-stack-", "gulp", "webpack", "typescript",
      "eslint", "@microsoft/sp-build-web", "@microsoft/sp-module-interfaces",
      "@microsoft/sp-webpart-workbench", "@microsoft/sp-extension-base"
    ],
    configDependent: [
      "gulp-sass", "gulp-typescript", "gulp-clean", "gulp-rename",
      "webpack-merge", "webpack-bundle-analyzer"
    ]
  },

  // Правила для Angular
  angular: {
    alwaysKeep: [
      "@angular/", "ng-", "@angular/cli", "@angular-devkit/", "rxjs", "zone.js",
      "@angular/material", "@angular/cdk", "@angular/flex-layout"
    ],
    devAlwaysKeep: [
      "@angular/cli", "@angular/compiler-cli", "@angular/language-service",
      "typescript", "@types/node", "karma", "jasmine", "protractor"
    ],
    configDependent: [
      "@angular-builders/", "ng-packagr", "@angular/compiler-cli"
    ]
  },

  // Правила для React
  react: {
    alwaysKeep: ["react", "react-dom", "react-scripts"],
    devAlwaysKeep: [
      "@types/react", "@types/react-dom", "@types/node", "typescript",
      "eslint", "eslint-config-react-app", "web-vitals"
    ],
    conditionalKeep: [
      "styled-components", "emotion", "css-in-js", "react-router", "react-router-dom",
      "redux", "react-redux", "mobx", "mobx-react"
    ]
  },

  // Правила для Next.js
  nextjs: {
    alwaysKeep: [
      "next", "react", "react-dom", "next-images", "next-seo", "next-auth",
      "next-i18next", "next-themes", "next-pwa"
    ],
    devAlwaysKeep: [
      "@types/react", "@types/react-dom", "@types/node", "typescript",
      "eslint", "eslint-config-next", "tailwindcss", "postcss", "autoprefixer"
    ],
    configDependent: [
      "next-compose-plugins", "next-transpile-modules", "next-optimized-images"
    ]
  },

  // Правила для Nuxt.js
  nuxt: {
    alwaysKeep: [
      "nuxt", "@nuxtjs/", "vue", "vue-router", "vuex", "@nuxtjs/axios",
      "@nuxtjs/pwa", "@nuxtjs/auth", "@nuxtjs/i18n"
    ],
    devAlwaysKeep: [
      "@nuxt/typescript-build", "@nuxtjs/eslint-config", "typescript",
      "@types/node", "eslint", "prettier"
    ]
  },

  // Правила для Vue.js
  vue: {
    alwaysKeep: [
      "vue", "@vue/cli", "vue-loader", "vue-router", "vuex", "vue-i18n",
      "@vue/composition-api", "vue-class-component"
    ],
    devAlwaysKeep: [
      "@vue/cli-service", "@vue/cli-plugin-", "typescript", "@types/node",
      "eslint", "eslint-plugin-vue", "prettier"
    ],
    configDependent: [
      "vue-template-compiler", "vue-tsc", "@vitejs/plugin-vue"
    ]
  },

  // Правила для Svelte
  svelte: {
    alwaysKeep: [
      "svelte", "@sveltejs/", "svelte-router-spa", "svelte-store"
    ],
    devAlwaysKeep: [
      "@sveltejs/adapter-", "svelte-check", "typescript", "@types/node"
    ]
  },

  // Правила для WordPress
  wordpress: {
    alwaysKeep: [
      "wp-", "wordpress", "gutenberg", "@wordpress/", "webpack", "gulp"
    ],
    configDependent: [
      "webpack-merge", "webpack-dev-server", "babel-loader"
    ]
  },

  // Правила для Vite
  vite: {
    alwaysKeep: [
      "vite", "@vitejs/", "rollup", "esbuild"
    ],
    devAlwaysKeep: [
      "typescript", "@types/node", "eslint", "prettier"
    ],
    configDependent: [
      "vite-plugin-", "rollup-plugin-", "@rollup/plugin-"
    ]
  },

  // Правила для Webpack
  webpack: {
    alwaysKeep: [
      "webpack", "webpack-cli", "webpack-dev-server"
    ],
    devAlwaysKeep: [
      "typescript", "@types/node", "eslint", "prettier"
    ],
    configDependent: [
      "webpack-merge", "webpack-bundle-analyzer", "webpack-plugin-"
    ]
  },

  // Правила для TypeScript
  typescript: {
    alwaysKeep: [
      "typescript", "@types/", "ts-node", "tsx"
    ],
    devAlwaysKeep: [
      "@types/node", "tsc-alias", "typescript-transform-paths"
    ]
  }
};

// Розширена функція для виявлення типу проекту з детальним аналізом
function detectProjectType(componentPath) {
  const packageJsonPath = path.join(componentPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return "unknown";
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const depNames = Object.keys(dependencies);
    const scripts = packageJson.scripts || {};

    // Аналіз конфігураційних файлів
    const configFiles = [
      "angular.json", "ng-package.json", "angular-cli.json",
      "next.config.js", "next.config.ts", "next.config.mjs",
      "nuxt.config.js", "nuxt.config.ts",
      "vite.config.js", "vite.config.ts",
      "webpack.config.js", "webpack.config.ts",
      "rollup.config.js", "rollup.config.ts",
      "gulpfile.js", "gulpfile.ts",
      "gruntfile.js", "gruntfile.ts",
      "tailwind.config.js", "tailwind.config.ts",
      "postcss.config.js", "postcss.config.mjs",
      "babel.config.js", "babel.config.json",
      ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs",
      "tsconfig.json", "jsconfig.json",
      "jest.config.js", "jest.config.ts",
      "cypress.config.js", "cypress.config.ts",
      "playwright.config.js", "playwright.config.ts",
      "vitest.config.js", "vitest.config.ts"
    ];

    const existingConfigs = configFiles.filter(file => 
      fs.existsSync(path.join(componentPath, file))
    );

    // Детекція SharePoint/SPFx
    if (
      depNames.some(dep => 
        dep.includes("@microsoft/sp-") ||
        dep.includes("@microsoft/rush-stack-") ||
        dep.includes("@microsoft/sp-build-web") ||
        dep.includes("@microsoft/sp-module-interfaces")
      ) ||
      existingConfigs.some(config => config.includes("gulpfile")) ||
      scripts.build && scripts.build.includes("gulp")
    ) {
      return "sharepoint";
    }

    // Детекція Angular
    if (
      depNames.some(dep => 
        dep.includes("@angular/") || 
        dep.includes("ng-") ||
        dep.includes("@angular/cli")
      ) ||
      existingConfigs.includes("angular.json") ||
      existingConfigs.includes("ng-package.json") ||
      existingConfigs.includes("angular-cli.json") ||
      scripts.build && scripts.build.includes("ng build")
    ) {
      return "angular";
    }

    // Детекція Next.js
    if (
      dependencies.next ||
      dependencies["next-images"] ||
      dependencies["next-seo"] ||
      dependencies["next-auth"] ||
      existingConfigs.some(config => config.startsWith("next.config")) ||
      scripts.build && scripts.build.includes("next build")
    ) {
      return "nextjs";
    }

    // Детекція Nuxt.js
    if (
      dependencies.nuxt ||
      dependencies["@nuxtjs/"] ||
      existingConfigs.some(config => config.startsWith("nuxt.config")) ||
      scripts.build && scripts.build.includes("nuxt build")
    ) {
      return "nuxt";
    }

    // Детекція Vue.js
    if (
      dependencies.vue ||
      dependencies["@vue/cli"] ||
      dependencies["vue-loader"] ||
      dependencies["@vitejs/plugin-vue"] ||
      existingConfigs.some(config => config.includes("vue.config")) ||
      scripts.build && scripts.build.includes("vue-cli-service")
    ) {
      return "vue";
    }

    // Детекція React
    if (
      dependencies.react ||
      dependencies["react-dom"] ||
      dependencies["react-scripts"] ||
      dependencies["@vitejs/plugin-react"] ||
      dependencies["@vitejs/plugin-react-swc"] ||
      scripts.build && (scripts.build.includes("react-scripts") || scripts.build.includes("vite"))
    ) {
      return "react";
    }

    // Детекція WordPress
    if (
      depNames.some(dep => 
        dep.includes("wp-") || 
        dep.includes("wordpress") ||
        dep.includes("@wordpress/")
      ) ||
      existingConfigs.some(config => config.includes("webpack.config")) ||
      scripts.build && scripts.build.includes("webpack")
    ) {
      return "wordpress";
    }

    // Детекція Svelte
    if (
      dependencies.svelte ||
      dependencies["@sveltejs/"] ||
      dependencies["vite-plugin-svelte"] ||
      existingConfigs.some(config => config.includes("svelte.config"))
    ) {
      return "svelte";
    }

    // Детекція Vite (загальний)
    if (
      dependencies.vite ||
      dependencies["@vitejs/"] ||
      existingConfigs.some(config => config.startsWith("vite.config")) ||
      scripts.build && scripts.build.includes("vite build")
    ) {
      return "vite";
    }

    // Детекція Webpack (загальний)
    if (
      dependencies.webpack ||
      dependencies["webpack-cli"] ||
      existingConfigs.some(config => config.startsWith("webpack.config")) ||
      scripts.build && scripts.build.includes("webpack")
    ) {
      return "webpack";
    }

    // Детекція TypeScript проекту
    if (
      dependencies.typescript ||
      dependencies["@types/"] ||
      existingConfigs.includes("tsconfig.json") ||
      scripts.build && scripts.build.includes("tsc")
    ) {
      return "typescript";
    }

    return "unknown";
  } catch (error) {
    return "unknown";
  }
}

// Розширена функція для перевірки безпеки видалення залежності
function isSafeToRemove(dependencyName, projectType, isDevDependency = false, componentPath = null) {
  const rules = SAFE_DEPENDENCY_RULES;

  // Перевірка універсальних правил
  const universalRules = rules.universal;
  
  // Пакети тестування - завжди безпечні для видалення
  if (universalRules.testPackages.some(pkg => 
    dependencyName === pkg || dependencyName.startsWith(pkg + "-")
  )) {
    return true;
  }

  // Пакети збірки - безпечні для видалення
  if (universalRules.buildOnlyPackages.some(pkg => 
    dependencyName === pkg || dependencyName.startsWith(pkg + "-")
  )) {
    return true;
  }

  // Пакети деплою - безпечні для видалення
  if (universalRules.deploymentPackages.includes(dependencyName)) {
    return true;
  }

  // Пакети документації - безпечні для видалення
  if (universalRules.documentationPackages.includes(dependencyName)) {
    return true;
  }

  // Пакети лінтингу - перевіряємо чи використовуються в конфігах
  if (universalRules.lintingPackages.includes(dependencyName)) {
    // Якщо є шлях до компонента, перевіряємо використання в конфігах
    if (componentPath && !isReferencedInConfigFiles(componentPath, dependencyName)) {
      return true; // Безпечно видалити якщо не використовується в конфігах
    }
    return false; // Не видаляємо якщо використовується в конфігах
  }

  // Перевірка специфічних правил для типу проекту
  if (projectType !== "unknown" && rules[projectType]) {
    const projectRules = rules[projectType];

    // Залежності, які завжди потрібно зберігати
    if (projectRules.alwaysKeep) {
      for (const pattern of projectRules.alwaysKeep) {
        if (dependencyName.includes(pattern) || dependencyName.startsWith(pattern)) {
          return false; // НЕ безпечно видаляти
        }
      }
    }

    // Dev залежності, які завжди потрібно зберігати
    if (isDevDependency && projectRules.devAlwaysKeep) {
      for (const pattern of projectRules.devAlwaysKeep) {
        if (dependencyName.includes(pattern) || dependencyName.startsWith(pattern)) {
          return false; // НЕ безпечно видаляти
        }
      }
    }

    // Залежності, які залежать від конфігурації
    if (projectRules.configDependent) {
      for (const pattern of projectRules.configDependent) {
        if (dependencyName.includes(pattern) || dependencyName.startsWith(pattern)) {
          // Перевіряємо чи використовується в конфігах
          if (componentPath && isReferencedInConfigFiles(componentPath, dependencyName)) {
            return false; // НЕ безпечно видаляти якщо використовується в конфігах
          }
          return true; // Безпечно видалити якщо не використовується в конфігах
        }
      }
    }

    // Умовні залежності (для React, Vue тощо)
    if (projectRules.conditionalKeep) {
      for (const pattern of projectRules.conditionalKeep) {
        if (dependencyName.includes(pattern) || dependencyName.startsWith(pattern)) {
          // Для умовних залежностей потрібен детальний аналіз використання
          return false; // НЕ безпечно видаляти без детального аналізу
        }
      }
    }
  }

  // Для безпеки, якщо не впевнені, не видаляємо
  return false;
}

// Розширена функція для аналізу використання залежності в коді
function analyzeDependencyUsage(filePath, dependencyName) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const fileExt = path.extname(filePath).toLowerCase();

    // Розширені паттерни пошуку для використання залежності
    const patterns = [
      // ES6 imports - стандартні
      new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
      new RegExp(`import\\s+['"]${dependencyName}['"]`, "gi"),
      new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s+['"]${dependencyName}['"]`, "gi"),
      
      // ES6 imports - з підпакетами
      new RegExp(`import\\s+.*\\s+from\\s+['"]${dependencyName}/[^'"]*['"]`, "gi"),
      new RegExp(`import\\s+['"]${dependencyName}/[^'"]*['"]`, "gi"),
      new RegExp(`import\\s*\\{[^}]*\\}\\s*from\\s+['"]${dependencyName}/[^'"]*['"]`, "gi"),

      // CommonJS requires
      new RegExp(`require\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
      new RegExp(`require\\(['"]${dependencyName}['"]\\)`, "gi"),
      new RegExp(`require\\s*\\(\\s*['"]${dependencyName}/[^'"]*['"]\\s*\\)`, "gi"),

      // Dynamic imports
      new RegExp(`import\\s*\\(\\s*['"]${dependencyName}['"]\\s*\\)`, "gi"),
      new RegExp(`import\\s*\\(\\s*['"]${dependencyName}/[^'"]*['"]\\s*\\)`, "gi"),

      // AMD imports
      new RegExp(`define\\s*\\(\\s*\\[\\s*['"]${dependencyName}['"]`, "gi"),
      new RegExp(`define\\s*\\(\\s*\\[\\s*['"]${dependencyName}/[^'"]*['"]`, "gi"),

      // UMD patterns
      new RegExp(`\\(function\\s*\\(\\s*['"]${dependencyName}['"]`, "gi"),

      // Webpack specific
      new RegExp(`require\\.ensure\\s*\\(\\s*\\[\\s*['"]${dependencyName}['"]`, "gi"),
      new RegExp(`require\\.context\\s*\\(\\s*['"]${dependencyName}['"]`, "gi"),

      // SystemJS
      new RegExp(`System\\.import\\s*\\(\\s*['"]${dependencyName}['"]`, "gi"),

      // Прямі посилання
      new RegExp(`['"]${dependencyName}['"]`, "gi"),
      new RegExp(`['"]${dependencyName}/[^'"]*['"]`, "gi"),

      // Template literals
      new RegExp('`[^`]*\\\\$\\\\{[^}]*[\'\"]' + dependencyName + '[\'\"][^}]*\\\\}[^`]*`', "gi"),

      // CSS imports (для CSS-in-JS)
      new RegExp(`@import\\s+['"]${dependencyName}['"]`, "gi"),
      new RegExp(`@import\\s+['"]${dependencyName}/[^'"]*['"]`, "gi"),

      // HTML attributes (для HTML файлів)
      new RegExp(`src\\s*=\\s*['"]${dependencyName}['"]`, "gi"),
      new RegExp(`href\\s*=\\s*['"]${dependencyName}['"]`, "gi"),

      // JSON references
      new RegExp(`"${dependencyName}"`, "gi"),
      new RegExp(`"${dependencyName}/[^"]*"`, "gi"),

      // Environment variables
      new RegExp(`process\\.env\\.[A-Z_]*${dependencyName.toUpperCase()}`, "gi"),
      new RegExp(`\\$\\{${dependencyName.toUpperCase()}\\}`, "gi"),

      // Package.json scripts
      new RegExp(`"${dependencyName}"`, "gi"),
      new RegExp(`"${dependencyName}/[^"]*"`, "gi")
    ];

    // Спеціальні паттерни для різних типів файлів
    if (fileExt === '.vue') {
      patterns.push(
        // Vue specific
        new RegExp(`<script[^>]*>\\s*import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
        new RegExp(`<script[^>]*>\\s*require\\s*\\(\\s*['"]${dependencyName}['"]`, "gi"),
        new RegExp(`<style[^>]*>\\s*@import\\s+['"]${dependencyName}['"]`, "gi")
      );
    }

    if (fileExt === '.svelte') {
      patterns.push(
        // Svelte specific
        new RegExp(`<script[^>]*>\\s*import\\s+.*\\s+from\\s+['"]${dependencyName}['"]`, "gi"),
        new RegExp(`<script[^>]*>\\s*import\\s+['"]${dependencyName}['"]`, "gi")
      );
    }

    if (fileExt === '.html' || fileExt === '.htm') {
      patterns.push(
        // HTML specific
        new RegExp(`<script[^>]*src\\s*=\\s*['"]${dependencyName}['"]`, "gi"),
        new RegExp(`<link[^>]*href\\s*=\\s*['"]${dependencyName}['"]`, "gi"),
        new RegExp(`<link[^>]*rel\\s*=\\s*['"]stylesheet['"][^>]*href\\s*=\\s*['"]${dependencyName}['"]`, "gi")
      );
    }

    if (fileExt === '.css' || fileExt === '.scss' || fileExt === '.sass' || fileExt === '.less') {
      patterns.push(
        // CSS specific
        new RegExp(`@import\\s+['"]${dependencyName}['"]`, "gi"),
        new RegExp(`@import\\s+['"]${dependencyName}/[^'"]*['"]`, "gi"),
        new RegExp(`url\\s*\\(\\s*['"]${dependencyName}['"]`, "gi")
      );
    }

    // Перевіряємо кожен паттерн
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        return true; // Знайдено використання
      }
    }

    return false; // Не знайдено використання
  } catch (error) {
    return false; // В разі помилки вважаємо що залежність використовується
  }
}

// Розширена функція для сканування всіх файлів у директорії
function scanDirectoryForUsage(dirPath, dependencyName) {
  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Розширений список системних папок для пропуску
        const systemDirs = [
          "node_modules", ".git", "dist", "build", "lib", "temp", "release",
          ".next", ".nuxt", ".vuepress", ".docusaurus", "coverage", ".nyc_output",
          ".cache", ".parcel-cache", ".vscode", ".idea", "logs", "tmp",
          ".angular", ".svelte-kit", ".turbo", ".vercel", ".netlify"
        ];

        // Пропускаємо системні папки
        if (systemDirs.includes(item) || item.startsWith('.')) {
          continue;
        }

        // Рекурсивне сканування
        if (scanDirectoryForUsage(fullPath, dependencyName)) {
          return true;
        }
      } else if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();

        // Розширений список розширень файлів для аналізу
        const codeExtensions = [
          // JavaScript/TypeScript
          ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
          
          // Vue/Svelte
          ".vue", ".svelte",
          
          // Configuration files
          ".json", ".jsonc", ".json5",
          
          // HTML
          ".html", ".htm", ".xhtml",
          
          // CSS
          ".css", ".scss", ".sass", ".less", ".styl",
          
          // Markdown (може містити приклади коду)
          ".md", ".mdx",
          
          // YAML/TOML
          ".yml", ".yaml", ".toml",
          
          // Other configs
          ".env", ".env.local", ".env.development", ".env.production",
          ".babelrc", ".eslintrc", ".prettierrc", ".stylelintrc"
        ];

        // Аналізуємо файли коду та конфігурації
        if (codeExtensions.includes(ext)) {
          if (analyzeDependencyUsage(fullPath, dependencyName)) {
            return true;
          }
        }
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

// Funzione per analizzare le dipendenze di un componente
function analyzeComponentDependencies(componentPath) {
  // analyzeComponentDependencies - silenzioso
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    logger.error(`package.json non trovato in ${componentName}`);
    return { used: [], unused: [], error: true };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const peerDependencies = packageJson.peerDependencies || {};
    const optionalDependencies = packageJson.optionalDependencies || {};

    if (Object.keys(dependencies).length === 0) {
      return { used: [], unused: [], error: false };
    }

    // Analisi dipendenze - silenzioso

    // Rileva il tipo di progetto
    // Chiamando detectProjectType - silenzioso
    const projectType = detectProjectType(componentPath);
    // Tipo progetto rilevato - silenzioso

    // Debug: mostriamo le dipendenze trovate
    const depNames = Object.keys(dependencies);
    // Dipendenze trovate - silenzioso

    const usedDependencies = [];
    const unusedDependencies = [];

    // Analizza ogni dipendenza
    for (const [depName, depVersion] of Object.entries(dependencies)) {
      const isDevDependency =
        packageJson.devDependencies && packageJson.devDependencies[depName];

      // Se è nelle peer o optional, consideriamolo usato
      if (peerDependencies[depName] || optionalDependencies[depName]) {
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: peerDependencies[depName]
            ? "peerDependency"
            : "optionalDependency",
        });
        continue;
      }

      // Se è referenziato in file di configurazione consideriamolo utilizzato
      if (isReferencedInConfigFiles(componentPath, depName)) {
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: "riferito in file di configurazione",
        });
        continue;
      }

      // Перевіряємо чи безпечно видаляти залежність
      const isSafeToRemoveDep = isSafeToRemove(depName, projectType, !!isDevDependency, componentPath);
      
      if (isSafeToRemoveDep) {
        // Якщо безпечно видаляти, перевіряємо чи дійсно використовується
        const isUsedInCode = scanDirectoryForUsage(componentPath, depName);
        const isUsedInConfigs = isReferencedInConfigFiles(componentPath, depName);

        if (isUsedInCode || isUsedInConfigs) {
          usedDependencies.push({
            name: depName,
            version: depVersion,
            reason: isUsedInCode ? "використовується в коді" : "використовується в конфігурації",
          });
        } else {
          unusedDependencies.push({
            name: depName,
            version: depVersion,
            reason: "безпечно видалити - не використовується",
          });
        }
      } else {
        // Якщо не безпечно видаляти, вважаємо що залежність використовується
        usedDependencies.push({
          name: depName,
          version: depVersion,
          reason: "необхідна для проекту",
        });
      }
    }

    return { used: usedDependencies, unused: unusedDependencies, error: false };
  } catch (error) {
    logger.error(`Errore nell'analisi ${componentName}: ${error.message}`);
    return { used: [], unused: [], error: true };
  }
}

// Розширена функція для делікатного видалення залежностей
function removeUnusedDependencies(componentPath, unusedDependencies) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const projectType = detectProjectType(componentPath);
    
    // Групуємо залежності за типом для більш точного видалення
    const dependenciesToRemove = [];
    const devDependenciesToRemove = [];
    const optionalDependenciesToRemove = [];

    for (const dep of unusedDependencies) {
      // Додаткова перевірка безпеки перед видаленням
      const isStillSafe = isSafeToRemove(dep.name, projectType, false, componentPath);
      
      if (!isStillSafe) {
        logger.warning(`Пропускаємо ${dep.name} - небезпечно видаляти`);
        continue;
      }

      // Перевіряємо чи залежність дійсно не використовується
      const isUsedInCode = scanDirectoryForUsage(componentPath, dep.name);
      const isUsedInConfigs = isReferencedInConfigFiles(componentPath, dep.name);
      
      if (isUsedInCode || isUsedInConfigs) {
        logger.warning(`Пропускаємо ${dep.name} - знайдено використання`);
        continue;
      }

      // Визначаємо тип залежності
      if (packageJson.dependencies && packageJson.dependencies[dep.name]) {
        dependenciesToRemove.push(dep.name);
        delete packageJson.dependencies[dep.name];
      }
      if (packageJson.devDependencies && packageJson.devDependencies[dep.name]) {
        devDependenciesToRemove.push(dep.name);
        delete packageJson.devDependencies[dep.name];
      }
      if (packageJson.optionalDependencies && packageJson.optionalDependencies[dep.name]) {
        optionalDependenciesToRemove.push(dep.name);
        delete packageJson.optionalDependencies[dep.name];
      }
    }

    // Якщо немає залежностей для видалення
    if (dependenciesToRemove.length === 0 && devDependenciesToRemove.length === 0 && optionalDependenciesToRemove.length === 0) {
      logger.info(`Немає безпечних залежностей для видалення в ${componentName}`);
      return true;
    }

    // Зберігаємо оновлений package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    logger.process(`Видалення залежностей для ${componentName}...`);

    let allRemoved = true;
    let removedPackages = [];

    // Видаляємо production залежності
    if (dependenciesToRemove.length > 0) {
      try {
        const packagesToRemove = dependenciesToRemove.join(" ");
        const npmCommand = `${getNpmCommand()} uninstall ${packagesToRemove} --ignore-scripts`;
        
        execSync(npmCommand, {
          cwd: componentPath,
          stdio: "inherit",
        });
        
        removedPackages.push(...dependenciesToRemove);
        logger.success(`Видалено production залежності: ${dependenciesToRemove.join(", ")}`);
      } catch (npmError) {
        logger.warning(`Помилка видалення production залежностей: ${npmError.message}`);
        allRemoved = false;
      }
    }

    // Видаляємо dev залежності
    if (devDependenciesToRemove.length > 0) {
      try {
        const packagesToRemove = devDependenciesToRemove.join(" ");
        const npmCommand = `${getNpmCommand()} uninstall ${packagesToRemove} --save-dev --ignore-scripts`;
        
        execSync(npmCommand, {
          cwd: componentPath,
          stdio: "inherit",
        });
        
        removedPackages.push(...devDependenciesToRemove);
        logger.success(`Видалено dev залежності: ${devDependenciesToRemove.join(", ")}`);
      } catch (npmError) {
        logger.warning(`Помилка видалення dev залежностей: ${npmError.message}`);
        allRemoved = false;
      }
    }

    // Видаляємо optional залежності
    if (optionalDependenciesToRemove.length > 0) {
      try {
        const packagesToRemove = optionalDependenciesToRemove.join(" ");
        const npmCommand = `${getNpmCommand()} uninstall ${packagesToRemove} --save-optional --ignore-scripts`;
        
        execSync(npmCommand, {
          cwd: componentPath,
          stdio: "inherit",
        });
        
        removedPackages.push(...optionalDependenciesToRemove);
        logger.success(`Видалено optional залежності: ${optionalDependenciesToRemove.join(", ")}`);
      } catch (npmError) {
        logger.warning(`Помилка видалення optional залежностей: ${npmError.message}`);
        allRemoved = false;
      }
    }

    if (removedPackages.length > 0) {
      logger.success(`Успішно видалено ${removedPackages.length} залежностей для ${componentName}: ${removedPackages.join(", ")}`);
    }

    return allRemoved;
  } catch (error) {
    logger.error(`Помилка видалення залежностей для ${componentName}: ${error.message}`);
    return false;
  }
}

// Funzione per eseguire il comando depcheck
async function executeDepcheckCommand(
  scope,
  components,
  args,
  onComplete = null
) {
  const allComponents = getComponentDirectories();
  let targetComponents = [];

  // Determina i componenti target
  switch (scope) {
    case "all":
      targetComponents = allComponents;
      break;
    case "single":
      if (components.length > 0) {
        targetComponents = [components[0]];
      }
      break;
    case "exclude":
      targetComponents = allComponents.filter(
        (comp) => !components.includes(comp)
      );
      break;
  }

  if (targetComponents.length === 0) {
    logger.error("Nessun componente trovato per l'analisi");
    if (onComplete) onComplete();
    return;
  }

  logger.process(`Analisi ${targetComponents.length} componenti...`);

  let totalUnused = 0;
  let componentsWithUnused = 0;
  const allUnusedDependencies = [];
  const conciseOutput = [];

  // Analizza ogni componente
  for (const component of targetComponents) {
    const componentPath = path.join(process.cwd(), component);
    const result = analyzeComponentDependencies(componentPath);

    if (result.error) {
      continue;
    }

    if (result.unused.length > 0) {
      componentsWithUnused++;
      totalUnused += result.unused.length;

      if (!logger.isVerbose()) {
        // quiet/default: output conciso: component: dep1 dep2 ...
        conciseOutput.push(
          `${component}: ${result.unused.map((d) => d.name).join(" ")}`
        );
      } else {
        logger.info(`${component}:`);
        logger.error(`Sicure da rimuovere (${result.unused.length}):`);
        result.unused.forEach((dep) => {
          logger.log(`      - ${dep.name} (${dep.reason})`);
        });
      }

      allUnusedDependencies.push({
        component: component,
        path: componentPath,
        unused: result.unused,
      });
    } else {
      logger.success(`${component}: tutte le dipendenze sono necessarie`);
    }
  }

  // Mostra il risultato
  if (!logger.isVerbose()) {
    // Stampa lista concisa e ritorna
    conciseOutput.forEach((line) => console.log(line));
  } else {
    logger.section("Risultato controllo");
    logger.info(`Componenti analizzati: ${targetComponents.length}`);
    if (totalUnused > 0) {
      logger.error(`Dipendenze sicure da rimuovere: ${totalUnused}`);
      logger.error(
        `Componenti con dipendenze rimovibili: ${componentsWithUnused}`
      );
    } else {
      logger.success(`Tutte le dipendenze sono necessarie`);
    }
  }

  if (totalUnused > 0 && !args.includes("clean")) {
    logger.info("Per rimuovere le dipendenze sicure usa:");
    logger.log(`   npx packman depcheck clean`);
  } else if (totalUnused === 0) {
    logger.success(
      "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
    );
  }

  // Se è specificato clean, rimuovi automaticamente
  if (args.includes("clean") && totalUnused > 0) {
    if (logger.isVerbose())
      logger.process("Rimozione automatica delle dipendenze sicure...");

    for (const item of allUnusedDependencies) {
      if (logger.isVerbose())
        logger.process(`Rimozione dipendenze per ${item.component}...`);
      const success = removeUnusedDependencies(item.path, item.unused);

      if (success) {
        if (logger.isVerbose())
          logger.success(`Dipendenze rimosse per ${item.component}`);
      } else {
        if (logger.isVerbose())
          logger.error(
            `Errore nella rimozione delle dipendenze per ${item.component}`
          );
      }
    }

    logger.success("Rimozione completata!");
  }

  if (onComplete) onComplete();
}

// Нова функція для детального аналізу проекту
function generateDetailedAnalysisReport(componentPath, projectType) {
  const componentName = path.basename(componentPath);
  const packageJsonPath = path.join(componentPath, "package.json");
  
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    
    const report = {
      component: componentName,
      projectType: projectType,
      totalDependencies: Object.keys(dependencies).length,
      analysis: {
        used: [],
        unused: [],
        configDependent: [],
        potentiallyUnsafe: []
      },
      recommendations: []
    };

    // Аналізуємо кожну залежність
    for (const [depName, depVersion] of Object.entries(dependencies)) {
      const isDevDependency = packageJson.devDependencies && packageJson.devDependencies[depName];
      const isUsedInCode = scanDirectoryForUsage(componentPath, depName);
      const isUsedInConfigs = isReferencedInConfigFiles(componentPath, depName);
      const isSafeToRemoveDep = isSafeToRemove(depName, projectType, !!isDevDependency, componentPath);

      const depInfo = {
        name: depName,
        version: depVersion,
        isDevDependency,
        isUsedInCode,
        isUsedInConfigs,
        isSafeToRemove: isSafeToRemoveDep
      };

      if (isUsedInCode || isUsedInConfigs) {
        report.analysis.used.push(depInfo);
      } else if (isSafeToRemoveDep) {
        report.analysis.unused.push(depInfo);
      } else if (isUsedInConfigs) {
        report.analysis.configDependent.push(depInfo);
      } else {
        report.analysis.potentiallyUnsafe.push(depInfo);
      }
    }

    // Генеруємо рекомендації
    if (report.analysis.unused.length > 0) {
      report.recommendations.push({
        type: "safe_removal",
        message: `Можна безпечно видалити ${report.analysis.unused.length} залежностей`,
        packages: report.analysis.unused.map(dep => dep.name)
      });
    }

    if (report.analysis.potentiallyUnsafe.length > 0) {
      report.recommendations.push({
        type: "manual_review",
        message: `Потрібен ручний огляд ${report.analysis.potentiallyUnsafe.length} залежностей`,
        packages: report.analysis.potentiallyUnsafe.map(dep => dep.name)
      });
    }

    if (report.analysis.configDependent.length > 0) {
      report.recommendations.push({
        type: "config_review",
        message: `${report.analysis.configDependent.length} залежностей використовуються тільки в конфігурації`,
        packages: report.analysis.configDependent.map(dep => dep.name)
      });
    }

    return report;
  } catch (error) {
    logger.error(`Помилка генерації звіту для ${componentName}: ${error.message}`);
    return null;
  }
}

// Funzione per il parsing e l'esecuzione dei comandi
async function parseAndExecuteCommand(args, onComplete = null) {
  let scope = "all";
  let components = [];

  // Reset verbose by default; can be enabled via flag or env
  logger.setVerbose(!!process.env.PACKMAN_VERBOSE);

  // Parsa gli argomenti
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--verbose" || arg === "-v") {
      logger.setVerbose(true);
      continue;
    }

    if (arg === "--single") {
      scope = "single";
      if (i + 1 < args.length) {
        components = [args[i + 1]];
        i++; // Salta il prossimo argomento
      }
    } else if (arg === "--exclude") {
      scope = "exclude";
      components = [];
      for (let j = i + 1; j < args.length; j++) {
        if (args[j].startsWith("--")) {
          break; // Ci fermiamo al prossimo flag
        }
        components.push(args[j]);
      }
      i += components.length; // Salta gli argomenti processati
    }
  }

  // Esegui il comando
  await executeDepcheckCommand(scope, components, args, onComplete);
}

// Funzione per la modalità interattiva
function showInteractiveMenu() {
  logger.section("Controllo dipendenze non utilizzate (experimental)");
  logger.step("Controlla tutti i componenti", 1);
  logger.step("Controlla un componente", 2);
  logger.step("Controlla tutti tranne quelli specificati", 3);
  logger.step("Controlla e rimuovi per tutti i componenti (automatico)", 4);
  logger.step("Torna al menu principale", 0);

  if (!rl) return;

  rl.question("Scegli un'opzione (0-4): ", (answer) => {
    switch (answer.trim()) {
      case "0":
        logger.info("Tornando al menu principale...");
        if (onComplete) onComplete();
        break;
      case "1":
        logger.process("Controllo dipendenze per tutti i componenti...");
        executeDepcheckCommand("all", [], [], () => {
          if (rl) {
            // Controlla se ci sono dipendenze sicure da rimuovere
            const allComponents = getComponentDirectories();
            let hasSafeToRemove = false;

            for (const component of allComponents) {
              const componentPath = path.join(process.cwd(), component);
              const result = analyzeComponentDependencies(componentPath);
              if (result.unused.length > 0) {
                hasSafeToRemove = true;
                break;
              }
            }

            if (hasSafeToRemove) {
              logger.warning(
                "Rimuovere le dipendenze sicure per tutti i componenti?"
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    "Rimozione dipendenze per tutti i componenti..."
                  );
                  executeDepcheckCommand("all", [], ["clean"], () => {
                    if (onComplete) onComplete();
                  });
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
              );
              if (onComplete) onComplete();
            }
          }
        });
        break;
      case "2":
        showComponentSelection();
        break;
      case "3":
        showExcludeSelection();
        break;
      case "4":
        logger.process(
          "Controllo e rimozione automatica delle dipendenze per tutti i componenti..."
        );
        executeDepcheckCommand("all", [], ["clean"], () => {
          if (onComplete) onComplete();
        });
        break;
      default:
        logger.error("Scelta non valida");
        if (onComplete) onComplete();
    }
  });
}

// Funzione per la selezione del componente
function showComponentSelection() {
  const components = getComponentDirectories();

  if (components.length === 0) {
    logger.error("Nessun componente trovato");
    if (onComplete) onComplete();
    return;
  }

  logger.section("Componenti disponibili");
  components.forEach((component, index) => {
    logger.step(component, index + 1);
  });
  logger.step("Torna al menu principale", 0);

  if (!rl) return;

  rl.question(
    "\nInserisci il numero del componente (0 per tornare): ",
    (answer) => {
      if (answer.trim() === "0") {
        logger.info("Tornando al menu principale...");
        if (onComplete) onComplete();
        return;
      }

      const index = parseInt(answer) - 1;

      if (index >= 0 && index < components.length) {
        const selectedComponent = components[index];
        logger.success(`Selezionato: ${selectedComponent}`);

        logger.process(`Analisi dipendenze per: ${selectedComponent}`);
        executeDepcheckCommand("single", [selectedComponent], [], () => {
          if (rl) {
            const componentPath = path.join(process.cwd(), selectedComponent);
            const result = analyzeComponentDependencies(componentPath);

            if (result.unused.length > 0) {
              logger.warning(
                `Rimuovere le dipendenze sicure per: ${selectedComponent}?`
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    `Rimozione dipendenze per: ${selectedComponent}`
                  );
                  executeDepcheckCommand(
                    "single",
                    [selectedComponent],
                    ["clean"],
                    () => {
                      if (onComplete) onComplete();
                    }
                  );
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                `Tutte le dipendenze sono necessarie per ${selectedComponent}, nessuna rimozione sicura disponibile`
              );
              if (onComplete) onComplete();
            }
          }
        });
      } else {
        logger.error("Numero componente non valido");
        if (onComplete) onComplete();
      }
    }
  );
}

// Funzione per la selezione delle esclusioni
function showExcludeSelection() {
  if (!rl) return;

  rl.question(
    "Inserisci i nomi dei componenti da escludere (separati da spazio): ",
    (excludeAnswer) => {
      const excludeList = excludeAnswer
        .trim()
        .split(/\s+/)
        .filter((name) => name.length > 0);
      if (excludeList.length > 0) {
        logger.process(
          `Analisi dipendenze per tutti i componenti tranne: ${excludeList.join(
            ", "
          )}`
        );
        executeDepcheckCommand("exclude", excludeList, [], () => {
          if (rl) {
            const allComponents = getComponentDirectories();
            const filteredComponents = allComponents.filter(
              (component) => !excludeList.includes(component)
            );
            let hasSafeToRemove = false;

            for (const component of filteredComponents) {
              const componentPath = path.join(process.cwd(), component);
              const result = analyzeComponentDependencies(componentPath);
              if (result.unused.length > 0) {
                hasSafeToRemove = true;
                break;
              }
            }

            if (hasSafeToRemove) {
              logger.warning(
                `Rimuovere le dipendenze sicure per tutti i componenti tranne: ${excludeList.join(
                  ", "
                )}?`
              );
              rl.question("Continuare? (y/N): ", (confirm) => {
                if (
                  confirm.toLowerCase() === "y" ||
                  confirm.toLowerCase() === "yes"
                ) {
                  logger.process(
                    `Rimozione dipendenze per tutti i componenti tranne: ${excludeList.join(
                      ", "
                    )}`
                  );
                  executeDepcheckCommand(
                    "exclude",
                    excludeList,
                    ["clean"],
                    () => {
                      if (onComplete) onComplete();
                    }
                  );
                } else {
                  logger.warning("Operazione annullata");
                  if (onComplete) onComplete();
                }
              });
            } else {
              logger.success(
                "Tutte le dipendenze sono necessarie, nessuna rimozione sicura disponibile"
              );
              if (onComplete) onComplete();
            }
          }
        });
      } else {
        logger.error("Nessun componente specificato per l'esclusione");
        if (onComplete) onComplete();
      }
    }
  );
}

// Funzione principale
async function main() {
  logger.section(`${projectConfig.project.name} - Controllo dipendenze`);

  const args = process.argv.slice(2);

  // Se sono passati argomenti dalla riga di comando
  if (args.length > 0) {
    await parseAndExecuteCommand(args);
    return;
  }

  // Modalità interattiva
  try {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Gestione errori readline
    rl.on("error", (err) => {
      logger.error(`Errore readline: ${err.message}`);
    });

    rl.on("close", () => {
      logger.info("Interfaccia chiusa");
      process.exit(0);
    });

    // Gestione SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      logger.success("Arrivederci!");
      if (rl) rl.close();
      process.exit(0);
    });

    showInteractiveMenu();
  } catch (error) {
    logger.error(`Errore durante l'inizializzazione: ${error.message}`);
    process.exit(1);
  }
}

// Avvio dello script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseAndExecuteCommand,
  analyzeComponentDependencies,
  removeUnusedDependencies,
  executeDepcheckCommand,
  detectProjectType,
  isSafeToRemove,
  isReferencedInConfigFiles,
  analyzeDependencyUsage,
  scanDirectoryForUsage,
  generateDetailedAnalysisReport,
  SAFE_DEPENDENCY_RULES
};
