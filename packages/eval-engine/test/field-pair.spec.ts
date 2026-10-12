import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { createMatchupCache, evalFeatures, evaluatePosition, featureWeights, EVAL_WEIGHTS, type EvalFeatures, type StaticRuleset } from '../src/eval-function';
import { boostedFraction, pairThreat } from '../src/score/threat';
import { redirectsFoes } from '../src/score/field-pair';
import { set } from './move-oracle';
import { battleOf } from './power-oracle';

/**
 * Round 69 (T42 part 2, decision 15): the field pair as two features, at weight
 * 0 until a fit prices them. pairFocus: a foe on the field that neither of the
 * side's two actives KOs alone but both KO together, valued by the second
 * attacker's marginal share of the foe's HP, over the foes on the field.
 * pairRedirect: a living Follow Me or Rage Powder user next to a partner with
 * damage, valued by the partner's best share of a foe's HP it covers, at the
 * redirector's HP. Both are p1-positive differences and 0 in singles. The
 * premises (who KOs, who is hit) are played in the simulator.
 */

const FORMAT = 'gen9doublescustomgame';
const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);
const PIKACHU = () => set('Pikachu', ['splash', 'thunderbolt'], { ability: 'Static' });
const snorlaxes = () => [splash('Snorlax'), splash('Snorlax')];
const OLD_KEYS = ['bodies', 'boosts', 'hazards', 'screens', 'tailwind', 'trickRoom', 'matchup', 'coverage', 'choiceMismatch',
  'sweepFastKo', 'sweepFastChip', 'sweepSlowKo', 'sweepSlowChip'] as const;
const RULESETS: StaticRuleset[] = ['standard', 'vgc', 'champions'];

/** Foe slot-1 HP lost when p1's two Pikachu both use Thunderbolt on it. */
function hitOf(build: () => Battle): number {
  const battle = build();
  const mon = battle.sides[1].active[0]!;
  const before = mon.hp;
  battle.choose('p1', 'move 2 1, move 1');
  battle.choose('p2', 'move 1, move 1');
  return before - mon.hp;
}

/** Whether p1's choice faints foe slot 1 in the simulator. */
function faintsFoe(build: () => Battle, choice: string): boolean {
  const battle = build();
  battle.choose('p1', choice);
  battle.choose('p2', 'move 1, move 1');
  return battle.sides[1].active[0]!.fainted;
}

describe('pairFocus (round 69, T42)', () => {
  const plain = () => battleOf(FORMAT, [PIKACHU(), PIKACHU()], snorlaxes());
  const hurt = (hp: number) => () => {
    const battle = plain();
    battle.sides[1].active[0]!.sethp(hp);
    return battle;
  };
  const pairOnlyHp = () => Math.floor(hitOf(plain) * 1.35);

  test('the premise from the simulator: at that HP only the pair KOs foe 1', () => {
    const build = hurt(pairOnlyHp());
    expect(faintsFoe(build, 'move 2 1, move 1')).toBe(false);
    expect(faintsFoe(build, 'move 2 1, move 2 1')).toBe(true);
  });

  test('a pair that KOs where neither does alone reads the second attacker\'s marginal share, over the foes on the field', () => {
    const battle = hurt(pairOnlyHp())();
    const [first, second] = battle.sides[0].active as [Pokemon, Pokemon];
    const foe = battle.sides[1].active[0]!;
    const hit = boostedFraction(pairThreat(first, foe, battle), first, foe);
    const hitTwo = boostedFraction(pairThreat(second, foe, battle), second, foe);
    const foeHp = foe.hp / foe.maxhp;
    expect(Math.max(hit, hitTwo)).toBeLessThan(foeHp);
    expect(hit + hitTwo).toBeGreaterThanOrEqual(foeHp);
    const features = evalFeatures(battle);
    expect(features.pairFocus).toBeGreaterThan(0);
    expect(features.pairFocus).toBeCloseTo(0.5 * (1 - Math.max(hit, hitTwo) / foeHp), 10);
    expect(features.pairRedirect).toBe(0);
  });

  test('0 where the pair does not KO (full HP), where one attack KOs alone, and where only one attacker is on the field', () => {
    expect(evalFeatures(plain()).pairFocus).toBe(0);
    expect(faintsFoe(hurt(1), 'move 2 1, move 1')).toBe(true);
    expect(evalFeatures(hurt(1)()).pairFocus).toBe(0);
    const lone = () => battleOf(FORMAT, [PIKACHU(), splash('Pikachu')], snorlaxes());
    const loneBattle = lone();
    loneBattle.sides[1].active[0]!.sethp(pairOnlyHp());
    expect(faintsFoe(() => { const b = lone(); b.sides[1].active[0]!.sethp(pairOnlyHp()); return b; }, 'move 2 1, move 1')).toBe(false);
    expect(evalFeatures(loneBattle).pairFocus).toBe(0);
  });

  test('the sides mirror: the same board with the sides swapped negates the cell', () => {
    const hp = pairOnlyHp();
    const mine = plain();
    mine.sides[1].active[0]!.sethp(hp);
    const theirs = battleOf(FORMAT, snorlaxes(), [PIKACHU(), PIKACHU()]);
    theirs.sides[0].active[0]!.sethp(hp);
    const a = evalFeatures(mine);
    const b = evalFeatures(theirs);
    expect(a.pairFocus).toBeGreaterThan(0);
    expect(b.pairFocus).toBeCloseTo(-a.pairFocus, 12);
  });
});

