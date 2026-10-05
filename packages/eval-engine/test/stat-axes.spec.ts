import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { boostedFraction, pairThreat, singleMoveFraction } from '../src/score/threat';
import { expectedRate } from '../src/score/unanswered';
import { combinedOptionHints } from '../src/search/hints';
import { ScriptedPRNG } from '../src/forward/scripted-prng';
import { active, set } from './move-oracle';
import { battleOf, powerInTurn } from './power-oracle';
import { doublesRoot } from './pair-battles';

/**
 * Round 63 (T81 step 3): a move's damage reads the stats and stages its Dex
 * entry names (overrideOffensiveStat, overrideDefensiveStat,
 * overrideOffensivePokemon): Body Press off the user's Defense, Psyshock
 * against the target's Defense, Foul Play off the target's Attack. Stored
 * Power and Power Trip set their power from the boosts, through the stages
 * with the simulator's own callback (decision 3 of the wave spec).
 */

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

/** The simulator's damage in a real turn, the roll pinned to the maximum, a sure hit, no crit. */
function simDamage(format: string, attacker: PokemonSet[], defender: PokemonSet[], id: string, p1 = 'move 1', p2 = 'move 1'): number {
  const battle = battleOf(format, attacker, defender);
  const prng = new ScriptedPRNG([1, 2, 3, 4], new Map([[`p1:${id}`, { hit: true, crit: false, roll: 0 }]]));
  prng.attach(battle);
  battle.prng = prng;
  const target = battle.sides[1].active[0];
  const before = target.hp;
  battle.choose('p1', p1);
  battle.choose('p2', p2);
  return before - target.hp;
}

/** Our fraction, in HP, against the simulator's damage: the static's formula skips the sim's rounding steps. */
function expectNearSim(format: string, attacker: PokemonSet[], defender: PokemonSet[], id: string, p1?: string, p2?: string) {
  const battle = battleOf(format, attacker, defender);
  const ours = singleMoveFraction(battle.sides[0].active[0], battle.sides[1].active[0], id, battle) * battle.sides[1].active[0].maxhp;
  const sim = simDamage(format, attacker, defender, id, p1, p2);
  expect(Math.abs(ours - sim) / sim, `${id}: ours ${ours.toFixed(1)} against the sim's ${sim}`).toBeLessThan(0.03);
}

const pair = (battle: Battle): [Pokemon, Pokemon] => [active(battle, 0), active(battle, 1)];

