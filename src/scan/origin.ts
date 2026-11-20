/**
 * Where the receiver of a matched call comes from: the package it is imported from, a class the
 * file declares itself, or the SPFx context factory that hands out Microsoft Graph clients. A
 * `.get()` on a Graph client is then not attributed to PnPjs just because the file also imports
 * PnPjs somewhere, and `new Web()` of the legacy `sp-pnp-js` package is not `@pnp/sp`.
 *
 * The tracing is deliberately simple and file-local: imports, `const`/`let`/`var` initializers,
 * `this.x = ...` assignments, type annotations of parameters and class properties, and the
 * parameter of a `.then(...)` callback. A name is resolved by its nearest binding before the use,
 * which approximates block scope without parsing. Anything it cannot see stays unknown, and the
 * caller falls back to the file-level check.
 */

/** Package that provides `context.msGraphClientFactory` and the clients it returns. */
export const SPFX_HTTP = '@microsoft/sp-http';
/** Origin of a class the file declares itself: never a package API. */
export const LOCAL = '<local>';

const MAX_DEPTH = 8;
const MAX_BACK_SCAN = 4000;
const PRIMITIVE = /^(?:string|number|boolean|any|unknown|void|object|never|null|undefined)$/;

/** One place a name gets its value or type. */
interface Binding {
  index: number;
  /** Initializer or assigned expression. */
  expr?: string;
  /** Root identifier of a type annotation (`Client<T>` -> `Client`). */
  type?: string;
  /** Index of the `.` of `.then(` whose callback receives this name. */
  then?: number;
}

export interface FileSymbols {
  code: string;
  /** Local name -> package the name is imported (or required) from. */
  imports: Map<string, string>;
  /** Classes declared in the file. */
  classes: Set<string>;
  /** Local name -> bindings in source order (declarations, parameters, callbacks). */
  locals: Map<string, Binding[]>;
  /** `this.<name>` -> assignments and class property annotations. */
  members: Map<string, Binding[]>;
}

