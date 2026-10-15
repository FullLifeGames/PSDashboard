import { afterEach, test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evalFeatures, evaluatePosition, featureWeights, EVAL_WEIGHTS, type EvalFeatures } from '../src/eval-function';
import { pairThreat } from '../src/score/threat';
import { removalFormat, removesStages, stageValue } from '../src/score/boost-bite';
import { setStaticForm } from '../src/score/phase-form';
import { loadSimMods } from '../src/forward/sim-mods';
import { set } from './move-oracle';
import { battleOf, fingerprint } from './power-oracle';

/**
 * Round 69 (T49, decision 16): boostsBiting, the standing stages of `boosts`
 * damped by the share of living foes the stage bites, at weight 0 until a fit
 * prices it. A foe takes the bite away when it plays Unaware, can click a move
 * that takes the stages away (Haze, Clear Smog, a phazer), or when the stage
 * changes nothing in the race within a few turns (a wall that survives the
 * boosted hit, a boost no move of the mon reads). Every premise (the damage,
 * who moves first, what a move does to a stage) is played in the simulator.
 */

await loadSimMods('gen9championscustomgame');

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const CHAMPIONS = 'gen9championscustomgame';
const CHAMPIONS_DOUBLES = 'gen9championsdoublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const GARCHOMP = () => set('Garchomp', ['crunch', 'splash']);
const clefable = (ability: string, moves = ['splash']) => set('Clefable', moves, { ability });

/** Foe HP (in HP points) at `hits` hits of the attacker's best move on no stages: 1.4 means one boosted hit KOs and an unboosted one does not. */
function biteHp(battle: Battle, attacker: Pokemon, foe: Pokemon, hits = 1.4): number {
  return Math.max(1, Math.floor(hits * pairThreat(attacker, foe, battle).physical * foe.maxhp));
}

/** HP the foe loses when slot 0 of p1 clicks its first move at +`stage` Attack, the others Splashing. */
function hitAt(build: () => Battle, stage: number): number {
  const battle = build();
  const foe = battle.sides[1].active[0]!;
  battle.sides[0].active[0]!.boosts.atk = stage;
  const before = foe.hp;
  battle.choose('p1', battle.gameType === 'doubles' ? 'move 1 1, move 1' : 'move 1');
  battle.choose('p2', battle.gameType === 'doubles' ? 'move 1, move 1' : 'move 1');
  return before - foe.hp;
}

const plainDuel = () => battleOf(SINGLES, [GARCHOMP()], [clefable('No Ability')]);
const unawareDuel = () => battleOf(SINGLES, [GARCHOMP()], [clefable('Unaware')]);

/** The singles scene: +2 Attack on the first side, the foe at the HP where only the boost KOs. */
function duel(foe: PokemonSet, mine: PokemonSet[] = [GARCHOMP()], hits = 1.4): Battle {
  const battle = battleOf(SINGLES, mine, [foe]);
  const attacker = battle.sides[0].active[0]!;
  attacker.boosts.atk = 2;
  const target = battle.sides[1].active[0]!;
  target.sethp(biteHp(battle, attacker, target, hits));
  return battle;
}

describe('the premises, from the simulator', () => {
  test('Unaware ignores the stage (+2 Attack deals what +0 deals), a plain foe takes twice', () => {
    expect(hitAt(unawareDuel, 2)).toBe(hitAt(unawareDuel, 0));
    expect(hitAt(plainDuel, 2)).toBeGreaterThanOrEqual(1.9 * hitAt(plainDuel, 0));
  });

  test('at the scene HP the boosted hit KOs and the unboosted hit does not', () => {
    const ko = (stage: number) => {
      const battle = duel(clefable('No Ability'));
      battle.sides[0].active[0]!.boosts.atk = stage;
      battle.choose('p1', 'move 1');
      battle.choose('p2', 'move 1');
      return battle.sides[1].active[0]!.fainted;
    };
    expect(ko(2)).toBe(true);
    expect(ko(0)).toBe(false);
  });
});

