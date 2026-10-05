import { test, expect, describe } from 'vitest';
import type { Battle, Pokemon, PokemonSet } from '@pkmn/sim';
import { landedMove } from '../src/score/move-facts';
import { singleMoveFraction } from '../src/score/threat';
import { active, bench, set } from './move-oracle';
import { battleOf, fingerprint, powerInTurn } from './power-oracle';

/**
 * Round 63 (T81): the static prices a move's power as it lands by asking the
 * simulator's own handler of that move (basePowerCallback, the move's
 * onBasePower, Endeavor's damageCallback). Each answer is checked against
 * what the simulator uses in a real turn, read before the turn starts.
 */

const ours = (battle: Battle, attacker: Pokemon, defender: Pokemon, id: string) =>
  landedMove(attacker, defender, battle.dex.moves.get(id), battle);

/** Our answer before the turn, then the simulator's in the turn (p1 slot 1 uses its first move, p2 Splashes). */
function againstTurn(battle: Battle, id: string, p1 = 'move 1', p2 = 'move 1') {
  const answer = ours(battle, active(battle, 0), active(battle, 1), id);
  const seen = powerInTurn(battle, { p1, p2 }, id);
  expect(seen.length, `${id} reached the BasePower event`).toBeGreaterThan(0);
  return { ours: { basePower: answer.basePower, powerMult: answer.powerMult }, sim: { basePower: seen[0].basePower, powerMult: seen[0].modifier } };
}

function expectTurn(format: string, attacker: PokemonSet, defender: PokemonSet, id: string, setup?: (battle: Battle) => void) {
  const battle = battleOf(format, [attacker], [defender]);
  setup?.(battle);
  const { ours: mine, sim } = againstTurn(battle, id);
  expect(mine, id).toEqual(sim);
  return mine;
}

const splash = (species: string, extra: Partial<PokemonSet> = {}) => set(species, ['splash'], extra);

