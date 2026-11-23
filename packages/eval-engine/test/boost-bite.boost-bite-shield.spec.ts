import { describe, expect, test } from 'vitest';
import type { Battle, PokemonSet, Pokemon } from '@pkmn/sim';
import { createMatchupCache, evalFeatures, featureWeights } from '../src/eval-function';
import { boostBiteValue, stageValue } from '../src/score/boost-bite';
import { threatGetter, pairThreat } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { BITE_TURNS } from '../src/score/boost-race';

/**
 * A standing defensive stage takes away the foe's win bites although the holder wins nothing itself. Clefable behind +1 Defense and
 * +1 Special Defense against a Rhydon whose Earthquake and Avalanche then never KO it: the simulator is the judge of that (the
 * Rhydon's hits and Clefable's Moonlight), the race reads it, and the holder's own clock (fourteen turns against a resting Rhydon)
 * does not shut the stage. The rule's table is in boost-race.spec.ts.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const WALL = () => set('Clefable', ['cosmicpower', 'moonlight', 'moonblast'], { evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 4, spe: 0 } });
const BRUISER = (extra: Partial<PokemonSet> = {}) =>
  set('Rhydon', ['earthquake', 'rest', 'sleeptalk'], { evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 }, ...extra });

function sideValue(battle: Battle): number {
  return boostBiteValue(battle.sides[0], 0, battle, threatGetter(battle, createMatchupCache('standard')));
}

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

describe('doubles and the other families (T288)', () => {
  const DOUBLES = 'gen9doublescustomgame';
  const CHAMPIONS = 'gen9championscustomgame';
  // Stat points of the mode: a bulky Rhydon whose Earthquake the holder needs three turns to answer, so the foe wins the fresh race.
  const SP = { hp: 32, atk: 8, def: 0, spa: 0, spd: 32, spe: 0 };
  const splash = (species: string) => set(species, ['splash']);

  function doublesBoard(): Battle {
    const battle = battleOf(DOUBLES, [WALL(), splash('Snorlax')], [BRUISER(), splash('Snorlax')]);
    const mine = battle.sides[0].active[0]!;
    mine.boosts.def = 1;
    mine.boosts.spd = 1;
    mine.sethp(Math.floor(mine.maxhp * 0.7));
    return battle;
  }

  test('standard Doubles OU weighs boostsBiting 0: the column is not read, the board scores as it did', () => {
    const battle = doublesBoard();
    const weights = featureWeights(true, 'standard');
    expect(weights.boostsBiting).toBe(0);
    expect(weights.boosts).toBeGreaterThan(0);
    // The column is computed only where its weight is not 0 (boost-bite.spec.ts): the rule adds nothing to this family's score.
    expect(evalFeatures(battle, createMatchupCache('standard'), weights).boostsBiting).toBe(0);
  });

  test('a VGC board (weight 16): the shielded Clefable bites the Rhydon of the pair, and the score prices it', () => {
    const battle = doublesBoard();
    expect(featureWeights(true, 'vgc').boostsBiting).toBe(16);
    const cache = createMatchupCache('vgc');
    expect(evalFeatures(battle, cache).boostsBiting).toBeGreaterThan(0);
    const plain = doublesBoard();
    plain.sides[0].active[0]!.boosts.def = 0;
    plain.sides[0].active[0]!.boosts.spd = 0;
    expect(evalFeatures(plain, createMatchupCache('vgc')).boostsBiting).toBe(0);
  });

  test('a Champions singles board (weight 102): the shielded Clefable bites the Rhydon, the stat points of the mode', () => {
    const wall = set('Clefable', ['cosmicpower', 'moonlight', 'moonblast'], { evs: { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, level: 50 });
    const foe = set('Rhydon', ['earthquake', 'rest', 'sleeptalk'], { evs: SP, level: 50 });
    const battle = battleOf(CHAMPIONS, [wall], [foe, set('Landorus-Therian', ['earthquake', 'uturn'], { evs: SP, level: 50 })]);
    const mine = battle.sides[0].active[0]!;
    mine.boosts.def = 1;
    mine.boosts.spd = 1;
    mine.sethp(Math.floor(mine.maxhp * 0.7));
    expect(featureWeights(false, 'champions').boostsBiting).toBe(102);
    expect(evalFeatures(battle, createMatchupCache('champions')).boostsBiting).toBeGreaterThan(0);
  });
});

const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const GARCHOMP = () => set('Garchomp', ['crunch', 'splash']);

const hit = (battle: Battle, attacker: Pokemon, victim: Pokemon) => {
  const threat = pairThreat(attacker, victim, battle);
  return Math.max(threat.physical, threat.special);
};

/** HP (points) at which `hits` plain hits of the attacker's best move take the victim: 1.4 is one boosted hit but not one plain one. */
const hpAt = (battle: Battle, attacker: Pokemon, victim: Pokemon, hits: number) => {
  const share = hits * hit(battle, attacker, victim);
  if (share > 1) throw new Error(`${hits} hits of ${attacker.name} are ${share.toFixed(2)} of ${victim.name}'s max HP`);
  return Math.max(1, Math.floor(share * victim.maxhp));
};