describe('boostsBiting, singles', () => {
  test('a foe the boosted hit KOs and the unboosted hit does not: the stage counts in full', () => {
    const features = evalFeatures(duel(clefable('No Ability')));
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBeCloseTo(features.boosts, 12);
  });

  test('an Unaware foe: the stage counts 0', () => {
    const features = evalFeatures(duel(clefable('Unaware')));
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBe(0);
  });

  test('a wall the boosted hit leaves standing for many turns: 0', () => {
    const battle = battleOf(SINGLES, [set('Pikachu', ['tackle', 'splash'])], [splash('Snorlax')]);
    const attacker = battle.sides[0].active[0]!;
    const foe = battle.sides[1].active[0]!;
    attacker.boosts.atk = 2;
    const before = foe.hp;
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    expect(before - foe.hp).toBeLessThan(foe.maxhp / 6);
    const boosted = battleOf(SINGLES, [set('Pikachu', ['tackle', 'splash'])], [splash('Snorlax')]);
    boosted.sides[0].active[0]!.boosts.atk = 2;
    const read = evalFeatures(boosted);
    expect(read.boosts).toBeGreaterThan(0);
    expect(read.boostsBiting).toBe(0);
  });

  test('a boost no move of the mon reads: 0 (Attack on a mon with a special attack only)', () => {
    const features = evalFeatures(duel(clefable('No Ability'), [set('Garchomp', ['dragonpulse', 'splash'])]));
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBe(0);
  });

  test('a foe that clicks Haze takes the stage away: 0; the same foe without it: in full', () => {
    const haze = evalFeatures(duel(clefable('No Ability', ['haze', 'splash'])));
    const control = evalFeatures(duel(clefable('No Ability', ['splash'])));
    expect(haze.boosts).toBeGreaterThan(0);
    expect(haze.boostsBiting).toBe(0);
    expect(control.boostsBiting).toBeCloseTo(control.boosts, 12);
  });

  test('a phazer counts only when the boosted mon has a bench to be dragged out to', () => {
    const roar = clefable('No Ability', ['roar', 'splash']);
    const withBench = evalFeatures(duel(roar, [GARCHOMP(), splash('Snorlax')]));
    const alone = evalFeatures(duel(roar));
    expect(withBench.boosts).toBeGreaterThan(0);
    expect(withBench.boostsBiting).toBe(0);
    expect(alone.boostsBiting).toBeCloseTo(alone.boosts, 12);
  });

  // 13.10.2026: a speed stage bites where the move order decides a race somebody wins. The foe swings back with an Ice Beam
  // (it KOs Garchomp in one hit, so the faster one wins); a foe that only Splashes lets the holder win either way.
  test('each stage on its own: against Unaware the Attack part is 0 and the Speed part stays where it moves first', () => {
    const battle = battleOf(SINGLES, [GARCHOMP()], [set('Jolteon', ['icebeam', 'splash'], { ability: 'Unaware' })]);
    const attacker = battle.sides[0].active[0]!;
    const foe = battle.sides[1].active[0]!;
    const foeSpeed = foe.getActionSpeed();
    expect(attacker.getActionSpeed()).toBeLessThan(foeSpeed);
    attacker.boosts.atk = 2;
    attacker.boosts.spe = 2;
    expect(attacker.getActionSpeed()).toBeGreaterThan(foeSpeed);
    foe.sethp(biteHp(battle, attacker, foe, 0.5));
    const features = evalFeatures(battle);
    expect(features.boosts).toBeCloseTo(stageValue(attacker, 'atk', 2) + stageValue(attacker, 'spe', 2), 12);
    expect(features.boostsBiting).toBeCloseTo(stageValue(attacker, 'spe', 2), 12);
  });

  test('the sides mirror: the same board with the sides swapped negates the feature', () => {
    const mine = duel(clefable('No Ability'));
    const theirs = battleOf(SINGLES, [clefable('No Ability')], [GARCHOMP()]);
    const attacker = theirs.sides[1].active[0]!;
    attacker.boosts.atk = 2;
    theirs.sides[0].active[0]!.sethp(biteHp(theirs, attacker, theirs.sides[0].active[0]!));
    const a = evalFeatures(mine).boostsBiting;
    expect(a).toBeGreaterThan(0);
    expect(evalFeatures(theirs).boostsBiting).toBeCloseTo(-a, 12);
  });
});

describe('boostsBiting, doubles', () => {
  test('the premise in doubles: the Unaware foe ignores the stage, the plain one does not', () => {
    const duelOf = (ability: string) => () => battleOf(DOUBLES, [GARCHOMP(), splash('Snorlax')], [clefable(ability), splash('Snorlax')]);
    expect(hitAt(duelOf('Unaware'), 0)).toBeGreaterThan(0);
    expect(hitAt(duelOf('Unaware'), 2)).toBe(hitAt(duelOf('Unaware'), 0));
    expect(hitAt(duelOf('No Ability'), 2)).toBeGreaterThanOrEqual(1.9 * hitAt(duelOf('No Ability'), 0));
  });

  test('two boosted actives, two foes, one Unaware: each stage counts for the share of foes it bites', () => {
    const battle = battleOf(DOUBLES, [GARCHOMP(), GARCHOMP()], [clefable('Unaware'), clefable('No Ability')]);
    const attackers = battle.sides[0].active as Pokemon[];
    for (const attacker of attackers) attacker.boosts.atk = 2;
    for (const foe of battle.sides[1].active as Pokemon[]) foe.sethp(biteHp(battle, attackers[0], foe));
    const features = evalFeatures(battle);
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBeCloseTo(0.5 * features.boosts, 12);
  });

  test('a board with no stage reads 0', () => {
    const board = battleOf(DOUBLES, [GARCHOMP(), GARCHOMP()], [clefable('Unaware'), clefable('No Ability')]);
    expect(evalFeatures(board).boostsBiting).toBe(0);
  });
});

