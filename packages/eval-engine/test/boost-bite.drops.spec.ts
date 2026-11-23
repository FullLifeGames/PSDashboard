import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { evalFeatures, createMatchupCache } from '../src/eval-function';
import { stageValue, boostBiteValue } from '../src/score/boost-bite';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';
import { setRaceCut } from '../src/score/boost-race';
import { pairThreat, threatGetter } from '../src/score/threat';

/**
 * Round 69 (T49, review of the merge): a stage below 0 bites too. A drop that
 * moves the 1v1 race against its holder counts negative in boostsBiting, as the
 * same stage counts in boosts; a drop that moves nothing counts 0. Every premise
 * is played in the simulator, in Scarlet and Violet and on the Champions mod,
 * singles and doubles.
 *
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320): a drop is the
 * mirror of a boost. It is the foe's stage, so it bites only where the FOE wins
 * the race with it (a flip from my win to the foe's, or a win the drop made
 * faster) and gets to act in it; a drop in a race I still win costs nothing, and
 * a foe that never swings back never wins one. Scene (a) used to be a passive
 * Clefable that only waited for a 3HKO and is now a Jolteon that swings back.
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

/**
 * The board: my slot 0 and the foe's slot 0 carry the scene, a Splashing Snorlax stands next to each in doubles. `bench` puts a Blissey
 * behind my side (alive, or fainted as after a loss); `trapper` is the ability of the foe's lead.
 */
function board(mode: Mode, mine: [string, string[]], foe: [string, string[]], seed = '1,2,3,4', extra: { bench?: 'living' | 'fainted'; trapper?: string } = {}): Battle {
  const partner = () => mode.mon('Snorlax', ['splash']);
  const team = (lead: [string, string[]]) => [mode.mon(lead[0], lead[1]), ...(mode.doubles ? [partner()] : [])];
  const mineTeam = [...team(mine), ...(extra.bench ? [mode.mon('Blissey', ['splash'])] : [])];
  const foeTeam = team(foe);
  if (extra.trapper) foeTeam[0].ability = extra.trapper;
  const battle = battleOf(mode.format, mineTeam, foeTeam, seed);
  if (extra.bench === 'fainted') {
    const body = battle.sides[0].pokemon[mineTeam.length - 1];
    body.hp = 0;
    body.fainted = true;
    battle.sides[0].pokemonLeft--;
  }
  return battle;
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
  let capacity = Infinity;
  for (let seed = 1; seed <= 16; seed++) {
    const battle = board(mode, mine, foe, `1,2,3,${seed}`);
    const victim = mons(battle)[attacker === 0 ? 'foe' : 'mine'];
    capacity = victim.maxhp;
    const before = victim.hp;
    battle.choose('p1', click(mode, mons(battle).mine, attacker === 0));
    battle.choose('p2', click(mode, mons(battle).foe, attacker === 1));
    damage.push(before - victim.hp);
  }
  damage.sort((x, y) => x - y);
  // A scene that asks for more hits than the victim's max HP holds is a mistake in the scene, not a board.
  if (hits * damage[8] > capacity) throw new Error(`${hits} hits of ${damage[8]} HP are more than ${capacity}`);
  return Math.max(1, Math.floor(hits * damage[8]));
}

/** The foes of the first side count in the feature as living mons of the other side. */
const foeCount = (battle: Battle) => battle.sides[1].pokemon.filter(mon => !mon.fainted).length;

