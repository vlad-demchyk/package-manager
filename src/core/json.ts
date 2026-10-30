import { readFile } from 'node:fs/promises';
import { applyEdits, modify, parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

export type JsonResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses JSON with comments and trailing commas (tsconfig style). Never throws. */
export function parseJsonc<T = unknown>(text: string, source = '<input>'): JsonResult<T> {
  const errors: ParseError[] = [];
  const value = parse(stripBom(text), errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T;
  const first = errors[0];
  if (first) {
    return {
      ok: false,
      error: `${source}: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
    };
  }
  return { ok: true, value };
}

export async function readJsonFile<T = unknown>(file: string): Promise<JsonResult<T>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return { ok: false, error: `${file}: ${(error as Error).message}` };
  }
  return parseJsonc<T>(text, file);
}

/**
 * Applies set/remove operations to JSON text, preserving formatting, comments and key order.
 * `value: undefined` removes the property.
 */
export function editJsonText(
  text: string,
  operations: { path: (string | number)[]; value: unknown }[],
): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = detectIndent(text);
  let result = text;
  for (const { path, value } of operations) {
    const edits = modify(result, path, value, {
      formattingOptions: {
        insertSpaces: indent !== '\t',
        tabSize: indent === '\t' ? 1 : indent.length,
        eol,
      },
    });
    result = applyEdits(result, edits);
  }
  return result;
}

function detectIndent(text: string): string {
  const match = /^([ \t]+)"/m.exec(text);
  return match?.[1] ?? '  ';
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