/** Symbols of one comment-stripped source file; build once per file and pass to the lookups. */
export function symbolsOf(code: string): FileSymbols {
  const symbols: FileSymbols = {
    code,
    imports: new Map(),
    classes: new Set(),
    locals: new Map(),
    members: new Map(),
  };
  collectImports(code, symbols);
  for (const match of code.matchAll(/\bclass\s+([\w$]+)/g))
    if (match[1]) symbols.classes.add(match[1]);
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([\w$]+)\s*(?::\s*([^=;\n]+?))?\s*(?:=\s*([^;\n]+)|;|\n)/g,
  )) {
    const binding: Binding = { index: match.index };
    if (match[3]) binding.expr = match[3];
    const type = typeRoot(match[2]);
    if (type) binding.type = type;
    push(symbols.locals, match[1], binding);
  }
  for (const match of code.matchAll(/\bthis\s*\.\s*([\w$]+)\s*=(?!=)\s*([^;\n]+)/g))
    push(symbols.members, match[1], { index: match.index, expr: match[2] ?? '' });
  // Parameters: `(graph: Client`, `, graph?: Client`.
  for (const match of code.matchAll(/[(,]\s*([\w$]+)\??\s*:\s*([A-Za-z_$][\w$.]*)/g)) {
    const type = typeRoot(match[2]);
    if (type) push(symbols.locals, match[1], { index: match.index, type });
  }
  // Class properties `private graph: Client;` (and a parameter alone on its line).
  for (const match of code.matchAll(
    /^[ \t]*((?:(?:private|public|protected|readonly|static|declare)\s+)*)([\w$]+)[?!]?\s*:\s*([A-Za-z_$][\w$.]*)/gm,
  )) {
    const type = typeRoot(match[3]);
    if (!type) continue;
    push(symbols.members, match[2], { index: match.index, type });
    if (!match[1]) push(symbols.locals, match[2], { index: match.index, type });
  }
  // `.then((client) => ...)`, `.then(async res => ...)`, `.then(function (res) {...})`.
  for (const match of code.matchAll(
    /\.\s*then\s*\(\s*(?:async\s+)?(?:function\s*[\w$]*\s*)?\(?\s*([\w$]+)\s*[:,)=]/g,
  ))
    push(symbols.locals, match[1], { index: match.index, then: match.index });
  for (const list of symbols.locals.values()) list.sort((a, b) => a.index - b.index);
  return symbols;
}

function push(map: Map<string, Binding[]>, key: string | undefined, value: Binding): void {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/**
 * `Client<T>` or `Web[]` -> `Client`; primitives, lowercase values (`key: value` in an object
 * literal) and non-identifiers -> undefined. Types are PascalCase by convention.
 */
function typeRoot(annotation: string | undefined): string | undefined {
  const root = /^\s*([A-Za-z_$][\w$]*)/.exec(annotation ?? '')?.[1];
  if (!root || PRIMITIVE.test(root) || !/^[A-Z_$]/.test(root)) return undefined;
  return root;
}

function collectImports(code: string, symbols: FileSymbols): void {
  for (const match of code.matchAll(
    /\bimport\s+(?:type\s+)?([^;'"`]{1,600}?)\s*from\s*["']([^"'\n]+)["']/g,
  )) {
    const pkg = packageOf(match[2] ?? '');
    if (pkg) bindNames(match[1] ?? '', (name) => symbols.imports.set(name, pkg));
  }
  for (const match of code.matchAll(
    /\bimport\s+([\w$]+)\s*=\s*require\(\s*["']([^"'\n]+)["']\s*\)/g,
  )) {
    const pkg = packageOf(match[2] ?? '');
    if (pkg && match[1]) symbols.imports.set(match[1], pkg);
  }
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*["']([^"'\n]+)["']\s*\)/g,
  )) {
    const pkg = packageOf(match[2] ?? '');
    if (!pkg) continue;
    const target = match[1] ?? '';
    if (target.startsWith('{')) bindNames(target, (name) => symbols.imports.set(name, pkg));
    else symbols.imports.set(target, pkg);
  }
}

/** Names bound by an import clause: `A`, `* as NS`, `{ B, C as D }`, `A, { E }`. */
function bindNames(clause: string, bind: (name: string) => void): void {
  let rest = clause.replace(/^\s*type\s+/, '');
  const braces = /\{([^}]*)\}/.exec(rest);
  if (braces) {
    for (const part of (braces[1] ?? '').split(',')) {
      const named = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
      if (named) bind(named[2] ?? named[1] ?? '');
    }
    rest = rest.replace(/\{[^}]*\}/, '');
  }
  for (const part of rest.split(',')) {
    const plain = /^\s*(?:\*\s+as\s+)?([\w$]+)\s*$/.exec(part);
    if (plain?.[1]) bind(plain[1]);
  }
}

/** `@scope/name/sub` or `name/sub` -> package name; relative, absolute and URL specifiers -> undefined. */
function packageOf(specifier: string): string | undefined {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[a-z]+:/i.test(specifier)
  )
    return undefined;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  return parts[0];
}

/**
 * Package of the receiver that ends at `index` (exclusive), or undefined when it cannot be traced:
 * for `graph.api(x).select(y).get()` matched at `.select`, the receiver is `graph.api(x)`.
 */
export function originBefore(
  symbols: FileSymbols,
  code: string,
  index: number,
): string | undefined {
  return originBeforeAt(symbols, code, index, 0);
}

function originBeforeAt(
  symbols: FileSymbols,
  code: string,
  index: number,
  depth: number,
): string | undefined {
  const chain = receiverChain(code, index);
  return chain ? originOfChain(symbols, chain, index, depth) : undefined;
}

/** Origin of a match that starts with an identifier or with `new X`, e.g. `sp.setup(` or `new Web(`. */
export function originAtIdentifier(
  symbols: FileSymbols,
  code: string,
  index: number,
): string | undefined {
  const head = /^(new\s+)?([\w$]+)/.exec(code.slice(index, index + 200));
  if (!head?.[2]) return undefined;
  if (head[1] && symbols.classes.has(head[2])) return LOCAL;
  return originOfName(symbols, head[2], index, 0);
}

/**
 * Identifier chain the receiver ends with: `this.a.b(x).c` before `.c` gives ['this', 'a', 'b', 'c'].
 * Call arguments are skipped by matching parentheses backwards; `?.` and `!.` are accepted.
 */
