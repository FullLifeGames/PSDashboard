
export const EVAL_STORE_DIR = 'test/e2e/fixtures/eval-store';
export const CAPTURE_COMMAND = 'node scripts/capture-eval-store.mjs';

export interface EvalStoreSettings {
  depth: number;
  samples: number;
  mode: string;
  tera: string;
}

export interface EvalStoreCapture {
  replay: string;
  settings: EvalStoreSettings;
  /** The turns the spec analyzes with "Analyze this position" (a single turn's store key); absent: the game's sweep. */
  turns?: number[];
}

const S_MCTS: EvalStoreSettings = { mode: 'mcts', depth: 1, samples: 1, tera: 'auto' };
const S_MATRIX: EvalStoreSettings = { mode: 'matrix', depth: 1, samples: 1, tera: 'auto' };
const S_AUTO: EvalStoreSettings = { mode: 'auto', depth: 1, samples: 1, tera: 'auto' };

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
  turns?: number[];
  records: EvalStoreRecord[];
}

export const evalStoreFileName = (replay: string, settings: Pick<EvalStoreSettings, 'depth' | 'samples' | 'mode'>, turns?: readonly number[]): string =>
  `${replay}--${settings.mode}-d${settings.depth}s${settings.samples}${turns?.length ? `-t${turns.join('_')}` : ''}.json`;

const fix = (what: string): Error => new Error(`${what}. Run \`${CAPTURE_COMMAND}\` to capture the saved engine results again, then commit test/e2e/fixtures/eval-store/.`);

const VERSION_PREFIX = /^v\d+(?:~[^|]*)?(?=\|)/;

/** `tag` is the app's own `vN` or `vN~budget`. */
export function rewriteCacheVersion(key: string, tag: string): string {
  if (!VERSION_PREFIX.test(key)) throw fix(`The saved key "${key.slice(0, 60)}" starts with no cache version`);
  return key.replace(VERSION_PREFIX, tag);
}

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

/** Times fresh: the app prunes records older than 30 days. */
export function seedRecords(file: EvalStoreFile, options: { tag: string; now: number }): EvalStoreRecord[] {
  if (file.format !== 1) throw fix(`The saved file of ${file.replay} has format ${String(file.format)}, this helper reads format 1`);
  if (!Array.isArray(file.records) || file.records.length === 0) throw fix(`The saved file of ${file.replay} holds no records`);
  return file.records.map((record, index) => {
    const checked = checkRecord(record, file.replay, index);
    return { ...checked, key: rewriteCacheVersion(checked.key, options.tag), savedAt: options.now };
  });
}

function sorted(value: unknown, top = false): unknown {
  if (Array.isArray(value)) return value.map(item => sorted(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    entries.sort(([a], [b]) => (top && a === 'key' ? -1 : top && b === 'key' ? 1 : a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([name, item]) => [name, sorted(item)]));
  }
  return value;
}

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

/** The listing of choices (`choices`) is no search. */
export const SEARCH_REQUESTS = ['search', 'mctstree', 'cells', 'subsearch', 'prove', 'lines', 'job'] as const;

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
    requests: (): readonly string[] => seen,
  };
}

export type SearchGuard = ReturnType<typeof createSearchGuard>;
