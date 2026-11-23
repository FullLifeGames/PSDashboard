import { afterEach, describe, expect, test } from 'vitest';
import { configureSearchBudget, parseSearchBudget } from '@fulllifegames/eval-engine';
import {
  resolveAutoTurnSettings,
  supersedesStored,
  type EngineMode,
  resolveAutoLeadSettings,
  serializedAutoRouting,
} from '../../src/hooks/evaluation/prefs';

/**
 * Round 69 (T184): after a matrix result of depth 2 or more, a sweep whose
 * configured engine is the tree replaces it. The round-67 gate removed the
 * two cross-engine exceptions (a deep matrix result lands on a tree turn and
 * survives the next tree sweep); the configured engine decides, nothing else.
 */
afterEach(() => configureSearchBudget(null));

const DEEP_MATRIX = { depth: 2, samples: 3, mode: 'matrix' } as const;
const TREE = { depth: 1, samples: 1, mode: 'mcts' } as const;
const SKETCH = { depth: 1, samples: 1, mode: 'matrix' } as const;
type Setting = { depth: number; samples: number; mode: EngineMode };

describe('auto routing per game type', () => {
  test('at the default early singles turns run the matrix with three draws, doubles the tree from the first turn, the lead stays d1s1', () => {
    expect(resolveAutoTurnSettings(0, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
    expect(resolveAutoTurnSettings(0.249, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
    expect(resolveAutoTurnSettings(0.25, false)).toEqual(TREE);
    expect(resolveAutoTurnSettings(0, true)).toEqual(TREE);
    expect(resolveAutoTurnSettings(0.249, true)).toEqual(TREE);
    expect(resolveAutoLeadSettings()).toEqual(SKETCH);
  });

  test('a form per game type resolves each game type by its own split', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25,singles-early-samples=3'));
    expect(resolveAutoTurnSettings(0.1, false)).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
    expect(resolveAutoTurnSettings(0.25, false)).toEqual(TREE);
    expect(resolveAutoTurnSettings(0.1, true)).toEqual(TREE);
  });

  test('the team-preview lead stays d1s1 in both game types, whatever the early splits', () => {
    expect(resolveAutoLeadSettings()).toEqual(SKETCH);
    // Before round 63 the lead read the early matrix, so this form moved it to three draws.
    configureSearchBudget(parseSearchBudget('tree-from=0.25,early-samples=3'));
    expect(resolveAutoLeadSettings()).toEqual(SKETCH);
    configureSearchBudget(parseSearchBudget('singles-early-samples=5,doubles-early-depth=2'));
    expect(resolveAutoLeadSettings()).toEqual(SKETCH);
    // Only its own keys move it.
    configureSearchBudget(parseSearchBudget('lead-samples=3'));
    expect(resolveAutoLeadSettings()).toEqual({ depth: 1, samples: 3, mode: 'matrix' });
  });

  test('the monotone merge resolves the configured engine per game type', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25'));
    // Early singles turn: auto's target is the matrix, so the sketch replaces a stored tree result.
    expect(supersedesStored(TREE, SKETCH, 'auto', 0.1, false)).toBe(true);
    // Early doubles turn: auto's target is the tree, so the sketch never downgrades it.
    expect(supersedesStored(TREE, SKETCH, 'auto', 0.1, true)).toBe(false);
    // Unknown fraction: fail closed in both game types.
    expect(supersedesStored(TREE, SKETCH, 'auto', null, false)).toBe(false);
    expect(supersedesStored(TREE, SKETCH, 'auto', null, true)).toBe(false);
  });

  test('serializedAutoRouting reads the game type next to the fainted fraction', () => {
    const sides = [
      { pokemon: [{ hp: 100 }, { hp: 0 }, { hp: 12, fainted: false }] },
      { pokemon: [{ hp: 50, fainted: true }, { hp: 88 }, { hp: 44 }] },
    ];
    expect(serializedAutoRouting(JSON.stringify({ gameType: 'doubles', sides }))).toEqual({ faintedFraction: 2 / 6, doubles: true });
    expect(serializedAutoRouting(JSON.stringify({ gameType: 'singles', sides }))).toEqual({ faintedFraction: 2 / 6, doubles: false });
    // A battle without a game type is singles, as the simulator's default.
    expect(serializedAutoRouting(JSON.stringify({ sides: [] }))).toEqual({ faintedFraction: 0, doubles: false });
  });
});

describe('after depth 2 the configured engine decides', () => {
  test('after depth 2, an MCTS target replaces the stored matrix result', () => {
    expect(supersedesStored(DEEP_MATRIX, TREE, 'mcts')).toBe(true);
    expect(supersedesStored({ depth: 3, samples: 3, mode: 'matrix' }, TREE, 'mcts')).toBe(true);
  });

  test('after depth 2 and Auto, singles from the tree threshold replace it, doubles on every turn', () => {
    // Auto routing reads the game type only, so a VGC battle counts as doubles here.
    const { mode: atQuarter } = resolveAutoTurnSettings(0.25, false);
    expect(atQuarter).toBe('mcts');
    expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', 0.25, false)).toBe(true);
    expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', 0.5, false)).toBe(true);
    expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', 0.1, true)).toBe(true);
    expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', 0, true)).toBe(true);
  });

  test('an early singles turn targets the matrix, so a tree pass does not replace the deep result', () => {
    expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', 0.1, false)).toBe(false);
    expect(supersedesStored(DEEP_MATRIX, TREE, 'matrix')).toBe(false);
  });

  test('a matrix pass does not land on a stored tree result of a tree turn', () => {
    // The removed exception: a deep matrix pass used to outrank the tree on its own turn.
    expect(supersedesStored(TREE, DEEP_MATRIX, 'mcts')).toBe(false);
    expect(supersedesStored(TREE, DEEP_MATRIX, 'auto', 0.5, false)).toBe(false);
    expect(supersedesStored(TREE, DEEP_MATRIX, 'auto', 0.1, true)).toBe(false);
    // Where the matrix is the target it still lands, and the sketch of an early singles turn replaces a tree result.
    expect(supersedesStored(TREE, DEEP_MATRIX, 'matrix')).toBe(true);
    expect(supersedesStored(TREE, SKETCH, 'auto', 0.1, false)).toBe(true);
  });

  test('an unknown fraction keeps the stored result in both game types', () => {
    for (const doubles of [false, true]) {
      expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', null, doubles)).toBe(false);
      expect(supersedesStored(TREE, DEEP_MATRIX, 'auto', null, doubles)).toBe(false);
      expect(supersedesStored(DEEP_MATRIX, TREE, 'auto', undefined, doubles)).toBe(false);
    }
  });
});

describe('truth table over the settings lattice', () => {
  const settings: Setting[] = [];
  for (const mode of ['matrix', 'mcts'] as const) for (const depth of [1, 2, 3]) for (const samples of [1, 3, 5]) settings.push({ depth, samples, mode });
  const target = (configured: 'matrix' | 'mcts' | 'auto', fraction: number | null, doubles: boolean): EngineMode | null =>
    configured !== 'auto' ? configured : fraction == null ? null : resolveAutoTurnSettings(fraction, doubles).mode;

  test.each([false, true])('across engines the incoming pass wins exactly when it carries the target (doubles %s)', (doubles) => {
    for (const configured of ['matrix', 'mcts', 'auto'] as const) for (const fraction of [null, 0.1, 0.25, 0.5, 1]) {
      const wanted = target(configured, fraction, doubles);
      for (const stored of settings) for (const incoming of settings) {
        if (stored.mode === incoming.mode) continue;
        expect(supersedesStored(stored, incoming, configured, fraction, doubles), JSON.stringify({ configured, fraction, stored, incoming })).toBe(incoming.mode === wanted);
      }
    }
  });

  test.each([false, true])('a sweep that carries the configured engine is never blocked by the other engine (doubles %s)', (doubles) => {
    for (const configured of ['matrix', 'mcts', 'auto'] as const) for (const fraction of [0.1, 0.25, 0.5, 1]) {
      const wanted = target(configured, fraction, doubles);
      for (const stored of settings) for (const incoming of settings) {
        if (incoming.mode !== wanted || stored.mode === wanted) continue;
        expect(supersedesStored(stored, incoming, configured, fraction, doubles)).toBe(true);
      }
    }
  });

  test.each([false, true])('within one engine the matrix needs both dimensions and the tree refreshes (doubles %s)', (doubles) => {
    for (const stored of settings) for (const incoming of settings) {
      if (stored.mode !== incoming.mode) continue;
      const expected = incoming.mode === 'mcts' || (incoming.depth >= stored.depth && incoming.samples >= stored.samples);
      expect(supersedesStored(stored, incoming, incoming.mode, 0.5, doubles)).toBe(expected);
    }
  });
});