function receiverChain(code: string, index: number): string[] | undefined {
  const names: string[] = [];
  let end = index;
  for (let guard = 0; guard < 64; guard++) {
    let i = skipBlankBack(code, end);
    if (code[i - 1] === '!') i = skipBlankBack(code, i - 1);
    if (code[i - 1] === ')') {
      const open = openParenBack(code, i - 1);
      if (open === undefined) return undefined;
      i = skipBlankBack(code, open);
      // `.get<T>()`-style type arguments between the name and its call.
      if (code[i - 1] === '>') {
        const lt = code.lastIndexOf('<', i - 1);
        if (lt !== -1 && /^<[\w$.,\s[\]<>|]*>$/.test(code.slice(lt, i)))
          i = skipBlankBack(code, lt);
      }
    }
    const stop = i;
    while (i > 0 && /[\w$]/.test(code[i - 1] ?? '')) i--;
    if (i === stop) return undefined;
    names.unshift(code.slice(i, stop));
    const dot = skipBlankBack(code, i);
    if (code[dot - 1] !== '.') break;
    end = code[dot - 2] === '?' ? dot - 2 : dot - 1;
  }
  return names.length > 0 ? names : undefined;
}

function skipBlankBack(code: string, index: number): number {
  let i = index;
  while (i > 0 && /\s/.test(code[i - 1] ?? '')) i--;
  return i;
}

/** Index of the `(` matching the `)` at `close`, scanning backwards; undefined when unbalanced. */
function openParenBack(code: string, close: number): number | undefined {
  let depth = 0;
  const floor = Math.max(0, close - MAX_BACK_SCAN);
  for (let i = close; i >= floor; i--) {
    const ch = code[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

function originOfChain(
  symbols: FileSymbols,
  chain: string[],
  at: number,
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  // `context.msGraphClientFactory.getClient('3')` and anything chained on it: a Graph client.
  if (chain.includes('msGraphClientFactory')) return SPFX_HTTP;
  const [root, member] = chain;
  if (root === 'this') return member ? originOfMember(symbols, member, depth + 1) : undefined;
  return root ? originOfName(symbols, root, at, depth + 1) : undefined;
}

/** Nearest binding of `name` before `at`; with none before it, every binding has to agree. */
function originOfName(
  symbols: FileSymbols,
  name: string,
  at: number,
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const bindings = symbols.locals.get(name) ?? [];
  const before = bindings.filter((binding) => binding.index < at);
  const nearest = before[before.length - 1];
  if (nearest) return originOfBinding(symbols, nearest, depth + 1);
  if (bindings.length > 0) return agreed(symbols, bindings, depth + 1);
  return symbols.imports.get(name);
}

function originOfMember(symbols: FileSymbols, name: string, depth: number): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  return agreed(symbols, symbols.members.get(name) ?? [], depth + 1);
}

/** The one origin the traceable bindings agree on; conflicting or no origins -> undefined. */
function agreed(symbols: FileSymbols, bindings: Binding[], depth: number): string | undefined {
  const origins = new Set<string>();
  for (const binding of bindings) {
    const origin = originOfBinding(symbols, binding, depth);
    if (origin) origins.add(origin);
  }
  return origins.size === 1 ? [...origins][0] : undefined;
}

function originOfBinding(
  symbols: FileSymbols,
  binding: Binding,
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  if (binding.expr !== undefined) {
    const origin = originOfExpression(symbols, binding.expr, binding.index, depth + 1);
    if (origin) return origin;
  }
  if (binding.type) {
    const origin = symbols.classes.has(binding.type) ? LOCAL : symbols.imports.get(binding.type);
    if (origin) return origin;
  }
  if (binding.then !== undefined)
    return originBeforeAt(symbols, symbols.code, binding.then, depth + 1);
  return undefined;
}

function originOfExpression(
  symbols: FileSymbols,
  expr: string,
  at: number,
  depth: number,
): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const text = expr
    .trim()
    .replace(/^(?:await\s+|\(\s*|<[\w$.]+>\s*)+/, '')
    .trim();
  if (/\bmsGraphClientFactory\s*\.\s*getClient\s*\(/.test(text)) return SPFX_HTTP;
  const cast = /\bas\s+([A-Za-z_$][\w$]*)[\s)]*$/.exec(text)?.[1];
  if (cast && symbols.imports.has(cast)) return symbols.imports.get(cast);
  const head = /^(new\s+)?(this\s*\.\s*)?([\w$]+)/.exec(text);
  if (!head?.[3]) return undefined;
  if (head[2]) return originOfMember(symbols, head[3], depth + 1);
  if (head[1] && symbols.classes.has(head[3])) return LOCAL;
  return originOfName(symbols, head[3], at, depth + 1);
}