/**
 * What the simulator does to a boosted mon (+2 Attack and Speed) when a foe
 * clicks the move at it, with a bench behind it or without: the positive
 * stages are gone (the mon is dragged out, or none is left on it).
 */
function removedInSim(format: string, moveId: string, benched: boolean): boolean {
  const doubles = format === DOUBLES || format === CHAMPIONS_DOUBLES;
  const target = () => set('Blissey', ['splash']);
  const field = doubles ? 2 : 1;
  const mover = (moves: string[]) => set('Snorlax', moves, { evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
  const mine = Array.from({ length: benched ? field + 1 + (doubles ? 1 : 0) : field }, target);
  const theirs = Array.from({ length: mine.length }, (_, index) => (index === 0 ? mover([moveId, 'splash']) : mover(['splash'])));
  const battle = battleOf(format, mine, theirs);
  const boosted = battle.sides[0].active[0]!;
  boosted.boosts.atk = 2;
  boosted.boosts.spe = 2;
  const user = battle.sides[1].active[0]!;
  for (let turn = 0; turn < 2 && !battle.ended; turn++) {
    const aimed = turn > 0 ? 'default' : doubles ? 'move 1 1, move 1' : 'move 1';
    if (!battle.choose('p2', aimed) && turn === 0) battle.choose('p2', doubles ? 'move 1, move 1' : 'move 1');
    battle.choose('p1', turn > 0 ? 'default' : doubles ? 'move 1, move 1' : 'move 1');
    if (!user.volatiles['twoturnmove'] && !user.volatiles['mustrecharge']) break;
  }
  if (boosted.fainted) return false;
  const now = battle.sides[0].active[0]!;
  return now !== boosted || !Object.values(now.boosts).some(stage => stage > 0);
}

describe('removesStages (the move predicate), checked against the simulator', () => {
  const dexOf = (format: string) => battleOf(format, [splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
  const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown; id: string }) =>
    move.exists && move.gen <= 9 && !move.isMax && !move.isZ && move.id !== 'struggle';

  test.each([SINGLES, DOUBLES])('every gen 9 move, played at a boosted mon with a bench (%s)', format => {
    const moves = dexOf(format).moves.all().filter(playable);
    expect(moves.length).toBeGreaterThan(800);
    const mismatches = moves
      .filter(move => removesStages(SINGLES, move.id, true) !== removedInSim(format, move.id, true))
      .map(move => move.id);
    expect(mismatches).toEqual([]);
  });

  test('every gen 9 move, played at a boosted mon with no bench (singles)', () => {
    const moves = dexOf(SINGLES).moves.all().filter(playable);
    const mismatches = moves
      .filter(move => removesStages(SINGLES, move.id, false) !== removedInSim(SINGLES, move.id, false))
      .map(move => move.id);
    expect(mismatches).toEqual([]);
  });

  test('the Dex answers part of it: every move that forces a switch removes the stages with a bench and not without', () => {
    const forcing = dexOf(SINGLES).moves.all().filter(move => playable(move) && !!move.forceSwitch);
    expect(forcing.length).toBeGreaterThan(2);
    for (const move of forcing) {
      expect(`${move.id} ${removesStages(SINGLES, move.id, true)}`).toBe(`${move.id} true`);
      expect(`${move.id} ${removesStages(SINGLES, move.id, false)}`).toBe(`${move.id} false`);
    }
  });

  test('the rest of the removers are moves with a handler (the Dex has no flag for them)', () => {
    const others = dexOf(SINGLES).moves.all()
      .filter(move => playable(move) && !move.forceSwitch && removesStages(SINGLES, move.id, false));
    expect(others.length).toBeGreaterThan(0);
    for (const move of others) {
      expect(`${move.id} ${typeof move.onHit === 'function' || typeof move.onHitField === 'function'}`).toBe(`${move.id} true`);
    }
  });

  test('moves that leave the stages alone answer false, and the memo answers the same twice', () => {
    for (const id of ['splash', 'tackle', 'swordsdance']) expect(removesStages(SINGLES, id, true)).toBe(false);
    expect(removesStages(SINGLES, 'haze', true)).toBe(true);
    expect(removesStages(SINGLES, 'haze', true)).toBe(true);
  });
});

describe('the twin battle runs in the mode of the battle it answers for (user 12.10.: the mode decides)', () => {
  const SP = { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 };
  const champion = (species: string, moves: string[], ability = 'No Ability') => set(species, moves, { ability, evs: SP, level: 50 });
  const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown; id: string }) =>
    move.exists && move.gen <= 9 && !move.isMax && !move.isZ && move.id !== 'struggle';

  test('removalFormat: a base battle plays its twin on the base custom game, a Champions battle on the Champions custom game, singles or doubles', () => {
    const base = [SINGLES, DOUBLES].map(format => removalFormat(battleOf(format, [splash('Garchomp'), splash('Snorlax')], [splash('Clefable'), splash('Snorlax')])));
    expect(base).toEqual([SINGLES, SINGLES]);
    const champions = [CHAMPIONS, CHAMPIONS_DOUBLES, 'gen9championsou', 'gen9championsvgc2026regmbbo3']
      .map(format => removalFormat(battleOf(format, [splash('Garchomp'), splash('Snorlax')], [splash('Clefable'), splash('Snorlax')])));
    expect(champions).toEqual([CHAMPIONS, CHAMPIONS, CHAMPIONS, CHAMPIONS]);
  });

  test.each([CHAMPIONS, CHAMPIONS_DOUBLES])('every move played at a boosted mon in the Champions mod, with a bench and without (%s)', format => {
    const dex = battleOf(format, [splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]).dex;
    const moves = dex.moves.all().filter(playable);
    expect(moves.length).toBeGreaterThan(800);
    const twin = removalFormat(battleOf(format, [splash('Pikachu'), splash('Pikachu')], [splash('Pikachu'), splash('Pikachu')]));
    const mismatches = moves
      .flatMap(move => [true, false].map(benched => ({ move, benched })))
      .filter(({ move, benched }) => removesStages(twin, move.id, benched) !== removedInSim(format === CHAMPIONS_DOUBLES && !benched ? CHAMPIONS : format, move.id, benched))
      .map(({ move, benched }) => `${move.id} ${benched}`);
    expect(mismatches).toEqual([]);
  });

  test('a Champions singles board: the foe that clicks Haze takes the stage away, the same foe without it does not', () => {
    const board = (moves: string[]) => {
      const battle = battleOf(CHAMPIONS, [champion('Garchomp', ['crunch', 'splash'])], [champion('Clefable', moves)]);
      const attacker = battle.sides[0].active[0]!;
      attacker.boosts.atk = 2;
      const foe = battle.sides[1].active[0]!;
      foe.sethp(biteHp(battle, attacker, foe));
      return evalFeatures(battle);
    };
    const haze = board(['haze', 'splash']);
    const control = board(['splash']);
    expect(haze.boosts).toBeGreaterThan(0);
    expect(haze.boostsBiting).toBe(0);
    expect(control.boostsBiting).toBeCloseTo(control.boosts, 12);
  });

  // 13.10.2026: a Haze on the field wipes the stage for every foe (the foes in front gate it, boost-bite-front.spec.ts); a Haze on
  // the bench only takes its own foe out of the share.
  test('a Champions doubles board: a foe with Haze on the bench, three without: the stage counts for the three quarters it bites', () => {
    const battle = battleOf(CHAMPIONS_DOUBLES, [champion('Garchomp', ['crunch', 'splash']), champion('Garchomp', ['crunch', 'splash'])],
      [champion('Clefable', ['splash']), champion('Clefable', ['splash']), champion('Clefable', ['haze', 'splash']), champion('Clefable', ['splash'])]);
    const attackers = battle.sides[0].active as Pokemon[];
    for (const attacker of attackers) attacker.boosts.atk = 2;
    for (const foe of battle.sides[1].pokemon) foe.sethp(biteHp(battle, attackers[0], foe));
    const features = evalFeatures(battle);
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBeCloseTo(0.75 * features.boosts, 12);
  });

  test('a Champions doubles board: the foe with Haze on the field wipes the stage for every foe', () => {
    const battle = battleOf(CHAMPIONS_DOUBLES, [champion('Garchomp', ['crunch', 'splash']), champion('Garchomp', ['crunch', 'splash'])],
      [champion('Clefable', ['haze', 'splash']), champion('Clefable', ['splash'])]);
    const attackers = battle.sides[0].active as Pokemon[];
    for (const attacker of attackers) attacker.boosts.atk = 2;
    for (const foe of battle.sides[1].active as Pokemon[]) foe.sethp(biteHp(battle, attackers[0], foe));
    const features = evalFeatures(battle);
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBe(0);
  });
});

