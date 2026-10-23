import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { boostBiteValue, stageValue } from '../src/score/boost-bite';
import { setRaceCut } from '../src/score/boost-race';
import { pairThreat, threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320, causes 1 to 5 and T218): when a standing stage
 * counts against a foe. The holder must WIN the 1v1 race with the stage and get to act in it (it moves first or
 * survives the foe's hit), and the stage must make the difference; the foes in front gate the stage for everybody
 * behind them. Every scene is held to turns of the simulator (who moves first, who dies, who is KO'd by what).
 * The value read is boostBiteValue of the holder's side: the sum of its stages over the share of foes they bite.
 */

await loadSimMods('gen9championscustomgame');

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