describe.each(MODES)('a stage drop in the race, $name', mode => {
  /** Garchomp (Crunch) against a faster Jolteon (Shadow Ball): the foe stands at 1.15 of my plain hits, I stand at 2.4 of its hits. */
  const GARCHOMP: [string, string[]] = ['Garchomp', ['crunch', 'splash']];
  const JOLTEON: [string, string[]] = ['Jolteon', ['shadowball', 'splash']];
  function raceScene(mode: Mode, stage: number, swapped = false): Battle {
    const [mineSet, foeSet] = swapped ? [JOLTEON, GARCHOMP] : [GARCHOMP, JOLTEON];
    const battle = board(mode, mineSet, foeSet);
    const { mine, foe } = mons(battle);
    const [dropped, other] = swapped ? [foe, mine] : [mine, foe];
    other.sethp(hpAt(1.15, mode, mineSet, foeSet, swapped ? 1 : 0));
    dropped.sethp(hpAt(2.4, mode, mineSet, foeSet, swapped ? 0 : 1));
    dropped.boosts.atk = stage;
    return battle;
  }

  /** Both leads attack every turn until one faints: who wins the race, and in how many turns. */
  function played(stage: number): { winner: 'mine' | 'foe'; turns: number } {
    const battle = raceScene(mode, stage);
    for (let turn = 1; turn <= 8; turn++) {
      battle.choose('p1', click(mode, mons(battle).mine, true));
      battle.choose('p2', click(mode, mons(battle).foe, true));
      if (mons(battle).foe.fainted) return { winner: 'mine', turns: turn };
      if (mons(battle).mine.fainted) return { winner: 'foe', turns: turn };
    }
    throw new Error('nobody fainted');
  }

  test('(a) -2 Attack turns the race I win into the race the faster foe wins: the drop counts, signed, for the foe it bites', () => {
    expect(played(0)).toEqual({ winner: 'mine', turns: 2 });
    expect(played(-2)).toEqual({ winner: 'foe', turns: 3 });
    const battle = raceScene(mode, -2);
    const features = evalFeatures(battle);
    expect(features.boosts).toBeLessThan(0);
    expect(features.boostsBiting).toBeCloseTo(stageValue(mons(battle).mine, 'atk', -2) / foeCount(battle), 12);
    expect(features.boostsBiting).toBeLessThan(0);
  });

  test('(a2) -2 Attack that only makes a win slower costs nothing: the foe waits for a 3HKO and never swings back (before: it counted)', () => {
    const scene = (stage: number) => {
      const battle = board(mode, ['Garchomp', ['crunch', 'splash']], ['Clefable', ['splash']]);
      const { mine, foe } = mons(battle);
      foe.sethp(hpAt(1.15, mode, ['Garchomp', ['crunch', 'splash']], ['Clefable', ['splash']], 0));
      mine.boosts.atk = stage;
      return battle;
    };
    expect(turnsToKo(scene(0), 0, 'foe', mode)).toBe(2);
    expect(turnsToKo(scene(-2), 0, 'foe', mode)).toBe(3);
    const features = evalFeatures(scene(-2));
    expect(features.boosts).toBeLessThan(0);
    expect(features.boostsBiting).toBe(0);
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
    const mine = evalFeatures(raceScene(mode, -2)).boostsBiting;
    expect(mine).toBeLessThan(0);
    expect(evalFeatures(raceScene(mode, -2, true)).boostsBiting).toBeCloseTo(-mine, 12);
  });
});

