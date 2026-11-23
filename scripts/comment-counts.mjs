// The comment ratchets (AGENTS.md, "Rules for the code", comments). Two baselines in comment-ratchet.json, both only falling:
//
//   history   per source file, the comment lines that carry history (a round, a ruling, a date, a T-number, an issue number; the
//             patterns are in comment-lib.mjs). The rule comments/no-history (eslint.comments.mjs) reads this baseline and fails a
//             file above its count, so `npm run lint` holds it.
//
// `node scripts/update-lint-ratchet.mjs` writes the baseline from the tree and lowers it after a clean-up; it refuses to raise a
// count unless `--allow-raise` names the reason.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyLinesOf } from './comment-lib.mjs';

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
