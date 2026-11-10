import { test, expect, describe } from 'vitest';
import { State } from '@pkmn/sim';
import { ENDGAME_FIXTURES } from './endgame-fixtures';
import { proveForcedWin, MIN_FORCED_MASS, type ForcedWinCaveat } from '@fulllifegames/eval-engine';

/**
 * The forced-win prover over the synthetic endgames (round 35): the proofs
 * the spec expects, the clean failures, and the mass cases, pinned from the
 * first sighting against the round-34 solver values. Findings: fixed damage
 * proves without the crit label (toss-race-2v3 in 2); a speed tie reads one
 * half however many ties precede the deciding one (toss-race-even, the
 * 2HKO tie); the two walls without an attack lose in 3 (one-v-two-breaker,
 * where the solver capped at 0.294); with classes the draws never showed
 * left open, the burned heal war, the PP lock, and the Scarf lock prove
 * for p2 over three to five turns on the sampled rolls (healer-burned and
 * choice-locked at mass 1 once a missing class inherits the proof of the
 * class that dominates it, struggle-lock 0.997); focus-blast-range (a
 * twelve-turn miss chain) read 0.9999 in rounds 35 and 88 (round 86 lost the
 * proof to 163 cells against the budget's 100, and round 88, T336, brought it
 * back: the class in which the Special Defense drop fired takes the proof of
 * the class in which it did not), and reads no proof at 100 cells since round
 * 89, where each cell rolls its own dice (281 to 420 cells; the room test
 * below holds 0.99 to 0.99995 in 12 turns at 5,000); the six-turn heal war
 * healer-vs-band and its doubles twin read mass 1 since round 89 (A5f-7), once
 * the full proof stopped waiting for a greedy five-turn line;
 * fixed-vs-ghost and the sack fail at the depth cap or
 * at unpriced cells, honestly; doubles proofs carry the sampled-rolls
 * label, a doubles speed tie prices each order as one half since round 67
 * (doubles-ohko-tie, a coin flip like the singles ohko-tie), and
 * the doubles spread cells stay unpriced.
 */
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
  // The last tie decides: the first turn's order does not, so both read one half.
  'speed-tie-2hko': { side: 'p1', mass: 0.5, turns: 1 },
  'toss-race-even': { side: 'p1', mass: 0.5, turns: 2 },
  'thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'doubles-thunder-70': { side: 'p1', mass: 0.7, turns: 1, caveat: 'none' },
  'toxic-stall': { side: 'p2', mass: 1, turns: 2, caveat: 'barring-crit' },
  'one-v-two-breaker': { side: 'p1', mass: 1, turns: 4, caveat: 'barring-crit' },
  'two-v-one-sack': { side: 'p1', mass: null },
  // Round 88 (T336, #72): back at 0.9999 in 12 turns. Round 89 (A5, T322): each cell now rolls its own dice, so "hit, then miss" and
  // "miss, then hit" leave the Blissey a few HP apart and the memo no longer merges them; the proof needs 281 to 420 cells where
  // PROVER_BUDGET.cells allows 100, and the row reads no proof at the production budget (user ruling of 10.11.2026, 22a). The
  // game still holds 0.99994 (Gengar loses only if all eight Focus Blasts miss and its Struggles fall short); the next test gives
  // the prover room, so the T336 rule (the class in which the Special Defense drop fired takes the proof of the class in which it
  // did not, endgame/prover-helping.ts) and the game's number stay guarded.
  'focus-blast-range': { side: 'p1', mass: null },
  'struggle-lock': { side: 'p2', mass: 0.997, digits: 3, turns: 5, caveat: 'sampled-rolls' },
  // The six-turn heal war (the game: Toxapex falls in every one of 10,000 simulated games, by turn 6 in 88 % of them). Round 89
  // (A5f-7): the proof starts for the three ranked lines without the greedy five-turn scout that used to gate it, so it reads the win.
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

describe('forced-win prover over the synthetic endgames (round 35)', () => {
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

describe('the prover with room (round 89, ruling 22)', () => {
  // The game's win share is 0.999941 (5,000 simulated games: Gengar wins all, the loss needs eight misses in a row, one game in
  // 17,000). A proof is a lower bound under the class model, so it reads between 0.99 and the game's number; with 5,000 cells all
  // 20 salts of the cell key prove it (0.9966 to 0.9999) in 12 turns.
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