/** The simulator's own answer to "does this move turn a foe's single-target hit away from the partner". */
function redirectedInSim(moveId: string): boolean {
  const build = () => battleOf(FORMAT,
    [set('Blissey', [moveId, 'splash'], { ability: 'No Ability' }), set('Blissey', ['splash'])],
    [set('Pikachu', ['tackle', 'splash']), set('Pikachu', ['splash'])]);
  const run = (foeChoice: string) => {
    const battle = build();
    battle.choose('p1', 'move 1, move 1');
    battle.choose('p2', `${foeChoice}, move 1`);
    const [user, partner] = battle.sides[0].active as [Pokemon, Pokemon];
    return { user: user.hp, partner: partner.hp, partnerMax: partner.maxhp };
  };
  const control = run('move 2');
  const aimed = run('move 1 2');
  return aimed.partner === aimed.partnerMax && aimed.user < control.user;
}

describe('pairRedirect (round 69, T42)', () => {
  const CLEFAIRY = (move: string) => set('Clefairy', [move, 'splash'], { ability: 'Magic Guard' });
  const GARCHOMP = () => set('Garchomp', ['splash', 'dragonclaw'], { ability: 'Sand Veil' });
  const pikachus = () => [splash('Pikachu'), splash('Pikachu')];

  test.each(['followme', 'ragepowder'])('%s: a living redirector next to a partner with damage reads the partner\'s share, at its HP', move => {
    const battle = battleOf(FORMAT, [CLEFAIRY(move), GARCHOMP()], pikachus());
    const [redirector, partner] = battle.sides[0].active as [Pokemon, Pokemon];
    redirector.sethp(Math.floor(redirector.maxhp / 2));
    const foe = battle.sides[1].active[0]!;
    const share = Math.min(1, boostedFraction(pairThreat(partner, foe, battle), partner, foe) / (foe.hp / foe.maxhp));
    expect(share).toBeGreaterThan(0.2);
    const features = evalFeatures(battle);
    expect(features.pairRedirect).toBeCloseTo((redirector.hp / redirector.maxhp) * share, 10);
    expect(features.pairFocus).toBe(0);
  });

  test('0 next to a partner without damage, without a redirection move, or with the redirector fainted', () => {
    const noDamage = battleOf(FORMAT, [CLEFAIRY('followme'), splash('Garchomp')], pikachus());
    expect(evalFeatures(noDamage).pairRedirect).toBe(0);
    const noMove = battleOf(FORMAT, [CLEFAIRY('splash'), GARCHOMP()], pikachus());
    expect(evalFeatures(noMove).pairRedirect).toBe(0);
    const gone = battleOf(FORMAT, [CLEFAIRY('followme'), GARCHOMP()], pikachus());
    gone.sides[0].active[0]!.faint();
    expect(evalFeatures(gone).pairRedirect).toBe(0);
  });

  test('the sides mirror: a redirector on p2 negates the cell', () => {
    const mine = battleOf(FORMAT, [CLEFAIRY('followme'), GARCHOMP()], pikachus());
    const theirs = battleOf(FORMAT, pikachus(), [CLEFAIRY('followme'), GARCHOMP()]);
    const a = evalFeatures(mine).pairRedirect;
    expect(a).toBeGreaterThan(0);
    expect(evalFeatures(theirs).pairRedirect).toBeCloseTo(-a, 12);
  });

  test('the predicate agrees with the simulator for every self-targeted move with a volatile (Dex sweep)', () => {
    const dex = battleOf(FORMAT, pikachus(), pikachus()).dex;
    const playable = (move: { exists: boolean; gen: number; isMax?: unknown; isZ?: unknown }) => move.exists && move.gen <= 9 && !move.isMax && !move.isZ;
    const moves = dex.moves.all().filter(move => playable(move) && move.target === 'self' && !!move.volatileStatus);
    expect(moves.length).toBeGreaterThan(20);
    expect(moves.filter(move => redirectsFoes(dex, move)).map(move => move.id).sort()).toEqual(['followme', 'ragepowder']);
    for (const move of moves) {
      // Ally Switch lands the user in the partner's slot: the same probe sees a hit on the user.
      if (move.id === 'allyswitch') continue;
      expect(`${move.id} ${redirectedInSim(move.id)}`).toBe(`${move.id} ${redirectsFoes(dex, move)}`);
    }
  });
});

