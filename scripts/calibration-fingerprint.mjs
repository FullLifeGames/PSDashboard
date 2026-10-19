// Fingerprints of calibration runs, the reuse of a finished base, and the quick-tier header of the paired script.
//
// A bank run costs 15 to 50 minutes of machine time, and two runs on the same inputs give the same rows (the
// bases of 12.10. and 13.10. were byte-identical). The fingerprint names everything that decides the rows.
// scripts/run-calibration.mjs writes it into run.json; with --reuse it prints the folder of a finished run that
// carries the same one and starts nothing. computeFingerprint hashes these inputs:
//
//   format     the version of this recipe, so a changed recipe never matches an older run
//   node       process.version, platform and arch
//   trees      the git ids at HEAD of FINGERPRINT_PATHS: tree ids for folders, blob ids for files
//   installed  sha256 of node_modules/.package-lock.json, npm's record of the installed packages
//   caches     .smogon-cache and .fit-corpus: file count, bytes and one sha256 over every name, size and content
//   env        the run's env plus the ambient EVAL_*, CALIB_*, NODE_OPTIONS and NODE_ENV variables, without the two
//              keys the runner sets per slice (RUNNER_OWNED)
//
// The caches are hashed by content. Reading about 96 MB in 5,700 files takes 0.7 s against a run of 15 to 50
// minutes, and a payload edited in place keeps its name and often its size, which a hash of names and sizes misses.
// The slice count is no input: each replay belongs to one slice, so the merged rows come out the same.
//
// A tree with an uncommitted change under the inputs gets a value that names HEAD, not the files on disk. The
// runner marks its run dirty, such a run never serves as a base, and a dirty tree never reuses (decideReuse).
// A run that adds entries to .smogon-cache records the cache it leaves behind, because the entries it fetched
// produced its rows. A change of any other input during the run marks it unstable. A run that lost replays to
// HTTP errors is incomplete. Runs from before this recipe carry no fingerprint and never match.
//
// Everything under regression/ is an input, so a ledger block booked into regression/eval-calibration.spec.ts
// changes the value although it changes no behavior. Commits that touch only docs, NextSteps.md or AGENTS.md keep it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The version of the recipe; bump it when the inputs below change. */
export const FINGERPRINT_FORMAT = 1;

/** The tracked inputs read at HEAD: what the bank imports and runs, and the files that decide how it resolves. */
export const FINGERPRINT_PATHS = [
  'packages', 'src', 'regression', 'scripts',
  'package.json', 'package-lock.json',
  'vitest.config.ts', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
];

/** The untracked data folders the rows depend on: the pinned Smogon payloads and the fit corpus's replays. */
export const CACHE_DIRS = ['.smogon-cache', '.fit-corpus'];
const SMOGON_CACHE = '.smogon-cache';
const INSTALLED_LOCK = join('node_modules', '.package-lock.json');

const LEVER = /^(EVAL|CALIB)_/;
const OTHER_LEVERS = ['NODE_OPTIONS', 'NODE_ENV'];
/** Set per slice by the runner (the slice and the dump path), so they never decide a run. */
export const RUNNER_OWNED = ['EVAL_CALIBRATION_SLICE', 'EVAL_CALIBRATION_DUMP'];
const DIRTY_LIMIT = 20;

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with the keys of every object in code unit order, so equal data gives equal text. */
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, inner) => (inner && typeof inner === 'object' && !Array.isArray(inner)
    ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => byCode(a, b)))
    : inner));
}

/** The variables a slice sees that can move the rows: the ambient levers, then the run's own env on top, keys sorted. */
export function leverEnv(ambient, explicit) {
  const out = {};
  const take = (source, keep) => {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && !RUNNER_OWNED.includes(key) && keep(key)) out[key] = String(value);
    }
  };
  take(ambient, key => LEVER.test(key) || OTHER_LEVERS.includes(key));
  take(explicit, () => true);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => byCode(a, b)));
}

/**
 * The relative names of the files a folder holds for the bank, in code unit order, with `/` between parts. A `.tmp`
 * file is a sibling process's half-written entry (regression/smogon-fetch-cache.ts) that no reader opens, so it
 * stays out. scripts/bank-data.mjs packs exactly these files.
 */
