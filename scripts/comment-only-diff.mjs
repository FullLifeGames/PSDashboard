// Proof that an edit moved comments and whitespace only.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isCss, readByCode, readCss, readSource, scriptKindOf } from './comment-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pragmasOf(items) {
  const found = [];
  for (const item of items) {
    if (item.k !== 'c') continue;
    const read = readByCode(item.text);
    if (!read) continue;
    const lines = item.text.split(/\r?\n/);
    const text = read.lines ? read.lines.map(index => lines[index]).join('\n') : item.text;
    const record = { text, at: item.at, sameLine: item.sameLine };
    if (read.lines) record.contiguous = item.contiguous;
    if (/-next-line\b|@ts-(expect-error|ignore)\b/.test(item.text)) record.newlinesAfter = item.newlinesAfter;
    found.push({ ...record, line: item.line });
  }
  return found;
}

const sameRecord = (a, b) => a.text === b.text && a.at === b.at && a.sameLine === b.sameLine && a.contiguous === b.contiguous
  && a.newlinesAfter === b.newlinesAfter;

const show = text => (text.length > 60 ? `${text.slice(0, 57)}...` : text).replace(/\s+/g, ' ');

/** Compares two texts of one file. `{ ok: true }`, or `{ ok: false, reason, detail }` with the first difference. */
export function compareSource(before, after, fileName) {
  if (isCss(fileName)) return compareCss(before, after);
  if (scriptKindOf(fileName) === undefined) return { ok: true, skipped: true };
  const a = readSource(before, fileName);
  const b = readSource(after, fileName);
  if (a.errors.length > 0 || b.errors.length > 0) {
    const side = a.errors.length > 0 ? 'before' : 'after';
    return { ok: false, reason: 'parse', detail: `the ${side} text does not parse: ${(a.errors[0] ?? b.errors[0]).split('\n')[0]}` };
  }
  const tokensA = a.items.filter(item => item.k === 't');
  const tokensB = b.items.filter(item => item.k === 't');
  const length = Math.max(tokensA.length, tokensB.length);
  for (let index = 0; index < length; index++) {
    const x = tokensA[index];
    const y = tokensB[index];
    if (!x || !y || x.text !== y.text || x.lb !== y.lb) {
      const side = token => (token ? `"${show(token.text)}"${token.lb ? ' after a line break' : ''} at line ${token.line}` : 'the end of the file');
      return { ok: false, reason: 'token', detail: `token ${index + 1} differs: before ${side(x)}, after ${side(y)}` };
    }
  }
  const pragmasA = pragmasOf(a.items);
  const pragmasB = pragmasOf(b.items);
  const count = Math.max(pragmasA.length, pragmasB.length);
  for (let index = 0; index < count; index++) {
    const x = pragmasA[index];
    const y = pragmasB[index];
    if (!x || !y || !sameRecord(x, y)) {
      const side = record => (record ? `"${show(record.text)}" at line ${record.line}` : 'nothing');
      return { ok: false, reason: 'pragma', detail: `code-read comment ${index + 1} differs: before ${side(x)}, after ${side(y)}` };
    }
  }
  return { ok: true };
}

function compareCss(before, after) {
  const a = readCss(before);
  const b = readCss(after);
  if (a.stripped !== b.stripped) {
    let at = 0;
    while (at < a.stripped.length && a.stripped[at] === b.stripped[at]) at++;
    const near = text => `"${show(text.slice(Math.max(0, at - 20), at + 30))}"`;
    return { ok: false, reason: 'token', detail: `the CSS differs near character ${at}: before ${near(a.stripped)}, after ${near(b.stripped)}` };
  }
  const legal = comments => comments.filter(comment => readByCode(comment.text)).map(comment => comment.text);
  const legalA = legal(a.comments);
  const legalB = legal(b.comments);
  if (legalA.join('\n') !== legalB.join('\n')) return { ok: false, reason: 'pragma', detail: 'a legal comment of the stylesheet changed' };
  return { ok: true };
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Files that differ between `base` and `head` (undefined: the working tree), with their status letter. */
export function changedFiles({ base, head, paths = [], cwd = ROOT }) {
  const args = ['diff', '--name-status', '--no-renames', base, ...(head ? [head] : []), '--', ...paths];
  return git(args, cwd).split('\n').filter(Boolean).map(line => {
    const [status, ...rest] = line.split('\t');
    return { status: status[0], file: rest.join('\t') };
  });
}

const readAt = (rev, file, cwd) => (rev === undefined ? readFileSync(path.join(cwd, file), 'utf8') : git(['show', `${rev}:${file}`], cwd));

/** Checks every changed file; returns `{ checked, skipped, failures: [{ file, reason, detail }] }`. */
export function commentOnlyDiff({ base, head, paths = [], cwd = ROOT }) {
  const failures = [];
  let checked = 0;
  let skipped = 0;
  for (const { status, file } of changedFiles({ base, head, paths, cwd })) {
    if (!isCss(file) && scriptKindOf(file) === undefined) {
      skipped++;
      continue;
    }
    if (status !== 'M') {
      failures.push({ file, reason: 'status', detail: status === 'A' ? 'the file is new' : 'the file is gone' });
      continue;
    }
    checked++;
    const result = compareSource(readAt(base, file, cwd), readAt(head, file, cwd), file);
    if (!result.ok) failures.push({ file, reason: result.reason, detail: result.detail });
  }
  return { checked, skipped, failures };
}

function main() {
  const args = process.argv.slice(2);
  const headAt = args.indexOf('--head');
  const head = headAt >= 0 ? args.splice(headAt, 2)[1] : undefined;
  const [base, ...paths] = args;
  if (!base || base.startsWith('-')) {
    console.error('usage: node scripts/comment-only-diff.mjs <base> [--head <rev>] [paths or globs...]');
    process.exit(2);
  }
  const { checked, skipped, failures } = commentOnlyDiff({ base, head, paths });
  for (const { file, reason, detail } of failures) console.error(`${file}: ${reason}: ${detail}`);
  console.log(`comment-only-diff: ${checked} files checked, ${skipped} not code, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
