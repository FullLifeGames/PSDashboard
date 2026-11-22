import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_COMMAND, EVAL_STORE_DIR, createSearchGuard, parseEvalStoreFile, rewriteCacheVersion, seedRecords, serializeEvalStoreFile,
  type EvalStoreFile,
} from '../e2e/eval-store';

/**
 * Round 90 (#222), step E2: the saved engine results that browser specs seed instead of searching. The helper rewrites the cache version
 * of a saved record to the current one (a score-touching round needs no new capture) and fails fast, naming the capture command, when a
 * record does not fit or the page starts a search anyway.
 */
const record = (key: string, extra: Record<string, unknown> = {}) => ({
  key, result: { score: 0.5, rows: [] }, depth: 1, samples: 1, mode: 'mcts', tera: 'auto', savedAt: 0, ...extra,
});
const file = (records: ReturnType<typeof record>[], extra: Partial<EvalStoreFile> = {}): EvalStoreFile => ({
  format: 1, replay: 'gen9ou-1', cacheVersion: 'v79', settings: { depth: 1, samples: 1, mode: 'mcts', tera: 'auto' }, records, ...extra,
} as EvalStoreFile);

describe('rewriteCacheVersion', () => {
  it('replaces the version of a saved key and keeps the rest', () => {
    expect(rewriteCacheVersion('v79|gen9ou-1:3:abc|d1s1mmctsta', 'v80')).toBe('v80|gen9ou-1:3:abc|d1s1mmctsta');
  });

  it('replaces a version that carries a search-budget tag, and takes a tagged current version', () => {
    expect(rewriteCacheVersion('v79~fast|gen9ou-1:3:abc|d1', 'v80')).toBe('v80|gen9ou-1:3:abc|d1');
    expect(rewriteCacheVersion('v79|gen9ou-1:3:abc|d1', 'v80~fast')).toBe('v80~fast|gen9ou-1:3:abc|d1');
  });

  it('refuses a key with no version and names the capture command', () => {
    expect(() => rewriteCacheVersion('gen9ou-1:3:abc|d1', 'v80')).toThrow(CAPTURE_COMMAND);
  });
});

describe('seedRecords (the failure path: a record does not fit)', () => {
  const options = { tag: 'v80', now: 1_700_000_000_000 };

  it('rewrites every key to the current version and stamps the records as fresh', () => {
    const seeded = seedRecords(file([record('v79|gen9ou-1:1:fp|d1'), record('v79|gen9ou-1:2:fp|d1', { playedOutcome: 0.25 })]), options);
    expect(seeded.map(entry => entry.key)).toEqual(['v80|gen9ou-1:1:fp|d1', 'v80|gen9ou-1:2:fp|d1']);
    expect(seeded.every(entry => entry.savedAt === options.now)).toBe(true);
    expect(seeded[1].playedOutcome).toBe(0.25);
  });

  it('names the capture command when a key belongs to another replay', () => {
    expect(() => seedRecords(file([record('v79|gen9ou-2:1:fp|d1')]), options)).toThrow(CAPTURE_COMMAND);
  });

  it('names the capture command when a record misses a field the store reads', () => {
    for (const field of ['result', 'depth', 'samples', 'mode', 'tera']) {
      const broken = record('v79|gen9ou-1:1:fp|d1') as Record<string, unknown>;
      delete broken[field];
      expect(() => seedRecords(file([broken as ReturnType<typeof record>]), options), field).toThrow(CAPTURE_COMMAND);
    }
  });

  it('names the capture command for a file with no records or an unknown format', () => {
    expect(() => seedRecords(file([]), options)).toThrow(CAPTURE_COMMAND);
    expect(() => seedRecords(file([record('v79|gen9ou-1:1:fp|d1')], { format: 2 as 1 }), options)).toThrow(CAPTURE_COMMAND);
  });
});

