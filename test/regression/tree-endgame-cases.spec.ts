import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { configureSearchBudget, createLocalTreeExecutor, proveForcedWin, SEARCH_BUDGET_DEFAULT, searchTreesOrchestrated, solveEndgame } from '@fulllifegames/eval-engine';
import { ENDGAME_FIXTURES } from './endgame-fixtures';

/**
 * Two synthetic doubles endgames on the path the app computes (searchTreesOrchestrated: four trees, verify, prover), beside the endgame
 * solver. doubles-ohko-tie is a coin flip (two 1-HP Machamps, Close Combat each, equal speed): fixed draws that resolve the tie alike
 * would let the solver read 1.0 as exact and the prover prove a win of mass 1. doubles-spread-2v1 is a won endgame (truth 1.0) whose
 * visit mean one tree pulls down: its first expansion fixes a root cell in a losing world and its visits inherit it.
 */

const board = (name: string): string =>
  JSON.stringify(State.serializeBattle(ENDGAME_FIXTURES.find(fixture => fixture.name === name)!.build()));

describe('doubles endgames on the app path (round 67, T114)', () => {
  // The solver and the prover keep their assertions. The tree's score is the mean of the trees' root cells, and each of the four trees
  // draws the tie once: the first draw of `treeSeed(0, offset)` puts p2 first for offsets 0 to 13, so the four trees read -1 (the
  // lattice seeds read 0.5, one tree order only by luck of four fixed numbers). `Math.abs(result.score)` has no stable bound at any tree
  // count, and the undrawn tie order at its Dex weight is not asserted.
  test('doubles-ohko-tie: the speed tie is priced as a coin, no forced win of mass 1 (round 86: no tree-score assertion)', { timeout: 120_000 }, async () => {
    const serialized = board('doubles-ohko-tie');
    expect(proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    expect(proveForcedWin(serialized, { side: 'p2', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    const solved = solveEndgame(serialized, {}, 'standard');
    expect(solved.value).toBeCloseTo(0, 9);
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false });
    expect(result.forcedWin?.mass ?? 0).toBeLessThan(1);
  });

  // At the default four trees the hashed seeds give no tree the unlucky first expansion (visits 0.9994, game 0.9993), so the contrast
  // the row exists for is gone at that count. It shows at 8 trees (visits 0.655, game 0.832; 16 trees 0.821), so the row sets the tree
  // count.
  test('doubles-spread-2v1: at 8 trees the visit mean reads under 0.7 where the game value reads over 0.8, the rankings stay (EVAL_TREE_SCORE, round 86)', { timeout: 240_000 }, async () => {
    const serialized = board('doubles-spread-2v1');
    const saved = process.env.EVAL_TREE_SCORE;
    const search = (form: string) => {
      process.env.EVAL_TREE_SCORE = form;
      return searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false, prove: false });
    };
    configureSearchBudget({ ...SEARCH_BUDGET_DEFAULT, trees: 8 });
    try {
      const visits = await search('visits');
      const game = await search('game');
      expect(visits.score).toBeLessThan(0.7);
      expect(game.score).toBeGreaterThan(0.8);
      expect(game.perSide).toEqual(visits.perSide);
    } finally {
      configureSearchBudget(null);
      if (saved === undefined) delete process.env.EVAL_TREE_SCORE;
      else process.env.EVAL_TREE_SCORE = saved;
    }
  });
});