export function dataFileNames(dir) {
  const names = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDirectory && !isFile) {
        try {
          const stat = statSync(full);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }
      if (isDirectory) walk(full, `${prefix}${entry.name}/`);
      else if (isFile && !entry.name.endsWith('.tmp')) names.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, '');
  return names.sort(byCode);
}

/**
 * File count, bytes and one sha256 over every name, size and content of a folder's files (dataFileNames), in code
 * unit order of the relative names; null when the folder is absent.
 */
export function hashDirectory(dir) {
  if (!existsSync(dir)) return null;
  return hashFiles(dir, dataFileNames(dir));
}

/**
 * hashDirectory's recipe over the given relative names of `dir` (sorted here): what a folder that holds exactly these
 * files hashes to. A name that cannot be read is skipped, as in hashDirectory.
 */
export function hashFiles(dir, names) {
  const hash = createHash('sha256');
  let files = 0;
  let bytes = 0;
  for (const name of [...names].sort(byCode)) {
    let data;
    try {
      data = readFileSync(join(dir, ...name.split('/')));
    } catch {
      continue;
    }
    files += 1;
    bytes += data.length;
    hash.update(`${name}\0${data.length}\0`).update(data);
  }
  return { files, bytes, sha256: hash.digest('hex') };
}

function hashFile(path) {
  try {
    return { sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  } catch {
    return null;
  }
}

/** Git runs with the repository's own folder as the ceiling, so a stray .git above the checkout is never read. */
function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) },
  });
}

/** The id of each path at HEAD (a tree id for a folder, a blob id for a file); null for a path HEAD lacks. */
function treeIds(root, paths) {
  const found = {};
  for (const record of git(root, ['ls-tree', '-z', 'HEAD', '--', ...paths]).split('\0')) {
    const match = /^\d+ \w+ ([0-9a-f]+)\t(.+)$/s.exec(record);
    if (match) found[match[2]] = match[1];
  }
  return Object.fromEntries(paths.map(path => [path, found[path] ?? null]));
}

/**
 * The paths under the inputs with an uncommitted change: edited, staged, removed or untracked (a file the
 * .gitignore names does not count). --no-optional-locks keeps the status from writing the index while a run goes.
 */
function dirtyPathsOf(root, paths) {
  const records = git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths])
    .split('\0').filter(Boolean);
  const dirty = [];
  for (let index = 0; index < records.length; index++) {
    const status = records[index].slice(0, 2);
    dirty.push(records[index].slice(3));
    // A rename or copy lists its origin path as the next record.
    if (/[RC]/.test(status)) index += 1;
  }
  return dirty.sort(byCode);
}

const nodeInfo = () => ({ version: process.version, platform: process.platform, arch: process.arch });

/**
 * The fingerprint of the inputs as they stand: { value, dirty, dirtyPaths, commit, inputs, problem }.
 * `env` is the run's own env (the DEFAULT_ENV merged with --env and --tranche, plus EVAL_CALIBRATION=1),
 * `ambient` the environment the slices inherit, `slices` the run's slice count (no pair of runs has shown that the
 * rows ignore it, so a base serves only runs with its own count). Without a readable HEAD, value is null and the
 * tree counts as dirty.
 */
export function computeFingerprint({
  root, env, ambient = process.env, node = nodeInfo(), paths = FINGERPRINT_PATHS, cacheDirs = CACHE_DIRS, slices = null,
}) {
  let trees;
  let dirtyPaths;
  let commit;
  try {
    trees = treeIds(root, paths);
    dirtyPaths = dirtyPathsOf(root, paths);
    commit = git(root, ['rev-parse', '--short', 'HEAD']).trim();
  } catch (error) {
    const first = String(error instanceof Error ? (error.stderr || error.message) : error).trim().split(/\r?\n/)[0];
    return { value: null, dirty: true, dirtyPaths: [], commit: null, inputs: null, problem: `git could not read the inputs (${first})` };
  }
  const inputs = {
    format: FINGERPRINT_FORMAT,
    node,
    trees,
    installed: hashFile(join(root, INSTALLED_LOCK)),
    caches: Object.fromEntries(cacheDirs.map(dir => [dir, hashDirectory(join(root, dir))])),
    env: leverEnv(ambient, env),
    slices,
  };
  return {
    value: createHash('sha256').update(canonicalJson(inputs)).digest('hex'),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    commit,
    inputs,
    problem: null,
  };
}

