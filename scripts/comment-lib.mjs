// The one reader of comments for the comment tools: scripts/comment-only-diff.mjs (proof that an edit moved no code),
// scripts/comment-counts.mjs (the comment ratchet) and eslint.comments.mjs (the rule comments/no-history).
//
// A comment that code reads is never history and never changes in a comment-only edit: `// oracle:` markers (they name the spec that holds the list; one spec still reads its own),
// eslint directives, TypeScript and test-runner pragmas, triple-slash references, shebangs and legal headers. `readByCode` is the
// one list of them; the checker compares them byte for byte, the rule and the counter leave them out.
import ts from 'typescript';

const SCRIPT_KINDS = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

/** The script kind of a file name, or undefined for a file the tools do not read as code. */
export function scriptKindOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? undefined : SCRIPT_KINDS[fileName.slice(dot)];
}

export const isCss = fileName => fileName.endsWith('.css');

/** What a comment of the repository's own marker looks like: `// oracle: <spec path>`; it names the spec that holds the list below it, and one spec still reads its own. */
const ORACLE_LINE = /^\s*(\/\/|\/\*+|\*)?\s*oracle:/;

/**
 * Patterns that make a whole comment code-read, tested on the comment's text without its delimiters and leading asterisks. The
 * pragmas stand at the start of a line of the comment: a sentence that names one is prose.
 */
