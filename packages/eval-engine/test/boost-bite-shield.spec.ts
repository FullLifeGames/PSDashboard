import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { boostBiteValue, stageValue } from '../src/score/boost-bite';
import { threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 79 (T288): a standing defensive stage that takes away the foe's win bites although the holder wins nothing
 * itself. Clefable behind +1 Defense and +1 Special Defense against a Rhydon whose Earthquake and Avalanche then never
 * KO it: the simulator is the judge of that (the Rhydon's hits and Clefable's Moonlight), the race reads it, and the
 * holder's own clock (fourteen turns against a resting Rhydon) no longer shuts the stage. The rule's table is in
 * boost-race.spec.ts; the guards (a foe that wipes stages, a foe that plays Unaware, no hit the stage reduces) stay.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const WALL = () => set('Clefable', ['cosmicpower', 'moonlight', 'moonblast'], { evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 } });
const BRUISER = (extra: Partial<PokemonSet> = {}) =>
  set('Rhydon', ['earthquake', 'rest', 'sleeptalk'], { evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 }, ...extra });

/** p1's boostsBiting contribution (side 0), alone. */
function sideValue(battle: Battle): number {
  return boostBiteValue(battle.sides[0], 0, battle, threatGetter(battle, createMatchupCache('standard')));
}

/** The holder with +1 Defense and +1 Special Defense, at the share of its HP given. */
function shielded(foe: PokemonSet, hpShare = 0.7, boosts: Record<string, number> = { def: 1, spd: 1 }): Battle {
  const battle = battleOf(SINGLES, [WALL()], [foe, set('Landorus-Therian', ['earthquake', 'uturn'])]);
  const mine = battle.sides[0].active[0]!;
  for (const [stat, stage] of Object.entries(boosts)) mine.boosts[stat as 'def'] = stage;
  mine.sethp(Math.floor(mine.maxhp * hpShare));
  return battle;
}

const BOTH = (battle: Battle) => {
  const mine = battle.sides[0].active[0]!;
  return stageValue(mine, 'def', 1) + stageValue(mine, 'spd', 1);
};

describe('the simulator: with the stage the Rhydon never KOs Clefable, without it the Rhydon does', () => {
  /** Clefable at 70% clicks one move each turn against the Rhydon's Earthquake; how many turns it lives (12 at most). */
  const lives = (boosts: boolean, move: 'move 2' | 'move 3'): number => {
    const battle = battleOf(SINGLES, [WALL()], [BRUISER()]);
    const mine = battle.sides[0].active[0]!;
    if (boosts) { mine.boosts.def = 1; mine.boosts.spd = 1; }
    mine.sethp(Math.floor(mine.maxhp * 0.7));
    let turns = 0;
    while (!mine.fainted && turns < 12) {
      battle.choose('p1', move);
      battle.choose('p2', 'move 1');
      turns++;
    }
    return turns;
  };

  test('an attacking Clefable is KOed within three turns; behind +1/+1 it heals the Earthquake away for twelve', () => {
    expect(lives(false, 'move 3')).toBeLessThanOrEqual(3);
    expect(lives(true, 'move 2')).toBe(12);
  });
});

describe('the stage bites a foe it takes the win from (T288)', () => {
  test('Clefable at +1 Defense and +1 Special Defense against an awake Rhydon: both stages count (before: 0)', () => {
    const battle = shielded(BRUISER());
    expect(sideValue(battle)).toBeGreaterThan(0);
    // The front foe bites for both stages; the bench Landorus-Therian may add a share, never more than the sum of the stages.
    expect(sideValue(battle)).toBeLessThanOrEqual(BOTH(battle));
  });

  test('the same board with the Rhydon asleep (it Rests and Sleep Talks)', () => {
    const battle = shielded(BRUISER());
    battle.sides[1].active[0]!.setStatus('slp');
    expect(sideValue(battle)).toBeGreaterThan(0);
  });

  test('a Rhydon that can click Haze takes the stages away: still 0', () => {
    expect(sideValue(shielded(set('Rhydon', ['earthquake', 'haze', 'sleeptalk'])))).toBe(0);
  });

  test('an Unaware foe reads no stage of the holder: still 0', () => {
    expect(sideValue(shielded(BRUISER({ ability: 'Unaware' })))).toBe(0);
  });

  test('a foe with no hit the stage reduces: 0 (the stage made no difference)', () => {
    expect(sideValue(shielded(set('Rhydon', ['rest', 'sleeptalk', 'splash'])))).toBe(0);
  });

  test('a stage on a stat the foe\'s hits do not read (Attack against a physical Rhydon): 0', () => {
    expect(sideValue(shielded(BRUISER(), 0.7, { atk: 2 }))).toBe(0);
  });
});
