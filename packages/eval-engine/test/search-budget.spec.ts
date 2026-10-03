import { afterEach, describe, expect, test } from 'vitest';
import {
  autoTurnSettings, configureSearchBudget, parseSearchBudget, searchBudget, searchBudgetTag, SEARCH_BUDGET_DEFAULT,
} from '../src/search/budget';
import { SEARCH_SEEDS, treeSeed } from '../src/search/leaf';
import { AUTO_MCTS_FAINTED_FRACTION } from '../src/types';

afterEach(() => configureSearchBudget(null));

describe('search budget (round 61)', () => {
  test('the default is today\'s search', () => {
    expect(SEARCH_BUDGET_DEFAULT).toEqual({ trees: 4, iterations: 600, earlyDepth: 1, earlySamples: 1, treeFrom: AUTO_MCTS_FAINTED_FRACTION });
    expect(searchBudget()).toEqual(SEARCH_BUDGET_DEFAULT);
    expect(searchBudgetTag()).toBe('');
    expect(autoTurnSettings(0)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
    expect(autoTurnSettings(0.25)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
  });

  test('the switch: a key=value list over the default', () => {
    expect(parseSearchBudget(undefined)).toBeNull();
    expect(parseSearchBudget('')).toBeNull();
    expect(parseSearchBudget('trees=8,iterations=1200')).toEqual({ ...SEARCH_BUDGET_DEFAULT, trees: 8, iterations: 1200 });
    expect(parseSearchBudget('early-depth=3,early-samples=5,tree-from=0')).toEqual({ ...SEARCH_BUDGET_DEFAULT, earlyDepth: 3, earlySamples: 5, treeFrom: 0 });
    configureSearchBudget(parseSearchBudget('trees=16,tree-from=0'));
    expect(searchBudgetTag()).toBe('t16-i600-d1-s1-f0');
    expect(autoTurnSettings(0)).toEqual({ depth: 1, samples: 1, mode: 'mcts' });
  });

  test('a typo or an unseeded value throws', () => {
    expect(() => parseSearchBudget('tres=8')).toThrow(/unknown key/);
    expect(() => parseSearchBudget('constructor=8')).toThrow(/unknown key/);
    expect(() => parseSearchBudget('early-samples=7')).toThrow(/early-samples/);
    expect(() => parseSearchBudget('early-depth=4')).toThrow(/early-depth/);
    expect(() => parseSearchBudget('trees=0')).toThrow(/trees/);
    expect(() => parseSearchBudget('tree-from=1.5')).toThrow(/tree-from/);
    expect(() => parseSearchBudget('tree-from=')).toThrow(/tree-from/);
  });

  test('tree seeds: trees 0 to 4 keep their sequences, 16 trees draw 16 different ones', () => {
    for (let offset = 0; offset < 5; offset++) {
      for (let iteration = 0; iteration < 12; iteration++) {
        expect(treeSeed(iteration, offset)).toBe(SEARCH_SEEDS[(iteration + offset) % SEARCH_SEEDS.length]);
      }
    }
    const sequences = new Set(Array.from({ length: 16 }, (_, offset) =>
      Array.from({ length: 10 }, (_, iteration) => treeSeed(iteration, offset)).join('|')));
    expect(sequences.size).toBe(16);
  });
});