/** The wall: a Skarmory at +6 Defense that only splashes (it cannot hurt the holder, and the holder needs more than the horizon). */
const wall = () => splash('Skarmory');
const walled = (foe: Pokemon) => { foe.boosts.def = 6; };

function turnsToKo(battle: Battle, foeSlot = 0): number {
  const doubles = battle.gameType === 'doubles';
  const foe = battle.sides[1].active[foeSlot]!;
  for (let turns = 1; turns <= 10; turns++) {
    battle.choose('p1', doubles ? `move 1 ${foeSlot + 1}, move 1` : 'move 1');
    battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
    if (foe.fainted) return turns;
    expect(battle.sides[0].active[0]!.fainted).toBe(false);
  }
  return Infinity;
}

function singlesBoard(format: string, front: PokemonSet, edit: (foe: Pokemon) => void): Battle {
  const battle = battleOf(format, [GARCHOMP()], [front, splash('Clefable')]);
  const [mine, foe, bench] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!, battle.sides[1].pokemon[1]];
  mine.boosts.atk = 2;
  edit(foe);
  bench.sethp(hpAt(battle, mine, bench, 1.4));
  return battle;
}

describe.each([SINGLES, CHAMPIONS])('singles on %s: the bench credit needs the holder to win its front race', format => {
  test('the simulator: the walled Skarmory takes the Crunch more than three turns and never hurts the holder', () => {
    const battle = singlesBoard(format, wall(), walled);
    expect(turnsToKo(battle)).toBeGreaterThan(BITE_TURNS);
  });

  test('a front foe the holder needs more than three turns for closes the bench (before: it stayed open and the stage counted)', () => {
    expect(sideValue(singlesBoard(format, wall(), walled))).toBe(0);
  });

  test('the simulator: a front Snorlax at 1.5 plain hits falls in two turns', () => {
    const battle = singlesBoard(format, splash('Snorlax'), foe => foe.sethp(1));
    expect(turnsToKo(battle)).toBeLessThanOrEqual(BITE_TURNS);
  });

  test('the same board with a front foe the holder takes within three turns keeps the bench credit', () => {
    const battle = singlesBoard(format, splash('Snorlax'), foe => foe.sethp(1));
    // The front foe at 1 HP is bitten as well as the bench foe (the stage is judged on the fresh race).
    expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2), 12);
  });
});

describe('doubles: the holder has to get past every foe on the field', () => {
  function board(second: PokemonSet, edit: (foe: Pokemon) => void): Battle {
    const battle = battleOf(DOUBLES, [GARCHOMP(), splash('Snorlax')], [splash('Snorlax'), second, splash('Clefable')]);
    const [mine, first, other, bench] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!, battle.sides[1].active[1]!, battle.sides[1].pokemon[2]];
    mine.boosts.atk = 2;
    first.sethp(1);
    edit(other);
    bench.sethp(hpAt(battle, mine, bench, 1.4));
    return battle;
  }

  test('the simulator: the walled front foe outlasts the horizon, the weak one falls in a turn', () => {
    expect(turnsToKo(board(wall(), walled), 1)).toBeGreaterThan(BITE_TURNS);
    expect(turnsToKo(board(wall(), walled), 0)).toBeLessThanOrEqual(BITE_TURNS);
  });

  test('one front foe the holder cannot get past closes the bench for the other foes too', () => {
    // The front foe at 1 HP is bitten itself (a third of the foes); the Clefable on the bench would add another third if the bench were open.
    const battle = board(wall(), walled);
    expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2) / 3, 12);
  });

  test('both front foes within the horizon: the bench foe the stage bites counts', () => {
    const battle = board(splash('Snorlax'), foe => foe.sethp(1));
    // All three foes are bitten: the two at 1 HP in front and the Clefable on the bench.
    expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2), 12);
  });
});
