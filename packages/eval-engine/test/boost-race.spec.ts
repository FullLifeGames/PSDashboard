import { describe, expect, test } from 'vitest';
import {
  BITE_TURNS,
  foeWins,
  holderActs,
  holderHolds,
  stageBites,
  stageShields,
  type Race,
  holderActsInFront,
  idleHolders,
} from '../src/score/boost-race';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evalFeatures, evaluatePosition } from '../src/eval-function';
import { stageValue } from '../src/score/boost-bite';
import { threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

const race = (partial: Partial<Race>): Race => ({
  turnsMine: Infinity, turnsFoe: Infinity, first: false, foeFirst: false, mineSurvives: true, foeSurvives: true, ...partial,
});

describe('a boost counts when the holder wins the race with it and the stage made the difference', () => {
  test.each([
    ['a flip: lost without the stage, won with it', race({ turnsMine: 2, turnsFoe: 3 }), race({ turnsMine: 4, turnsFoe: 3 }), true],
    ['a faster win: won either way, one turn sooner', race({ turnsMine: 1 }), race({ turnsMine: 2 }), true],
    ['a flip by the move order: the same clocks, the first move won', race({ turnsMine: 2, turnsFoe: 2, first: true }), race({ turnsMine: 2, turnsFoe: 2 }), true],
    ['a flip from a hold: nobody won without the stage', race({ turnsMine: 2 }), race({}), true],
    ['a shorter clock in a race the foe wins anyway (the Scarf Mienshao: it moves first and KOs in one hit)',
      race({ turnsMine: 1, turnsFoe: 1, foeFirst: true, mineSurvives: false }), race({ turnsMine: 2, turnsFoe: 1, foeFirst: true, mineSurvives: false }), false],
    ['a later KO of me in a race I still lose', race({ turnsMine: 5, turnsFoe: 4 }), race({ turnsMine: 5, turnsFoe: 2 }), false],
    ['a race won either way at the same speed: the stage changed nothing', race({ turnsMine: 2 }), race({ turnsMine: 2 }), false],
    ['a win either way, only safer: the foe\'s clock is longer, mine is not', race({ turnsMine: 2, turnsFoe: 4 }), race({ turnsMine: 2, turnsFoe: 3 }), true],
    ['a win beyond the horizon is a stall war', race({ turnsMine: BITE_TURNS + 1 }), race({ turnsMine: BITE_TURNS + 3 }), false],
    ['nobody wins with the stage', race({}), race({}), false],
    ['equal clocks, the foe moves first: the foe wins the tie', race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }), race({ turnsMine: 3, turnsFoe: 2, foeFirst: true }), false],
    ['equal clocks, neither moves first (a speed tie): nobody wins', race({ turnsMine: 2, turnsFoe: 2 }), race({ turnsMine: 3, turnsFoe: 2 }), false],
  ])('%s', (_name, held, without, expected) => {
    expect(stageBites(held, without, false)).toBe(expected);
  });

  test('the holder must get to act: the clocks say win, but the foe\'s hit KOs it before it moves', () => {
    const held = race({ turnsMine: 2, turnsFoe: 3, first: false, mineSurvives: false });
    const without = race({ turnsMine: 4, turnsFoe: 3, first: false, mineSurvives: false });
    expect(holderActs(held)).toBe(false);
    expect(stageBites(held, without, false)).toBe(false);
    expect(stageBites({ ...held, first: true }, without, false)).toBe(true);
    expect(stageBites({ ...held, mineSurvives: true }, without, false)).toBe(true);
  });
});

describe('the difference a stage makes is read on the fresh race', () => {
  test('the same stage counts at every HP the gate lets through: the HP of the held race does not decide whether the stage helps', () => {
    const full = race({ turnsMine: 2, turnsFoe: 3 });
    const without = race({ turnsMine: 4, turnsFoe: 3 });
    for (const heldHere of [race({ turnsMine: 2, turnsFoe: 3 }), race({ turnsMine: 1, turnsFoe: 3 }), race({ turnsMine: 2, turnsFoe: 9 })]) {
      expect(stageBites(heldHere, without, false, full)).toBe(true);
    }
  });

  test('a stage that changes nothing at full HP counts nowhere, though the held race shows a difference at its low HP', () => {
    const same = race({ turnsMine: 4, turnsFoe: 3 });
    expect(stageBites(race({ turnsMine: 1, turnsFoe: 3 }), same, false, same)).toBe(false);
  });

  test('the gate still reads the held race: a held race the side loses counts nothing, whatever the fresh race says', () => {
    const lost = race({ turnsMine: 3, turnsFoe: 2 });
    expect(stageBites(lost, race({ turnsMine: 5, turnsFoe: 2 }), false, race({ turnsMine: 2, turnsFoe: 3 }))).toBe(false);
  });
});

