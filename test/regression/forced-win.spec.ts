import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { proveForcedWin, MIN_FORCED_MASS, type ForcedWinCaveat } from '@fulllifegames/eval-engine';

interface Expected { side: 'p1' | 'p2'; mass: number | null; turns?: number; maxTurns?: number; caveat?: ForcedWinCaveat; digits?: number }

const EXPECTED: Record<string, Expected> = {
  'toss-race-2v3': { side: 'p1', mass: 1, turns: 2, caveat: 'none' },
  'level-gap': { side: 'p1', mass: 1, turns: 1 },
  'priority-race': { side: 'p1', mass: 1, turns: 1 },
  'doubles-toss-race': { side: 'p1', mass: 1, turns: 2, caveat: 'sampled-rolls' },
  'doubles-level-gap': { side: 'p1', mass: 1, turns: 1, caveat: 'sampled-rolls' },
  'doubles-priority': { side: 'p1', mass: 1, turns: 1, caveat: 'sampled-rolls' },
  'doubles-ohko-tie': { side: 'p1', mass: 0.5, turns: 1, caveat: 'sampled-rolls' },
  'ohko-tie': { side: 'p1', mass: 0.5, turns: 1 },
  'speed-tie-2hko': { side: 'p1', mass: 0.5, turns: 1 },
  'toss-race-even': { side: 'p1', mass: 0.5, turns: 2 },
  'thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'doubles-thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'toxic-stall': { side: 'p2', mass: 1, turns: 2, caveat: 'barring-crit' },
  'one-v-two-breaker': { side: 'p1', mass: 1, turns: 4, caveat: 'barring-crit' },
  'two-v-one-sack': { side: 'p1', mass: null },
  // Each cell rolls its own dice, so the memo merges nothing: 281 to 420 cells needed, PROVER_BUDGET.cells allows 100.
  'focus-blast-range': { side: 'p1', mass: null },
  'struggle-lock': { side: 'p2', mass: 0.99584, digits: 5, turns: 5, caveat: 'sampled-rolls' },
  // 10,000 simulated games: Toxapex falls in every one, by turn 6 in 88 % of them.
  'healer-vs-band': { side: 'p2', mass: 1, maxTurns: 9, caveat: 'sampled-rolls' },
  'healer-burned': { side: 'p2', mass: 1, turns: 4, caveat: 'sampled-rolls' },
  'choice-locked': { side: 'p2', mass: 1, turns: 3, caveat: 'sampled-rolls' },
  'fixed-vs-ghost': { side: 'p2', mass: null },
  'setup-vs-heal': { side: 'p1', mass: null },
  'two-v-one-switch-loop': { side: 'p2', mass: null },
  'doubles-healer-vs-band': { side: 'p2', mass: 1, maxTurns: 9, caveat: 'sampled-rolls' },
  'doubles-spread-2v1': { side: 'p1', mass: null },
  'doubles-1v2-spread': { side: 'p1', mass: null },
};

describe('forced-win prover over the synthetic endgames', () => {
  for (const fixture of ENDGAME_FIXTURES) {
    const expected = EXPECTED[fixture.name];
    const title = expected ? (expected.mass === null ? 'no proof' : `mass ${expected.mass}`) : 'unlisted';
    test(`${fixture.name}: ${title}`, () => {
      expect(expected, `${fixture.name} needs a row in EXPECTED`).toBeDefined();
      const serialized = JSON.stringify(State.serializeBattle(fixture.build()));
      const proof = proveForcedWin(serialized, { side: expected.side, rootOrder: [], tera: false });
      console.log(`${fixture.name} ${expected.side}: mass=${proof.mass.toFixed(3)} turns=${proof.turns} caveat=${proof.caveat} states=${proof.states}` +
        (proof.open ? ` open=${proof.open.label}@${proof.open.odds}` : ''));
      if (expected.mass === null) {
        expect(proof.mass).toBeLessThan(MIN_FORCED_MASS);
        return;
      }
      expect(proof.mass).toBeCloseTo(expected.mass, expected.digits ?? 6);
      if (expected.turns !== undefined) expect(proof.turns).toBe(expected.turns);
      if (expected.maxTurns !== undefined) expect(proof.turns).toBeLessThanOrEqual(expected.maxTurns);
      if (expected.caveat !== undefined) expect(proof.caveat).toBe(expected.caveat);
    });
  }
});

describe('the prover with room', () => {
  // The game's win share is 0.999941 (5,000 simulated games); a proof is a lower bound under the class model.
  test('focus-blast-range with 5,000 cells: 0.99 < mass <= 0.99995 in 12 turns', () => {
    const fixture = ENDGAME_FIXTURES.find(row => row.name === 'focus-blast-range')!;
    const serialized = JSON.stringify(State.serializeBattle(fixture.build()));
    const proof = proveForcedWin(serialized, { side: 'p1', rootOrder: [], tera: false, budget: { cells: 5000, states: 5000 } });
    expect(proof.mass).toBeGreaterThan(0.99);
    expect(proof.mass).toBeLessThanOrEqual(0.99995);
    expect(proof.turns).toBe(12);
    expect(proof.caveat).toBe('sampled-rolls');
  });
});
