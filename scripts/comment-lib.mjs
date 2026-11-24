// The one reader of comments for the comment tools and rules: comment-only-diff.mjs, comment-counts.mjs, eslint.comments.mjs.
// `readByCode` lists the comments code reads (`oracle:` lines, directives, pragmas, references, shebangs, legal headers).
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

export const isYaml = fileName => /\.ya?ml$/.test(fileName);

/** The repository's marker `// oracle: <spec path>`, which names the spec that holds the list below it. */
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
  return { items: finalize(items), errors, sf };
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

/**
 * The `#` comments of a YAML text: a `#` at the start of a line or after whitespace, outside quotes, to the end of the line. A
 * shell comment inside a `run: |` block counts as one (it is a comment of the workflow); `$#` and `${x#y}` do not.
 */
export function readHashComments(text) {
  const comments = [];
  let offset = 0;
  text.split('\n').forEach((line, index) => {
    let quote = '';
    for (let at = 0; at < line.length; at++) {
      const ch = line[at];
      if (quote) {
        if (ch === '\\' && quote === '"') at++;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '#' && (at === 0 || /\s/.test(line[at - 1]))) {
        comments.push({ text: line.slice(at).replace(/\r$/, ''), line: index + 1, start: offset + at });
        break;
      }
    }
    offset += line.length + 1;
  });
  return comments;
}

/** The comments of a file as `{ text, line, start }` (`start`: the offset in the text), whatever its language. */
export function commentsOf(text, fileName) {
  if (isYaml(fileName)) return readHashComments(text);
  if (isCss(fileName)) {
    const lineOf = offset => text.slice(0, offset).split('\n').length;
    return readCss(text).comments.map(comment => ({ text: comment.text, line: lineOf(comment.start), start: comment.start }));
  }
  return readSource(text, fileName).items.filter(item => item.k === 'c');
}

/**
 * History in a comment: a round, a ruling, a gate, a date, a T-number, an issue or pull request number, a branch name, a plan
 * or gate code, a word that tells what the code was ("used to", "formerly"). Each pattern has a name for the rule's message; the
 * comment lines it finds are counted once. The sources of the repository's own rule: AGENTS.md "Rules for the code", comments.
 */
export const HISTORY_PATTERNS = [
  ['round', /\b(?:round|Round|Runde)s?\s+\d+/],
  ['ruling', /\bruling\s+\d+/i],
  ['gate', /\buser gate\b|\bgate\s+\d+[a-z]?\b|\bgate\s+[A-Z]\d/],
  ['date', /\b\d{1,2}\.\d{1,2}\.20\d\d\b|\b20\d\d-\d\d-\d\d\b/],
  ['T-number', /\bT\d{2,3}[a-z]?\b/],
  ['issue', /(?:^|[\s(\[,;])#\d{2,4}\b|\b(?:issue|PR|pull request)\s+#?\d+\b/i],
  ['lane', /\blane [A-Z]\d?\b/],
  ['branch', /\br\d{2,3}[a-z]?\b/],
  ['plan-code', /\bD\d{1,2}[a-z]?\b|\b[A-Z]\d{1,2}[a-z]\b|\b(?:NG|FT|FB|SB|WP)-?\d{1,2}[a-z]?\b/],
  ['trail', /\b(?:decision|question|finding)\s+[A-Z]?\d+[a-z]?\b|\breview of wave\b|\bfinal review\b/i],
  ['past', /\bused to\b|\bformerly\b|\bpreviously\b|\bsince round\b|\bbefore round\b|\b(?:was|were) (?:removed|replaced|dropped|renamed|moved)\b/],
  ['decision', /\buser (?:ruled|ruling|decided|asked|okayed|reported)\b|\bruled by the user\b/],
];

/** The patterns a test title is held to: the history patterns without the wording of the comment rule ("used to" and the user's decisions are game facts in a title). */
export const TITLE_HISTORY_PATTERNS = HISTORY_PATTERNS.filter(([name]) => name !== 'past' && name !== 'decision');

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
    const text = raw.startsWith('#') ? line.replace(/^\s*#+\s?/, '') : lineText(line);
    const found = HISTORY_PATTERNS.find(([, pattern]) => pattern.test(text));
    if (found) hits.push({ line: index, pattern: found[0] });
  });
  return hits;
}

/** The history lines of a whole file, with their 1-based line numbers; used by the ratchet and by the rule's spec. */
export function historyLinesOf(text, fileName) {
  return commentsOf(text, fileName).flatMap(comment => historyHits(comment.text).map(hit => ({ line: comment.line + hit.line, pattern: hit.pattern })));
}

/** The limits of `shapeHits`: width, lines per gap, lines of an export's JSDoc, and `localDoc` (allow or forbid). */
export const SHAPE_DEFAULTS = { width: 120, lines: 2, exportLines: 1, localDoc: 'allow' };

const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g;
const BLANK_LINE = /(?:\r\n|[\n\r\u2028\u2029])[ \t]*(?:\r\n|[\n\r\u2028\u2029])/;
const LONE_URL = /^<?https?:\/\/\S+>?$/;
const DECLARATIONS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
]);

