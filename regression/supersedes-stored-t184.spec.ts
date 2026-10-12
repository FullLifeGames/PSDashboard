import { afterEach, describe, expect, test } from 'vitest';
import { configureSearchBudget } from '@fulllifegames/eval-engine';
import { resolveAutoTurnSettings, supersedesStored, type EngineMode } from '../src/hooks/evaluation/prefs';

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
