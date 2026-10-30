import { describe, expect, test } from 'vitest';
import { analyzeTurn, type AnalyzeTurnParams } from '../src/analysis';
import type { TurnRolls } from '../src/dice-events';
import type { EvalResult, RankedChoice } from '../src/types';

/**
 * Round 79 (T285 follow-up of T287): the hazard sack's luck gate reads the dice. 653785 t19: 3d switched Weavile (63/281) into
 * Stealth Rock, Charizard-Mega-X's Flare Blitz found no target and Lopunny-Mega came in free (the expert's hazard sack, T17).
 * The gate asked whether "the rolls after the pair added nothing", and measured it as the after score minus the pair's value
 * (at most FEED_FLOOR_EPSILON). With T287 the pair's value is the root's own cell, -0.0927, and the next root reads 0.0451:
 * the 0.138 between them is the gap of two searches, no die decided the turn, and the credit went. The gate now refuses only
 * a turn on which a roll went the side's way (rolledFor); without the turn's rolls the score test stays.
 */

const ranked = (choice: string, label: string, worstCase: number, expected: number, ev: number): RankedChoice =>
  ({ choice, label, worstCase, expected, ev, punishedBy: null });

const quiet: TurnRolls = { favored: { p1: false, p2: false }, hits: [] };
const rolled = (side: 'p1' | 'p2'): TurnRolls => ({ favored: { p1: side === 'p1', p2: side === 'p2' }, hits: [] });

/** The lane D numbers of 653785 t19 (p1 view): best -0.1, played -0.1155 (regret 0.0155), safe floor -0.1307, window peak 0.2136. */
function t19(side: 'p1' | 'p2', over: Partial<AnalyzeTurnParams> = {}, doubles = false) {
  const sign = side === 'p1' ? 1 : -1;
  const own = (value: number) => sign * value;
  const playedRow = doubles
    ? ranked('switch 3, move protect', '→ Weavile + Protect', -0.2, -0.12, -0.1155)
    : ranked('switch 3', '→ Weavile', -0.2, -0.12, -0.1155);
  const bestRow = ranked('move 1', 'Roost', -0.1307, -0.11, -0.1);
  const mine = [bestRow, playedRow];
  const foe = [ranked('move 1', 'Flare Blitz', 0.1, 0.1, 0.1)];
  const result: EvalResult = {
    score: own(-0.1753), interval: 0, depthCompleted: 2,
    perSide: side === 'p1' ? { p1: mine, p2: foe } : { p1: foe, p2: mine },
  };
  const weavile = { kind: 'switch' as const, name: 'Weavile', species: 'Weavile' };
  const protect = { kind: 'move' as const, name: 'Protect' };
  const flare = { kind: 'move' as const, name: 'Flare Blitz' };
  const mineAction = doubles ? { slots: [weavile, protect], raw: null } : { slots: undefined, raw: weavile };
  const played = side === 'p1'
    ? { p1: mineAction.raw, p2: flare, ...(mineAction.slots ? { p1Slots: mineAction.slots } : {}) }
    : { p1: flare, p2: mineAction.raw, ...(mineAction.slots ? { p2Slots: mineAction.slots } : {}) };
  return analyzeTurn({
    turn: 19, result, played,
    playedOutcome: own(-0.0927), futureOutcomes: [own(0.1764), own(0.2136)],
    scoreBefore: own(-0.1753), scoreAfter: own(0.0451),
    sacks: { [side]: { name: 'Weavile', species: 'Weavile', hpFraction: 63 / 281, healthy: true, hazard: true } },
    rolls: quiet,
    ...over,
  });
}

describe('the hazard sack reads the dice, not the gap between two searches (T287 follow-up)', () => {
  for (const side of ['p1', 'p2'] as const) {
    for (const doubles of [false, true]) {
      const kind = doubles ? 'doubles' : 'singles';
      test(`${kind}, ${side}: no roll on the turn and a later root 0.138 better is still the hazard sack`, () => {
        const analysis = t19(side, {}, doubles);
        expect(analysis[side].regret).toBeCloseTo(0.0155, 4);
        expect(analysis[side].tier).toBeUndefined();
        expect(analysis[side].sacrifice).toMatchObject({ name: 'Weavile', hazard: true, verified: true });
      });

      test(`${kind}, ${side}: a roll in the side's favour on the turn earns no stamp`, () => {
        const analysis = t19(side, { rolls: rolled(side) }, doubles);
        expect(analysis[side].sacrifice).toBeUndefined();
      });

      test(`${kind}, ${side}: a roll for the opponent does not cost the stamp`, () => {
        const analysis = t19(side, { rolls: rolled(side === 'p1' ? 'p2' : 'p1') }, doubles);
        expect(analysis[side].sacrifice).toMatchObject({ hazard: true, verified: true });
      });
    }
  }

  test('without the turn\'s rolls the score test stays: a later root 0.138 above the pair earns no stamp', () => {
    expect(t19('p1', { rolls: undefined }).p1.sacrifice).toBeUndefined();
    // The pair's own value reached by the after score (own luck 0): the stamp stands.
    expect(t19('p1', { rolls: undefined, scoreAfter: -0.0927 }).p1.sacrifice).toMatchObject({ hazard: true, verified: true });
  });
});
