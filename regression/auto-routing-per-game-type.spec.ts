import { afterEach, describe, expect, test } from 'vitest';
import { configureSearchBudget, parseSearchBudget } from '@fulllifegames/eval-engine';
import {
  needsSettingsUpgrade, resolveAutoLeadSettings, resolveAutoTurnSettings, serializedAutoRouting, supersedesStored,
} from '../src/hooks/evaluation/prefs';

/**
 * Round 63 (T110): auto resolves per game type. The search budget holds one
 * early split per game type (matrix below its tree threshold, the tree at or
 * above) and the team-preview lead apart from both.
 */
afterEach(() => configureSearchBudget(null));

const TREE = { depth: 1, samples: 1, mode: 'mcts' } as const;
const SKETCH = { depth: 1, samples: 1, mode: 'matrix' } as const;
const AUTO_PREFS = { depth: 2, samples: 3, mode: 'auto', auto: false, autoAnalyze: false, tera: 'auto' } as const;

describe('auto routing per game type', () => {
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

  test('the upgrade check resolves the configured engine per game type', () => {
    configureSearchBudget(parseSearchBudget('singles-tree-from=0.25'));
    // An early singles turn holding the sketch is settled; the same doubles turn rises to the tree.
    expect(needsSettingsUpgrade(SKETCH, AUTO_PREFS, 0.1, false)).toBe(false);
    expect(needsSettingsUpgrade(SKETCH, AUTO_PREFS, 0.1, true)).toBe(true);
    // A tree result is settled on the doubles turn and replaced by the configured matrix on the singles turn.
    expect(needsSettingsUpgrade(TREE, AUTO_PREFS, 0.1, true)).toBe(false);
    expect(needsSettingsUpgrade(TREE, AUTO_PREFS, 0.1, false)).toBe(true);
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
