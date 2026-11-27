import { test, expect, describe, vi, afterEach } from 'vitest';
import type { WinPaths, WinPathsRequest } from '@fulllifegames/eval-engine';
import { evalStoreKey, evalStorePrefix, loadStoredEvalsByPrefix, loadStoredWinPaths, saveStoredWinPaths, winPathsStoreKey } from '../../src/lib/eval-cache-store';

const request = (turn: number, extra: Partial<WinPathsRequest> = {}): WinPathsRequest =>
  ({ side: 'p1', turn, tera: true, sleepClause: true, ruleset: 'standard', ...extra });
const paths: WinPaths = { side: 'p1', turn: 7, steps: [{ kind: 'stronger', status: 'found', spent: { cells: 3, turns: 2 } }] };

function stubIndexedDb(): Map<string, { key: string; kind?: string }> {
  const rows = new Map<string, { key: string; kind?: string }>();
  const request = <T>(value: () => T) => {
    const req: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => { req.result = value(); req.onsuccess?.(); });
    return req;
  };
  const objectStore = {
    createIndex: () => ({}),
    index: () => ({ openCursor: () => ({}) }),
    get: (key: string) => request(() => rows.get(key)),
    getAll: (range: { low: string; high: string }) => request(() => [...rows.values()].filter(row => row.key >= range.low && row.key <= range.high)),
    put: (value: { key: string }) => { rows.set(value.key, structuredClone(value)); },
  };
  const transaction = () => {
    const tx: { oncomplete?: () => void; objectStore: () => typeof objectStore } = { objectStore: () => objectStore };
    queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
    return tx;
  };
  vi.stubGlobal('IDBKeyRange', { bound: (low: string, high: string) => ({ low, high }), upperBound: () => ({}) });
  vi.stubGlobal('indexedDB', {
    open: () => {
      const req: { result: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: { createObjectStore: () => objectStore, transaction } };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  });
  return rows;
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('eval cache store keys', () => {
  test('the store prefix covers every turn and engine of one replay and nothing else', () => {
    const prefix = evalStorePrefix('smogtours-gen8ou-573756');
    expect(prefix).toMatch(/^v\d+\|smogtours-gen8ou-573756:$/);
    const key = evalStoreKey('smogtours-gen8ou-573756:12:abc', 1, 1, 'mcts', true);
    expect(key.startsWith(prefix)).toBe(true);
    expect(evalStoreKey('smogtours-gen8ou-573756:0:abc', 2, 3, 'matrix', { p1: ['Garchomp'], p2: [] }).startsWith(prefix)).toBe(true);
    expect(evalStoreKey('smogtours-gen8ou-5737560:1:abc', 1, 1, 'matrix', true).startsWith(prefix)).toBe(false);
    // The IDBKeyRange upper bound: prefix + U+FFFF sorts after every real key.
    expect(key < `${prefix}￿`).toBe(true);
    expect(key > prefix).toBe(true);
  });

  test('the batch read degrades to null without IndexedDB', async () => {
    expect(await loadStoredEvalsByPrefix(evalStorePrefix('any'))).toBeNull();
  });
});

describe('win-paths store keys and records', () => {
  test('the key reads cache version, turn key, win-paths version and a digest of the rule set and the request', () => {
    const key = winPathsStoreKey('smogtours-gen6ou-649664:7:abc', 'standard', request(7));
    expect(key).toMatch(/^v\d+\|smogtours-gen6ou-649664:7:abc\|winpaths\d+:[0-9a-f]{16}$/);
    expect(key.startsWith(evalStorePrefix('smogtours-gen6ou-649664'))).toBe(true);
  });

  test('another rule set, turn or request gives another key, and the same question the same key', () => {
    const base = winPathsStoreKey('r:7:abc', 'standard', request(7));
    expect(winPathsStoreKey('r:7:abc', 'standard', request(7))).toBe(base);
    expect(winPathsStoreKey('r:7:abc', 'champions', request(7))).not.toBe(base);
    expect(winPathsStoreKey('r:8:abc', 'standard', request(7))).not.toBe(base);
    expect(winPathsStoreKey('r:7:abc', 'standard', request(7, { played: 'move scald' }))).not.toBe(base);
    expect(winPathsStoreKey('r:7:abc', 'standard', request(7, { tera: false }))).not.toBe(base);
  });

  test('reading and writing degrade to nothing without IndexedDB', async () => {
    expect(await loadStoredWinPaths('v1|r:7:abc|winpaths1:0')).toBeNull();
    await expect(saveStoredWinPaths({ key: 'v1|r:7:abc|winpaths1:0', kind: 'winPaths', paths, savedAt: 1 })).resolves.toBeUndefined();
  });

  test.each([['singles', 'move scald'], ['doubles', 'move scald 1, move protect']])('a saved %s answer reads back under its key; another key or another win-paths version reads nothing', async (_type, played) => {
    const rows = stubIndexedDb();
    const store = await import('../../src/lib/eval-cache-store');
    const key = store.winPathsStoreKey('r:7:abc', 'standard', request(7, { played }));
    await store.saveStoredWinPaths({ key, kind: 'winPaths', paths, savedAt: 5 });
    expect(rows.size).toBe(1);
    expect(await store.loadStoredWinPaths(key)).toMatchObject({ key, kind: 'winPaths', paths });
    expect(await store.loadStoredWinPaths(store.winPathsStoreKey('r:7:abc', 'standard', request(7)))).toBeNull();
    expect(await store.loadStoredWinPaths(key.replace(/\|winpaths\d+:/, '|winpaths999:'))).toBeNull();
    expect(await store.loadStoredWinPaths(key.replace(/^v\d+/, 'v0'))).toBeNull();
  });

  test('the prefix read of a replay leaves its win-paths records out, so its map holds results only', async () => {
    const rows = stubIndexedDb();
    const store = await import('../../src/lib/eval-cache-store');
    const evalKey = store.evalStoreKey('r:7:abc', 1, 1, 'matrix', true);
    rows.set(evalKey, { key: evalKey });
    const key = store.winPathsStoreKey('r:7:abc', 'standard', request(7));
    await store.saveStoredWinPaths({ key, kind: 'winPaths', paths, savedAt: 5 });
    const map = await store.loadStoredEvalsByPrefix(store.evalStorePrefix('r'));
    expect([...map!.keys()]).toEqual([evalKey]);
  });
});