const DIRECTIVES = [
  ['eslint', /^eslint-(disable|enable|env)\b/],
  ['eslint', /^eslint\s+[@\w./-]+\s*:/],
  ['typescript', /^@ts-(expect-error|ignore|nocheck|check)\b/m],
  ['vitest', /^@vitest-environment/m],
  ['coverage', /^(istanbul|v8|c8)\s+ignore\b/m],
  ['jsx', /@jsx\w*\b/],
  ['bundler', /[@#]__(PURE|NO_SIDE_EFFECTS)__|@vite-ignore|webpackIgnore/],
  ['sourcemap', /[#@]\s*sourceMappingURL=/],
  ['legal', /@(license|preserve|copyright)\b|\bcopyright\b|SPDX-License-Identifier/i],
];

/** The text of a comment without its delimiters, its leading asterisks and its outer whitespace. */
function body(raw) {
  if (raw.startsWith('//')) return raw.slice(2).trim();
  if (raw.startsWith('/*')) return raw.slice(2, raw.endsWith('*/') ? -2 : undefined).split(/\r?\n/).map(line => line.replace(/^\s*\*+/, '').trim()).join('\n').trim();
  return raw.trim();
}

/**
 * How code reads a comment, given its raw text with delimiters:
 *   null            no code reads it
 *   { all: kind }   the whole comment is read (a directive, a reference, a shebang, a legal header)
 *   { lines: [n] }  only those lines of it (0-based): the `oracle:` marker lines
 */
export function readByCode(raw) {
  if (raw.startsWith('#!')) return { all: 'shebang' };
  if (/^\/\/\/\s*<(reference|amd-)/.test(raw)) return { all: 'reference' };
  if (raw.startsWith('/*!')) return { all: 'legal' };
  const text = body(raw);
  for (const [kind, pattern] of DIRECTIVES) if (pattern.test(text)) return { all: kind };
  const lines = raw.split(/\r?\n/).flatMap((line, index) => (ORACLE_LINE.test(line) ? [index] : []));
  return lines.length > 0 ? { lines } : null;
}

const isLineBreak = ch => ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
const isSpace = ch => /\s/.test(ch) || ch === '\ufeff';

/**
 * The comments in the trivia that starts at `from`: returns them and the offset of the first character that is no trivia.
 * `from` is the end of a token (or 0, where a shebang line counts as a comment).
 */
export function scanTrivia(text, from) {
  const comments = [];
  let at = from;
  if (from === 0 && text.startsWith('#!')) {
    let end = 2;
    while (end < text.length && !isLineBreak(text[end])) end++;
    comments.push({ start: 0, end, text: text.slice(0, end) });
    at = end;
  }
  for (;;) {
    while (at < text.length && isSpace(text[at])) at++;
    if (text.startsWith('//', at)) {
      let end = at + 2;
      while (end < text.length && !isLineBreak(text[end])) end++;
      comments.push({ start: at, end, text: text.slice(at, end) });
      at = end;
    } else if (text.startsWith('/*', at)) {
      const close = text.indexOf('*/', at + 2);
      const end = close < 0 ? text.length : close + 2;
      comments.push({ start: at, end, text: text.slice(at, end) });
      at = end;
    } else return { comments, end: at };
  }
}

const isChildlessJsxExpression = node => node.kind === ts.SyntaxKind.JsxExpression && !node.expression && !node.dotDotDotToken
  && (node.parent.kind === ts.SyntaxKind.JsxElement || node.parent.kind === ts.SyntaxKind.JsxFragment);

const isJsDoc = node => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

/** JSX text as React reads it: whitespace between lines folds, a run that holds only whitespace and a line break is nothing. */
export function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((line, index) => {
    let text = line.replace(/\t/g, ' ');
    if (index > 0) text = text.replace(/^ +/, '');
    if (index < lines.length - 1) text = text.replace(/ +$/, '');
    if (text) kept.push(text);
  });
  return kept.join(' ');
}

/**
 * Reads a source text as a stream of items: `{ k: 't', text, lb, line }` for a token (lb: a line break comes before it) and
 * `{ k: 'c', text, ... }` for a comment, in source order. Parse errors come back in `errors`. The tokens come from the compiler's
 * syntax tree (so a regular expression, a template or JSX text reads right); a `{/* c *\/}` JSX child holds only comments and is no
 * token, and the JSX text around it is folded as React folds it.
 */
export function readSource(text, fileName) {
  const kind = scriptKindOf(fileName);
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const errors = sf.parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  const items = [];
  const lineOf = offset => sf.getLineAndCharacterOfPosition(offset).line + 1;
  let tokenCount = 0;

  /** Push the comments of a trivia run; each carries what the pragma comparison needs. */
  const pushRun = (run, from, nextStart) => {
    run.comments.forEach((comment, index) => {
      const after = text.slice(comment.end, nextStart);
      let masked = after;
      for (const later of run.comments.slice(index + 1)) masked = masked.replace(text.slice(later.start, later.end), 'X');
      items.push({
        k: 'c',
        text: comment.text,
        start: comment.start,
        line: lineOf(comment.start),
        sameLine: tokenCount > 0 && !/[\n\r]/.test(text.slice(from, comment.start)),
        newlinesAfter: (after.match(/\r\n|\n|\r/g) ?? []).length,
        contiguous: !/(\r\n|\n|\r)[ \t]*(\r\n|\n|\r)/.test(masked),
      });
    });
  };

  const visit = node => {
    if (isJsDoc(node)) return;
    if (isChildlessJsxExpression(node)) {
      const open = scanTrivia(text, node.pos);
      pushRun(open, node.pos, open.end);
      const close = scanTrivia(text, open.end + 1);
      pushRun(close, open.end + 1, close.end);
      items.push({ k: 'skip' });
      return;
    }
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    const isEof = node.kind === ts.SyntaxKind.EndOfFileToken;
    const isText = node.kind === ts.SyntaxKind.JsxText;
    const start = isText ? node.pos : node.getStart(sf);
    const run = isText ? { comments: [], end: start } : scanTrivia(text, node.pos);
    if (!isText) pushRun(run, node.pos, start);
    if (isEof || node.end === node.pos) return;
    const raw = text.slice(start, node.end);
    const lb = !isText && /[\n\r\u2028\u2029]/.test(text.slice(node.pos, start)) && tokenCount > 0;
    tokenCount++;
    const last = items.findLast(item => item.k === 't');
    if (isText && last?.jsx && items.at(-1)?.k !== 't') {
      last.text += raw;
      return;
    }
    items.push({ k: 't', text: raw, lb, line: lineOf(start), jsx: isText });
  };
  visit(sf);
  return { items: finalize(items), errors };
}

/** Folds JSX text tokens, drops the ones that hold nothing, and numbers every comment by the tokens before it. */
function finalize(items) {
  const out = [];
  let tokens = 0;
  for (const item of items) {
    if (item.k === 'skip') continue;
    if (item.k === 't' && item.jsx) {
      const folded = jsxText(item.text);
      if (!folded) continue;
      out.push({ ...item, text: folded });
      tokens++;
    } else if (item.k === 't') {
      out.push(item);
      tokens++;
    } else out.push({ ...item, at: tokens });
  }
  return out;
}

/** The comments of a CSS text and the text with every comment folded into one space, whitespace collapsed. */
export function readCss(text) {
  const comments = [];
  let stripped = '';
  let at = 0;
  while (at < text.length) {
    const ch = text[at];
    if (ch === '"' || ch === "'") {
      let end = at + 1;
      while (end < text.length && text[end] !== ch && !isLineBreak(text[end])) end += text[end] === '\\' ? 2 : 1;
      stripped += text.slice(at, end + 1);
      at = end + 1;
    } else if (ch === '/' && text[at + 1] === '*') {
      const close = text.indexOf('*/', at + 2);
      const end = close < 0 ? text.length : close + 2;
      comments.push({ text: text.slice(at, end), start: at });
      stripped += ' ';
      at = end;
    } else {
      stripped += ch;
      at++;
    }
  }
  return { comments, stripped: stripped.replace(/\s+/g, ' ').trim() };
}

/** The comments of a file as `{ text, line, start }` (`start`: the offset in the text), whatever its language. */
export function commentsOf(text, fileName) {
  if (isCss(fileName)) {
    const lineOf = offset => text.slice(0, offset).split('\n').length;
    return readCss(text).comments.map(comment => ({ text: comment.text, line: lineOf(comment.start), start: comment.start }));
  }
  return readSource(text, fileName).items.filter(item => item.k === 'c');
}

/**
 * History in a comment: a round, a ruling, a gate, a date, a T-number, an issue or pull request number, a word that tells what the
 * code was ("used to", "formerly"). Each pattern has a name for the rule's message; the comment lines it finds are counted once.
 * The sources of the repository's own rule: AGENTS.md "Rules for the code", comments.
 */
export const HISTORY_PATTERNS = [
  ['round', /\b(?:round|Round|Runde)s?\s+\d+/],
  ['ruling', /\bruling\s+\d+/i],
  ['gate', /\buser gate\b|\bgate\s+\d+[a-z]?\b|\bgate\s+[A-Z]\d/],
  ['date', /\b\d{1,2}\.\d{1,2}\.20\d\d\b|\b20\d\d-\d\d-\d\d\b/],
  ['T-number', /\bT\d{2,3}[a-z]?\b/],
  ['issue', /(?:^|[\s(])#\d{2,4}\b|\b(?:issue|PR|pull request)\s+#?\d+\b/i],
  ['lane', /\blane [A-Z]\b/],
  ['past', /\bused to\b|\bformerly\b|\bpreviously\b|\bsince round\b|\bbefore round\b|\b(?:was|were) (?:removed|replaced|dropped|renamed|moved)\b/],
  ['decision', /\buser (?:ruled|ruling|decided|asked|okayed|reported)\b|\bruled by the user\b/],
];

/** The text a history pattern reads on one comment line: delimiters and leading asterisks off. */
const lineText = line => line.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?)\s?/, '').replace(/\*\/\s*$/, '');

/**
 * The lines of a comment (raw text with delimiters) that carry history: `{ line, pattern }`, `line` 0-based inside the comment.
 * A comment that code reads is left out (a directive whole, an oracle marker by its own line).
 */
export function historyHits(raw) {
  const read = readByCode(raw);
  if (read?.all) return [];
  const hits = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (read?.lines?.includes(index)) return;
    const text = lineText(line);
    const found = HISTORY_PATTERNS.find(([, pattern]) => pattern.test(text));
    if (found) hits.push({ line: index, pattern: found[0] });
  });
  return hits;
}

/** The history lines of a whole file, with their 1-based line numbers; used by the ratchet and by the rule's spec. */
export function historyLinesOf(text, fileName) {
  return commentsOf(text, fileName).flatMap(comment => historyHits(comment.text).map(hit => ({ line: comment.line + hit.line, pattern: hit.pattern })));
}