describe.each(MODES.filter(mode => !mode.doubles))('a drop behind a front that beats the holder, $name', mode => {
  const GARCHOMP: [string, string[]] = ['Garchomp', ['crunch', 'splash']];
  const JOLTEON: [string, string[]] = ['Jolteon', ['shadowball', 'splash']];

  /** Garchomp at -2 Attack against `front` with a Jolteon on the bench that the drop turns from a lost race into a won one. */
  function behind(front: [string, string[]]): Battle {
    const battle = battleOf(mode.format, [mode.mon(...GARCHOMP)], [mode.mon(...front), mode.mon(...JOLTEON)]);
    const [mine, bench] = [battle.sides[0].active[0]!, battle.sides[1].pokemon[1]];
    bench.sethp(hpAt(1.15, mode, GARCHOMP, JOLTEON, 0));
    mine.sethp(hpAt(2.4, mode, GARCHOMP, JOLTEON, 1));
    mine.boosts.atk = -2;
    return battle;
  }

  test('a front foe that wins the race anyway closes the gate: the drop costs nothing against the bench behind it (before: it counted)', () => {
    // The front Jolteon at full HP wins on the move order whatever the drop does; the bench Jolteon would be the flip.
    const battle = behind(JOLTEON);
    expect(evalFeatures(battle).boosts).toBeLessThan(0);
    // T248 (round 73): the front Jolteon is bitten itself, as it wins and the drop makes the win safer in the fresh race (half the foes); the bench Jolteon behind it would add the other half.
    expect(evalFeatures(battle).boostsBiting).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', -2) / 2, 12);
  });

  test('a front foe that never swings back but outlasts the horizon closes the bench as well (T225; before: the drop counted)', () => {
    expect(evalFeatures(behind(['Clefable', ['splash']])).boostsBiting).toBe(0);
  });

  test('a front foe that never swings back and falls to the holder at once leaves the gate open: the drop counts against the bench Jolteon', () => {
    const battle = behind(['Clefable', ['splash']]);
    battle.sides[1].active[0]!.sethp(1);
    const features = evalFeatures(battle);
    expect(features.boostsBiting).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', -2) / 2, 12);
    expect(features.boostsBiting).toBeLessThan(0);
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
    // T249 (round 73): the slowed holder at 1 HP never acts (the foe moves first and KOs it), so `boosts` reads its stage as 0 too (before: it read the stage in full).
    expect(features.boosts).toBe(0);
    expect(features.boostsBiting).toBe(0);
  });
});

describe.each(MODES)('a drop its holder clears by switching counts nothing (SB-2, round 89), $name', mode => {
  const GARCHOMP: [string, string[]] = ['Garchomp', ['crunch', 'splash']];
  const JOLTEON: [string, string[]] = ['Jolteon', ['shadowball', 'splash']];
  const PIKACHU: [string, string[]] = ['Pikachu', ['tackle', 'splash']];
  const SHADOW_TAG = 'Shadow Tag';
  type Extra = { bench?: 'living' | 'fainted'; trapper?: string };

  /** The three scenes of (a), (b) and (c) above, each with its drop, after one Splash turn (the end of a turn writes `trapped`). */
  const SCENES: Record<'a' | 'b' | 'c', (extra: Extra, stage?: number) => Battle> = {
    a: (extra, stage = -2) => {
      const battle = board(mode, GARCHOMP, JOLTEON, '1,2,3,4', extra);
      const { mine, foe } = mons(battle);
      foe.sethp(hpAt(1.15, mode, GARCHOMP, JOLTEON, 0));
      mine.sethp(hpAt(2.4, mode, GARCHOMP, JOLTEON, 1));
      mine.boosts.atk = stage;
      return battle;
    },
    b: (extra, stage = -1) => {
      const battle = board(mode, ['Snorlax', ['splash']], PIKACHU, '1,2,3,4', extra);
      const { mine } = mons(battle);
      mine.sethp(hpAt(2.4, mode, ['Snorlax', ['splash']], PIKACHU, 1));
      mine.boosts.def = stage;
      return battle;
    },
    c: (extra, stage = -1) => {
      const battle = board(mode, GARCHOMP, ['Gyarados', ['waterfall', 'splash']], '1,2,3,4', extra);
      const { mine, foe } = mons(battle);
      mine.sethp(1);
      foe.sethp(1);
      mine.boosts.spe = stage;
      return battle;
    },
  };
  const idleTurn = (battle: Battle): Battle => {
    battle.choose('p1', click(mode, mons(battle).mine, false));
    battle.choose('p2', click(mode, mons(battle).foe, false));
    return battle;
  };
  const read = (kind: 'a' | 'b' | 'c', extra: Extra, stage?: number) => {
    const battle = idleTurn(SCENES[kind](extra, stage));
    return { battle, features: evalFeatures(battle), holder: mons(battle).mine };
  };

  test.each(['a', 'b', 'c'] as const)('scene (%s): with a living bench the drop is free, with the bench fainted or behind Shadow Tag it counts as before', kind => {
    const held = read(kind, {});
    expect(held.holder.isActive && held.battle.canSwitch(held.holder.side)).toBe(0);
    expect(held.features.boostsBiting).toBeLessThan(0);
    expect(held.features.boosts).toBeLessThan(0);

    const free = read(kind, { bench: 'living' });
    expect(free.holder.trapped).toBe(false);
    expect(free.battle.canSwitch(free.holder.side)).toBeGreaterThan(0);
    expect(free.features.boostsBiting).toBe(0);
    expect(free.features.boosts).toBe(0);

    const fainted = read(kind, { bench: 'fainted' });
    expect(fainted.battle.canSwitch(fainted.holder.side)).toBe(0);
    expect(fainted.features.boostsBiting).toBeCloseTo(held.features.boostsBiting, 12);
    expect(fainted.features.boosts).toBeCloseTo(held.features.boosts, 12);

    const trapped = read(kind, { bench: 'living', trapper: SHADOW_TAG });
    expect(trapped.holder.trapped).toBeTruthy();
    expect(trapped.features.boostsBiting).toBeCloseTo(held.features.boostsBiting, 12);
    expect(trapped.features.boosts).toBeCloseTo(held.features.boosts, 12);
  });

  test('a raised stage is the holder\'s asset whatever the bench: the boosts term reads it with and without a bench', () => {
    const plain = read('c', {}, 2);
    const benched = read('c', { bench: 'living' }, 2);
    expect(plain.features.boosts).toBeGreaterThan(0);
    expect(benched.features.boosts).toBeCloseTo(plain.features.boosts, 12);
  });

  test('the foe\'s drop counts for me as before: it can switch out only if it has a bench, and the foe lead here has none', () => {
    const battle = idleTurn(SCENES.a({}, 0));
    mons(battle).foe.boosts.atk = -2;
    const features = evalFeatures(battle);
    expect(battle.canSwitch(mons(battle).foe.side)).toBe(0);
    expect(features.boosts).toBeGreaterThan(0);
  });
});

