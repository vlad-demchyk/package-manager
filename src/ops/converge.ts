import { existsSync, readFileSync } from 'node:fs';
import { parseJsonc } from '../core/json.js';
import type { Fix } from '../core/types.js';

/**
 * Repeated fix passes (fix, rebuild the store, check again) must settle. A pass that would put back
 * what an earlier pass changed (remove a package one pass added, or set a version back) is a cycle:
 * the fix is held back and reported instead of applied, so passes never go back and forth.
 */

/** One JSON value a fix changes: `before` and `after` are JSON text, undefined when absent. */
export interface EditStep {
  key: string;
  file: string;
  path: (string | number)[];
  before: string | undefined;
  after: string | undefined;
  fixId: string;
  pass: number;
}

export interface Cycle {
  step: EditStep;
  /** The earlier step this one would undo. */
  undoes: EditStep;
}

const keyOf = (file: string, path: (string | number)[]): string =>
  `${file}#${JSON.stringify(path)}`;

function valueAt(document: unknown, path: (string | number)[]): unknown {
  let value = document;
  for (const part of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string | number, unknown>)[part];
  }
  return value;
}

/** Reads a JSON file the way a pass sees it before its edits. */
export function readJsonForSteps(file: string): unknown {
  if (!existsSync(file)) return undefined;
  const parsed = parseJsonc(readFileSync(file, 'utf8'), file);
  return parsed.ok ? parsed.value : undefined;
}

/** The JSON values the fixes of one pass change, with the value each had before. */
export function editSteps(
  fixes: Fix[],
  pass: number,
  read: (file: string) => unknown = readJsonForSteps,
): EditStep[] {
  const documents = new Map<string, unknown>();
  const steps: EditStep[] = [];
  for (const item of fixes)
    for (const edit of item.edits) {
      if (edit.kind !== 'json-set' && edit.kind !== 'json-remove') continue;
      if (!documents.has(edit.file)) documents.set(edit.file, read(edit.file));
      const before = valueAt(documents.get(edit.file), edit.path);
      const after = edit.kind === 'json-set' ? edit.value : undefined;
      steps.push({
        key: keyOf(edit.file, edit.path),
        file: edit.file,
        path: edit.path,
        before: before === undefined ? undefined : JSON.stringify(before),
        after: after === undefined ? undefined : JSON.stringify(after),
        fixId: item.id,
        pass,
      });
    }
  return steps.filter((step) => step.before !== step.after);
}

/**
 * Steps of the next pass that undo an earlier pass: same file and path, back to a value the path had
 * before an earlier step (A -> B -> A, also A -> B -> C -> A over three passes).
 */
export function findCycles(history: EditStep[], next: EditStep[]): Cycle[] {
  const cycles: Cycle[] = [];
  for (const step of next) {
    const earlier = history.filter((item) => item.key === step.key && item.pass < step.pass);
    const undoes = earlier.find((item) => item.before === step.after);
    if (undoes) cycles.push({ step, undoes });
  }
  return cycles;
}

/** The fixes of a pass without the ones that would undo an earlier pass. */
export function withoutCycles(fixes: Fix[], cycles: Cycle[]): Fix[] {
  const held = new Set(cycles.map((cycle) => cycle.step.fixId));
  return fixes.filter((item) => !held.has(item.id));
}

/** `app/package.json dependencies.@pnp/logging: pass 1 changed "4.1.0" -> absent, pass 2 would change it back (fix id)`. */
export function describeCycle(cycle: Cycle, relative: (file: string) => string = (f) => f): string {
  const show = (value: string | undefined): string => value ?? 'absent';
  return `${relative(cycle.step.file)} ${cycle.step.path.join('.')}: pass ${cycle.undoes.pass} changed ${show(cycle.undoes.before)} -> ${show(cycle.undoes.after)}, pass ${cycle.step.pass} would change it back (${cycle.step.fixId})`;
}