describe('a drop is the mirror: it counts when the foe wins the race with it and the drop made the difference', () => {
  test.each([
    ['a flip: I won without the drop, the foe wins with it', race({ turnsMine: 3, turnsFoe: 3, foeFirst: true }), race({ turnsMine: 2, turnsFoe: 3, foeFirst: true }), true],
    ['a faster win for the foe: it won either way, one turn sooner', race({ turnsFoe: 2 }), race({ turnsFoe: 3 }), true],
    ['a flip by the move order: the foe moves first with it', race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }), race({ turnsMine: 2, turnsFoe: 2, first: true }), true],
    ['a flip from a hold: nobody won without the drop', race({ turnsFoe: 3 }), race({}), true],
    ['a later KO of the foe in a race I still win: the drop costs nothing', race({ turnsMine: 3 }), race({ turnsMine: 2 }), false],
    ['a shorter clock for the foe in a race the foe loses anyway', race({ turnsMine: 2, turnsFoe: 3, first: true }), race({ turnsMine: 2, turnsFoe: 4, first: true }), false],
    ['the foe wins beyond the horizon', race({ turnsFoe: BITE_TURNS + 1 }), race({ turnsFoe: BITE_TURNS + 4 }), false],
    ['the drop changed nothing', race({ turnsFoe: 2 }), race({ turnsFoe: 2 }), false],
  ])('%s', (_name, held, without, expected) => {
    expect(stageBites(held, without, true)).toBe(expected);
  });

  test('the foe must get to act: it moves first or it survives my hit', () => {
    const held = race({ turnsMine: 5, turnsFoe: 2, foeFirst: false, foeSurvives: false });
    const without = race({ turnsMine: 5, turnsFoe: 3, foeFirst: false, foeSurvives: false });
    expect(stageBites(held, without, true)).toBe(false);
    expect(stageBites({ ...held, foeFirst: true }, without, true)).toBe(true);
    expect(stageBites({ ...held, foeSurvives: true }, without, true)).toBe(true);
  });
});

describe('the gates read the race from the foe in front', () => {
  test('the foe wins on a shorter clock, or on an equal finite one when it moves first, and never on infinite clocks', () => {
    expect(foeWins(race({ turnsMine: 3, turnsFoe: 2 }))).toBe(true);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 2, foeFirst: true }))).toBe(true);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 2, first: true }))).toBe(false);
    expect(foeWins(race({ turnsMine: 2, turnsFoe: 3 }))).toBe(false);
    expect(foeWins(race({}))).toBe(false);
  });

  test('the holder acts when it moves first or survives the foe\'s hit', () => {
    expect(holderActs(race({ first: true, mineSurvives: false }))).toBe(true);
    expect(holderActs(race({ first: false, mineSurvives: true }))).toBe(true);
    expect(holderActs(race({ first: false, mineSurvives: false }))).toBe(false);
  });
});