export const shortValue = value => (value ? value.slice(0, 12) : 'none');

/**
 * What run.json keeps of a run's fingerprint, from the one taken before the slices start and the one after they
 * end. The value is the end one: it names the Smogon cache the run leaves behind, which holds every entry it
 * fetched. `stable` is false when any other input moved during the run; `dirty` when either end was dirty.
 */
export function fingerprintRecord(start, end) {
  if (start.value === null || end.value === null) {
    return { value: null, dirty: true, stable: false, problem: start.problem ?? end.problem };
  }
  const settled = inputs => canonicalJson({ ...inputs, caches: { ...inputs.caches, [SMOGON_CACHE]: null } });
  return {
    value: end.value,
    dirty: start.dirty || end.dirty,
    stable: settled(start.inputs) === settled(end.inputs),
    smogonCacheGrew: canonicalJson(start.inputs.caches[SMOGON_CACHE]) !== canonicalJson(end.inputs.caches[SMOGON_CACHE]),
    startValue: start.value,
    commit: end.commit,
    dirtyPaths: [...new Set([...start.dirtyPaths, ...end.dirtyPaths])].sort(byCode).slice(0, DIRTY_LIMIT),
    inputs: end.inputs,
  };
}

/**
 * The quick tier's share (EVAL_CALIBRATION_FRACTION, regression/bank-universe.ts reads it the same way):
 * unset or empty is the whole universe, anything else must be a number above 0 and at most 1.
 */
export function parseFraction(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const fraction = Number(raw);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`EVAL_CALIBRATION_FRACTION must be a number above 0 and at most 1 (a share of the universe), got "${raw}"`);
  }
  return fraction;
}

/** The fraction a run's run.json records: its own field, else its env, else the whole universe; null for a junk value. */
export function runFraction(run) {
  if (typeof run?.fraction === 'number') return run.fraction;
  try {
    return parseFraction(run?.env?.EVAL_CALIBRATION_FRACTION);
  } catch {
    return null;
  }
}

/** Every subfolder of the calibration folder with a readable run.json, by name. */
export function readRuns(calibrationDir) {
  if (!existsSync(calibrationDir)) return [];
  const runs = [];
  for (const entry of readdirSync(calibrationDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(calibrationDir, entry.name);
    try {
      runs.push({ dir, name: entry.name, run: JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) });
    } catch {
      // A folder without a run.json (a run still going, a cache) or with a garbled one is no candidate.
    }
  }
  return runs.sort((a, b) => byCode(a.name, b.name));
}

const lineCount = text => text.split(/\r?\n/).filter(line => line.trim()).length;

/**
 * A run that can serve as a base: clean, settled, complete (every slice green, no replay lost to an HTTP error),
 * and its merged dump on disk with the hash and row count run.json recorded, next to its summary.
 */
function isBase({ dir, run }) {
  const fingerprint = run.fingerprint;
  if (!fingerprint || typeof fingerprint.value !== 'string' || fingerprint.dirty !== false || fingerprint.stable !== true) return false;
  if (run.complete !== true || typeof run.finishedAt !== 'string' || !(run.samples > 0)) return false;
  if (!Array.isArray(run.results) || run.results.length === 0 || !run.results.every(result => result.code === 0)) return false;
  try {
    const merged = readFileSync(join(dir, 'merged.jsonl'));
    return typeof run.mergedSha256 === 'string' && createHash('sha256').update(merged).digest('hex') === run.mergedSha256
      && lineCount(merged.toString('utf8')) === run.samples && existsSync(join(dir, 'summary.txt'));
  } catch {
    return false;
  }
}

const unionOf = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort(byCode);
const shown = value => (value === undefined ? 'unset' : value);

/** The input groups in which two fingerprints differ, as short phrases (a path, `node`, a cache, or an env key with both values). */
export function explainMismatch(current, other) {
  const differs = [];
  const same = (a, b) => canonicalJson(a) === canonicalJson(b);
  if (current.format !== other.format) differs.push('fingerprint format');
  if (!same(current.node, other.node)) differs.push('node');
  for (const key of unionOf(current.trees, other.trees)) if (current.trees?.[key] !== other.trees?.[key]) differs.push(key);
  if (!same(current.installed, other.installed)) differs.push('installed packages');
  for (const key of unionOf(current.caches, other.caches)) if (!same(current.caches?.[key], other.caches?.[key])) differs.push(key);
  for (const key of unionOf(current.env, other.env)) {
    if (current.env?.[key] !== other.env?.[key]) differs.push(`env ${key} (${shown(current.env?.[key])} here, ${shown(other.env?.[key])} there)`);
  }
  if ((current.slices ?? null) !== (other.slices ?? null)) differs.push(`slices (${current.slices ?? 'unset'} here, ${other.slices ?? 'unset'} there)`);
  return differs;
}

