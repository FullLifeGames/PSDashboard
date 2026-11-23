// The comment ratchets (AGENTS.md, "Rules for the code", comments). Two baselines in comment-ratchet.json, both only falling:
//
//   history   per source file, the comment lines that carry history (a round, a ruling, a date, a T-number, an issue number; the
//             patterns are in comment-lib.mjs). The rule comments/no-history (eslint.comments.mjs) reads this baseline and fails a
//             file above its count, so `npm run lint` holds it.
//   lines     per project (the three source trees, the app's stylesheets and each test project), the non-blank lines that hold only
//             a comment. `node scripts/comment-counts.mjs` checks it and `npm run lint` runs the check; the calibration ledger
//             (test/regression/eval-calibration.spec.ts) is the history of the engine rounds, kept by rule, and stays out.
//
// `node scripts/update-lint-ratchet.mjs` writes the baseline from the tree and lowers it after a clean-up; it refuses to raise a
// count unless `--allow-raise` names the reason.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commentsOf, historyLinesOf } from './comment-lib.mjs';
import { SPEC_PROJECTS } from './spec-counts.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COMMENT_BASELINE = path.join(ROOT, 'comment-ratchet.json');

/** The folders whose sources the history rule reads: the two packages and the app. */
export const HISTORY_FOLDERS = ['packages/eval-engine/src', 'packages/replay-core/src', 'src'];

const SOURCE = /\.(ts|tsx)$/;

/** Every file under `dir` (relative to `root`) that `keep` accepts, as slash paths, sorted. */
export function filesUnder(root, dir, keep) {
  const found = [];
  const walk = relative => {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(next);
      } else if (keep(next)) found.push(next);
    }
  };
  walk(dir);
  return found.sort();
}

/** The sources the history rule reads, as paths from the root. */
export const historySources = (root = ROOT) => HISTORY_FOLDERS.flatMap(dir => filesUnder(root, dir, file => SOURCE.test(file)));

/** The history lines per source file under `root`; a file without any is left out. */
export function historyCounts(root = ROOT) {
  const counts = {};
  for (const file of historySources(root)) {
    const count = historyLinesOf(readFileSync(path.join(root, file), 'utf8'), file).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

/** The baseline file as an object (empty parts when the file is missing). */
export function commentBaseline(file = COMMENT_BASELINE) {
  const baseline = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { history: baseline.history ?? {}, ...baseline };
}

/** The files whose count is above the baseline; a file the baseline lacks counts from zero. */
export function overBaseline(baseline, counts) {
  return Object.entries(counts)
    .map(([key, count]) => ({ key, baseline: baseline[key] ?? 0, count }))
    .filter(entry => entry.count > entry.baseline);
}

// ---- comment lines per project -------------------------------------------------------------------------------------------------

/**
 * The projects of the line ratchet: the three source trees and the test project of each spec folder (`SPEC_PROJECTS`). A key is
 * `source:<name>` or `test:<name>`; the stylesheets of the app count on their own.
 */
export const LINE_PROJECTS = {
  'source:eval-engine': { dir: 'packages/eval-engine/src', pattern: SOURCE },
  'source:replay-core': { dir: 'packages/replay-core/src', pattern: SOURCE },
  'source:app': { dir: 'src', pattern: SOURCE },
  'source:app-css': { dir: 'src', pattern: /\.css$/ },
  ...Object.fromEntries(Object.entries(SPEC_PROJECTS).map(([name, dir]) => [`test:${name}`, { dir, pattern: SOURCE }])),
};

/** The calibration ledger is the comment history of the engine rounds, kept by rule; it stays out of the count of its project. */
export const LEDGER_FILES = ['test/regression/eval-calibration.spec.ts'];

/** The non-blank lines of `text` that hold only comment (a comment after code does not count): the unit of the line ratchet. */
export function commentLineCount(text, fileName) {
  const spans = commentsOf(text, fileName);
  if (spans.length === 0) return 0;
  const masked = text.split('');
  for (const { start, text: comment } of spans) {
    for (let at = start; at < start + comment.length; at++) if (masked[at] !== '\n' && masked[at] !== '\r') masked[at] = ' ';
  }
  const original = text.split(/\r\n|\n|\r/);
  const rest = masked.join('').split(/\r\n|\n|\r/);
  let count = 0;
  // `{/* c */}` leaves its braces behind: a JSX comment child on its own line is a comment line too.
  const blank = (line, was) => line.trim() === '' || (line !== was && /^\{\s*\}$/.test(line.trim()));
  for (let index = 0; index < original.length; index++) if (original[index].trim() !== '' && blank(rest[index], original[index])) count++;
  return count;
}

/** The comment lines per project under `root`; every project of `LINE_PROJECTS` appears, with 0 when it holds none. */
export function lineCounts(root = ROOT) {
  const counts = {};
  for (const [key, { dir, pattern }] of Object.entries(LINE_PROJECTS)) {
    let total = 0;
    for (const file of filesUnder(root, dir, candidate => pattern.test(candidate) && !LEDGER_FILES.includes(candidate))) {
      total += commentLineCount(readFileSync(path.join(root, file), 'utf8'), file);
    }
    counts[key] = total;
  }
  return counts;
}

/** The projects above their line baseline. */
export const overLines = (baseline, counts) => overBaseline(baseline.lines ?? {}, counts);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const counts = lineCounts();
  const over = overLines(commentBaseline(), counts);
  if (over.length > 0) {
    for (const { key, baseline, count } of over) console.error(`comment lines in ${key}: ${count}, baseline ${baseline}`);
    console.error('Comments only fall (AGENTS.md, "Rules for the code", comments). Cut the comment; node scripts/update-lint-ratchet.mjs lowers the baseline.');
    process.exit(1);
  }
  console.log('comment ratchet: no project above its baseline');
}
