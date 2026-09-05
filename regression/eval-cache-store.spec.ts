import { test, expect, describe } from 'vitest';
import { evalStoreKey, evalStorePrefix, loadStoredEvalsByPrefix } from '../src/lib/eval-cache-store';

describe('eval cache store keys', () => {
  test('the store prefix covers every turn and engine of one replay and nothing else', () => {
    const prefix = evalStorePrefix('smogtours-gen8ou-573756');
    expect(prefix).toMatch(/^v\d+\|smogtours-gen8ou-573756:$/);
    const key = evalStoreKey('smogtours-gen8ou-573756:12:abc', 1, 1, 'mcts', true);
    expect(key.startsWith(prefix)).toBe(true);
    expect(evalStoreKey('smogtours-gen8ou-573756:0:abc', 2, 3, 'matrix', { p1: ['Garchomp'], p2: [] }).startsWith(prefix)).toBe(true);
    // A replay id that merely extends this one falls outside the prefix.
    expect(evalStoreKey('smogtours-gen8ou-5737560:1:abc', 1, 1, 'matrix', true).startsWith(prefix)).toBe(false);
    // The IDBKeyRange upper bound: prefix + U+FFFF sorts after every real key.
    expect(key < `${prefix}￿`).toBe(true);
    expect(key > prefix).toBe(true);
  });

  test('the batch read degrades to null without IndexedDB', async () => {
    expect(await loadStoredEvalsByPrefix(evalStorePrefix('any'))).toBeNull();
  });
});