/**
 * Whether a finished run under the calibration folder can stand in for a run with this fingerprint.
 *   { action: 'reuse', dir, name, run, matches }   the newest finished run with the same value
 *   { action: 'run', reason: 'unavailable' }        git could not read the inputs
 *   { action: 'run', reason: 'dirty', dirtyPaths }  an uncommitted change under the inputs: a dirty tree never reuses
 *   { action: 'run', reason: 'no-match', nearest }  nearest is the finished run with the fewest differing input groups
 *                                                   ({ dir, name, run, differs }), absent when no finished run has a fingerprint
 */
export function decideReuse({ fingerprint, calibrationDir }) {
  if (fingerprint.value === null) return { action: 'run', reason: 'unavailable', detail: fingerprint.problem };
  if (fingerprint.dirty) return { action: 'run', reason: 'dirty', dirtyPaths: fingerprint.dirtyPaths };
  const bases = readRuns(calibrationDir).filter(isBase);
  const newestFirst = (a, b) => byCode(b.run.finishedAt, a.run.finishedAt) || byCode(a.name, b.name);
  const matches = bases.filter(({ run }) => run.fingerprint.value === fingerprint.value).sort(newestFirst);
  if (matches.length > 0) return { action: 'reuse', dir: matches[0].dir, name: matches[0].name, run: matches[0].run, matches: matches.length };
  const ranked = bases
    .filter(({ run }) => run.fingerprint.inputs)
    .map(base => ({ ...base, differs: explainMismatch(fingerprint.inputs, base.run.fingerprint.inputs) }))
    .sort((a, b) => a.differs.length - b.differs.length || newestFirst(a, b));
  return { action: 'run', reason: 'no-match', nearest: ranked[0] };
}

/** The fractions the run.json files beside a dump (or beside each of several dumps joined by commas) record. */
function sideFractions(path) {
  const found = [];
  for (const one of path.split(',')) {
    try {
      const fraction = runFraction(JSON.parse(readFileSync(join(dirname(one), 'run.json'), 'utf8')));
      if (fraction !== null) found.push(fraction);
    } catch {
      // A dump copied away from its run folder has no run.json beside it.
    }
  }
  return found;
}

/**
 * The header lines scripts/paired-calibration.mjs adds when a side ran the quick tier (its run.json records a
 * fraction below 1): the fraction of each side, the pairing count and its share of A, and what the fixed K comes from.
 * Two full runs, or dumps without run.json, give no lines, so the output of an ordinary pair stays as it was.
 */
export function quickTierLines({ aPath, bPath, aRows, pairs, replays }) {
  const a = sideFractions(aPath);
  const b = sideFractions(bPath);
  const quick = fractions => fractions.some(fraction => fraction < 1);
  if (!quick(a) && !quick(b)) return [];
  const say = (label, fractions) => {
    if (fractions.length === 0) return `${label} has no run.json next to its dump`;
    if (!quick(fractions)) return `${label} ran the full universe`;
    return `${label} ran EVAL_CALIBRATION_FRACTION=${[...new Set(fractions)].sort((x, y) => x - y).join(' and ')}`;
  };
  const share = aRows > 0 ? (100 * pairs / aRows).toFixed(1) : '0.0';
  const subset = quick(a) ? ' (a quick subset, so put the full run first to fit K on all of it)' : '';
  return [
    `quick tier: ${say('A', a)}, ${say('B', b)}. They pair on the ${pairs} positions of ${replays} replays that both dumps hold, ${share} % of A's ${aRows}.`,
    `The first verdict table fixes K from all ${aRows} positions of A${subset}; the own K table fits K on the ${pairs} pairs.`,
    'A quick pair has fewer replays and wider bands, and a resolved row can flip in the full pair: it screens a change, the full pair decides it.',
  ];
}
