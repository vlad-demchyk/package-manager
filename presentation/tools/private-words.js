/* global process */
// Private names (client, real projects, user) are read from a local file outside git:
// presentation/.private-words.txt or the path in PACKMAN_SITE_PRIVATE_WORDS. One regex per line
// (case-insensitive); empty lines and lines starting with # are skipped. The words are not in the repository.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** @returns {{ file: string, patterns: RegExp[] } | { file: string, error: string }} */
export function loadPrivateWords(pres) {
  const file = process.env.PACKMAN_SITE_PRIVATE_WORDS || path.join(pres, '.private-words.txt');
  if (!existsSync(file))
    return {
      file,
      error: `private word list ${file} not found: create it (one regex per line) or set PACKMAN_SITE_PRIVATE_WORDS`,
    };
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return { file, error: `private word list ${file} is empty` };
  // Longest first: otherwise a shorter name would eat part of a longer one when replacing.
  lines.sort((a, b) => b.length - a.length);
  return { file, patterns: lines.map((line) => new RegExp(line, 'gi')) };
}
