/**
 * Saved engine results for the browser specs that judge a view, not the engine. `scripts/capture-eval-store.mjs` runs
 * the analysis once per game and settings in the browser and writes the IndexedDB records (`StoredEval`, src/lib/eval-cache-store.ts) to
 * `test/e2e/fixtures/eval-store/`; a spec seeds them before the analysis (`eval-store-seed.ts`), so "Analyze game" reads the store.
 *
 * This module holds the parts that need no browser: the file form, the cache-version rewrite (a score-touching change needs no new capture)
 * and the two failure paths, each naming the capture command: a record that does not fit, and a page that starts
 * a search although the store was seeded. `test/regression/eval-store-fixtures.spec.ts` holds them.
 */

export const EVAL_STORE_DIR = 'test/e2e/fixtures/eval-store';
export const CAPTURE_COMMAND = 'node scripts/capture-eval-store.mjs';

/** What a capture is keyed by: the replay and the settings the analysis ran with (the suffix of the store key). */
export interface EvalStoreSettings {
  depth: number;
  samples: number;
  mode: string;
  tera: string;
}

/** One capture: a replay and the settings, and either the whole game ("Analyze game") or the turns a spec analyzes one by one. */
export interface EvalStoreCapture {
  replay: string;
  settings: EvalStoreSettings;
  /** The turns the spec analyzes with "Analyze this position" (the store key of a single turn); absent: the game's sweep. */
  turns?: number[];
}

const S_MCTS: EvalStoreSettings = { mode: 'mcts', depth: 1, samples: 1, tera: 'auto' };
const S_MATRIX: EvalStoreSettings = { mode: 'matrix', depth: 1, samples: 1, tera: 'auto' };
const S_AUTO: EvalStoreSettings = { mode: 'auto', depth: 1, samples: 1, tera: 'auto' };

/**
 * The captures: one file per replay, settings and turns. A spec names its file with `evalStoreFileName(replay, settings, turns)`. The
 * replay is the fixture of the same id under packages/eval-engine/test/fixtures/ or test/e2e-feedback/fixtures/. These specs read them:
 * the Game review rows except the Auto row, the single turns of lines-play and the sweeps of win-paths. Hard-mode stays live.
 */
export const EVAL_STORE_CAPTURES: EvalStoreCapture[] = [
  { replay: 'gen9ou-2658662321', settings: S_MCTS },
  { replay: 'gen9vgc2026regi-2630452654', settings: S_AUTO },
  { replay: 'gen9championsvgc2026regma-2625939941', settings: S_AUTO },
  { replay: 'smogtours-gen6ou-655336', settings: S_MCTS, turns: [8, 12] },
  { replay: 'smogtours-gen9doublesou-912884', settings: S_MCTS, turns: [5, 8, 11] },
  { replay: 'gen9vgc2026regi-2630452654', settings: S_MCTS, turns: [4, 6] },
  { replay: 'gen9championsou-2691703002', settings: S_MCTS, turns: [8, 12] },
  { replay: 'gen9championsvgc2026regma-2625939941', settings: S_MCTS, turns: [3, 5] },
  { replay: 'smogtours-gen6ou-649664', settings: S_MATRIX },
  { replay: 'gen9championsvgc2026regmc-2695803506', settings: S_MATRIX },
  { replay: 'gen9vgc2026regi-2629703929', settings: S_MATRIX },
  { replay: 'smogtours-gen9doublesou-912045', settings: S_MATRIX },
];

/** The record the app stores: the fields the app reads are checked, the rest passes through untouched. */
export interface EvalStoreRecord {
  key: string;
  result: unknown;
  depth: number;
  samples: number;
  mode: string;
  tera: unknown;
  savedAt: number;
  [field: string]: unknown;
}

export interface EvalStoreFile {
  format: 1;
  replay: string;
  /** The cache version the records were captured under (`v80`); a seed rewrites it to the current one. */
  cacheVersion: string;
  settings: EvalStoreSettings;
  /** The single turns the records hold; absent for a game's sweep. */
  turns?: number[];
  records: EvalStoreRecord[];
}

/** The file name of a capture: one file per game, settings and turns (`-t8_12` for the single turns 8 and 12; none for the sweep). */
export const evalStoreFileName = (replay: string, settings: Pick<EvalStoreSettings, 'depth' | 'samples' | 'mode'>, turns?: readonly number[]): string =>
  `${replay}--${settings.mode}-d${settings.depth}s${settings.samples}${turns?.length ? `-t${turns.join('_')}` : ''}.json`;

const fix = (what: string): Error => new Error(`${what}. Run \`${CAPTURE_COMMAND}\` to capture the saved engine results again, then commit test/e2e/fixtures/eval-store/.`);

/** `v80` or `v80~tag`: the version and search-budget tag every store key starts with, up to the first bar. */
const VERSION_PREFIX = /^v\d+(?:~[^|]*)?(?=\|)/;

