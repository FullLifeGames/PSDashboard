/** The code and strings of a handler; a build writes them differently (state-readers-built.spec.ts compares both). */

export interface Lexed { code: string; strings: string[] }

const IDENT = /^[A-Za-z_$][\w$]*$/;
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof)\s*$/;

const opensKey = (out: string): boolean => /[\w$)\]]\s*\[\s*$/.test(out) && !/\b(?:return|typeof|in|of|case|delete|void|yield|await|throw|else|new)\s*\[\s*$/.test(out);

interface Pass { src: string; i: number; out: string; strings: string[]; depth: number }

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

const READ = /(?<!\.|"")\.([A-Za-z_$][\w$]*)(?![\w$])(?!\s*(?:=(?!=)|\+\+|--|[-+*/%|&^]=|\*\*=|<<=|>>=))/g;

export const readsOfCode = (code: string): Set<string> => {
  const found = new Set<string>();
  for (const match of code.matchAll(READ)) found.add(match[1]);
  return found;
};

// One id, or a list of ids behind one separator: a build writes ['a', 'b'] as 'a.b'.split('.').
const ID_STRING = /^[a-z][a-z0-9]{2,}$/;
const ID_LIST = /^[a-z0-9]+(?:[^\sa-z0-9][a-z0-9]+)+$/;

/** Object-literal keys are no names: a build writes a quoted key bare and a shorthand { pokemon } as { pokemon: e }. */
export function idsOfStrings(strings: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const text of strings) {
    if (ID_STRING.test(text)) found.add(text);
    else if (ID_LIST.test(text)) for (const piece of text.split(/[^a-z0-9]+/)) if (ID_STRING.test(piece)) found.add(piece);
  }
  return found;
}
