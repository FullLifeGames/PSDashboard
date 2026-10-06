import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { evalFeatures } from '../src/eval-function';
import { pairThreat } from '../src/score/threat';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 64 (T125, point 3): a sweep cell counts a pair the mon's stages flip,
 * won with them and lost without them. "Without them" reset only Attack and
 * Special Attack, so a Calm Mind kept its Special Defense stage in the
 * comparison: the foe's race against it stayed slow and the pair never
 * flipped. The comparison now reads the mon on no stages at all. The cells
 * carry weight 0, so this moves only what the fit sees.
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/**
 * Clefable (slower) clicks Calm Mind in the simulator, then both bodies get the
 * HP of the race: the foe needs 3 hits against +1 SpD and 2 against none,
 * Clefable needs 2 unboosted Moonblasts and 2 boosted ones short of a KO. With
 * its stages Clefable wins 2 to 3, with its SpD stage alone it still wins 2 to
 * 3, on no stages it ties 2 to 2 and the faster foe wins the tie.
 */
function calmMindBoard(format: string, choices: { p1: string; p2: string }, p1: PokemonSet[], p2: PokemonSet[]): { battle: Battle; clefable: Pokemon } {
  const battle = battleOf(format, p1, p2);
  battle.choose('p1', choices.p1);
  battle.choose('p2', choices.p2);
  const clefable = battle.sides[0].active[0];
  const alakazam = battle.sides[1].active[0];
  expect([clefable.boosts.spa, clefable.boosts.spd]).toEqual([1, 1]);
  const moonblast = pairThreat(clefable, alakazam, battle).special;
  const psychic = pairThreat(alakazam, clefable, battle).special;
  clefable.hp = Math.floor(1.7 * psychic * clefable.maxhp);
  alakazam.hp = Math.floor(1.8 * moonblast * alakazam.maxhp);
  expect(clefable.hp).toBeLessThan(clefable.maxhp);
  expect(alakazam.hp).toBeLessThan(alakazam.maxhp);
  return { battle, clefable };
}

const clefable = () => set('Clefable', ['calmmind', 'moonblast']);
const alakazam = () => set('Alakazam', ['splash', 'psychic']);

describe('the sweep comparison drops every stage (round 64, T125)', () => {
  test('singles: a Calm Mind flip counts once the comparison drops the Special Defense stage too', () => {
    const { battle, clefable: mon } = calmMindBoard('gen9customgame', { p1: 'move 1', p2: 'move 1' }, [clefable()], [alakazam()]);
    const features = evalFeatures(battle);
    // Slower and short of a KO: the one flip of one foe lands in slowChip at Clefable's HP.
    expect(features.sweepSlowChip).toBeCloseTo(mon.hp / mon.maxhp, 10);
    expect(features.sweepFastKo + features.sweepFastChip + features.sweepSlowKo).toBe(0);
  });

  test('doubles: the same flip, one of two foes (a Splashing Shuckle never flips)', () => {
    const { battle, clefable: mon } = calmMindBoard('gen9doublescustomgame', { p1: 'move 1, move 1', p2: 'move 1, move 1' },
      [clefable(), splash('Pikachu')], [alakazam(), splash('Shuckle')]);
    const features = evalFeatures(battle);
    expect(features.sweepSlowChip).toBeCloseTo(0.5 * (mon.hp / mon.maxhp), 10);
    expect(features.sweepFastKo + features.sweepFastChip + features.sweepSlowKo).toBe(0);
  });

  test('the comparison leaves the body as it was', () => {
    const { battle, clefable: mon } = calmMindBoard('gen9customgame', { p1: 'move 1', p2: 'move 1' }, [clefable()], [alakazam()]);
    evalFeatures(battle);
    expect(mon.boosts).toMatchObject({ spa: 1, spd: 1 });
    expect(mon.isActive).toBe(true);
  });
});