describe('singles and the inert weights (round 69, T42)', () => {
  test('singles boards read 0 in both cells, whatever sits on the field', () => {
    const battle = battleOf('gen9customgame', [set('Clefairy', ['followme', 'splash']), splash('Garchomp')],
      [splash('Pikachu'), splash('Snorlax')]);
    battle.sides[1].active[0]!.sethp(1);
    const features = evalFeatures(battle);
    expect(features.pairFocus).toBe(0);
    expect(features.pairRedirect).toBe(0);
  });

  test.each([false, true])('every rule set carries both keys at weight 0 (doubles %s)', doubles => {
    for (const ruleset of RULESETS) {
      const weights = featureWeights(doubles, ruleset);
      expect(weights.pairFocus).toBe(0);
      expect(weights.pairRedirect).toBe(0);
    }
  });

  test.each([
    ['standard doubles', FORMAT, 'standard' as const],
    ['vgc doubles', FORMAT, 'vgc' as const],
    ['champions doubles', FORMAT, 'champions' as const],
    ['singles', 'gen9customgame', 'standard' as const],
    ['champions singles', 'gen9customgame', 'champions' as const],
  ])('the score with both keys at 0 is the sum over the old keys (%s)', (_name, format, ruleset) => {
    const doubles = format === FORMAT;
    const mons = doubles ? [PIKACHU(), PIKACHU()] : [PIKACHU(), splash('Garchomp')];
    const foes = doubles ? snorlaxes() : [splash('Snorlax'), splash('Garchomp')];
    const battle = battleOf(format, mons, foes);
    battle.sides[1].active[0]!.sethp(Math.floor(battle.sides[1].active[0]!.maxhp * 0.4));
    const cache = createMatchupCache(ruleset);
    const features = evalFeatures(battle, cache);
    const weights = featureWeights(doubles, ruleset);
    let diff = 0;
    for (const key of OLD_KEYS) diff += weights[key] * (features as EvalFeatures)[key];
    const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
    const expected = Math.tanh((diff / (teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp))) * EVAL_WEIGHTS.scale);
    expect(evaluatePosition(battle, cache)).toBe(expected);
  });
});
