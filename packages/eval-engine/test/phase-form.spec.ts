import { afterEach, describe, expect, test } from 'vitest';
import type { Battle, Pokemon } from '@pkmn/sim';
import {
  createMatchupCache, evalFeatures, evaluatePosition, featureWeights, EVAL_WEIGHTS, FEATURE_WEIGHTS, type EvalFeatures,
} from '../src/eval-function';
import { phaseFormOf, setStaticForm, staticFormOn } from '../src/score/phase-form';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (S9, T102, decision 17): the model form of the static in standard
 * singles. Phase on the two big weights (bodies and matchup, weight plus an
 * addend times the share of fainted mons) and the status fold (statusFix at
 * the weight of bodies, so a Poison Heal body under toxic is no longer
 * discounted like a plain one). Fitted on the r69-b0 capture, 10,350
 * positions of 1,363 sets, out of fold better than the table in 20 of 20
 * seeds (log-loss -21 bp, Brier -7 bp); the other four families keep their
 * tables. The switch (EVAL_STATIC_FORM=0 or setStaticForm(false)) gives the
 * table's score back exactly.
 */

const SINGLES = 'gen9customgame';
const DOUBLES = 'gen9doublescustomgame';
const mon = (species: string, extra: Partial<Parameters<typeof set>[2]> = {}) => set(species, ['splash', 'tackle'], extra);

afterEach(() => setStaticForm(null));

/** The share of fainted mons of both sides, counted here from the board. */
const faintedShare = (battle: Battle): number => {
  const all = battle.sides.flatMap(side => side.pokemon as Pokemon[]);
  return all.filter(pokemon => pokemon.fainted || pokemon.hp <= 0).length / all.length;
};

/** Gliscor with Poison Heal under toxic against a plain team, one foe already fainted. */
function board(format: string): Battle {
  const doubles = format === DOUBLES;
  const mine = [mon('Gliscor', { ability: 'Poison Heal', item: 'Toxic Orb' }), mon('Garchomp'), mon('Clefable'), mon('Blissey')];
  const foes = [mon('Garchomp'), mon('Clefable'), mon('Snorlax'), mon('Toxapex')];
  const battle = battleOf(format, mine.slice(0, doubles ? 4 : 3), foes.slice(0, doubles ? 4 : 3));
  battle.sides[0].pokemon[0].setStatus('tox', null, null, true);
  const lost = battle.sides[1].pokemon[doubles ? 3 : 2];
  lost.hp = 0;
  lost.fainted = true;
  return battle;
}

const sumAt = (battle: Battle, weights: Record<keyof EvalFeatures, number>, cache: ReturnType<typeof createMatchupCache>, extra: (key: keyof EvalFeatures) => number = () => 0): number => {
  const features = evalFeatures(battle, cache);
  let diff = 0;
  for (const key of Object.keys(weights) as (keyof EvalFeatures)[]) diff += (weights[key] + extra(key)) * features[key];
  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  return Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
};

describe('the tables and the form per family', () => {
  test.each([
    ['standard singles', false, 'standard' as const, 200],
    ['vgc singles (reads the standard singles table)', false, 'vgc' as const, 200],
    ['champions singles', false, 'champions' as const, 0],
    ['standard doubles', true, 'standard' as const, 0],
    ['vgc doubles', true, 'vgc' as const, 0],
    ['champions doubles', true, 'champions' as const, 0],
  ])('the status fold of %s', (_name, doubles, ruleset, statusFix) => {
    expect(featureWeights(doubles, ruleset).statusFix).toBe(statusFix);
  });

  test('the form belongs to standard singles and to no other family', () => {
    const form = phaseFormOf(false, 'standard');
    expect(form).not.toBeNull();
    expect(form!.base).toEqual({ bodies: 148, matchup: 137, statusFix: 148 });
    expect(form!.phase).toEqual({ bodies: 232, matchup: 327, statusFix: 232 });
    for (const [doubles, ruleset] of [[false, 'champions'], [true, 'standard'], [true, 'vgc'], [true, 'champions']] as const) {
      expect(phaseFormOf(doubles, ruleset)).toBeNull();
    }
    // A VGC singles game reads the standard singles table, and the form with it.
    expect(phaseFormOf(false, 'vgc')).toBe(form);
  });

  test('the fold: statusFix weighs what bodies weighs, in the table and in the form', () => {
    expect(FEATURE_WEIGHTS.statusFix).toBe(FEATURE_WEIGHTS.bodies);
    const form = phaseFormOf(false, 'standard')!;
    expect(form.base.statusFix).toBe(form.base.bodies);
    expect(form.phase.statusFix).toBe(form.phase.bodies);
  });
});

