import { afterEach, describe, expect, test } from 'vitest';
import {
  autoTurnSettings, configureSearchBudget, parseSearchBudget, searchBudget, searchBudgetTag, SEARCH_BUDGET_DEFAULT,
} from '../src/search/budget';
import { SEARCH_SEEDS, treeSeed } from '../src/search/leaf';
import { AUTO_MCTS_FAINTED_FRACTION } from '../src/types';

afterEach(() => configureSearchBudget(null));

const TREE = { depth: 1, samples: 1, mode: 'mcts' } as const;
const MATRIX = { depth: 1, samples: 1, mode: 'matrix' } as const;

describe('search budget (round 61)', () => {
  test('the form chosen at the round-61 gate stays reachable through the switch: trees from the first turn', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0,singles-early-samples=1'));
    expect(searchBudgetTag()).not.toBe('');
    for (const doubles of [false, true]) {
      expect(autoTurnSettings(0, doubles)).toEqual(TREE);
      expect(autoTurnSettings(0.5, doubles)).toEqual(TREE);
    }
  });

  test('the search before round 61 stays reachable through the switch', () => {
    configureSearchBudget(parseSearchBudget(`iterations=600,tree-from=${AUTO_MCTS_FAINTED_FRACTION},early-samples=1`));
    for (const doubles of [false, true]) {
      expect(autoTurnSettings(0, doubles)).toEqual(MATRIX);
      expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION, doubles)).toEqual(TREE);
    }
  });

  test('the switch: a key=value list over the default', () => {
    expect(parseSearchBudget(undefined)).toBeNull();
    expect(parseSearchBudget('')).toBeNull();
    expect(parseSearchBudget('trees=8,iterations=1200')).toEqual({ ...SEARCH_BUDGET_DEFAULT, trees: 8, iterations: 1200 });
    const early = { earlyDepth: 3, earlySamples: 5, treeFrom: 0 };
    expect(parseSearchBudget('early-depth=3,early-samples=5,tree-from=0')).toEqual({ ...SEARCH_BUDGET_DEFAULT, singles: early, doubles: early });
    configureSearchBudget(parseSearchBudget('trees=16,tree-from=0'));
    expect(searchBudgetTag()).toBe('t16-i600-s1.3.0-d1.1.0-l1.1');
    expect(autoTurnSettings(0, false)).toEqual(TREE);
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

describe('search budget per game type (round 63, T110)', () => {
  test('the default splits auto by game type: early singles turns run the matrix with three draws, doubles the tree from the first turn', () => {
    expect(SEARCH_BUDGET_DEFAULT).toEqual({
      trees: 4, iterations: 600,
      singles: { earlyDepth: 1, earlySamples: 3, treeFrom: AUTO_MCTS_FAINTED_FRACTION },
      doubles: { earlyDepth: 1, earlySamples: 1, treeFrom: 0 },
      lead: { depth: 1, samples: 1 },
    });
    expect(searchBudget()).toEqual(SEARCH_BUDGET_DEFAULT);
    expect(searchBudgetTag()).toBe('');
    const early = { depth: 1, samples: 3, mode: 'matrix' } as const;
    expect(autoTurnSettings(0, false)).toEqual(early);
    expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION - 0.001, false)).toEqual(early);
    expect(autoTurnSettings(AUTO_MCTS_FAINTED_FRACTION, false)).toEqual(TREE);
    expect(autoTurnSettings(0, true)).toEqual(TREE);
    expect(autoTurnSettings(1, true)).toEqual(TREE);
  });

  test('the switch sets one game type or both, and the team-preview lead apart', () => {
    const singlesOne = parseSearchBudget('singles-early-samples=3,singles-early-depth=2')!;
    expect(singlesOne.singles).toEqual({ earlyDepth: 2, earlySamples: 3, treeFrom: SEARCH_BUDGET_DEFAULT.singles.treeFrom });
    expect(singlesOne.doubles).toEqual(SEARCH_BUDGET_DEFAULT.doubles);
    expect(singlesOne.lead).toEqual(SEARCH_BUDGET_DEFAULT.lead);
    const doublesOne = parseSearchBudget('doubles-tree-from=0.25')!;
    expect(doublesOne.doubles.treeFrom).toBe(0.25);
    expect(doublesOne.singles).toEqual(SEARCH_BUDGET_DEFAULT.singles);
    // The unprefixed keys keep their round-61 meaning for turns: both game types, never the lead.
    const both = parseSearchBudget('tree-from=0.25,early-samples=3')!;
    expect(both.singles).toEqual({ earlyDepth: 1, earlySamples: 3, treeFrom: 0.25 });
    expect(both.doubles).toEqual({ earlyDepth: 1, earlySamples: 3, treeFrom: 0.25 });
    expect(both.lead).toEqual({ depth: 1, samples: 1 });
    // Left to right: a game-type key after a both key wins for its game type.
    expect(parseSearchBudget('early-samples=5,singles-early-samples=1')!.singles.earlySamples).toBe(1);
    expect(parseSearchBudget('lead-depth=2,lead-samples=3')).toEqual({ ...SEARCH_BUDGET_DEFAULT, lead: { depth: 2, samples: 3 } });
    expect(() => parseSearchBudget('singles-early-samples=7')).toThrow(/singles-early-samples/);
    expect(() => parseSearchBudget('doubles-tree-from=2')).toThrow(/doubles-tree-from/);
    expect(() => parseSearchBudget('lead-depth=4')).toThrow(/lead-depth/);
    expect(() => parseSearchBudget('triples-tree-from=0')).toThrow(/unknown key/);
  });

  test('a form per game type routes each game type by its own split', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25,singles-early-samples=3'));
    expect(autoTurnSettings(0, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
    expect(autoTurnSettings(0.25, false)).toEqual(TREE);
    expect(autoTurnSettings(0, true)).toEqual(TREE);
    configureSearchBudget(parseSearchBudget('doubles-tree-from=0.25,doubles-early-depth=2'));
    expect(autoTurnSettings(0, true)).toEqual({ depth: 2, samples: 1, mode: 'matrix' });
    expect(autoTurnSettings(0.25, true)).toEqual(TREE);
    // The singles split keeps its default.
    expect(autoTurnSettings(0, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
  });

  test('tags tell apart forms that differ in one game type, and a form equal to the default keeps the plain key', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.5'));
    const singlesTag = searchBudgetTag();
    configureSearchBudget(parseSearchBudget('doubles-tree-from=0.25'));
    const doublesTag = searchBudgetTag();
    configureSearchBudget(parseSearchBudget('lead-samples=3'));
    const leadTag = searchBudgetTag();
    expect(new Set([singlesTag, doublesTag, leadTag, '']).size).toBe(4);
    // Field by field, not by key order: a form that spells out the default is the default.
    configureSearchBudget(parseSearchBudget('early-samples=5,singles-early-samples=3,doubles-early-samples=1'));
    expect(searchBudgetTag()).toBe('');
    configureSearchBudget({
      lead: { samples: 1, depth: 1 }, doubles: { treeFrom: 0, earlySamples: 1, earlyDepth: 1 },
      singles: { treeFrom: AUTO_MCTS_FAINTED_FRACTION, earlySamples: 3, earlyDepth: 1 }, iterations: 600, trees: 4,
    });
    expect(searchBudgetTag()).toBe('');
  });
});
