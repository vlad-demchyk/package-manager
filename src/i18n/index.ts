import type { Message } from '../core/types.js';
import { en, type Catalogue, type MessageKey } from './en.js';
import { it } from './it.js';
import { uk } from './uk.js';

export type Language = 'en' | 'it' | 'uk';

const CATALOGUES: Record<Language, Catalogue> = { en, it, uk };

let current: Language = 'en';

export function setLanguage(language: Language | 'auto'): Language {
  current = language === 'auto' ? detectLanguage() : language;
  return current;
}

function detectLanguage(env = process.env): Language {
  const locale = (
    env.PACKMAN_LANG ??
    env.LC_ALL ??
    env.LC_MESSAGES ??
    env.LANG ??
    Intl.DateTimeFormat().resolvedOptions().locale
  ).toLowerCase();
  if (locale.startsWith('uk')) return 'uk';
  if (locale.startsWith('it')) return 'it';
  return 'en';
}

/** Translates a message key with `{param}` placeholders; unknown keys fall back to English, then to the key. */
export function t(key: string, params?: Message['params'], language = current): string {
  const template =
    (CATALOGUES[language] as Record<string, string>)[key] ??
    (en as Record<string, string>)[key] ??
    key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name];
    return value === undefined ? match : String(value);
  });
}

export function tm(message: Message, language = current): string {
  return t(message.key, message.params, language);
}

export type { MessageKey };
