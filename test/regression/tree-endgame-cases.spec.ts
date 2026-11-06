import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { configureSearchBudget, createLocalTreeExecutor, proveForcedWin, SEARCH_BUDGET_DEFAULT, searchTreesOrchestrated, solveEndgame } from '@fulllifegames/eval-engine';
import { ENDGAME_FIXTURES } from './endgame-fixtures';

/**
 * Round 67 (T114): two synthetic doubles endgames on the path the app
 * computes (searchTreesOrchestrated: four trees, verify, prover), beside the
 * endgame solver. doubles-ohko-tie is a coin flip (two 1-HP Machamps, Close
 * Combat each, equal speed): the three fixed draws of a doubles cell resolved
 * the tie alike, so the solver read 1.0 as exact and the prover proved a win
 * of mass 1. doubles-spread-2v1 is a won endgame (truth 1.0) whose visit
 * mean one tree pulls down: its first expansion fixed a root cell in a losing
 * world and its visits inherited it (probe lanes/B/t114-spread, round 67).
 *
 * Round 86 (T323, the trees' seeds hashed from offset and iteration; user gate
 * of 06.11.2026, 2a): the two rows moved with the new seeds and were re-pinned.
 * doubles-ohko-tie lost its tree-score assertion (the four trees' first draw
 * of the tie put p2 first in every tree, score -1 where the lattice seeds read
 * 0.5; the solver's 0 and the prover's mass below 1 stay). doubles-spread-2v1
 * runs at 8 trees, where the contrast between the visit mean and the game
 * value still shows (four hashed trees read 0.9994 against 0.9993).
 */

const board = (name: string): string =>
  JSON.stringify(State.serializeBattle(ENDGAME_FIXTURES.find(fixture => fixture.name === name)!.build()));

describe('doubles endgames on the app path (round 67, T114)', () => {
  // Round 86 (T323): the solver and the prover keep their assertions. The tree's score is the mean of the trees' root cells,
  // and each of the four trees draws the tie once: the first draw of `treeSeed(0, offset)` puts p2 first for offsets 0 to 13,
  // so the four trees read -1 (the lattice seeds read 0.5, one tree order only by luck of four fixed numbers). The line
  // `expect(Math.abs(result.score)).toBeLessThan(0.9)` is dropped: no tree count makes it stable, and the undrawn tie order
  // at its Dex weight is T340. User gate of 06.11.2026 (2a).
  test('doubles-ohko-tie: the speed tie is priced as a coin, no forced win of mass 1 (round 86: no tree-score assertion)', { timeout: 120_000 }, async () => {
    const serialized = board('doubles-ohko-tie');
    expect(proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    expect(proveForcedWin(serialized, { side: 'p2', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    const solved = solveEndgame(serialized, {}, 'standard');
    expect(solved.value).toBeCloseTo(0, 9);
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false });
    expect(result.forcedWin?.mass ?? 0).toBeLessThan(1);
  });

  // Round 86 (T323, user gate of 06.11.2026, 2a): the row ran at the default four trees and read the visit mean 0.355 against
  // the game value 0.832 (lattice seeds; 0.471 / 0.551 / 0.355 / 0.655 at 5 / 6 / 8 / 16 trees). The hashed seeds give no
  // tree the unlucky first expansion at four trees (visits 0.9994, game 0.9993), so the contrast the row exists for is gone
  // at that count. It still shows at 8 trees (visits 0.655, game 0.832; 16 trees 0.821), so the row sets the tree count.
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
