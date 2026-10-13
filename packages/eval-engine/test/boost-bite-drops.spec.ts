import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { evalFeatures } from '../src/eval-function';
import { stageValue } from '../src/score/boost-bite';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (T49, review of the merge): a stage below 0 bites too. A drop that
 * moves the 1v1 race against its holder (my KO clock longer, the foe's shorter,
 * the first move lost in a race somebody wins within three turns) counts
 * negative in boostsBiting, as the same stage counts in boosts; a drop that
 * moves nothing counts 0. Every premise is played in the simulator, in Scarlet
 * and Violet and on the Champions mod, singles and doubles.
 */

await loadSimMods('gen9championscustomgame');

const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };

interface Mode { name: string; format: string; doubles: boolean; mon: (species: string, moves: string[]) => PokemonSet }

const base = (species: string, moves: string[]) => set(species, moves);
const champion = (species: string, moves: string[]) => set(species, moves, { evs: SP, level: 50 });
const MODES: Mode[] = [
  { name: 'Gen 9 singles', format: 'gen9customgame', doubles: false, mon: base },
  { name: 'Gen 9 doubles', format: 'gen9doublescustomgame', doubles: true, mon: base },
  { name: 'Champions singles', format: 'gen9championscustomgame', doubles: false, mon: champion },
  { name: 'Champions doubles', format: 'gen9championsdoublescustomgame', doubles: true, mon: champion },
];

/** The board: my slot 0 and the foe's slot 0 carry the scene, a Splashing Snorlax stands next to each in doubles. */
function board(mode: Mode, mine: [string, string[]], foe: [string, string[]], seed = '1,2,3,4'): Battle {
  const partner = () => mode.mon('Snorlax', ['splash']);
  const team = (lead: [string, string[]]) => [mode.mon(lead[0], lead[1]), ...(mode.doubles ? [partner()] : [])];
  return battleOf(mode.format, team(mine), team(foe), seed);
}

const mons = (battle: Battle) => ({ mine: battle.sides[0].active[0]!, foe: battle.sides[1].active[0]! });

/** One side's choice: the lead clicks its first move (at the foe's lead in doubles) or Splashes through the last move. */
function click(mode: Mode, lead: Pokemon, attacks: boolean): string {
  const splash = lead.moveSlots.findIndex(slot => slot.id === 'splash') + 1;
  const move = attacks ? (mode.doubles ? 'move 1 1' : 'move 1') : `move ${splash}`;
  return mode.doubles ? `${move}, move 1` : move;
}

/** Turns until `victim` faints when `attacker` (0 or 1) clicks its first move every turn and the other side does not (8 if never). */
function turnsToKo(battle: Battle, attacker: 0 | 1, victim: 'mine' | 'foe', mode: Mode): number {
  const target = mons(battle)[victim];
  for (let turn = 1; turn <= 8 && !battle.ended; turn++) {
    battle.choose('p1', click(mode, mons(battle).mine, attacker === 0));
    battle.choose('p2', click(mode, mons(battle).foe, attacker === 1));
    if (target.fainted) return turn;
  }
  return 8;
}

/**
 * `hits` times the median first hit of the attacker (side 0 or 1) on the other lead on no stages, over sixteen seeds
 * (a middle damage roll, no crit), in HP points: the HP a scene sets, so that the hit counts are the same on the
 * simulator's dice and in the static, which reads the top roll.
 */
function hpAt(hits: number, mode: Mode, mine: [string, string[]], foe: [string, string[]], attacker: 0 | 1): number {
  const damage: number[] = [];
  for (let seed = 1; seed <= 16; seed++) {
    const battle = board(mode, mine, foe, `1,2,3,${seed}`);
    const victim = mons(battle)[attacker === 0 ? 'foe' : 'mine'];
    const before = victim.hp;
    battle.choose('p1', click(mode, mons(battle).mine, attacker === 0));
    battle.choose('p2', click(mode, mons(battle).foe, attacker === 1));
    damage.push(before - victim.hp);
  }
  damage.sort((x, y) => x - y);
  return Math.max(1, Math.floor(hits * damage[8]));
}

/** The foes of the first side count in the feature as living mons of the other side. */
const foeCount = (battle: Battle) => battle.sides[1].pokemon.filter(mon => !mon.fainted).length;