describe('the score', () => {
  test('the board has the premises: a discounted status, a fainted foe, a status fix to price', () => {
    const battle = board(SINGLES);
    expect(faintedShare(battle)).toBeCloseTo(1 / 6, 12);
    expect(evalFeatures(battle).statusFix).toBeGreaterThan(0);
  });

  test('with the switch off the singles score is the sum over the table, exactly', () => {
    const battle = board(SINGLES);
    const cache = createMatchupCache('standard');
    setStaticForm(false);
    expect(evaluatePosition(battle, cache)).toBe(sumAt(battle, featureWeights(false, 'standard'), cache));
  });

  test('with the switch on the singles score is the sum at weight = base + addend x fainted share', () => {
    const battle = board(SINGLES);
    const cache = createMatchupCache('standard');
    const form = phaseFormOf(false, 'standard')!;
    const share = faintedShare(battle);
    const table = featureWeights(false, 'standard');
    const shift = (key: keyof EvalFeatures) => (key in form.base ? (form.base as Record<string, number>)[key] - table[key] : 0)
      + (key in form.phase ? (form.phase as Record<string, number>)[key] * share : 0);
    setStaticForm(true);
    expect(evaluatePosition(battle, cache)).toBeCloseTo(sumAt(battle, table, cache, shift), 12);
    setStaticForm(false);
    expect(evaluatePosition(battle, cache)).not.toBeCloseTo(sumAt(battle, table, cache, shift), 6);
  });

  test('the phase moves the weight: no fainted mon prices bodies at the base, a fainted one adds the addend', () => {
    const fresh = board(SINGLES);
    fresh.sides[1].pokemon[2].hp = fresh.sides[1].pokemon[2].maxhp;
    fresh.sides[1].pokemon[2].fainted = false;
    expect(faintedShare(fresh)).toBe(0);
    const cache = createMatchupCache('standard');
    const form = phaseFormOf(false, 'standard')!;
    const table = featureWeights(false, 'standard');
    setStaticForm(true);
    const shift = (key: keyof EvalFeatures) => (key in form.base ? (form.base as Record<string, number>)[key] - table[key] : 0);
    expect(evaluatePosition(fresh, cache)).toBeCloseTo(sumAt(fresh, table, cache, shift), 12);
  });

  test.each([
    ['standard doubles', DOUBLES, 'standard' as const],
    ['vgc doubles', DOUBLES, 'vgc' as const],
    ['champions doubles', DOUBLES, 'champions' as const],
    ['champions singles', SINGLES, 'champions' as const],
  ])('the other families score the same with the switch on and off (%s)', (_name, format, ruleset) => {
    const battle = board(format);
    const cache = createMatchupCache(ruleset);
    setStaticForm(true);
    const on = evaluatePosition(battle, cache);
    setStaticForm(false);
    const off = evaluatePosition(battle, cache);
    expect(on).toBe(off);
    expect(on).toBe(sumAt(battle, featureWeights(format === DOUBLES, ruleset), cache));
  });
});

describe('the switch', () => {
  test('it is on unless EVAL_STATIC_FORM=0 or setStaticForm(false) turns it off', () => {
    setStaticForm(null);
    expect(staticFormOn()).toBe(true);
    setStaticForm(false);
    expect(staticFormOn()).toBe(false);
    setStaticForm(true);
    expect(staticFormOn()).toBe(true);
    const env = process.env.EVAL_STATIC_FORM;
    try {
      process.env.EVAL_STATIC_FORM = '0';
      setStaticForm(null);
      expect(staticFormOn()).toBe(false);
    } finally {
      if (env === undefined) delete process.env.EVAL_STATIC_FORM;
      else process.env.EVAL_STATIC_FORM = env;
    }
  });
});