describe('power at use asks the simulator (round 63, T81)', () => {
  test('Low Kick, Grass Knot, Heavy Slam and Heat Crash price by weight as in a real turn', () => {
    for (const id of ['lowkick', 'grassknot', 'heavyslam', 'heatcrash']) {
      for (const target of ['Pikachu', 'Heatran', 'Snorlax']) {
        const power = expectTurn('gen9customgame', set('Copperajah', [id]), splash(target), id);
        expect(power.basePower, `${id} into ${target}`).toBeGreaterThan(0);
      }
    }
  });

  test('Heat Crash prices into each foe of a doubles board', () => {
    const team = () => [set('Gouging Fire', ['heatcrash']), set('Pikachu', ['splash'])];
    const foes = () => [splash('Landorus-Therian'), splash('Chien-Pao')];
    for (const slot of [1, 2]) {
      const battle = battleOf('gen9doublescustomgame', team(), foes());
      const [gouging, foe] = [battle.sides[0].active[0], battle.sides[1].active[slot - 1]];
      const answer = ours(battle, gouging, foe, 'heatcrash');
      expect(singleMoveFraction(gouging, foe, 'heatcrash', battle), foe.species.name).toBeGreaterThan(0);
      const seen = powerInTurn(battle, { p1: `move 1 ${slot}, move 1`, p2: 'move 1, move 1' }, 'heatcrash');
      expect({ basePower: answer.basePower, powerMult: answer.powerMult }).toEqual({ basePower: seen[0].basePower, powerMult: seen[0].modifier });
    }
  });

  test("Flail, Reversal, Eruption, Water Spout and Dragon Energy follow the user's HP; Crush Grip, Wring Out, Hard Press and Brine the target's", () => {
    for (const id of ['flail', 'reversal', 'eruption', 'waterspout', 'dragonenergy']) {
      expectTurn('gen9customgame', set('Kingambit', [id]), splash('Garchomp'), id, battle => {
        active(battle, 0).hp = Math.floor(active(battle, 0).maxhp / 7);
      });
    }
    for (const id of ['crushgrip', 'wringout', 'hardpress', 'brine']) {
      const power = expectTurn('gen9customgame', set('Kingambit', [id]), splash('Snorlax'), id, battle => {
        active(battle, 1).hp = Math.floor(active(battle, 1).maxhp / 3);
      });
      expect(power.basePower * power.powerMult, id).not.toBe(battleOf('gen9customgame', [set('Kingambit', [id])], [splash('Snorlax')]).dex.moves.get(id).basePower);
    }
  });

  test('Gyro Ball and Electro Ball follow the speeds: stage, Choice Scarf, paralysis, Tailwind', () => {
    const setups: [string, (battle: Battle) => void][] = [
      ['plain', () => {}],
      ['stage', battle => { active(battle, 1).boosts.spe = 2; }],
      ['paralysis', battle => { active(battle, 1).setStatus('par'); }],
      ['Tailwind', battle => { battle.sides[1].addSideCondition('tailwind', 'debug'); }],
    ];
    for (const id of ['gyroball', 'electroball']) {
      for (const [label, setup] of setups) {
        const scarf = expectTurn('gen9customgame', set('Ferrothorn', [id]), splash('Weavile', { item: 'Choice Scarf' }), id, setup);
        expect(scarf.basePower, `${id} ${label}`).toBeGreaterThan(0);
      }
    }
  });

  test('gen 6 Return and Frustration follow happiness; gen 2 Low Kick keeps its fixed power', () => {
    expect(expectTurn('gen6customgame', set('Lopunny', ['return']), splash('Tornadus-Therian'), 'return').basePower).toBe(102);
    expect(expectTurn('gen6customgame', set('Lopunny', ['frustration'], { happiness: 0 }), splash('Tornadus-Therian'), 'frustration').basePower).toBe(102);
    expect(expectTurn('gen2customgame', set('Machamp', ['lowkick']), splash('Snorlax'), 'lowkick').basePower).toBe(50);
  });

  test('Knock Off hits 1.5 times into a removable item, plain into no item and into a Paradox holding Booster Energy', () => {
    expect(expectTurn('gen9customgame', set('Weavile', ['knockoff']), splash('Garchomp', { item: 'Leftovers' }), 'knockoff').powerMult).toBe(1.5);
    expect(expectTurn('gen9customgame', set('Weavile', ['knockoff']), splash('Garchomp'), 'knockoff').powerMult).toBe(1);
    expect(expectTurn('gen9customgame', set('Weavile', ['knockoff']), splash('Iron Valiant', { item: 'Booster Energy' }), 'knockoff').powerMult).toBe(1);
  });

  test('Facade, Hex, Venoshock, Barb Barrage and Infernal Parade read status; Acrobatics the own item; Solar Beam the rain; Expanding Force Psychic Terrain', () => {
    expect(expectTurn('gen9customgame', set('Ursaluna', ['facade']), splash('Garchomp'), 'facade', battle => { active(battle, 0).setStatus('brn'); }).powerMult).toBe(2);
    for (const [id, status] of [['hex', 'par'], ['venoshock', 'psn'], ['barbbarrage', 'tox'], ['infernalparade', 'brn']] as const) {
      const power = expectTurn('gen9customgame', set('Gengar', [id]), splash('Garchomp'), id, battle => { active(battle, 1).setStatus(status); });
      expect(power.basePower * power.powerMult, id).toBe(2 * battleOf('gen9customgame', [set('Gengar', [id])], [splash('Garchomp')]).dex.moves.get(id).basePower);
    }
    expect(expectTurn('gen9customgame', set('Hawlucha', ['acrobatics']), splash('Garchomp'), 'acrobatics').basePower).toBe(110);
    expect(expectTurn('gen9customgame', set('Hawlucha', ['acrobatics'], { item: 'Leftovers' }), splash('Garchomp'), 'acrobatics').basePower).toBe(55);
    expect(expectTurn('gen9customgame', set('Venusaur', ['solarbeam'], { item: 'Power Herb' }), splash('Garchomp'), 'solarbeam', battle => {
      battle.field.setWeather('raindance', 'debug');
    }).powerMult).toBe(0.5);
    // Psychic Terrain also boosts every Psychic move of a grounded user (its own BasePower handler, a
    // field effect the static leaves out), so the turn's modifier is read against a plain Psychic.
    const terrainTurn = (id: string) => {
      const battle = battleOf('gen9customgame', [set('Indeedee', [id])], [splash('Garchomp')]);
      battle.field.setTerrain('psychicterrain', 'debug');
      const answer = ours(battle, active(battle, 0), active(battle, 1), id);
      return { answer, modifier: powerInTurn(battle, { p1: 'move 1', p2: 'move 1' }, id)[0].modifier };
    };
    const force = terrainTurn('expandingforce');
    expect(force.answer.powerMult).toBe(1.5);
    expect(force.answer.powerMult).toBeCloseTo(force.modifier / terrainTurn('psychic').modifier, 3);
  });

  test('Endeavor deals the HP difference through the simulator', () => {
    const battle = battleOf('gen9customgame', [set('Araquanid', ['endeavor'])], [splash('Snorlax')]);
    const [user, target] = [active(battle, 0), active(battle, 1)];
    user.hp = 50;
    const before = target.hp;
    expect(singleMoveFraction(user, target, 'endeavor', battle)).toBeCloseTo((before - 50) / target.maxhp, 10);
    battle.choose('p1', 'move 1');
    battle.choose('p2', 'move 1');
    expect(before - target.hp).toBe(before - 50);
  });

  test('a benched carrier and a benched target answer like active ones', () => {
    // Heavy Metal doubles the weight only while the sim reads the ability; on the bench it would not.
    const metal = battleOf('gen9customgame',
      [set('Pikachu', ['splash']), set('Copperajah', ['heavyslam'], { ability: 'Heavy Metal' })], [splash('Snorlax')]);
    const benched = ours(metal, bench(metal, 0, 1), active(metal, 1), 'heavyslam');
    metal.choose('p1', 'switch 2');
    metal.choose('p2', 'move 1');
    expect(benched).toEqual(ours(metal, active(metal, 0), active(metal, 1), 'heavyslam'));
    // A benched Choice Scarf target is as fast as an active one.
    const scarf = battleOf('gen9customgame',
      [set('Ferrothorn', ['gyroball'])], [splash('Snorlax'), splash('Weavile', { item: 'Choice Scarf' })]);
    const toBench = ours(scarf, active(scarf, 0), bench(scarf, 1, 1), 'gyroball');
    scarf.choose('p1', 'move 1');
    scarf.choose('p2', 'switch 2');
    expect(toBench).toEqual(ours(scarf, active(scarf, 0), active(scarf, 1), 'gyroball'));
  });

  test('asking the simulator leaves a debug-mode battle untouched', () => {
    const ids = ['lowkick', 'heavyslam', 'flail', 'eruption', 'crushgrip', 'gyroball', 'knockoff', 'facade', 'hex', 'acrobatics', 'solarbeam', 'expandingforce', 'endeavor'];
    const battle = battleOf('gen9customgame',
      [set('Copperajah', ['splash'], { ability: 'Heavy Metal' }), set('Ferrothorn', ['splash'], { item: 'Float Stone' })],
      [splash('Weavile', { item: 'Choice Scarf' }), splash('Garchomp', { item: 'Leftovers' })]);
    battle.field.setWeather('raindance', 'debug');
    for (const [attacker, defender] of [[active(battle, 0), active(battle, 1)], [bench(battle, 0, 1), bench(battle, 1, 1)]]) {
      for (const id of ids) {
        const before = fingerprint(battle, [attacker, defender], id);
        for (let i = 0; i < 1100; i++) ours(battle, attacker, defender, id);
        singleMoveFraction(attacker, defender, id, battle);
        expect(fingerprint(battle, [attacker, defender], id), id).toBe(before);
      }
    }
  });
});