describe('boost-bite-front', () => {


  const SINGLES = 'gen9customgame';
  const DOUBLES = 'gen9doublescustomgame';
  const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

  /** The best damage fraction of the attacker's moves on no stages. */
  const hit = (battle: Battle, attacker: Pokemon, victim: Pokemon) => {
    const threat = pairThreat(attacker, victim, battle);
    return Math.max(threat.physical, threat.special);
  };

  /**
   * HP (points) at which `hits` hits of the attacker's best move on no stages take the victim: 1.4 is one boosted hit but not one plain
   * one. A scene that asks for more hits than the victim's max HP holds is a mistake in the scene, not a board.
   */
  const hpAt = (battle: Battle, attacker: Pokemon, victim: Pokemon, hits: number) => {
    const share = hits * hit(battle, attacker, victim);
    if (share > 1) throw new Error(`${hits} hits of ${attacker.name} are ${share.toFixed(2)} of ${victim.name}'s max HP`);
    return Math.max(1, Math.floor(share * victim.maxhp));
  };

  /** p1's boostsBiting contribution (side 0), alone: the foe's own stages do not enter. */
  function sideValue(battle: Battle): number {
    return boostBiteValue(battle.sides[0], 0, battle, threatGetter(battle, createMatchupCache('standard')));
  }

  /** One turn of the simulator: both sides click their first move (the lead of a doubles side at the foe's first slot). */
  function turn(battle: Battle): void {
    const doubles = battle.gameType === 'doubles';
    battle.choose('p1', doubles ? 'move 1 1, move 1' : 'move 1');
    battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
  }

  const GARCHOMP = (extra: Partial<PokemonSet> = {}) => set('Garchomp', ['crunch', 'splash'], extra);
  const KILLER = () => set('Jolteon', ['icebeam', 'splash']);

  /**
   * Garchomp at half HP and +2 Attack against a faster Jolteon (Ice Beam hits it four times over: the lowest roll of the
   * simulator KOs it), the foe at the HP where only the boosted Crunch KOs.
   */
  function lostRace(extra: Partial<PokemonSet> = {}): Battle {
    const battle = battleOf(SINGLES, [GARCHOMP(extra)], [KILLER()]);
    const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
    mine.boosts.atk = 2;
    mine.sethp(Math.floor(mine.maxhp / 2));
    foe.sethp(hpAt(battle, mine, foe, 1.4));
    return battle;
  }

  describe('the holder wins the race with the stage and acts in it', () => {
    test('the simulator: the faster Jolteon KOs Garchomp before it moves; with a Scarf Garchomp moves first and the boosted Crunch KOs Jolteon', () => {
      const slow = lostRace();
      turn(slow);
      expect(slow.sides[0].active[0]!.fainted).toBe(true);
      expect(slow.sides[1].active[0]!.fainted).toBe(false);
      const fast = lostRace({ item: 'Choice Scarf' });
      turn(fast);
      expect(fast.sides[1].active[0]!.fainted).toBe(true);
      expect(fast.sides[0].active[0]!.fainted).toBe(false);
    });

    test('a stage that shortens my clock in a race the foe wins anyway counts 0 (before: it counted in full)', () => {
      const battle = lostRace();
      expect(sideValue(battle)).toBe(0);
    });

    test('the same race won by moving first: the stage counts in full', () => {
      const battle = lostRace({ item: 'Choice Scarf' });
      expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2), 12);
    });
  });

  /** Garchomp +2 Attack in front of nothing but the foes given: the front foe first, the bench behind it. */
  function behind(front: PokemonSet, bench: PokemonSet, mine: Partial<PokemonSet> = {}): Battle {
    const battle = battleOf(SINGLES, [GARCHOMP(mine)], [front, bench]);
    battle.sides[0].active[0]!.boosts.atk = 2;
    return battle;
  }

  describe('the foes in front gate the stage (T218)', () => {
    /** The bench foe at the HP where only the boosted Crunch KOs it. */
    const benchBitten = (battle: Battle) => {
      const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].pokemon[1]];
      foe.sethp(hpAt(battle, mine, foe, 1.4));
      return battle;
    };

    test('a front foe the holder KOs at once leaves the gate open: the bench foe it would bite counts', () => {
      const battle = behind(splash('Snorlax'), splash('Clefable'));
      battle.sides[1].active[0]!.sethp(1);
      benchBitten(battle);
      // T248 (round 73): the stage is judged on the fresh race, so the front foe at 1 HP is bitten as well as the bench foe.
      expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2), 12);
    });

    /**
     * Garchomp (+2 Attack) at 2.4 Shadow Balls in front of a faster Jolteon that stands behind +3 Defense (the boosted Crunch needs
     * three hits, the Shadow Ball three as well and it moves first), a Clefable the boosted Crunch KOs behind it.
     */
    const beaten = () => {
      const battle = behind(set('Jolteon', ['shadowball', 'splash']), splash('Clefable'));
      const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      expect(hit(battle, foe, mine)).toBeLessThan(0.5);
      mine.sethp(hpAt(battle, foe, mine, 2.4));
      foe.boosts.def = 3;
      return benchBitten(battle);
    };

    test('the simulator: the holder lives through the first Ice Beam, acts, and the Jolteon still wins the race within three turns', () => {
      const battle = beaten();
      const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      turn(battle);
      expect(mine.fainted).toBe(false);
      expect(foe.fainted).toBe(false);
      for (let round = 2; round <= 3 && !mine.fainted; round++) turn(battle);
      expect(mine.fainted).toBe(true);
      expect(foe.fainted).toBe(false);
    });

    test('a front foe that wins the race within three turns closes the gate: no bench foe counts (before: all of them did)', () => {
      expect(sideValue(beaten())).toBe(0);
    });

    test('a front foe that can click Haze wipes the stage for every foe, bench included', () => {
      const wiped = behind(set('Clefable', ['haze', 'splash']), splash('Clefable'));
      wiped.sides[1].active[0]!.sethp(1);
      benchBitten(wiped);
      expect(sideValue(wiped)).toBe(0);
      const control = behind(set('Clefable', ['splash']), splash('Clefable'));
      control.sides[1].active[0]!.sethp(1);
      benchBitten(control);
      // T248 (round 73): the stage is judged on the fresh race, so the front foe at 1 HP is bitten as well as the bench foe.
      expect(sideValue(control)).toBeCloseTo(stageValue(control.sides[0].active[0]!, 'atk', 2), 12);
    });

    test('a front Haze foe that is only on the bench does not close the gate: it just does not count', () => {
      const battle = behind(splash('Snorlax'), set('Clefable', ['haze', 'splash']));
      battle.sides[1].active[0]!.sethp(hpAt(battle, battle.sides[0].active[0]!, battle.sides[1].active[0]!, 1.4));
      expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 2) / 2, 12);
    });
  });

  describe('the report on gen9draft-2058494320: a 5% Cobalion at +4 into a full-HP Shore Up Palossand', () => {
    const COBALION = () => set('Cobalion', ['smartstrike', 'splash']);
    const PALOSSAND = () => set('Palossand', ['shoreup', 'earthpower']);
    /** Cobalion at 5% and +4 Attack (a hit three times as hard); the bench foe stands at 1.4 plain hits, so only the boosted Smart Strike KOs it. */
    function scene(front: PokemonSet): Battle {
      const battle = battleOf(SINGLES, [COBALION()], [front, splash('Clefable')]);
      const [mine, bench] = [battle.sides[0].active[0]!, battle.sides[1].pokemon[1]];
      mine.boosts.atk = 4;
      mine.sethp(Math.floor(mine.maxhp * 0.05));
      bench.sethp(hpAt(battle, mine, bench, 1.4));
      return battle;
    }

    test('the simulator: Cobalion moves first and hurts Palossand, then Earth Power KOs it', () => {
      const battle = scene(PALOSSAND());
      const [mine, front] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      battle.choose('p1', 'move 1');
      battle.choose('p2', 'move 2');
      expect(front.hp).toBeGreaterThan(0);
      expect(front.hp).toBeLessThan(front.maxhp * 0.5);
      expect(mine.fainted).toBe(true);
    });

    test('the stage counts 0: the healer is not pinned when one Earth Power wins it the race (before: it never swung back and the bench foe counted)', () => {
      expect(sideValue(scene(PALOSSAND()))).toBe(0);
    });

    test('the simulator: against a Palossand that only clicks Shore Up, the boosted Smart Strike takes it in three turns (hit, heal, hit, heal, hit)', () => {
      const battle = scene(set('Palossand', ['shoreup', 'splash']));
      const front = battle.sides[1].active[0]!;
      let turns = 0;
      while (!front.fainted && turns < 10) {
        battle.choose('p1', 'move 1');
        battle.choose('p2', 'move 1');
        turns++;
      }
      expect(turns).toBe(3);
    });

    test('the same board in front of a Palossand without its attack: the holder gets past Shore Up within the horizon, as the simulator does in three turns, and the bench foe counts (T258; T225 had it shut at five turns)', () => {
      const battle = scene(set('Palossand', ['shoreup', 'splash']));
      expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 4), 12);
    });

    test('the same Palossand with no heal move: the holder gets past it within the horizon and the bench foe counts', () => {
      const battle = scene(set('Palossand', ['splash']));
      // Both foes bite now: the Palossand in front and the Clefable behind it.
      expect(sideValue(battle)).toBeCloseTo(stageValue(battle.sides[0].active[0]!, 'atk', 4), 12);
    });
  });

  describe('the end of the turn is part of the race (Leech Seed)', () => {
    /**
     * Garchomp at 22% and +2 Attack against a slow Snorlax, the foe at the HP where the boosted Crunch needs two hits. Its Tackle takes
     * 15 to 18% of Garchomp: the holder lives through it, and the seed's 12% at the end of the turn finishes it.
     */
    function seededRace(seeded: boolean): Battle {
      const battle = battleOf(SINGLES, [GARCHOMP()], [set('Snorlax', ['tackle', 'splash'])]);
      const [mine, foe] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!];
      mine.boosts.atk = 2;
      mine.sethp(Math.floor(mine.maxhp * 0.22));
      foe.sethp(hpAt(battle, mine, foe, 3));
      if (seeded) mine.addVolatile('leechseed', foe);
      return battle;
    }

    test('the simulator: unseeded Garchomp moves first, survives the Tackle and wins in two turns; seeded, the end of the first turn takes it', () => {
      const plain = seededRace(false);
      turn(plain);
      expect(plain.sides[0].active[0]!.fainted).toBe(false);
      turn(plain);
      expect(plain.sides[1].active[0]!.fainted).toBe(true);
      expect(plain.sides[0].active[0]!.fainted).toBe(false);
      const seeded = seededRace(true);
      turn(seeded);
      expect(seeded.sides[0].active[0]!.fainted).toBe(true);
      expect(seeded.sides[1].active[0]!.fainted).toBe(false);
    });

    test('unseeded the stage wins a race it needs; seeded the seed ends the holder first and the stage counts 0 (before: the table knew no Leech Seed)', () => {
      const plain = seededRace(false);
      expect(sideValue(plain)).toBeCloseTo(stageValue(plain.sides[0].active[0]!, 'atk', 2), 12);
      expect(sideValue(seededRace(true))).toBe(0);
    });
  });

  describe('the doubles gate: the foes in front are the foes on the field', () => {
    /** Garchomp +2 Attack at half HP with a Splashing partner against `first` and a Clefable the stage bites; `first` sits at 1 HP. */
    const board = (first: PokemonSet) => {
      const battle = battleOf(DOUBLES, [GARCHOMP(), splash('Snorlax')], [first, splash('Clefable')]);
      const [mine, quick, other] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!, battle.sides[1].active[1]!];
      mine.boosts.atk = 2;
      mine.sethp(Math.floor(mine.maxhp / 2));
      quick.sethp(1);
      other.sethp(hpAt(battle, mine, other, 1.4));
      return { battle, mine, quick };
    };

    test('the simulator: the faster foe on the field KOs the holder before it moves', () => {
      const { battle, mine, quick } = board(KILLER());
      turn(battle);
      expect(mine.fainted).toBe(true);
      expect(quick.hp).toBe(1);
    });

    test('one foe on the field KOs the holder before it acts: the other foe on the field, which the stage bites, counts 0', () => {
      expect(sideValue(board(KILLER()).battle)).toBe(0);
    });

    test('the same board with a harmless first foe: the stage counts for the foe it bites', () => {
      const { battle, mine } = board(splash('Snorlax'));
      // T248 (round 73): the stage is judged on the fresh race, so the front foe at 1 HP is bitten as well as the bench foe.
      expect(sideValue(battle)).toBeCloseTo(stageValue(mine, 'atk', 2), 12);
    });
  });

  describe('one race per pair (T221): the cut changes nothing', () => {
    test('boards with several stats, healers, walls and a bench give the same value with and without the cut', () => {
      const boards: Battle[] = [];
      const add = (battle: Battle, edit: (mine: Pokemon, foe: Pokemon) => void) => {
        edit(battle.sides[0].active[0]!, battle.sides[1].active[0]!);
        boards.push(battle);
      };
      add(battleOf(SINGLES, [GARCHOMP()], [KILLER(), splash('Clefable')]), mine => { mine.boosts.atk = 2; mine.boosts.spe = 1; mine.boosts.spa = 3; });
      add(battleOf(SINGLES, [set('Garchomp', ['dragonpulse', 'splash'])], [splash('Clefable')]), mine => { mine.boosts.atk = 2; mine.boosts.def = -1; });
      add(battleOf(SINGLES, [GARCHOMP()], [set('Clefable', ['softboiled', 'moonblast'])]), (mine, foe) => { mine.boosts.atk = 4; foe.sethp(foe.maxhp / 3); });
      add(battleOf(SINGLES, [GARCHOMP()], [set('Blissey', ['softboiled', 'seismictoss']), splash('Gengar')]), mine => { mine.boosts.atk = 1; mine.boosts.accuracy = 1; });
      const values = (cut: boolean) => {
        setRaceCut(cut);
        try { return boards.map(sideValue); } finally { setRaceCut(true); }
      };
      expect(values(false)).toEqual(values(true));
    });
  });
});
