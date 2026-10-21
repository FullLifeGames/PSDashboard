import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { boostBiteValue, stageValue } from '../src/score/boost-bite';
import { BITE_TURNS } from '../src/score/boost-race';
import { pairThreat, threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T225 (round 73): the bench credit of the front gate. A standing stage counts against a foe off the field only where
 * the holder gets past the foes in front within the race horizon; a front foe the holder needs six turns for closes
 * the bench even though that foe cannot KO the holder (gen9draft-2058494320, rebuild of turn 19: Swords Dance into a
 * Talonflame switch read +0.165 through the bench). Every board is held to turns of the simulator: how many turns the
 * holder's Crunch needs to take the front foe, and that the foe never takes the holder.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
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

function sideValue(battle: Battle): number {
  return boostBiteValue(battle.sides[0], 0, battle, threatGetter(battle, createMatchupCache('standard')));
}

/** The wall: a Skarmory at +6 Defense that only splashes (it cannot hurt the holder, and the holder needs more than the horizon). */
const wall = () => splash('Skarmory');
const walled = (foe: Pokemon) => { foe.boosts.def = 6; };

/** Turns the holder's Crunch needs to take the foe in the slot, both sides clicking their first move (the holder at the foe's first slot). */
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

/** Garchomp +2 Attack against the front foe, a Clefable on the bench at the HP where only the boosted Crunch KOs it. */
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
    expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2) / 2, 12);
  });
});

describe('doubles: the holder has to get past every foe on the field', () => {
  /** Garchomp +2 Attack with a Splashing partner against two front foes and a Clefable on the bench the stage bites. */
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
    expect(sideValue(board(wall(), walled))).toBe(0);
  });

  test('both front foes within the horizon: the bench foe the stage bites counts', () => {
    const battle = board(splash('Snorlax'), foe => foe.sethp(1));
    expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2) / 3, 12);
  });
});