describe('a stage that takes away the foe\'s win counts although the holder wins nothing itself', () => {
  const without = race({ turnsMine: 3, turnsFoe: 2, first: true });
  const held = race({ turnsMine: 14, turnsFoe: Infinity, first: true });
  const full = race({ turnsMine: 16, turnsFoe: Infinity, first: true });

  test.each([
    ['the foe\'s clock goes from 2 turns to never, the holder\'s own is 14', held, without, full, true],
    ['the foe\'s clock goes from 2 turns to 20 and the holder needs 14: the holder wins the long race', race({ turnsMine: 14, turnsFoe: 20, first: true }), without, race({ turnsMine: 14, turnsFoe: 20, first: true }), true],
    ['the foe\'s clock goes from 2 turns to 5, the holder needs 14: the foe still wins the stall war', race({ turnsMine: 14, turnsFoe: 5, first: true }), without, race({ turnsMine: 14, turnsFoe: 5, first: true }), false],
    ['the foe\'s clock goes from 2 to 3: still inside the horizon', race({ turnsMine: 14, turnsFoe: 3, first: true }), without, race({ turnsMine: 14, turnsFoe: 3, first: true }), false],
    ['the holder\'s own clock is Infinity (no hit that lands, no PP): nothing to act with', race({ turnsFoe: Infinity, first: true }), without, race({ turnsFoe: Infinity, first: true }), false],
    ['the foe did not win the race without the stage (a clock of 6): the stage took nothing away', held, race({ turnsMine: 3, turnsFoe: 6, first: true }), full, false],
    ['the foe never won the fresh race (an Infinity clock without the stage as well)', held, race({ turnsMine: 3, turnsFoe: Infinity, first: true }), full, false],
    ['the holder won the fresh race without the stage anyway (one hit)', held, race({ turnsMine: 1, turnsFoe: 2, first: true }), full, false],
    ['an offensive stage: the foe\'s clock is the same with and without it', race({ turnsMine: 14, turnsFoe: 2, first: true }), without, race({ turnsMine: 14, turnsFoe: 2, first: true }), false],
    ['the holder never acts: the foe moves first and KOs it', race({ turnsMine: 14, turnsFoe: Infinity, mineSurvives: false }), without, full, false],
  ])('%s', (_name, heldRace, withoutRace, fullRace, expected) => {
    expect(stageShields(heldRace, withoutRace, false, fullRace)).toBe(expected);
  });

  test('a drop is the foe\'s stage: it shields nobody', () => {
    expect(stageShields(held, without, true, full)).toBe(false);
  });

  test('the holder holds the front when it acts, has a clock of its own and the foe cannot win within the horizon or at all', () => {
    expect(holderHolds(held)).toBe(true);
    expect(holderHolds(race({ turnsMine: 14, turnsFoe: 5 }))).toBe(false);
    expect(holderHolds(race({ turnsMine: 14, turnsFoe: 20, first: true }))).toBe(true);
    expect(holderHolds(race({ turnsFoe: Infinity }))).toBe(false);
    expect(holderHolds(race({ turnsMine: 14, turnsFoe: Infinity, mineSurvives: false }))).toBe(false);
  });
});

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const GARCHOMP = (extra: Partial<PokemonSet> = {}) => set('Garchomp', ['crunch', 'splash'], extra);
const KILLER = () => set('Jolteon', ['icebeam', 'splash']);

function turn(battle: Battle): void {
  const doubles = battle.gameType === 'doubles';
  battle.choose('p1', doubles ? 'move 1 1, move 1' : 'move 1');
  battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
}

function scores(battle: Battle, holder: Pokemon): { raised: number; plain: number } {
  const raised = evaluatePosition(battle, createMatchupCache('standard'));
  const held = { ...holder.boosts };
  for (const stat of Object.keys(held) as (keyof typeof held)[]) holder.boosts[stat] = Math.min(held[stat], 0);
  const plain = evaluatePosition(battle, createMatchupCache('standard'));
  Object.assign(holder.boosts, held);
  return { raised, plain };
}

const boostsTerm = (battle: Battle) => evalFeatures(battle, createMatchupCache('standard')).boosts;

