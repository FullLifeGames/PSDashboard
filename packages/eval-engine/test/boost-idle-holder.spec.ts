import { describe, expect, test } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evalFeatures, evaluatePosition } from '../src/eval-function';
import { stageValue } from '../src/score/boost-bite';
import { holderActsInFront, idleHolders } from '../src/score/boost-race';
import { threatGetter } from '../src/score/threat';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * T249 (round 73): a raised stage on a body that never acts counts nothing, whichever term reads it. The body never
 * acts when a foe on the field moves first and takes its HP with one hit; the stage is then worth what it is worth
 * to a dead body. Each scene is held to turns of the simulator (who moves first, who faints), and read in the score and
 * in the `boosts` term: the score with the stage equals the score without it for the idle body, and the control (the same
 * board where the body does act) keeps the stage's worth. Singles, doubles and the Champions mod; a drop stays.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const GARCHOMP = (extra: Partial<PokemonSet> = {}) => set('Garchomp', ['crunch', 'splash'], extra);
const KILLER = () => set('Jolteon', ['icebeam', 'splash']);

/** One turn of the simulator: both sides click their first move (the lead of a doubles side at the foe's first slot). */
function turn(battle: Battle): void {
  const doubles = battle.gameType === 'doubles';
  battle.choose('p1', doubles ? 'move 1 1, move 1' : 'move 1');
  battle.choose('p2', doubles ? 'move 1 1, move 1' : 'move 1');
}

/** The score of the board with the holder's stages as they stand, and with the raises taken off. */
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
  /** Garchomp at 5% and +2 Attack against a faster Jolteon whose Ice Beam takes it: with Choice Scarf Garchomp moves first. */
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

  test('a drop on the idle holder stays: it costs what it cost', () => {
    const { battle, holder } = board();
    holder.boosts.atk = -2;
    expect(boostsTerm(battle)).toBeCloseTo(stageValue(holder, 'atk', -2), 12);
  });

  test('a stage that keeps the holder alive counts: +2 Special Defense lives through the Shadow Ball that takes it on no stage', () => {
    const shadow = () => set('Jolteon', ['shadowball', 'splash']);
    // The simulator's own damage of the Shadow Ball on the full-HP holder, with and without the stage (same seed, same roll).
    const damage = (spd: number): number => {
      const { battle, holder } = board({}, shadow());
      holder.sethp(holder.maxhp);
      holder.boosts.spd = spd;
      turn(battle);
      return holder.maxhp - holder.hp;
    };
    const [plain, staged] = [damage(0), damage(2)];
    expect(staged).toBeLessThan(plain);
    // The holder keeps half as much HP again as the staged hit takes: it lives through the staged hit and not through the plain one.
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
    // The reader and the term follow the simulator: the staged holder acts, so its Attack stage counts; the unstaged one does not.
    const withStage = standing(2);
    withStage.holder.boosts.atk = 2;
    expect(boostsTerm(withStage.battle)).toBeCloseTo(stageValue(withStage.holder, 'atk', 2) + stageValue(withStage.holder, 'spd', 2), 12);
    const without = standing(0);
    expect(boostsTerm(without.battle)).toBe(0);
  });
});

describe('doubles: one foe on the field that moves first and KOs the holder', () => {
  /** Garchomp +2 Attack at 5% with a Splashing partner against `first` and a Snorlax; the other foe never attacks. */
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

/**
 * Round 76 (12a, after T258): a foe that hits through the holder's own Attack (Foul Play reads the target's stat, so the
 * Dex entry names the holder as the stat's owner) hits an idle holder harder with a raised stage, and the coverage term
 * read that hit at the holder's raised stage (gen9ou-2658675932 turn 2: the bench Umbreon's Foul Play against a Great
 * Tusk at +4 that the active Dragonite KOs first). A body that never acts is read on its drops as the defender too: the
 * stage is moot to every pair term, whether it stands on the attacker or the defender side of the pair. Singles,
 * Champions singles and doubles; the control is the same board where the holder acts.
 */
describe('12a: the stage of an idle holder adds nothing to the hit of a foe that reads it (Foul Play)', () => {
  const FOUL = () => set('Umbreon', ['foulplay', 'splash']);
  // The holder hits hard enough that the Foul Play carrier is the foe's best answer to it only while the hit is small; a priority hit KOs it first.
  const HITTER = () => set('Garchomp', ['earthquake', 'splash']);
  const QUICK = () => set('Jolteon', ['quickattack', 'splash']);

  function board(format: string, first: PokemonSet): { battle: Battle; holder: Pokemon } {
    const doubles = format === DOUBLES;
    // The Foul Play carrier stays on the bench in both game types; the foe in front KOs the holder first.
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

/**
 * Round 76 (T262): one evaluation asks whether a raised body acts once per foe in front, not once for the boosts term
 * and again for the pair terms (the profile of the VGC trees: the same pair read twice per leaf). The reading is the
 * simulator's ModifyBoost event of each attack of the pair (`pairStages`), so the events fired from inside
 * `holderActsInFront` are counted: an evaluation of a board with a raised holder fires as many as one `idleHolders`
 * pass, and the board without a raise none. The holder is idle (a faster foe KOs it) or acts (a harmless foe).
 */
describe('T262: the idle reading runs once per evaluation', () => {
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
