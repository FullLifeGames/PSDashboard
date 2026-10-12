import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import { Move, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import { inferSpreads } from '../src/spread-inference';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { boostItemIds, isBoostItem } from '../src/spreads/boost-items';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';

/**
 * Round 69 (T26, spec decision 7): a guessed boost item (Choice Band, Choice Specs, Life Orb ...) the damage lines
 * refute gives way. The usage guess hits 1.5 times harder than the lines show at every spread, so the solver used
 * to zero the offense under the item (Kyurem Timid 0/0/0/0/0/252 with Choice Specs: Draco Meteor 28 % on Ting-Lu
 * fits only without the item). Every rung is now scored with the item and without it; the lower fit error wins,
 * the prior's distance breaks a tie, and the item stays on a tie. A revealed, sheet or manual item never yields.
 */
const WORLDS = [
  { name: 'gen9ou', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252 },
  { name: 'gen9doublesou', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252 },
  { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32 },
  { name: 'Champions doubles', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32 },
];
type World = (typeof WORLDS)[number];
type Mon = { species: string; side: 'p1' | 'p2'; nature: string; evs: PokemonEvs; item?: string };

const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const asSet = (m: Mon, level: number, moves: string[]): PokemonSet => ({
  name: m.species, species: m.species, item: m.item ?? '', ability: '', moves, nature: m.nature, evs: m.evs,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});
/** A mid-roll hit computed forward with the TRUE bodies, items included. */
function hit(world: World, attacker: Mon, defender: Mon, moveName: string, rollIndex = 8): DamageObservation {
  const body = (m: Mon) => buildCalcPokemon(world.gen, m.species, { level: world.level, nature: m.nature, evs: m.evs, item: m.item });
  const d = body(defender);
  const result = calculate(world.gen, body(attacker), d, new Move(world.gen, moveName));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  return {
    attackerSpecies: attacker.species, defenderSpecies: defender.species, attackerSide: attacker.side,
    moveId: toId(moveName), observedFraction: rolls[Math.min(rollIndex, rolls.length - 1)] / d.maxHP(), lethal: false,
    attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '',
  };
}
const knownItem = new Map([
  ['p2:gengar', { itemKnown: true, scarfRuledOut: false, spreadKnown: false, spreads: [] }],
  ['p2:garchomp', { itemKnown: true, scarfRuledOut: false, spreadKnown: false, spreads: [] }],
]);

for (const world of WORLDS) {
  const { max } = world;
  // Champions' generation 0 has no Choice Band and no Choice Specs (past items of the mod): Life Orb stands for the boost item there.
  const champions = world.formatid.includes('champions');
  const scenes = [
    { label: 'a special attacker', species: 'Gengar', item: champions ? 'Life Orb' : 'Choice Specs', moves: ['Shadow Ball', 'Sludge Bomb'], nature: 'Timid', offense: 'spa' as const, defender: { species: 'Garchomp', nature: 'Calm', spread: { hp: max, spd: max } } },
    { label: 'a physical attacker', species: 'Garchomp', item: champions ? 'Life Orb' : 'Choice Band', moves: ['Earthquake', 'Outrage'], nature: 'Jolly', offense: 'atk' as const, defender: { species: 'Clefable', nature: 'Bold', spread: { hp: max, def: max } } },
  ];
  for (const scene of scenes) {
    describe(`a guessed boost item the lines refute gives way: ${scene.item} on ${scene.label} (${world.name})`, () => {
      // The prior is the usage guess with the item (offense and Speed invested); the truth is the same body without it.
      const prior: Mon = { species: scene.species, side: 'p2', nature: scene.nature, evs: evs({ [scene.offense]: max, spe: max }), item: scene.item };
      const truth: Mon = { ...prior, item: undefined };
      // The defender already stands at the bulk the ladder tops out at, so no bulk rung can absorb a hit the item makes too hard.
      const wall: Mon = { species: scene.defender.species, side: 'p1', nature: scene.defender.nature, evs: evs(scene.defender.spread) };
      const sets = { p1: [asSet(wall, world.level, ['Protect'])], p2: [asSet(prior, world.level, scene.moves)] };
      const key = `p2:${toId(scene.species)}`;
      const lines = (body: Mon) => [hit(world, body, wall, scene.moves[0]), hit(world, body, wall, scene.moves[0], 5), hit(world, body, wall, scene.moves[0], 12)];
      const observations = lines(truth);

      test('the body without the item is solved and the candidate says so', () => {
        const solved = inferSpreads(observations, sets, world.formatid).get(key);
        expect(solved?.item).toBe('');
        expect(solved?.itemReason).toBe('no-boost');
        expect(solved?.evs[scene.offense]).toBe(max);
        expect(solved?.nature).toBe(scene.nature);
      });

      test('a revealed or manual item never yields', () => {
        const solved = inferSpreads(observations, sets, world.formatid, [], knownItem).get(key);
        expect(solved?.item).toBeUndefined();
        expect(solved?.itemReason).toBeUndefined();
      });

      test('lines the item explains keep it', () => {
        const solved = inferSpreads(lines(prior), sets, world.formatid).get(key);
        expect(solved?.item).toBeUndefined();
        expect(solved?.evs[scene.offense] ?? max).toBe(max);
      });

      test("the fit error of the solved body does not rise above the prior's", () => {
        const solved = inferSpreads(observations, sets, world.formatid).get(key)!;
        const ctx = buildSolveContext(observations, sets, world.formatid, []);
        const total = (spread: { evs: PokemonEvs; nature: string; item?: string }) =>
          observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, spread), 0);
        expect(total(solved)).toBeLessThan(total({ evs: prior.evs, nature: prior.nature }));
      });
    });
  }
}

describe('a boost item is what the Dex says it is (T26)', () => {
  const gen9 = Dex.forGen(9);
  test('the offense items of the simulator are in, the others are out', () => {
    for (const name of ['Choice Band', 'Choice Specs', 'Life Orb', 'Muscle Band', 'Expert Belt', 'Wise Glasses']) {
      expect(isBoostItem(9, name), name).toBe(true);
    }
    for (const name of ['Leftovers', 'Choice Scarf', 'Assault Vest', 'Heavy-Duty Boots', 'Rocky Helmet', 'Focus Sash', 'Eviolite', '']) {
      expect(isBoostItem(9, name), name).toBe(false);
    }
  });

  test('the list is read from the simulator\'s damage hooks, per generation, with no list in code', () => {
    const hooks = ['onModifyAtk', 'onModifySpA', 'onBasePower', 'onModifyDamage'] as const;
    for (const generation of [9, 8, 4]) {
      const dex = Dex.forGen(generation);
      const expected = dex.items.all().filter(item => hooks.some(hook => typeof (item as unknown as Record<string, unknown>)[hook] === 'function')).map(item => item.id);
      expect([...boostItemIds(generation)].sort()).toEqual(expected.sort());
    }
    expect(isBoostItem(9, 'choiceband')).toBe(isBoostItem(9, 'Choice Band'));
    expect(gen9.items.get('lifeorb').exists).toBe(true);
  });
});
