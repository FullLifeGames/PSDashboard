import { describe, expect, test } from 'vitest';
import { State } from '@pkmn/sim';
import { createLocalTreeExecutor, proveForcedWin, searchTreesOrchestrated, solveEndgame } from '@fulllifegames/eval-engine';
import { ENDGAME_FIXTURES } from './endgame-fixtures';

/**
 * Round 67 (T114): two synthetic doubles endgames on the path the app
 * computes (searchTreesOrchestrated: four trees, verify, prover), beside the
 * endgame solver. doubles-ohko-tie is a coin flip (two 1-HP Machamps, Close
 * Combat each, equal speed): the three fixed draws of a doubles cell resolved
 * the tie alike, so the solver read 1.0 as exact and the prover proved a win
 * of mass 1.
 */

const board = (name: string): string =>
  JSON.stringify(State.serializeBattle(ENDGAME_FIXTURES.find(fixture => fixture.name === name)!.build()));

describe('doubles endgames on the app path (round 67, T114)', () => {
  test('doubles-ohko-tie: the speed tie is priced as a coin, no forced win of mass 1', { timeout: 120_000 }, async () => {
    const serialized = board('doubles-ohko-tie');
    expect(proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    expect(proveForcedWin(serialized, { side: 'p2', rootOrder: [], tera: false }).mass).toBeLessThan(1);
    const solved = solveEndgame(serialized, {}, 'standard');
    expect(solved.value).toBeCloseTo(0, 9);
    const result = await searchTreesOrchestrated(createLocalTreeExecutor(serialized), { depth: 1, samples: 1, mode: 'mcts', tera: false });
    expect(result.forcedWin?.mass ?? 0).toBeLessThan(1);
    expect(Math.abs(result.score)).toBeLessThan(0.9);
  });
});
