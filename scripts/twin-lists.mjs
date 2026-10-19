// Round 72 (T236): the twin detector. AGENTS.md, Rules for the code: one rule lives in one module and every other place imports
// it; a deliberate copy gets a spec that compares the two. A twin is a list of 3 or more string literals that stands in two or
// more files with the same names (the stat names in four files, Reflect / Light Screen / Aurora Veil in five).
//
//   node scripts/twin-lists.mjs [--near] [--json] [--root <dir>] [--baseline <file>]
//
// Exit 1 when a pair (list, file) is not in scripts/twin-baseline.json while the list stands in 2 or more files. The baseline only
// shrinks (scripts/update-name-baseline.mjs): a group that lost a file passes, a group down to one file is no twin. A deliberate
// copy takes the comment `// twin-ok: <path of the spec that compares the copies>` on the line above the list; the spec must exist.
// --near prints lists with a Jaccard overlap of 0.7 or more (both with 4 or more names) and never fails: a copy with one more
// element is no twin to the check, and editing one element of a list must not fail a lane. --json prints the groups.
//
// A list is an array expression of string literals only (also inside `new Set([...])`); call arguments and type unions are not
// lists here. Test files are left out: the folders are packages/*/src and src.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSource, plainText, ROOT, sourceFiles } from './name-census.mjs';

export const TWIN_FOLDERS = ['packages/*/src', 'src'];
export const TWIN_BASELINE = path.join(ROOT, 'scripts', 'twin-baseline.json');
const MIN_LIST = 3;
const NEAR_FROM = 0.7;
const NEAR_MIN_NAMES = 4;

const toID = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');

const STATEMENT = /(Statement|Declaration|PropertyDefinition)$/;

/** Every node of a parsed file with `parent` set (the same walk as the name census, kept local to stay a plain function). */
function* nodesOf(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    yield node;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent' || key === 'loc' || key === 'range' || value === null || typeof value !== 'object') continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') {
          child.parent = node;
          stack.push(child);
        }
      }
    }
  }
}

/** Lines whose comment may carry the twin-ok of a list: above the list and above its statement. */
function commentLines(node) {
  const lines = [node.loc.start.line - 1];
  for (let up = node.parent; up; up = up.parent) {
    if (STATEMENT.test(up.type)) {
      lines.push(up.loc.start.line - 1);
      break;
    }
  }
  return lines;
}

/** `[{ line, key, names, exempt }]`: the lists of a parsed file. */
function listsOf(ast, root) {
  const marks = new Map();
  for (const comment of ast.comments ?? []) {
    const spec = /twin-ok:\s*(\S+)/.exec(comment.value)?.[1];
    if (spec) marks.set(comment.loc.end.line, spec);
  }
  const lists = [];
  for (const node of nodesOf(ast)) {
    if (node.type !== 'ArrayExpression' || node.elements.length < MIN_LIST) continue;
    const names = node.elements.map(element => (element && element.type !== 'SpreadElement' ? plainText(element) : null));
    if (names.some(name => name === null)) continue;
    const spec = commentLines(node).map(line => marks.get(line)).find(Boolean);
    lists.push({
      line: node.loc.start.line,
      key: [...new Set(names.map(toID))].sort().join(','),
      exempt: Boolean(spec) && existsSync(path.join(root, spec)),
    });
  }
  return lists;
}

/** `Map<key, [{ file, line }]>`: every list outside twin-ok, also the ones that stand in one file only. */
function placesOf(root, folders = TWIN_FOLDERS) {
  const places = new Map();
  for (const file of sourceFiles(root, folders)) {
    const ast = parseSource(readFileSync(path.join(root, file), 'utf8'), file);
    for (const list of listsOf(ast, root)) {
      if (list.exempt) continue;
      if (!places.has(list.key)) places.set(list.key, []);
      places.get(list.key).push({ file, line: list.line });
    }
  }
  return places;
}

const filesOf = spots => [...new Set(spots.map(spot => spot.file))].sort();

/** `{ "<key>": ["<file>", ...] }` for every list that stands in 2 or more files. */
export function twinsOf(root, folders = TWIN_FOLDERS) {
  const groups = {};
  for (const [key, spots] of [...placesOf(root, folders)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const files = filesOf(spots);
    if (files.length >= 2) groups[key] = files;
  }
  return groups;
}

/** The messages for every pair (list, file) of a group of 2 or more files that the baseline lacks. */
export function newTwins(root, baseline, folders = TWIN_FOLDERS) {
  const messages = [];
  for (const [key, spots] of placesOf(root, folders)) {
    const files = filesOf(spots);
    if (files.length < 2) continue;
    const known = new Set(baseline.groups?.[key] ?? []);
    for (const spot of spots.filter(candidate => !known.has(candidate.file))) {
      const others = spots.filter(other => other.file !== spot.file).map(other => `${other.file}:${other.line}`);
      const names = key.split(',');
      messages.push(
        `${spot.file}:${spot.line} repeats the list of ${others.join(', ')} (${names.length} names: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''}). `
        + 'One rule lives in one module: import the list, or hold the copy with a spec that compares the two and write '
        + '"// twin-ok: <path of that spec>" on the line above it.',
      );
    }
  }
  return messages.sort();
}

/** `[{ jaccard, left, right }]`: lists with an overlap of 0.7 or more that are no twins; report only. */
export function nearPairs(root, folders = TWIN_FOLDERS) {
  const places = placesOf(root, folders);
  const keys = [...places.keys()].sort();
  const pairs = [];
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const left = new Set(keys[a].split(','));
      const right = new Set(keys[b].split(','));
      if (left.size < NEAR_MIN_NAMES || right.size < NEAR_MIN_NAMES) continue;
      const shared = [...left].filter(name => right.has(name)).length;
      const jaccard = shared / (left.size + right.size - shared);
      if (jaccard >= NEAR_FROM) pairs.push({ jaccard: Math.round(jaccard * 100) / 100, left: places.get(keys[a]), right: places.get(keys[b]) });
    }
  }
  return pairs.sort((x, y) => y.jaccard - x.jaccard);
}

function main() {
  const flag = name => {
    const at = process.argv.indexOf(name);
    return at < 0 ? null : process.argv[at + 1];
  };
  const root = flag('--root') ?? ROOT;
  const baselineFile = flag('--baseline') ?? TWIN_BASELINE;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ groups: twinsOf(root) }, null, 2));
    return;
  }
  if (process.argv.includes('--near')) {
    const spot = list => list.map(place => `${place.file}:${place.line}`).join(' ');
    for (const pair of nearPairs(root)) console.log(`near ${pair.jaccard.toFixed(2)}  ${spot(pair.left)}  |  ${spot(pair.right)}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const messages = newTwins(root, baseline);
  for (const message of messages) console.error(message);
  if (messages.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