describe.each(MODES)('a stage drop in the race, $name', mode => {
  test('(a) -2 Attack turns my 2HKO of the foe into a 3HKO: the drop counts, signed, for the foe it bites', () => {
    const scene = (stage: number) => {
      const battle = board(mode, ['Garchomp', ['crunch', 'splash']], ['Clefable', ['splash']]);
      const { mine, foe } = mons(battle);
      foe.sethp(hpAt(1.15, mode, ['Garchomp', ['crunch', 'splash']], ['Clefable', ['splash']], 0));
      mine.boosts.atk = stage;
      return battle;
    };
    expect(turnsToKo(scene(0), 0, 'foe', mode)).toBe(2);
    expect(turnsToKo(scene(-2), 0, 'foe', mode)).toBe(3);
    const battle = scene(-2);
    const features = evalFeatures(battle);
    expect(features.boosts).toBeLessThan(0);
    expect(features.boostsBiting).toBeCloseTo(stageValue(mons(battle).mine, 'atk', -2) / foeCount(battle), 12);
    expect(features.boostsBiting).toBeLessThan(0);
  });

  test('(b) -1 Defense lets the foe KO me a turn sooner: the drop counts, signed', () => {
    const scene = (stage: number) => {
      const battle = board(mode, ['Snorlax', ['splash']], ['Pikachu', ['tackle', 'splash']]);
      const { mine } = mons(battle);
      mine.sethp(hpAt(2.4, mode, ['Snorlax', ['splash']], ['Pikachu', ['tackle', 'splash']], 1));
      mine.boosts.def = stage;
      return battle;
    };
    expect(turnsToKo(scene(0), 1, 'mine', mode)).toBe(3);
    expect(turnsToKo(scene(-1), 1, 'mine', mode)).toBe(2);
    const battle = scene(-1);
    const features = evalFeatures(battle);
    expect(features.boosts).toBeLessThan(0);
    expect(features.boostsBiting).toBeCloseTo(stageValue(mons(battle).mine, 'def', -1) / foeCount(battle), 12);
  });

  test('(c) -1 Speed loses the first move in a race somebody wins at once: the drop counts, signed', () => {
    const scene = (stage: number) => {
      const battle = board(mode, ['Garchomp', ['crunch', 'splash']], ['Gyarados', ['waterfall', 'splash']]);
      const { mine, foe } = mons(battle);
      mine.sethp(1);
      foe.sethp(1);
      mine.boosts.spe = stage;
      return battle;
    };
    const firstAt = (stage: number) => {
      const battle = scene(stage);
      const { mine, foe } = mons(battle);
      return mine.getActionSpeed() > foe.getActionSpeed();
    };
    expect(firstAt(0)).toBe(true);
    expect(firstAt(-1)).toBe(false);
    // The sim's turn: the one that moves first KOs the other.
    const played = (stage: number) => {
      const battle = scene(stage);
      battle.choose('p1', click(mode, mons(battle).mine, true));
      battle.choose('p2', click(mode, mons(battle).foe, true));
      return mons(battle);
    };
    expect(played(0).foe.fainted).toBe(true);
    expect(played(0).mine.fainted).toBe(false);
    expect(played(-1).mine.fainted).toBe(true);
    const battle = scene(-1);
    const features = evalFeatures(battle);
    expect(features.boosts).toBeLessThan(0);
    expect(features.boostsBiting).toBeCloseTo(stageValue(mons(battle).mine, 'spe', -1) / foeCount(battle), 12);
  });

  test('(d) a drop that moves nothing counts 0: a race far beyond three turns, and a race won at once either way', () => {
    const far = board(mode, ['Pikachu', ['tackle', 'splash']], ['Snorlax', ['splash']]);
    far.sides[0].active[0]!.boosts.atk = -2;
    const unboosted = board(mode, ['Pikachu', ['tackle', 'splash']], ['Snorlax', ['splash']]);
    expect(turnsToKo(unboosted, 0, 'foe', mode)).toBeGreaterThan(5);
    const farFeatures = evalFeatures(far);
    expect(farFeatures.boosts).toBeLessThan(0);
    expect(farFeatures.boostsBiting).toBe(0);

    const scene = (stage: number) => {
      const battle = board(mode, ['Garchomp', ['crunch', 'splash']], ['Clefable', ['splash']]);
      battle.sides[1].active[0]!.sethp(1);
      battle.sides[0].active[0]!.boosts.atk = stage;
      return battle;
    };
    expect(turnsToKo(scene(0), 0, 'foe', mode)).toBe(1);
    expect(turnsToKo(scene(-1), 0, 'foe', mode)).toBe(1);
    const won = evalFeatures(scene(-1));
    expect(won.boosts).toBeLessThan(0);
    expect(won.boostsBiting).toBe(0);
  });

  test('the same board with the sides swapped negates the feature (a drop of the foe counts for me)', () => {
    const scene = (dropped: 0 | 1) => {
      const mine: [string, string[]] = dropped === 0 ? ['Garchomp', ['crunch', 'splash']] : ['Clefable', ['splash']];
      const foe: [string, string[]] = dropped === 0 ? ['Clefable', ['splash']] : ['Garchomp', ['crunch', 'splash']];
      const battle = board(mode, mine, foe);
      const droppedMon = battle.sides[dropped].active[0]!;
      const victim = battle.sides[1 - dropped].active[0]!;
      victim.sethp(hpAt(1.15, mode, mine, foe, dropped));
      droppedMon.boosts.atk = -2;
      return battle;
    };
    const mine = evalFeatures(scene(0)).boostsBiting;
    expect(mine).toBeLessThan(0);
    expect(evalFeatures(scene(1)).boostsBiting).toBeCloseTo(-mine, 12);
  });
});

describe.each(MODES)('a positive stage that moves the race, as before, $name', mode => {
  test('+2 Speed under Trick Room hands the first move away and stays uncounted (a Ruling of the lane: the positive test is unchanged)', () => {
    const battle = board(mode, ['Gyarados', ['waterfall', 'splash']], ['Garchomp', ['crunch', 'splash']]);
    const { mine, foe } = mons(battle);
    mine.sethp(1);
    foe.sethp(1);
    battle.field.addPseudoWeather('trickroom', mine);
    expect(battle.field.pseudoWeather['trickroom']).toBeTruthy();
    // Under Trick Room the action speed is inverted: the slower Gyarados moves first; at +2 Speed it is the faster one and moves last.
    expect(mine.getActionSpeed()).toBeGreaterThan(foe.getActionSpeed());
    mine.boosts.spe = 2;
    expect(mine.getActionSpeed()).toBeLessThan(foe.getActionSpeed());
    const features = evalFeatures(battle);
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBe(0);
  });
});
