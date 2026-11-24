// The ratchets of comment-ratchet.json, both only falling: `history` per file and `lines` per project.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commentsOf, historyLinesOf, shapeHits } from './comment-lib.mjs';
import { SPEC_PROJECTS } from './spec-counts.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COMMENT_BASELINE = path.join(ROOT, 'comment-ratchet.json');

export const HISTORY_FOLDERS = ['packages/eval-engine/src', 'packages/replay-core/src', 'src'];

const SOURCE = /\.(ts|tsx)$/;
const CODE = /\.(m?js|cjs|ts)$/;
const ROOT_CONFIG = /^[^/]+\.(js|mjs|cjs|ts)$/;

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

export const WORKFLOW_FOLDER = '.github/workflows';

const YAML = /\.ya?ml$/;

export const workflowSources = (root = ROOT) => filesUnder(root, WORKFLOW_FOLDER, file => YAML.test(file));

export const historySources = (root = ROOT) => HISTORY_FOLDERS.flatMap(dir => filesUnder(root, dir, file => SOURCE.test(file)));

function historyOf(root, files) {
  const counts = {};
  for (const file of files) {
    const count = historyLinesOf(readFileSync(path.join(root, file), 'utf8'), file).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

export const workflowHistoryCounts = (root = ROOT) => historyOf(root, workflowSources(root));

export const historyCounts = (root = ROOT) => historyOf(root, [...historySources(root), ...workflowSources(root)]);

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


/** The line ratchet's projects, keyed `source:<name>` or `test:<name>`, plus css, workflows, `scripts`, `config`. */
export const LINE_PROJECTS = {
  'source:eval-engine': { dir: 'packages/eval-engine/src', pattern: SOURCE },
  'source:replay-core': { dir: 'packages/replay-core/src', pattern: SOURCE },
  'source:app': { dir: 'src', pattern: SOURCE },
  'source:app-css': { dir: 'src', pattern: /\.css$/ },
  workflows: { dir: WORKFLOW_FOLDER, pattern: YAML },
  scripts: { dir: 'scripts', pattern: CODE },
  config: { dir: '', pattern: ROOT_CONFIG, flat: true },
  ...Object.fromEntries(Object.entries(SPEC_PROJECTS).map(([name, dir]) => [`test:${name}`, { dir, pattern: SOURCE }])),
};

/** The calibration ledger holds the engine rounds' history by rule and stays out of its project's count. */
export const LEDGER_FILES = ['test/regression/eval-calibration.spec.ts'];

/** The non-blank lines of `text` that hold only comment (a comment after code does not count). */
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

export function lineCounts(root = ROOT) {
  const counts = {};
  for (const [key, { dir, pattern, flat }] of Object.entries(LINE_PROJECTS)) {
    let total = 0;
    const files = flat
      ? readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && pattern.test(entry.name)).map(entry => entry.name).sort()
      : filesUnder(root, dir, candidate => pattern.test(candidate) && !LEDGER_FILES.includes(candidate));
    for (const file of files) {
      total += commentLineCount(readFileSync(path.join(root, file), 'utf8'), file);
    }
    counts[key] = total;
  }
  return counts;
}

export const overLines = (baseline, counts) => overBaseline(baseline.lines ?? {}, counts);

export const shapeSources = (root = ROOT) => [...workflowSources(root), ...filesUnder(root, 'src', file => /\.css$/.test(file))].sort();

/** The shape hits of `files` (paths from `root`, or absolute) as `{ file, line, rule, message }`. */
export const shapeReport = (root, files, options = {}) =>
  files.flatMap(file => shapeHits(readFileSync(path.resolve(root, file), 'utf8'), file, options).map(({ line, rule, message }) => ({ file, line, rule, message })));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const shape = args.includes('--shape');
  const files = shape ? args.filter(arg => !arg.startsWith('--')) : [];
  const hits = shape ? (files.length > 0 ? shapeReport(process.cwd(), files) : shapeReport(ROOT, shapeSources())) : [];
  const failed = hits.length > 0;
  for (const hit of hits) console.error(`${hit.file}:${hit.line} ${hit.rule}: ${hit.message}`);
  if (files.length > 0) process.exit(failed ? 1 : 0);
  const counts = lineCounts();
  const baseline = commentBaseline();
  const over = overLines(baseline, counts);
  const history = overBaseline(baseline.history, workflowHistoryCounts());
  if (over.length > 0 || history.length > 0) {
    for (const entry of over) console.error(`comment lines in ${entry.key}: ${entry.count}, baseline ${entry.baseline}`);
    for (const entry of history) console.error(`history comment lines in ${entry.key}: ${entry.count}, baseline ${entry.baseline}`);
    console.error('Comments only fall (AGENTS.md, "Rules for the code", comments). Cut the comment; node scripts/update-lint-ratchet.mjs lowers the baseline.');
    process.exit(1);
  }
  if (failed) process.exit(1);
  console.log('comment ratchet: no project above its baseline');
}
