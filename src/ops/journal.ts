import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const JOURNAL = path.join('.packman', 'journal.jsonl');

export interface JournalEntry {
  at: string;
  command: string;
  projects: string[];
  files?: string[];
  result: 'ok' | 'failed' | 'aborted';
  detail?: string;
}

/** Appends one operation to `.packman/journal.jsonl` (2.x session logs, as structured history). */
export async function journal(root: string, entry: Omit<JournalEntry, 'at'>): Promise<void> {
  try {
    await mkdir(path.join(root, '.packman'), { recursive: true });
    await appendFile(
      path.join(root, JOURNAL),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  } catch {
    // The journal never blocks an operation.
  }
}

export async function readJournal(root: string): Promise<JournalEntry[]> {
  const text = await readFile(path.join(root, JOURNAL), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JournalEntry];
      } catch {
        return [];
      }
    });
}

/** Keeps only the entries newer than `days` days. */
export async function pruneJournal(root: string, days: number, now = new Date()): Promise<number> {
  const entries = await readJournal(root);
  const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
  const kept = entries.filter((entry) => Date.parse(entry.at) >= limit);
  await writeFile(
    path.join(root, JOURNAL),
    kept.map((entry) => JSON.stringify(entry)).join('\n') + (kept.length ? '\n' : ''),
    'utf8',
  );
  return entries.length - kept.length;
}