describe.each([['Gen 9 singles', SINGLES], ['Champions singles', CHAMPIONS]])('%s: the faster foe KOs the holder before it moves', (_name, format) => {
  function board(extra: Partial<PokemonSet> = {}, foe: PokemonSet = KILLER()): { battle: Battle; holder: Pokemon } {
    const battle = battleOf(format, [GARCHOMP(extra), splash('Clefable')], [foe, splash('Snorlax')]);
    const holder = battle.sides[0].active[0]!;
    holder.boosts.atk = 2;
    holder.sethp(Math.max(1, Math.floor(holder.maxhp * 0.05)));
    return { battle, holder };
  }

  test('the simulator: Jolteon moves first and Garchomp faints without a move; with Choice Scarf Garchomp acts first', () => {
    const slow = board();
    turn(slow.battle);
    expect(slow.holder.fainted).toBe(true);
    expect(slow.battle.sides[1].active[0]!.hp).toBe(slow.battle.sides[1].active[0]!.maxhp);
    const fast = board({ item: 'Choice Scarf' });
    turn(fast.battle);
    expect(fast.battle.sides[1].active[0]!.hp).toBeLessThan(fast.battle.sides[1].active[0]!.maxhp);
  });

  test('the reader says the idle holder does not act and the scarfed one does', () => {
    const threatOf = (battle: Battle) => threatGetter(battle, createMatchupCache('standard'));
    const slow = board();
    expect(holderActsInFront(slow.holder, [slow.battle.sides[1].active[0]!], slow.battle, threatOf(slow.battle))).toBe(false);
    const fast = board({ item: 'Choice Scarf' });
    expect(holderActsInFront(fast.holder, [fast.battle.sides[1].active[0]!], fast.battle, threatOf(fast.battle))).toBe(true);
  });

  test('the stage adds nothing to the idle holder: the score and the boosts term are those of the board without it', () => {
    const { battle, holder } = board();
    const { raised, plain } = scores(battle, holder);
    expect(raised).toBeCloseTo(plain, 12);
    expect(boostsTerm(battle)).toBe(0);
  });

  test('the same board with the scarfed holder keeps the worth of the stage', () => {
    const { battle, holder } = board({ item: 'Choice Scarf' });
    const { raised, plain } = scores(battle, holder);
    expect(raised).not.toBeCloseTo(plain, 6);
    expect(boostsTerm(battle)).toBeCloseTo(stageValue(holder, 'atk', 2), 12);
  });

  test('a drop on the idle holder with a living bench is free: it can switch out and loses the stage', () => {
    const { battle, holder } = board();
    holder.boosts.atk = -2;
    expect(battle.canSwitch(holder.side)).toBeGreaterThan(0);
    expect(boostsTerm(battle)).toBe(0);
  });

  test('a drop on the idle holder with no living bench stays: it costs what it cost', () => {
    const { battle, holder } = board();
    const bench = battle.sides[0].pokemon[1];
    bench.hp = 0;
    bench.fainted = true;
    battle.sides[0].pokemonLeft--;
    holder.boosts.atk = -2;
    expect(battle.canSwitch(holder.side)).toBe(0);
    expect(boostsTerm(battle)).toBeCloseTo(stageValue(holder, 'atk', -2), 12);
  });

  test('a stage that keeps the holder alive counts: +2 Special Defense lives through the Shadow Ball that takes it on no stage', () => {
    const shadow = () => set('Jolteon', ['shadowball', 'splash']);
    const damage = (spd: number): number => {
      const { battle, holder } = board({}, shadow());
      holder.sethp(holder.maxhp);
      holder.boosts.spd = spd;
      turn(battle);
      return holder.maxhp - holder.hp;
    };
    const [plain, staged] = [damage(0), damage(2)];
    expect(staged).toBeLessThan(plain);
    const standing = (spd: number) => {
      const { battle, holder } = board({}, shadow());
      holder.sethp(Math.ceil(staged * 1.5));
      holder.boosts.spd = spd;
      return { battle, holder };
    };
    const alive = standing(2);
    turn(alive.battle);
    expect(alive.holder.fainted).toBe(false);
    const dead = standing(0);
    turn(dead.battle);
    expect(dead.holder.fainted).toBe(true);
    const withStage = standing(2);
    withStage.holder.boosts.atk = 2;
    expect(boostsTerm(withStage.battle)).toBeCloseTo(stageValue(withStage.holder, 'atk', 2) + stageValue(withStage.holder, 'spd', 2), 12);
    const without = standing(0);
    expect(boostsTerm(without.battle)).toBe(0);
  });
});

describe('doubles: one foe on the field that moves first and KOs the holder', () => {
  function board(first: PokemonSet): { battle: Battle; holder: Pokemon } {
    const battle = battleOf(DOUBLES, [GARCHOMP(), splash('Snorlax')], [first, splash('Clefable')]);
    const holder = battle.sides[0].active[0]!;
    holder.boosts.atk = 2;
    holder.sethp(Math.max(1, Math.floor(holder.maxhp * 0.05)));
    return { battle, holder };
  }

  test('the simulator: the faster foe on the field KOs the holder before it moves', () => {
    const { battle, holder } = board(KILLER());
    turn(battle);
    expect(holder.fainted).toBe(true);
  });

  test('the stage adds nothing: the score is that of the board without it, and the boosts term is 0', () => {
    const { battle, holder } = board(KILLER());
    const { raised, plain } = scores(battle, holder);
    expect(raised).toBeCloseTo(plain, 12);
    expect(boostsTerm(battle)).toBe(0);
  });

  test('with a harmless first foe the holder acts and the stage keeps its worth', () => {
    const { battle, holder } = board(splash('Snorlax'));
    const { raised, plain } = scores(battle, holder);
    expect(raised).not.toBeCloseTo(plain, 6);
    expect(boostsTerm(battle)).toBeCloseTo(stageValue(holder, 'atk', 2), 12);
  });
});