describe('stat axes from the Dex (round 63, T81)', () => {
  test("Body Press deals damage off the user's Defense, Psyshock against the target's Defense, Foul Play off the target's Attack", () => {
    expectNearSim('gen9customgame', [set('Corviknight', ['bodypress'], { evs: { hp: 0, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } })], [splash('Snorlax')], 'bodypress');
    expectNearSim('gen9customgame', [set('Espeon', ['psyshock'])], [splash('Blissey')], 'psyshock');
    expectNearSim('gen9customgame', [set('Sableye', ['foulplay'])], [splash('Kingambit')], 'foulplay');
    // Doubles: Body Press into one foe of two.
    expectNearSim('gen9doublescustomgame',
      [set('Corviknight', ['bodypress'], { evs: { hp: 0, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 } }), splash('Pikachu')],
      [splash('Snorlax'), splash('Garchomp')], 'bodypress', 'move 1 1, move 1', 'move 1, move 1');
  });

  test('Choice Band boosts Body Press, Assault Vest does not guard against Psyshock', () => {
    expectNearSim('gen9customgame', [set('Corviknight', ['bodypress'], { item: 'Choice Band' })], [splash('Snorlax')], 'bodypress');
    // An Assault Vest holder cannot click Splash (a status move); Seismic Toss leaves its own HP alone.
    expectNearSim('gen9customgame', [set('Espeon', ['psyshock'])], [set('Blissey', ['seismictoss'], { item: 'Assault Vest' })], 'psyshock');
  });

  test('stages follow the axis', () => {
    const press = battleOf('gen9customgame', [set('Corviknight', ['bodypress'])], [splash('Snorlax')]);
    const [corv, lax] = pair(press);
    const pressThreat = pairThreat(corv, lax, press);
    const flat = boostedFraction(pressThreat, corv, lax);
    expect(flat).toBeGreaterThan(0);
    corv.boosts.atk = 2;
    expect(boostedFraction(pressThreat, corv, lax)).toBeCloseTo(flat, 10);
    corv.boosts.def = 2;
    expect(boostedFraction(pressThreat, corv, lax)).toBeCloseTo(2 * flat, 10);
    expect(expectedRate(pressThreat, corv, lax)).toBeCloseTo(2 * flat, 10);

    const foul = battleOf('gen9customgame', [set('Sableye', ['foulplay'])], [splash('Kingambit')]);
    const [sableye, gambit] = pair(foul);
    const foulThreat = pairThreat(sableye, gambit, foul);
    const foulFlat = boostedFraction(foulThreat, sableye, gambit);
    sableye.boosts.atk = 2;
    expect(boostedFraction(foulThreat, sableye, gambit)).toBeCloseTo(foulFlat, 10);
    gambit.boosts.atk = 2;
    expect(boostedFraction(foulThreat, sableye, gambit)).toBeCloseTo(2 * foulFlat, 10);

    const shock = battleOf('gen9customgame', [set('Espeon', ['psyshock'])], [splash('Blissey')]);
    const [espeon, blissey] = pair(shock);
    const shockThreat = pairThreat(espeon, blissey, shock);
    const shockFlat = boostedFraction(shockThreat, espeon, blissey);
    blissey.boosts.spd = 2;
    expect(boostedFraction(shockThreat, espeon, blissey)).toBeCloseTo(shockFlat, 10);
    blissey.boosts.def = 2;
    expect(boostedFraction(shockThreat, espeon, blissey)).toBeCloseTo(shockFlat / 2, 10);
  });

  test('Iron Defense buys setup equity for a Body Press carrier and none for a carrier without it', () => {
    const hint = (moves: string[]) => {
      const root = doublesRoot([set('Corviknight', moves), splash('Pikachu')], [splash('Snorlax'), splash('Garchomp')]);
      return combinedOptionHints(root, 'p1', [{ choice: 'move irondefense, move splash', label: '' }])[0];
    };
    // Two status parts at the support floor each, unless a part buys equity.
    expect(hint(['irondefense', 'bravebird'])).toBe(0.5);
    expect(hint(['irondefense', 'bodypress'])).toBeGreaterThan(0.5);
  });

  test("Stored Power and Power Trip price through the stages with the simulator's callback (decision 3)", () => {
    for (const id of ['storedpower', 'powertrip']) {
      const battle = battleOf('gen9customgame', [set('Espeon', [id])], [splash('Garchomp')]);
      const [espeon, chomp] = pair(battle);
      const threat = pairThreat(espeon, chomp, battle);
      const flat = boostedFraction(threat, espeon, chomp);
      expect(flat, id).toBeGreaterThan(0);
      // At +2/+2 the simulator gives power 100 in a real turn; the category's stage doubles it again.
      espeon.boosts.atk = 2;
      espeon.boosts.spa = 2;
      espeon.boosts.spd = 2;
      espeon.boosts.def = 2;
      const offense = battle.dex.moves.get(id).category === 'Physical' ? 'atk' : 'spa';
      const seen = powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, id);
      expect(seen[0].basePower, id).toBe(180);
      espeon.boosts[offense === 'atk' ? 'atk' : 'spa'] = 2;
      expect(boostedFraction(threat, espeon, chomp), id).toBeCloseTo(flat * (180 / 20) * 2, 6);
    }
    // The override of a setup hint reaches the callback: Calm Mind's +1/+1 is worth 60 power at x1.5.
    const battle = battleOf('gen9customgame', [set('Espeon', ['storedpower'])], [splash('Garchomp')]);
    const [espeon, chomp] = pair(battle);
    const threat = pairThreat(espeon, chomp, battle);
    expect(boostedFraction(threat, espeon, chomp, { spa: 1, spd: 1 }))
      .toBeCloseTo(boostedFraction(threat, espeon, chomp) * (60 / 20) * 1.5, 6);
  });
});
