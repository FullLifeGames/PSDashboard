import { beforeEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache } from '../src/eval-function';
import { boostBiteValue, stageValue } from '../src/score/boost-bite';
import { pairRace, raceBodies, setContactReads, setContactSides } from '../src/score/boost-race';
import { hitReader, resetHitMemo } from '../src/score/contact';
import { residualReader } from '../src/score/residuals';
import { bestMoveId, boostedFraction, pairThreat, threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * 13.10.2026 (the Swords Dance report on gen9draft-2058494320: Cobalion's contact moves into Talonflame meet Flame
 * Body, and the race did not know contact punishments): what a hit costs its attacker enters the races of boostsBiting.
 * The cost is read from the simulator (score/contact.ts, held to the simulator in contact-hits.spec.ts) and priced by
 * score/contact-price.ts: the chip of every hit after which the race goes on joins the attacker's residual, a status
 * chance compounds over the hits into expected end-of-turn damage and expected lost damage. This spec holds the whole
 * path to turns of the simulator and to boards where the stage's verdict flips with the cost and nowhere else.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const GARCHOMP = (extra: Partial<PokemonSet> = {}) => set('Garchomp', ['crunch', 'splash'], extra);
/** Faster than Garchomp, with one contact attack that Garchomp feels as a third of its HP. */
const WEAVILE = (extra: Partial<PokemonSet> = {}) => set('Weavile', ['knockoff', 'splash'], extra);

beforeEach(() => resetHitMemo());

const best = (battle: Battle, attacker: Pokemon, victim: Pokemon) => {
  const threat = pairThreat(attacker, victim, battle);
  return Math.max(threat.physical, threat.special);
};

/** HP (points) at which `hits` hits of the attacker's best move on no stages take the victim. */
const hpAt = (battle: Battle, attacker: Pokemon, victim: Pokemon, hits: number) => {
  const share = hits * best(battle, attacker, victim);
  if (share > 1) throw new Error(`${hits} hits of ${attacker.name} are ${share.toFixed(2)} of ${victim.name}'s max HP`);
  return Math.max(1, Math.floor(share * victim.maxhp));
};

function sideValue(battle: Battle): number {
  return boostBiteValue(battle.sides[0], 0, battle, threatGetter(battle, createMatchupCache('standard')));
}

/** One turn of the simulator: both sides click their first move (doubles: the lead at the foe's first slot). */
function turn(battle: Battle): void {
  const doubles = battle.gameType === 'doubles';
  battle.choose('p1', doubles ? 'move 1 1, move 1' : 'move 1');
  battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
}

const mine = (battle: Battle): Pokemon => battle.sides[0].active[0]!;
const theirs = (battle: Battle): Pokemon => battle.sides[1].active[0]!;

/**
 * Garchomp at +2 Attack against the faster Weavile. The foe stands at 3 plain Crunches, so that the boosted Crunch needs
 * two hits; Garchomp stands at 2.2 Knock Offs, so that the Weavile needs three hits on its own and two with the chip of
 * one hit of Garchomp's, and the Weavile moves first: the chip hands it the tie.
 */
function race(own: Partial<PokemonSet> = {}, other: Partial<PokemonSet> = {}, foeHits = 3, holderHits = 2.2): Battle {
  const battle = battleOf(SINGLES, [GARCHOMP(own)], [WEAVILE(other)]);
  mine(battle).boosts.atk = 2;
  theirs(battle).sethp(hpAt(battle, mine(battle), theirs(battle), foeHits));
  mine(battle).sethp(hpAt(battle, theirs(battle), mine(battle), holderHits));
  return battle;
}

const STAGE = () => stageValue(mine(race()), 'atk', 2);

/** The held race of the holder and the foe in front of it, as boostsBiting runs it. */
function held(battle: Battle) {
  const threat = threatGetter(battle, createMatchupCache('standard'));
  return pairRace(mine(battle), theirs(battle), battle, threat, raceBodies(battle, residualReader(battle)), hitReader(battle)).held;
}

describe('the chip of a hit joins the race: the stage counts only where the holder still wins with it', () => {
  test('the simulator: without a helmet Garchomp survives two Knock Offs and its second Crunch wins; with the helmet it faints in the second turn before it moves', () => {
    const plain = race();
    turn(plain);
    turn(plain);
    expect(theirs(plain).fainted).toBe(true);
    expect(mine(plain).fainted).toBe(false);
    const helmet = race({}, { item: 'Rocky Helmet' });
    turn(helmet);
    expect(mine(helmet).fainted).toBe(false);
    turn(helmet);
    expect(mine(helmet).fainted).toBe(true);
    expect(theirs(helmet).fainted).toBe(false);
  });

  test('without a punishment the stage counts in full (the control of every scene below)', () => {
    expect(sideValue(race())).toBeCloseTo(STAGE(), 12);
  });

  test('the clocks: two turns for Garchomp, three for the Weavile; the helmet takes the Weavile\'s to two', () => {
    expect(held(race()).turnsMine).toBe(2);
    expect(held(race()).turnsFoe).toBe(3);
    expect(held(race({}, { item: 'Rocky Helmet' })).turnsMine).toBe(2);
    expect(held(race({}, { item: 'Rocky Helmet' })).turnsFoe).toBe(2);
  });

  test.each([
    ['a Rocky Helmet on the foe', () => race({}, { item: 'Rocky Helmet' })],
    ['Rough Skin on the foe', () => race({}, { ability: 'Rough Skin' })],
    ['a Life Orb on the holder', () => race({ item: 'Life Orb' })],
  ])('%s: the holder loses the race it won, and the stage counts 0', (_name, build) => {
    expect(sideValue(build())).toBe(0);
  });

  test.each([
    ['Protective Pads against a Rocky Helmet', () => race({ item: 'Protective Pads' }, { item: 'Rocky Helmet' })],
    ['Protective Pads against Rough Skin', () => race({ item: 'Protective Pads' }, { ability: 'Rough Skin' })],
    ['Magic Guard under a Life Orb', () => race({ item: 'Life Orb', ability: 'Magic Guard' })],
  ])('%s: the simulator lets the holder off, and the stage counts in full again', (_name, build) => {
    expect(sideValue(build())).toBeCloseTo(STAGE(), 12);
  });

  test('a hit that finishes the race costs nothing that matters: a stage that wins in one hit counts through a helmet', () => {
    const battle = race({}, { item: 'Rocky Helmet' }, 1.5);
    expect(held(battle).turnsMine).toBe(1);
    expect(sideValue(battle)).toBeCloseTo(STAGE(), 12);
  });

  test('a second mover that wins in one hit acts before the chip it has not paid yet: the simulator\'s Garchomp survives the first Knock Off and its Crunch KOs', () => {
    // Garchomp at 1.33 Knock Offs: one Knock Off plus the sixth of a helmet would take it (a plain residual says so), the Knock Off alone does not.
    const battle = race({}, { item: 'Rocky Helmet' }, 1.5, 1.33);
    turn(battle);
    expect(theirs(battle).fainted).toBe(true);
    const clocks = held(race({}, { item: 'Rocky Helmet' }, 1.5, 1.33));
    expect([clocks.turnsMine, clocks.turnsFoe]).toEqual([1, 2]);
    expect(sideValue(race({}, { item: 'Rocky Helmet' }, 1.5, 1.33))).toBeCloseTo(STAGE(), 12);
  });

  test('a move without contact is not punished: the same helmet does not touch a special attacker', () => {
    const board = (item: string) => {
      const battle = battleOf(SINGLES, [set('Garchomp', ['dragonpulse', 'splash'])], [WEAVILE({ item })]);
      mine(battle).boosts.spa = 1;
      theirs(battle).sethp(hpAt(battle, mine(battle), theirs(battle), 2.25));
      mine(battle).sethp(hpAt(battle, theirs(battle), mine(battle), 2.2));
      return battle;
    };
    expect(held(board('')).turnsMine).toBe(2);
    expect(held(board('Rocky Helmet'))).toEqual(held(board('')));
    expect(sideValue(board('Rocky Helmet'))).toBeCloseTo(stageValue(mine(board('')), 'spa', 1), 12);
  });
});

describe('a status chance joins the race as expected damage and expected lost damage', () => {
  /** The foe stands at 3.8 plain Crunches (two boosted hits at the best roll, three once a burn has halved the second); Garchomp at 2.6 Knock Offs. */
  const burning = (ability: string) => race({}, { ability }, 3.8, 2.6);

  test('without the burn Garchomp wins in two hits, with the expected burn it needs three and the Weavile, who moves first, wins the tie', () => {
    expect(held(burning('No Ability')).turnsMine).toBe(2);
    expect(held(burning('Flame Body')).turnsMine).toBe(3);
    expect(sideValue(burning('No Ability'))).toBeCloseTo(STAGE(), 12);
    expect(sideValue(burning('Flame Body'))).toBe(0);
  });

  test('a burn that cannot land (a Fire type holder) costs nothing', () => {
    const board = (ability: string) => {
      const battle = battleOf(SINGLES, [set('Charizard', ['dragonclaw', 'splash'])], [WEAVILE({ ability })]);
      mine(battle).boosts.atk = 2;
      theirs(battle).sethp(hpAt(battle, mine(battle), theirs(battle), 2.8));
      mine(battle).sethp(hpAt(battle, theirs(battle), mine(battle), 2.2));
      return battle;
    };
    expect(held(board('Flame Body'))).toEqual(held(board('No Ability')));
  });

  test('a special attacker does not mind the burn (Grass Knot makes contact): its clock is the same through Flame Body', () => {
    const board = (ability: string) => {
      const battle = battleOf(SINGLES, [set('Garchomp', ['grassknot', 'splash'])], [WEAVILE({ ability })]);
      mine(battle).boosts.spa = 2;
      theirs(battle).sethp(hpAt(battle, mine(battle), theirs(battle), 3.8));
      mine(battle).sethp(hpAt(battle, theirs(battle), mine(battle), 2.6));
      return battle;
    };
    expect(held(board('Flame Body')).turnsMine).toBe(held(board('No Ability')).turnsMine);
  });
});

describe('the foe pays for its own hits too: a stage is judged on the race both sides run', () => {
  /** Garchomp against a slower Snorlax with Double-Edge; the foe's ability decides whether its recoil exists (Rock Head: none). */
  const against = (ability: string, foeHp: number) => {
    const battle = battleOf(SINGLES, [GARCHOMP()], [set('Snorlax', ['doubleedge', 'splash'], { ability })]);
    theirs(battle).sethp(Math.floor(theirs(battle).maxhp * foeHp));
    mine(battle).sethp(hpAt(battle, theirs(battle), mine(battle), 1.6));
    return battle;
  };
  const clocks = (ability: string) => Array.from({ length: 31 }, (_, step) => held(against(ability, 0.4 + step * 0.02)).turnsMine);

  test('the foe\'s recoil shortens the holder\'s clock on it in some races and lengthens it in none', () => {
    const [safe, recoil] = [clocks('Rock Head'), clocks('Sturdy')];
    recoil.forEach((turns, at) => expect(turns).toBeLessThanOrEqual(safe[at]));
    expect(recoil.filter((turns, at) => turns < safe[at]).length).toBeGreaterThan(0);
  });

  test('with the foe\'s side switched off only the holder pays: the clocks are the same with and without the recoil', () => {
    setContactSides('holder');
    try {
      expect(clocks('Sturdy')).toEqual(clocks('Rock Head'));
    } finally {
      setContactSides('both');
    }
  });
});

describe('a drop is judged on the race both sides run: the holder\'s helmet punishes the foe that profits from it', () => {
  /** Garchomp at -2 Defense and 0.9 HP against a slower Snorlax at 0.6 HP: Body Slam takes it in two hits with the drop, in three without. */
  function dropped(item: string): Battle {
    const battle = battleOf(SINGLES, [GARCHOMP({ item })], [set('Snorlax', ['bodyslam', 'splash'])]);
    mine(battle).boosts.def = -2;
    mine(battle).sethp(Math.floor(mine(battle).maxhp * 0.9));
    theirs(battle).sethp(Math.floor(theirs(battle).maxhp * 0.6));
    return battle;
  }

  test('the simulator: without a helmet the Snorlax wins the race by its second Body Slam, with the helmet it pays a sixth for the first and Garchomp\'s second Crunch wins', () => {
    const plain = dropped('');
    turn(plain);
    turn(plain);
    expect(mine(plain).fainted).toBe(true);
    expect(theirs(plain).fainted).toBe(false);
    const helmet = dropped('Rocky Helmet');
    turn(helmet);
    turn(helmet);
    expect(theirs(helmet).fainted).toBe(true);
    expect(mine(helmet).fainted).toBe(false);
  });

  test('the drop bites without the helmet (the foe wins by it) and counts 0 with it (the foe pays, and the holder wins anyway)', () => {
    expect(sideValue(dropped(''))).toBeCloseTo(stageValue(mine(dropped('')), 'def', -2), 12);
    expect(sideValue(dropped(''))).toBeLessThan(0);
    expect(sideValue(dropped('Rocky Helmet'))).toBe(0);
  });

  test('read for the holder\'s hits only, the foe pays for nothing and the drop bites again', () => {
    setContactSides('holder');
    try {
      expect(sideValue(dropped('Rocky Helmet'))).toBeLessThan(0);
    } finally {
      setContactSides('both');
    }
  });
});

describe('the doubles gate: the pair of the holder and the foe in front of it is its own race', () => {
  /** Garchomp +2 with a Splashing partner against `first` (the Weavile) and a Snorlax the stage bites; the helmet decides the Weavile's race. */
  const board = (first: PokemonSet) => {
    const battle = battleOf(DOUBLES, [GARCHOMP(), splash('Clefable')], [first, splash('Snorlax')]);
    const [holder, quick, other] = [battle.sides[0].active[0]!, battle.sides[1].active[0]!, battle.sides[1].active[1]!];
    holder.boosts.atk = 2;
    quick.sethp(hpAt(battle, holder, quick, 3));
    holder.sethp(hpAt(battle, quick, holder, 2.2));
    other.sethp(hpAt(battle, holder, other, 1.4));
    return { battle, holder };
  };

  test('the simulator: the helmet takes a sixth of Garchomp\'s HP when its Crunch lands on the Weavile', () => {
    const { battle, holder } = board(WEAVILE({ item: 'Rocky Helmet' }));
    const before = holder.hp;
    battle.choose('p1', 'move 1 1, move 1');
    battle.choose('p2', 'move 1 1, move 1');
    expect(before - holder.hp).toBeGreaterThan(holder.maxhp / 6);
  });

  test('without the helmet the stage bites both foes; with it, it bites the Snorlax only', () => {
    const { battle: plain, holder } = board(WEAVILE());
    expect(sideValue(plain)).toBeCloseTo(stageValue(holder, 'atk', 2), 12);
    const { battle: helmet } = board(WEAVILE({ item: 'Rocky Helmet' }));
    expect(sideValue(helmet)).toBeCloseTo(stageValue(holder, 'atk', 2) / 2, 12);
  });
});

describe('nothing changes where nothing punishes', () => {
  test('boards without a reaction, a recoil move or a Life Orb give the same value with the reads switched off', () => {
    const boards: Battle[] = [];
    const add = (battle: Battle, edit: (holder: Pokemon, foe: Pokemon) => void) => {
      edit(mine(battle), theirs(battle));
      boards.push(battle);
    };
    add(battleOf(SINGLES, [GARCHOMP()], [WEAVILE(), splash('Clefable')]), holder => { holder.boosts.atk = 2; holder.boosts.spe = 1; holder.boosts.spa = 3; });
    add(battleOf(SINGLES, [set('Garchomp', ['dragonpulse', 'splash'])], [splash('Clefable')]), holder => { holder.boosts.atk = 2; holder.boosts.def = -1; });
    add(battleOf(SINGLES, [GARCHOMP()], [set('Clefable', ['softboiled', 'moonblast'])]), (holder, foe) => { holder.boosts.atk = 4; foe.sethp(foe.maxhp / 3); });
    add(race(), () => undefined);
    const values = (on: boolean) => {
      setContactReads(on);
      try { return boards.map(sideValue); } finally { setContactReads(true); }
    };
    expect(values(true)).toEqual(values(false));
  });

  test('the best move of a threat is the one its fraction comes from, on the stages in view', () => {
    const battle = battleOf(SINGLES, [set('Garchomp', ['crunch', 'dragonpulse', 'splash'])], [splash('Snorlax')]);
    const [holder, foe] = [mine(battle), theirs(battle)];
    const threat = pairThreat(holder, foe, battle);
    expect(threat.physicalMove).toBe('crunch');
    expect(threat.specialMove).toBe('dragonpulse');
    holder.boosts.atk = 2;
    expect(boostedFraction(threat, holder, foe)).toBeCloseTo(threat.physical * 2, 9);
  });

  test('bestMoveId follows the stages: +2 Attack picks the physical move, +2 Special Attack the special one, and a body without a damaging move picks none', () => {
    const battle = battleOf(SINGLES, [set('Garchomp', ['crunch', 'dragonpulse', 'splash'])], [splash('Snorlax')]);
    const [holder, foe] = [mine(battle), theirs(battle)];
    const threat = pairThreat(holder, foe, battle);
    const physical = threat.physical;
    const special = threat.special;
    expect(physical).toBeGreaterThan(0);
    expect(special).toBeGreaterThan(0);
    holder.boosts.atk = 2;
    expect(bestMoveId(threat, holder, foe)).toBe('crunch');
    holder.boosts.atk = 0;
    holder.boosts.spa = 2;
    expect(bestMoveId(threat, holder, foe)).toBe('dragonpulse');
    const idle = battleOf(SINGLES, [splash('Garchomp')], [splash('Snorlax')]);
    expect(bestMoveId(pairThreat(mine(idle), theirs(idle), idle), mine(idle), theirs(idle))).toBeNull();
  });

  test('an off-axis move is found too: Body Press is the best move of a Defense-boosted Garchomp', () => {
    const battle = battleOf(SINGLES, [set('Garchomp', ['bodypress', 'splash'])], [splash('Snorlax')]);
    const [holder, foe] = [mine(battle), theirs(battle)];
    expect(bestMoveId(pairThreat(holder, foe, battle), holder, foe)).toBe('bodypress');
  });
});
