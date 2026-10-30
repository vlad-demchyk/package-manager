import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { editJsonText } from '../core/json.js';
import type { Edit, Fix } from '../core/types.js';

export interface FilePreview {
  file: string;
  before: string;
  after: string;
  /** For deletions. */
  deleted?: boolean;
}

export interface ApplyResult {
  files: string[];
  backupDir: string;
}

/** Copies only the named files, preserving their workspace-relative paths. */
export async function backupFiles(
  root: string,
  files: string[],
  now = new Date(),
): Promise<string> {
  const backupRoot = path.join(root, '.packman', 'backups');
  await mkdir(backupRoot, { recursive: true });
  const backupDir = await mkdtemp(
    path.join(backupRoot, `${now.toISOString().replace(/[:.]/g, '-')}-`),
  );
  for (const file of new Set(files)) {
    const relative = path.relative(root, file);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error(`backup path outside workspace: ${file}`);
    if (!existsSync(file)) continue;
    const target = path.join(backupDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  return backupDir;
}

/**
 * Merges edits from several fixes; later edits on the same JSON path win, except that a removal
 * made by one fix is never undone by another fix (a package moved or merged out of a section must
 * not be written back there by, for example, a version alignment of the old location).
 */
export function collectEdits(fixes: Fix[]): Edit[] {
  const keyOf = (edit: Edit): string =>
    edit.kind === 'file-delete' || edit.kind === 'file-write'
      ? `${edit.file}#whole`
      : `${edit.file}#${JSON.stringify(edit.path)}`;
  const removedBy = new Map<string, Fix>();
  for (const item of fixes) {
    for (const edit of item.edits)
      if (edit.kind === 'json-remove') removedBy.set(keyOf(edit), item);
  }
  const byKey = new Map<string, Edit>();
  for (const item of fixes) {
    for (const edit of item.edits) {
      const key = keyOf(edit);
      const remover = removedBy.get(key);
      if (edit.kind === 'json-set' && remover && remover !== item) continue;
      byKey.delete(key);
      byKey.set(key, edit);
    }
  }
  return [...byKey.values()];
}

export async function previewEdits(edits: Edit[]): Promise<FilePreview[]> {
  const byFile = new Map<string, Edit[]>();
  for (const edit of edits) {
    const list = byFile.get(edit.file) ?? [];
    list.push(edit);
    byFile.set(edit.file, list);
  }
  const previews: FilePreview[] = [];
  for (const [file, fileEdits] of byFile) {
    const before = existsSync(file) ? await readFile(file, 'utf8') : '';
    if (fileEdits.some((edit) => edit.kind === 'file-delete')) {
      previews.push({ file, before, after: '', deleted: true });
      continue;
    }
    const write = fileEdits.find((edit) => edit.kind === 'file-write');
    if (write?.kind === 'file-write') {
      if (write.content !== before) previews.push({ file, before, after: write.content });
      continue;
    }
    const operations = fileEdits.flatMap((edit) =>
      edit.kind === 'json-set'
        ? [{ path: edit.path, value: edit.value }]
        : edit.kind === 'json-remove'
          ? [{ path: edit.path, value: undefined }]
          : [],
    );
    const after = editJsonText(before === '' ? '{}\n' : before, operations);
    if (after !== before) previews.push({ file, before, after });
  }
  return previews;
}

/** Writes previews, backing up every touched file under `<root>/.packman/backups/<timestamp>/`. */
export async function applyPreviews(
  root: string,
  previews: FilePreview[],
  now = new Date(),
): Promise<ApplyResult> {
  // Confirmation may take time: refuse stale previews before touching any file.
  for (const preview of previews) {
    const current = existsSync(preview.file) ? await readFile(preview.file, 'utf8') : '';
    if (current !== preview.before)
      throw new Error(
        `file changed since preview: ${path.relative(root, preview.file)}; review the changes again`,
      );
  }
  const backupDir = await backupFiles(
    root,
    previews.map((preview) => preview.file),
    now,
  );
  for (const preview of previews) {
    if (preview.deleted) {
      await rm(preview.file, { force: true });
    } else {
      await mkdir(path.dirname(preview.file), { recursive: true });
      await writeFile(preview.file, preview.after, 'utf8');
    }
  }
  return { files: previews.map((preview) => preview.file), backupDir };
}

/** Minimal line diff for terminal previews. */
export function lineDiff(before: string, after: string, context = 1): string[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const start = out.length;
    for (let k = Math.max(0, i - context); k < i; k++) out.push(`  ${a[k] ?? ''}`);
    // Find the next resynchronisation point.
    let syncA = a.length;
    let syncB = b.length;
    search: for (let da = 0; da < 50; da++) {
      for (let db = 0; db < 50; db++) {
        if (a[i + da] !== undefined && a[i + da] === b[j + db] && a[i + da + 1] === b[j + db + 1]) {
          syncA = i + da;
          syncB = j + db;
          break search;
        }
      }
    }
    for (let k = i; k < syncA; k++) out.push(`- ${a[k] ?? ''}`);
    for (let k = j; k < syncB; k++) out.push(`+ ${b[k] ?? ''}`);
    if (out.length === start) break;
    i = syncA;
    j = syncB;
  }
  return out;
}
