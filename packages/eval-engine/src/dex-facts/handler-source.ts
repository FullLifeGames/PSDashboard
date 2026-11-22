/**
 * Round 89 (#149, step A8): the text of a Dex handler, read for the properties it reads and the ids it names. The simulator runs
 * in the browser as a production build, which writes the same handler differently (comments gone, `x['a']` as `x.a`, quotes
 * turned into backticks, a list of ids joined into one string, the local names shortened), and the scan must find the same
 * reads in both: packages/eval-engine/test/state-readers-built.spec.ts builds the Dex with the app's own Vite settings and compares.
 * `lex` reads the source once, the way a build does not change: it drops comments and the text of strings, keeps the code of a
 * template's `${}`, and writes a bracket access with a plain string key as the dot access.
 */

/** The code of a source (comments dropped, every string and regular expression written as `""`, `x['key']` written as `x.key`, a quoted key of an object literal written bare) and the texts of its strings. */
export interface Lexed { code: string; strings: string[] }

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** After one of these a `/` opens a regular expression, not a division. */
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof)\s*$/;

/** Whether the code so far ends where a bracket would index something (`a.b[`, `f()[`), not where it opens an array (`return [`). */
const opensKey = (out: string): boolean => /[\w$)\]]\s*\[\s*$/.test(out) && !/\b(?:return|typeof|in|of|case|delete|void|yield|await|throw|else|new)\s*\[\s*$/.test(out);

/** The state of one pass over a source: the position, the code written so far, the texts of the strings, the depth of the `${}` it stands in. */
interface Pass { src: string; i: number; out: string; strings: string[]; depth: number }

/** A quoted string or a template without expressions that is the whole key of a bracket access: `a['key']` becomes `a.key`. Returns whether it did. */
function asDotKey(pass: Pass, text: string): boolean {
  const close = IDENT.test(text) && opensKey(pass.out) ? /^\s*\]/.exec(pass.src.slice(pass.i)) : null;
  if (!close) return false;
  pass.out = `${pass.out.replace(/\s*\[\s*$/, '')}.${text}`;
  pass.i += close[0].length;
  return true;
}

function skipComment(pass: Pass): void {
  if (pass.src[pass.i + 1] === '/') {
    while (pass.i < pass.src.length && pass.src[pass.i] !== '\n') pass.i += 1;
  } else {
    const end = pass.src.indexOf('*/', pass.i + 2);
    pass.i = end < 0 ? pass.src.length : end + 2;
  }
  pass.out += ' ';
}

function skipRegex(pass: Pass): void {
  const { src } = pass;
  let inClass = false;
  pass.i += 1;
  while (pass.i < src.length && (inClass || src[pass.i] !== '/') && src[pass.i] !== '\n') {
    if (src[pass.i] === '\\') pass.i += 1;
    else if (src[pass.i] === '[') inClass = true;
    else if (src[pass.i] === ']') inClass = false;
    pass.i += 1;
  }
  pass.i += 1;
  while (pass.i < src.length && /[a-z]/.test(src[pass.i])) pass.i += 1;
  pass.out += '""';
}

function readQuoted(pass: Pass, quote: string): void {
  const { src } = pass;
  let text = '';
  pass.i += 1;
  while (pass.i < src.length && src[pass.i] !== quote && src[pass.i] !== '\n') {
    if (src[pass.i] === '\\') { text += src[pass.i + 1] ?? ''; pass.i += 2; } else text += src[pass.i++];
  }
  pass.i += 1;
  if (asDotKey(pass, text)) return;
  // A quoted key of an object literal is written bare, as a build writes it.
  if (IDENT.test(text) && /[{,]\s*$/.test(pass.out) && /^\s*:/.test(src.slice(pass.i))) pass.out += text;
  else {
    pass.strings.push(text);
    pass.out += '""';
  }
}

function readTemplate(pass: Pass): void {
  const { src } = pass;
  let text = '';
  let expressions = '';
  pass.i += 1;
  while (pass.i < src.length && src[pass.i] !== '`') {
    if (src[pass.i] === '\\') { text += src[pass.i + 1] ?? ''; pass.i += 2; } else if (src[pass.i] === '$' && src[pass.i + 1] === '{') {
      const inner: Pass = { src, i: pass.i + 2, out: '', strings: pass.strings, depth: -1 };
      lexUntilClose(inner);
      expressions += `;${inner.out};`;
      pass.i = inner.i;
    } else text += src[pass.i++];
  }
  pass.i += 1;
  if (expressions === '' && asDotKey(pass, text)) return;
  pass.strings.push(text);
  pass.out += `""${expressions}`;
}

/** Reads the code of the pass to its end, or, inside a `${}` (depth below zero from the start), to the brace that closes it. */
function lexUntilClose(pass: Pass): void {
  const { src } = pass;
  const nested = pass.depth < 0;
  pass.depth = 0;
  while (pass.i < src.length) {
    const c = src[pass.i];
    const next = src[pass.i + 1];
    if (c === '/' && (next === '/' || next === '*')) skipComment(pass);
    else if (c === '/' && REGEX_AFTER.test(pass.out)) skipRegex(pass);
    else if (c === '"' || c === "'") readQuoted(pass, c);
    else if (c === '`') readTemplate(pass);
    else {
      if (c === '}' && nested && pass.depth === 0) { pass.i += 1; return; }
      if (c === '{') pass.depth += 1;
      else if (c === '}') pass.depth -= 1;
      pass.out += c;
      pass.i += 1;
    }
  }
}

export const lex = (source: string): Lexed => {
  const pass: Pass = { src: source, i: 0, out: '', strings: [], depth: 0 };
  lexUntilClose(pass);
  return { code: pass.out, strings: pass.strings };
};

/** A property read: `.name` that is no spread, no property of a string and no assignment target. */
const READ = /(?<!\.|"")\.([A-Za-z_$][\w$]*)(?![\w$])(?!\s*(?:=(?!=)|\+\+|--|[-+*/%|&^]=|\*\*=|<<=|>>=))/g;

/** The property names the code of a lexed source reads. */
export const readsOfCode = (code: string): Set<string> => {
  const found = new Set<string>();
  for (const match of code.matchAll(READ)) found.add(match[1]);
  return found;
};

/** One id (`volatile`), and a list of ids behind one separator, which is how a build writes `['a', 'b']` as `'a.b'.split('.')`. */
const ID_STRING = /^[a-z][a-z0-9]{2,}$/;
const ID_LIST = /^[a-z0-9]+(?:[^\sa-z0-9][a-z0-9]+)+$/;

/**
 * The ids the strings of a source name. The keys of an object literal are no names: a build writes a quoted key bare and a
 * shorthand `{ pokemon }` as `{ pokemon: e }`, so no rule can read them the same in both.
 */
export function idsOfStrings(strings: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const text of strings) {
    if (ID_STRING.test(text)) found.add(text);
    else if (ID_LIST.test(text)) for (const piece of text.split(/[^a-z0-9]+/)) if (ID_STRING.test(piece)) found.add(piece);
  }
  return found;
}