describe('12a: the stage of an idle holder adds nothing to the hit of a foe that reads it (Foul Play)', () => {
  const FOUL = () => set('Umbreon', ['foulplay', 'splash']);
  const HITTER = () => set('Garchomp', ['earthquake', 'splash']);
  const QUICK = () => set('Jolteon', ['quickattack', 'splash']);

  function board(format: string, first: PokemonSet): { battle: Battle; holder: Pokemon } {
    const doubles = format === DOUBLES;
    const battle = battleOf(format, doubles ? [HITTER(), splash('Snorlax')] : [HITTER(), splash('Clefable')],
      doubles ? [first, splash('Clefable'), FOUL()] : [first, FOUL()]);
    const holder = battle.sides[0].active[0]!;
    holder.boosts.atk = 4;
    holder.sethp(Math.max(1, Math.floor(holder.maxhp * 0.05)));
    return { battle, holder };
  }

  const coverage = (battle: Battle) => evalFeatures(battle, createMatchupCache('standard')).coverage;
  const idle = (battle: Battle, holder: Pokemon) => idleHolders(battle, threatGetter(battle, createMatchupCache('standard'))).has(holder);

  test.each([['singles', SINGLES], ['Champions singles', CHAMPIONS]])('%s: the coverage and the score are those of the board without the stage', (_name, format) => {
    const { battle, holder } = board(format, QUICK());
    expect(idle(battle, holder)).toBe(true);
    const { raised, plain } = scores(battle, holder);
    expect(raised).toBeCloseTo(plain, 12);
    const withStage = coverage(battle);
    holder.boosts.atk = 0;
    expect(withStage).toBeCloseTo(coverage(battle), 12);
  });

  test('doubles: the same', () => {
    const { battle, holder } = board(DOUBLES, QUICK());
    expect(idle(battle, holder)).toBe(true);
    const { raised, plain } = scores(battle, holder);
    expect(raised).toBeCloseTo(plain, 12);
    const withStage = coverage(battle);
    holder.boosts.atk = 0;
    expect(withStage).toBeCloseTo(coverage(battle), 12);
  });

  test('the control: where the holder acts, the stage keeps its worth in the score', () => {
    const { battle, holder } = board(SINGLES, splash('Snorlax'));
    const { raised, plain } = scores(battle, holder);
    expect(raised).not.toBeCloseTo(plain, 6);
  });
});

describe('the idle reading runs once per evaluation', () => {
  function modifyBoostEvents(battle: Battle, run: () => void): number {
    let events = 0;
    const real = battle.runEvent.bind(battle);
    battle.runEvent = ((eventid: string, ...rest: unknown[]) => {
      if (eventid === 'ModifyBoost' && new Error().stack?.includes('holderActsInFront')) events++;
      return (real as (...args: unknown[]) => unknown)(eventid, ...rest);
    }) as typeof battle.runEvent;
    try { run(); } finally { delete (battle as { runEvent?: unknown }).runEvent; }
    return events;
  }

  function board(format: string, first: PokemonSet): { battle: Battle; holder: Pokemon } {
    const doubles = format === DOUBLES;
    const battle = battleOf(format, doubles ? [GARCHOMP(), splash('Snorlax')] : [GARCHOMP(), splash('Clefable')], doubles ? [first, splash('Clefable')] : [first, splash('Snorlax')]);
    const holder = battle.sides[0].active[0]!;
    holder.sethp(Math.max(1, Math.floor(holder.maxhp * 0.05)));
    return { battle, holder };
  }

  test.each([
    ['singles', SINGLES, KILLER()], ['doubles', DOUBLES, KILLER()], ['Champions singles', CHAMPIONS, KILLER()],
    ['singles, the holder acts', SINGLES, splash('Snorlax')], ['doubles, the holder acts', DOUBLES, splash('Snorlax')],
  ])('%s: the raised holder costs one pass of idleHolders', (_name, format, first) => {
    const { battle, holder } = board(format, first);
    const evaluate = () => { evalFeatures(battle, createMatchupCache('standard')); };
    expect(modifyBoostEvents(battle, evaluate)).toBe(0);
    holder.boosts.atk = 2;
    const raised = modifyBoostEvents(battle, evaluate);
    const pass = modifyBoostEvents(battle, () => { idleHolders(battle, threatGetter(battle, createMatchupCache('standard'))); });
    expect(pass).toBeGreaterThan(0);
    expect(raised).toBe(pass);
  });
});