describe('inert at weight 0', () => {
  afterEach(() => setStaticForm(null));

  test('evaluating the position leaves the battle as it was (log, dice, queues, stages)', () => {
    const battle = duel(clefable('Unaware', ['haze', 'splash']));
    const mons = [...battle.sides[0].pokemon, ...battle.sides[1].pokemon];
    const before = fingerprint(battle, mons, 'haze');
    evalFeatures(battle);
    expect(fingerprint(battle, mons, 'haze')).toBe(before);
  });

  test('with a weight table the column is read only where its weight is not 0, and no other feature moves', () => {
    const battle = duel(clefable('No Ability'));
    const all = evalFeatures(battle);
    const zero = { ...featureWeights(false, 'standard'), boostsBiting: 0 };
    const priced = { ...zero, boostsBiting: 1 };
    const skipped = evalFeatures(battle, undefined, zero);
    expect(all.boostsBiting).toBeGreaterThan(0);
    expect(skipped.boostsBiting).toBe(0);
    expect(evalFeatures(battle, undefined, priced)).toEqual(all);
    expect({ ...skipped, boostsBiting: all.boostsBiting }).toEqual(all);
  });

  // Round 69 (S8, T49; S17): REPLACEMENT in four families: the damped column takes the place of `boosts`, `boosts` goes to 0.
  // Champions doubles read 61 since S17 (the Schluss-Fit on the drops-aware column, user answer 2a: a fit value outside the lane band
  // [64, 120] applies), VGC doubles 16 (REPLACEMENT 20 of 20 seeds once the drops count). Standard doubles (REPLACEMENT 0 of 20,
  // ADDITIVE flagged) keeps `boosts` and the key at 0.
  test.each([
    ['standard singles', false, 'standard' as const, 0, 95],
    ['champions singles', false, 'champions' as const, 0, 102],
    ['champions doubles', true, 'champions' as const, 0, 61],
    ['standard doubles', true, 'standard' as const, 27, 0],
    ['vgc doubles', true, 'vgc' as const, 0, 16],
  ])('the adopted boost weights of %s', (_name, doubles, ruleset, boosts, bite) => {
    const weights = featureWeights(doubles, ruleset);
    expect(weights.boosts).toBe(boosts);
    expect(weights.boostsBiting).toBe(bite);
  });

  test('a stage that no move of the mon reads is in the boosts column and not in the singles score', () => {
    const battle = battleOf(SINGLES, [splash('Garchomp')], [clefable('No Ability')]);
    battle.sides[0].active[0]!.boosts.atk = 2;
    const features = evalFeatures(battle);
    expect(features.boosts).toBeGreaterThan(0);
    expect(features.boostsBiting).toBe(0);
    expect(evaluatePosition(battle)).toBe(0);
  });

  test('the singles weights of the rule sets without a fit follow the standard singles table', () => {
    // the vgc rule set has no singles table of its own: singles read the standard one
    expect(featureWeights(false, 'vgc')).toBe(featureWeights(false, 'standard'));
  });

  test.each([
    ['standard doubles', DOUBLES, 'standard' as const],
    ['vgc doubles', DOUBLES, 'vgc' as const],
    ['champions doubles', DOUBLES, 'champions' as const],
    ['singles', SINGLES, 'standard' as const],
    ['champions singles', SINGLES, 'champions' as const],
  ])('the score is the sum over every key at the family weights, with a boosted board (%s)', (_name, format, ruleset) => {
    const doubles = format === DOUBLES || format === CHAMPIONS_DOUBLES;
    const battle = doubles
      ? battleOf(format, [GARCHOMP(), GARCHOMP()], [clefable('Unaware'), clefable('No Ability')])
      : duel(clefable('No Ability'));
    for (const attacker of battle.sides[0].active as Pokemon[]) attacker.boosts.atk = 2;
    const cache = createMatchupCache(ruleset);
    const features = evalFeatures(battle, cache);
    expect(features.boosts).toBeGreaterThan(0);
    const weights = featureWeights(doubles, ruleset);
    // The sum is the table's: the singles phase form (round 69, S9) is off here and pinned in phase-form.spec.ts.
    setStaticForm(false);
    let diff = 0;
    for (const key of Object.keys(weights) as (keyof EvalFeatures)[]) {
      diff += weights[key] * features[key];
    }
    const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
    const expected = Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
    expect(evaluatePosition(battle, cache)).toBe(expected);
  });
});