// The start and end of each physical line (the end leaves the line break out) and the line of an offset.
function lineMap(text) {
  const starts = [0];
  const ends = [];
  for (const match of text.matchAll(LINE_BREAK)) {
    ends.push(match.index);
    starts.push(match.index + match[0].length);
  }
  ends.push(text.length);
  const lineAt = offset => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  return { starts, ends, lineAt };
}

// One physical line of a comment without its delimiters and outer whitespace.
const lineBody = segment => segment.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+)\s?/, '').replace(/\*\/\s*$/, '').trim();

// A comment as `shapeHits` reads it: its physical lines, the ones that hold counted text, and whether it trails code.
function describeComment(comment, text, map) {
  const start = comment.start;
  const end = start + comment.text.length;
  const first = map.lineAt(start);
  const last = map.lineAt(Math.max(start, end - 1));
  const read = readByCode(comment.text);
  const lines = [];
  for (let index = first; index <= last; index++) {
    const segment = text.slice(Math.max(map.starts[index], start), Math.min(map.ends[index], end));
    const skipped = read?.all || read?.lines?.includes(index - first);
    lines.push({ line: index + 1, body: skipped ? '' : lineBody(segment), width: map.ends[index] - map.starts[index] });
  }
  const before = text.slice(map.starts[first], start);
  return {
    start,
    end,
    raw: comment.text,
    read,
    lines,
    counted: lines.filter(line => line.body !== ''),
    own: /^\s*\{?\s*$/.test(before),
    indent: before,
  };
}

// The names that `export { }` or `export default x` make exports of declarations of the same module.
function exportedNames(sf) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) names.add(stmt.expression.text);
    else if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const element of stmt.exportClause.elements) names.add((element.propertyName ?? element.name).text);
    }
  }
  return names;
}

const bindingNames = name => (ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(element => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name))));

const declaredNames = stmt =>
  (stmt.kind === ts.SyntaxKind.VariableStatement ? stmt.declarationList.declarations.flatMap(declaration => bindingNames(declaration.name)) : stmt.name ? [stmt.name.text] : []);

const hasExportKeyword = stmt => ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);

// The last `/**` before a top-level statement, with no blank line between.
function docBefore(stmt, text, sf) {
  const trivia = scanTrivia(text, stmt.pos);
  const docs = trivia.comments.filter(comment => comment.text.startsWith('/**') && (stmt.pos === 0 || /[\n\r\u2028\u2029]/.test(text.slice(stmt.pos, comment.start))));
  const doc = docs.at(-1);
  return doc && !BLANK_LINE.test(text.slice(doc.end, stmt.getStart(sf))) ? doc : undefined;
}