describe('the file form', () => {
  it('writes one record per line in key order with the time zeroed, whatever order the browser returned', () => {
    const a = record('v79|gen9ou-1:2:fp|d1', { savedAt: 123 });
    const b = record('v79|gen9ou-1:1:fp|d1', { savedAt: 456 });
    const forward = serializeEvalStoreFile(file([a, b]));
    const backward = serializeEvalStoreFile(file([b, a]));
    expect(forward).toBe(backward);
    const lines = forward.trimEnd().split('\n');
    expect(lines.filter(line => line.includes('"key"'))).toHaveLength(2);
    expect(lines.findIndex(line => line.includes(':1:fp'))).toBeLessThan(lines.findIndex(line => line.includes(':2:fp')));
    expect(forward).not.toContain('123');
    expect(forward.endsWith('\n')).toBe(true);
  });

  it('writes the keys of a record in a fixed order', () => {
    const shuffled = { savedAt: 0, tera: 'auto', mode: 'mcts', samples: 1, depth: 1, result: { b: 1, a: 2 }, key: 'v79|gen9ou-1:1:fp|d1' };
    const text = serializeEvalStoreFile(file([shuffled as unknown as ReturnType<typeof record>]));
    expect(text).toContain('"result":{"a":2,"b":1}');
    expect(text).toContain('{"key":"v79|gen9ou-1:1:fp|d1","depth":1,"mode":"mcts"');
  });

  it('reads back what it wrote', () => {
    const original = file([record('v79|gen9ou-1:1:fp|d1'), record('v79|gen9ou-1:2:fp|d1')]);
    expect(parseEvalStoreFile(serializeEvalStoreFile(original), 'x.json')).toEqual(original);
  });

  it('names the file and the capture command when the text does not parse', () => {
    expect(() => parseEvalStoreFile('{ nope', 'gen9ou-1.json')).toThrow(/gen9ou-1\.json[\s\S]*capture-eval-store/);
  });
});

describe('createSearchGuard (the failure path: the page starts a search anyway)', () => {
  it('names the capture command and the request when a search starts', async () => {
    const guard = createSearchGuard('gen9ou-1.json');
    guard.note('search');
    expect(() => guard.assertClean()).toThrow(CAPTURE_COMMAND);
    expect(() => guard.assertClean()).toThrow(/search/);
    await expect(guard.race(new Promise(() => {}))).rejects.toThrow(CAPTURE_COMMAND);
  });

  it('fails a wait that was already running when the search started', async () => {
    const guard = createSearchGuard('gen9ou-1.json');
    const waiting = guard.race(new Promise(() => {}));
    guard.note('mctstree');
    await expect(waiting).rejects.toThrow(/mctstree/);
  });

  it('counts each search type of the worker protocol and lets the choice listing pass', () => {
    for (const type of ['search', 'mctstree', 'cells', 'subsearch', 'prove', 'lines', 'job']) {
      const guard = createSearchGuard('f.json');
      guard.note(type);
      expect(() => guard.assertClean(), type).toThrow();
    }
    const quiet = createSearchGuard('f.json');
    quiet.note('choices');
    expect(() => quiet.assertClean()).not.toThrow();
  });

  it('passes the value of a wait when no search started, and can be paused for a part that may search', async () => {
    const guard = createSearchGuard('f.json');
    await expect(guard.race(Promise.resolve(7))).resolves.toBe(7);
    guard.pause();
    guard.note('search');
    expect(() => guard.assertClean()).not.toThrow();
    await expect(guard.race(Promise.resolve(8))).resolves.toBe(8);
  });
});

describe('the saved files in the repository', () => {
  const dir = join(__dirname, '..', 'e2e', 'fixtures', 'eval-store');
  const names = readdirSync(dir).filter(name => name.endsWith('.json'));

  it('lives where the capture writes', () => {
    expect(EVAL_STORE_DIR).toBe('test/e2e/fixtures/eval-store');
  });

  for (const name of names) {
    it(`${name} parses, fits its replay and seeds`, () => {
      const parsed = parseEvalStoreFile(readFileSync(join(dir, name), 'utf-8'), name);
      expect(name).toBe(`${parsed.replay}--${parsed.settings.mode}-d${parsed.settings.depth}s${parsed.settings.samples}.json`);
      expect(seedRecords(parsed, { tag: 'v999', now: 1 }).every(entry => entry.key.startsWith('v999|'))).toBe(true);
    });
  }
});