/** The saved key under the current cache version; `tag` is the app's own `vN` or `vN~budget` (`evalStorePrefix` up to its bar). */
export function rewriteCacheVersion(key: string, tag: string): string {
  if (!VERSION_PREFIX.test(key)) throw fix(`The saved key "${key.slice(0, 60)}" starts with no cache version`);
  return key.replace(VERSION_PREFIX, tag);
}

/** The fields of the stored record that the sweep and the turn view read. */
function checkRecord(record: unknown, replay: string, index: number): EvalStoreRecord {
  const entry = record as Partial<EvalStoreRecord> | null;
  const bad = (why: string) => fix(`Saved record ${index} of ${replay} ${why}`);
  if (!entry || typeof entry !== 'object') throw bad('is not an object');
  if (typeof entry.key !== 'string') throw bad('has no key');
  if (!entry.result || typeof entry.result !== 'object') throw bad('has no result');
  if (typeof entry.depth !== 'number' || typeof entry.samples !== 'number') throw bad('has no depth or samples');
  if (typeof entry.mode !== 'string') throw bad('has no mode');
  if (entry.tera === undefined) throw bad('has no tera allowance');
  if (!VERSION_PREFIX.test(entry.key) || !entry.key.includes(`|${replay}:`)) throw bad(`belongs to another replay (${entry.key.slice(0, 60)})`);
  return entry as EvalStoreRecord;
}

/** The records of a file, ready for the store: keys under the current version, times fresh (the app prunes records older than 30 days). */
export function seedRecords(file: EvalStoreFile, options: { tag: string; now: number }): EvalStoreRecord[] {
  if (file.format !== 1) throw fix(`The saved file of ${file.replay} has format ${String(file.format)}, this helper reads format 1`);
  if (!Array.isArray(file.records) || file.records.length === 0) throw fix(`The saved file of ${file.replay} holds no records`);
  return file.records.map((record, index) => {
    const checked = checkRecord(record, file.replay, index);
    return { ...checked, key: rewriteCacheVersion(checked.key, options.tag), savedAt: options.now };
  });
}

/** Keys in a fixed order (the record's `key` first, then alphabetical), so a capture of the same engine writes the same bytes. */
function sorted(value: unknown, top = false): unknown {
  if (Array.isArray(value)) return value.map(item => sorted(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (top && a === 'key' ? -1 : top && b === 'key' ? 1 : a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([name, item]) => [name, sorted(item)]));
  }
  return value;
}

/** One record per line in key order, the save time zeroed: a diff shows the records that changed. */
export function serializeEvalStoreFile(file: EvalStoreFile): string {
  const lines = [...file.records]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(record => JSON.stringify(sorted({ ...record, savedAt: 0 }, true)));
  const head = JSON.stringify({ format: file.format, replay: file.replay, cacheVersion: file.cacheVersion, settings: sorted(file.settings), ...(file.turns ? { turns: file.turns } : {}) }).slice(0, -1);
  return `${head},"records":[\n${lines.join(',\n')}\n]}\n`;
}

export function parseEvalStoreFile(text: string, name: string): EvalStoreFile {
  try {
    return JSON.parse(text) as EvalStoreFile;
  } catch {
    throw fix(`The saved file ${name} is not valid JSON`);
  }
}

/** The worker requests that run a search or a prover; the listing of choices (`choices`) is no search. */
export const SEARCH_REQUESTS = ['search', 'mctstree', 'cells', 'subsearch', 'prove', 'lines', 'job'] as const;

/**
 * Watches the worker requests of a seeded page. A search that starts although the store holds the result means the saved key no longer
 * matches (a changed team build, rules or record shape): the guard fails the wait it is racing, and `assertClean` fails the test at its end.
 * `pause` ends the watch for a part of the spec that may search by design.
 */
export function createSearchGuard(fixture: string) {
  const seen: string[] = [];
  let paused = false;
  let failure: Error | null = null;
  let onFailure: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => { onFailure = reject; });
  failed.catch(() => {});
  return {
    note(type: string): void {
      seen.push(type);
      if (paused || !(SEARCH_REQUESTS as readonly string[]).includes(type) || failure) return;
      failure = fix(`The page started a search (worker request "${type}") although the engine results of ${fixture} were seeded: the saved records no longer fit the app`);
      onFailure(failure);
    },
    pause(): void { paused = true; },
    resume(): void { paused = false; },
    /** The wait, or the failure when a search starts first. */
    race<T>(wait: Promise<T>): Promise<T> {
      if (failure) {
        void wait.catch(() => {});
        return Promise.reject(failure);
      }
      return Promise.race([wait, failed]);
    },
    assertClean(): void {
      if (failure) throw failure;
    },
    /** Every worker request the page made, in order (a paused part included), for the probe's report. */
    requests: (): readonly string[] => seen,
  };
}

export type SearchGuard = ReturnType<typeof createSearchGuard>;
