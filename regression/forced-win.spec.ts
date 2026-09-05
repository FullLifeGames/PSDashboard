import { test, expect } from '@playwright/test';
import { State } from '@pkmn/sim';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { proveForcedWin } from '../packages/eval-engine/src/endgame/prover';
import { MIN_FORCED_MASS, type ForcedWinCaveat } from '../packages/eval-engine/src/types';

/**
 * The forced-win prover over the synthetic endgames (round 35): the proofs
 * the spec expects, the clean failures, and the mass cases, pinned from the
 * first sighting against the round-34 solver values. Findings: fixed damage
 * proves without the crit label (toss-race-2v3 in 2); a speed tie reads one
 * half however many ties precede the deciding one (toss-race-even, the
 * 2HKO tie); the two walls without an attack lose in 3 (one-v-two-breaker,
 * where the solver capped at 0.294); with classes the draws never showed
 * left open, the burned heal war, the PP lock, and the Scarf lock prove
 * for p2 over four to five turns on the sampled rolls (healer-burned 0.93,
 * struggle-lock 0.997, choice-locked 0.97); focus-blast-range (a ten-turn
 * miss chain), healer-vs-band, fixed-vs-ghost, and the sack fail at the
 * cells budget or the depth cap, honestly; doubles proofs carry the
 * sampled-rolls label, the doubles tie reads the sampled order
 * (doubles-ohko-tie), and the doubles spread cells stay unpriced.
 */
interface Expected { side: 'p1' | 'p2'; mass: number | null; turns?: number; caveat?: ForcedWinCaveat; digits?: number }

const EXPECTED: Record<string, Expected> = {
  'toss-race-2v3': { side: 'p1', mass: 1, turns: 2, caveat: 'none' },
  'level-gap': { side: 'p1', mass: 1, turns: 1 },
  'priority-race': { side: 'p1', mass: 1, turns: 1 },
  'doubles-toss-race': { side: 'p1', mass: 1, turns: 2, caveat: 'sampled-rolls' },
  'doubles-level-gap': { side: 'p1', mass: 1, turns: 1, caveat: 'sampled-rolls' },
  'doubles-priority': { side: 'p1', mass: 1, turns: 1, caveat: 'sampled-rolls' },
  'doubles-ohko-tie': { side: 'p1', mass: 1, turns: 1, caveat: 'sampled-rolls' },
  'ohko-tie': { side: 'p1', mass: 0.5, turns: 1 },
  // The last tie decides: the first turn's order does not, so both read one half.
  'speed-tie-2hko': { side: 'p1', mass: 0.5, turns: 1 },
  'toss-race-even': { side: 'p1', mass: 0.5, turns: 2 },
  'thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'doubles-thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'toxic-stall': { side: 'p2', mass: 1, turns: 2, caveat: 'none' },
  'one-v-two-breaker': { side: 'p1', mass: 1, turns: 3, caveat: 'none' },
  'two-v-one-sack': { side: 'p1', mass: null },
  'focus-blast-range': { side: 'p1', mass: null },
  'struggle-lock': { side: 'p2', mass: 0.997, digits: 3, turns: 5, caveat: 'sampled-rolls' },
  'healer-vs-band': { side: 'p2', mass: null },
  'healer-burned': { side: 'p2', mass: 0.926, digits: 3, turns: 4, caveat: 'sampled-rolls' },
  'choice-locked': { side: 'p2', mass: 0.974, digits: 3, turns: 3, caveat: 'sampled-rolls' },
  'fixed-vs-ghost': { side: 'p2', mass: null },
  'setup-vs-heal': { side: 'p1', mass: null },
  'two-v-one-switch-loop': { side: 'p2', mass: null },
  'doubles-healer-vs-band': { side: 'p2', mass: null },
  'doubles-spread-2v1': { side: 'p1', mass: null },
  'doubles-1v2-spread': { side: 'p1', mass: null },
};

test.describe('forced-win prover over the synthetic endgames (round 35)', () => {
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
      if (expected.caveat !== undefined) expect(proof.caveat).toBe(expected.caveat);
    });
  }
});