// The `lines` hit of one gap; `fileText` (file start only) splits the header run from the rest.
function gapHits(descs, limit, fileText) {
  const groups = [];
  const runs = [];
  if (fileText) {
    let run = [];
    for (const desc of descs) {
      if (run.length > 0 && BLANK_LINE.test(fileText.slice(run.at(-1).end, desc.start))) {
        runs.push(run);
        run = [];
      }
      run.push(desc);
    }
    runs.push(run);
    const at = runs.findIndex(run => run.some(desc => desc.counted.length > 0));
    if (at < 0) return [];
    groups.push(runs[at], runs.filter((_, index) => index !== at).flat());
  } else groups.push(descs);
  return groups.flatMap(group => {
    const counted = group.flatMap(desc => desc.counted);
    return counted.length > limit ? [{ line: counted[0].line, rule: 'lines', message: `${counted.length} comment text lines in a row, at most ${limit}` }] : [];
  });
}

/** The shape hits of a file as `{ line, rule, message, fix? }`: wide, lines, oneLine, exportDoc and localDoc. */
export function shapeHits(text, fileName, options = {}) {
  const opt = { ...SHAPE_DEFAULTS, ...options };
  const map = lineMap(text);
  const code = scriptKindOf(fileName) !== undefined;
  const source = code ? readSource(text, fileName) : undefined;
  const comments = source ? source.items.filter(item => item.k === 'c') : commentsOf(text, fileName);
  const descs = comments.map(comment => ({ ...describeComment(comment, text, map), at: comment.at }));
  const hits = [];

  for (const desc of descs) {
    if (desc.read?.all) continue;
    for (const line of desc.lines) {
      if (line.body !== '' && line.width > opt.width && !LONE_URL.test(line.body)) {
        hits.push({ line: line.line, rule: 'wide', message: `comment line runs to column ${line.width}, at most ${opt.width}` });
      }
    }
    if (!desc.read && desc.own && desc.lines.length > 1 && desc.counted.length === 1 && desc.raw.startsWith('/*')) {
      const fixed = `${desc.raw.startsWith('/**') ? '/**' : '/*'} ${desc.counted[0].body} */`;
      const fits = desc.indent.length + fixed.length <= opt.width && !desc.counted[0].body.includes('*/');
      hits.push({
        line: desc.lines[0].line,
        rule: 'oneLine',
        message: 'a comment of one text line takes one physical line',
        ...(fits ? { fix: { start: desc.start, end: desc.end, text: fixed } } : {}),
      });
    }
  }

  const gaps = [];
  let previous;
  for (const desc of descs.filter(item => item.own)) {
    const joined = previous && (code
      ? previous.at === desc.at
      : isYaml(fileName)
        ? previous.lines.at(-1).line + 1 === desc.lines[0].line
        : /^\s*$/.test(text.slice(previous.end, desc.start)));
    if (joined) gaps.at(-1).push(desc);
    else gaps.push([desc]);
    previous = desc;
  }
  for (const desc of descs.filter(item => !item.own)) gaps.push([desc]);
  for (const gap of gaps) hits.push(...gapHits(gap, opt.lines, code && gap[0].at === 0 ? text : undefined));

  if (source) {
    const exported = exportedNames(source.sf);
    for (const stmt of source.sf.statements) {
      const declaration = DECLARATIONS.has(stmt.kind);
      const isExport = hasExportKeyword(stmt) || ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)
        || (declaration && declaredNames(stmt).some(name => exported.has(name)));
      if (!isExport && !(declaration && opt.localDoc === 'forbid')) continue;
      const doc = docBefore(stmt, text, source.sf);
      if (!doc || readByCode(doc.text)) continue;
      const described = describeComment({ start: doc.start, text: doc.text }, text, map);
      const line = described.lines[0].line;
      if (isExport && described.counted.length > opt.exportLines) {
        hits.push({ line, rule: 'exportDoc', message: `JSDoc of an export holds ${described.counted.length} text lines, at most ${opt.exportLines}` });
      } else if (!isExport && described.counted.length > 0) {
        hits.push({ line, rule: 'localDoc', message: 'JSDoc on a declaration the module does not export' });
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
