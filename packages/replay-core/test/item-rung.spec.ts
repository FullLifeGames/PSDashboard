import './champions-mod';
import { describe, expect, test } from 'vitest';
import { Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { Move, calculate } from '@smogon/calc';
import { inferSpreads } from '../src/spread-inference';
import type { SpeedKnowledge, SpeedKnowledgeMap } from '../src/spreads/scarf';
import { buildCalcPokemon } from '../src/calc-build';
import { calcGenerationFor } from '../src/calc-gen';
import { buildSolveContext, observationError } from '../src/spreads/fit';
import { toId } from '../src/ids';
import type { DamageObservation, PokemonEvs } from '../src/types';

const WORLDS = [
  { name: 'Scarlet/Violet singles', formatid: 'gen9ou', gen: calcGenerationFor(9), level: 100, max: 252, doubles: false, item: 'Choice Specs', other: 'Life Orb' },
  { name: 'Scarlet/Violet doubles', formatid: 'gen9doublesou', gen: calcGenerationFor(9), level: 100, max: 252, doubles: true, item: 'Choice Specs', other: 'Life Orb' },
  { name: 'Scarlet/Violet VGC', formatid: 'gen9vgc2026regi', gen: calcGenerationFor(9), level: 50, max: 252, doubles: true, item: 'Choice Specs', other: 'Life Orb' },
  // Champions' generation 0 has no Choice Specs (a past item of the mod); the Dex there lists the game's items.
  { name: 'Champions singles', formatid: 'gen9championsou', gen: calcGenerationFor(0), level: 50, max: 32, doubles: false, item: 'Life Orb', other: 'Expert Belt' },
  { name: 'Champions VGC', formatid: 'gen9championsvgc2026regma', gen: calcGenerationFor(0), level: 50, max: 32, doubles: true, item: 'Life Orb', other: 'Expert Belt' },
] as const;
type World = (typeof WORLDS)[number];

const evs = (spread: Partial<PokemonEvs>): PokemonEvs => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...spread });
const asSet = (species: string, nature: string, spread: PokemonEvs, level: number, moves: string[], item = ''): PokemonSet => ({
  name: species, species, item, ability: '', moves, nature, evs: spread,
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, level, gender: '',
});
const body = (world: World, species: string, nature: string, spread: PokemonEvs, item?: string) =>
  buildCalcPokemon(world.gen, species, { level: world.level, nature, evs: spread, item });
function bestRoll(world: World, attacker: ReturnType<typeof body>, defender: ReturnType<typeof body>, move: string): number {
  const result = calculate(world.gen, attacker, defender, new Move(world.gen, move));
  return Math.max(...(Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number)) / defender.maxHP();
}

const knockout = (world: World, attacker: string, defender: string, move: string): DamageObservation => ({
  attackerSpecies: attacker, defenderSpecies: defender, attackerSide: 'p2', moveId: toId(move), observedFraction: 1, lethal: true,
  attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '', ...(world.doubles ? { doubles: true } : {}),
  defenderShown: { before: { hp: 100, maxhp: 100 } },
});

const DEFENDERS = ['Alakazam', 'Gardevoir', 'Clefable', 'Dragonite', 'Garchomp', 'Gyarados', 'Hydreigon', 'Weavile', 'Staraptor', 'Pelipper', 'Blissey', 'Skarmory', 'Corviknight'];

interface Attacker { species: string; guessed: string; plus: string; moves: string[] }
const GENGAR: Attacker = { species: 'Gengar', guessed: 'Timid', plus: 'Modest', moves: ['Shadow Ball', 'Sludge Bomb'] };

function scene(world: Pick<World, 'gen' | 'level' | 'max'>, item: string, attacker: Attacker = GENGAR) {
  const stat = attacker.moves[0] === 'Flare Blitz' || attacker.moves[0] === 'Dragon Claw' ? 'atk' : 'spa';
  for (const defender of DEFENDERS) {
    for (const move of attacker.moves) {
      const foe = body(world as World, defender, 'Hardy', evs({}));
      const without = bestRoll(world as World, body(world as World, attacker.species, attacker.plus, evs({ [stat]: world.max })), foe, move);
      const withItem = bestRoll(world as World, body(world as World, attacker.species, attacker.guessed, evs({ [stat]: world.max }), item), foe, move);
      if (without < 0.97 && withItem >= 1.01) return { defender, move, without, withItem };
    }
  }
  throw new Error(`no scene for ${item} on ${attacker.species}`);
}

const known = (over: Partial<SpeedKnowledge> = {}): SpeedKnowledge => ({ itemKnown: false, scarfRuledOut: false, spreadKnown: false, spreads: [], ...over });

for (const world of WORLDS) {
  describe(`a knockout no spread reaches takes the usage-listed boost item (${world.name})`, () => {
    const { defender, move, without, withItem } = scene(world, world.item);
    const prior = evs({ spa: world.max, spe: world.max });
    const sets = (guess = 'Leftovers') => ({
      p1: [asSet(defender, 'Hardy', evs({}), world.level, ['Protect'])],
      p2: [asSet('Gengar', 'Timid', prior, world.level, [move, 'Protect'], guess)],
    });
    const observations = [knockout(world, 'Gengar', defender, move), knockout(world, 'Gengar', defender, move)];
    const key = 'p2:gengar';
    const solve = (map: SpeedKnowledgeMap, guess?: string) => inferSpreads(observations, sets(guess), world.formatid, [], map).get(key);

    test('the scene is real: no item-less rung reaches, the item does', () => {
      expect(without).toBeLessThan(0.97);
      expect(withItem).toBeGreaterThanOrEqual(1.01);
    });

    test('the first offered boost item that reaches is the item, with its reason', () => {
      const solved = solve(new Map([[key, known({ itemOffers: ['Leftovers', world.item, world.other] })]]));
      expect(solved?.item).toBe(world.item);
      expect(solved?.itemReason).toBe('boost');
      expect(solved?.nature).toBe('Timid');
      expect(solved?.evs.spa).toBe(world.max);
    });

    test('the usage order decides among the items that reach', () => {
      const band = world.item === 'Choice Specs' ? 'Choice Band' : 'Expert Belt';
      const solved = solve(new Map([[key, known({ itemOffers: [band, world.item] })]]));
      expect(solved?.item).toBe(world.item);
      expect(solved?.itemReason).toBe('boost');
    });

    test('the solved body reaches every knockout and its error falls', () => {
      const map: SpeedKnowledgeMap = new Map([[key, known({ itemOffers: [world.item] })]]);
      const solved = solve(map)!;
      expect(solved, 'the fit stands (the knockouts are reached, so it does not forfeit)').toBeDefined();
      const ctx = buildSolveContext(observations, sets(), world.formatid, []);
      const total = (spread: { evs: PokemonEvs; nature: string; item?: string }) => observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, spread), 0);
      expect(total(solved)).toBe(0);
      expect(total({ evs: prior, nature: 'Timid' })).toBeGreaterThan(0);
    });

    test('a known item never changes', () => {
      const solved = solve(new Map([[key, known({ itemKnown: true, itemOffers: [world.item] })]]));
      expect(solved?.itemReason).not.toBe('boost');
      expect(solved?.item).toBeUndefined();
    });

    test('no offered item, or an offer that does not reach, leaves the item alone', () => {
      expect(solve(new Map([[key, known({ itemOffers: [] })]]))?.itemReason).not.toBe('boost');
      expect(solve(new Map([[key, known()]]))?.itemReason).not.toBe('boost');
      const solved = solve(new Map([[key, known({ itemOffers: ['Leftovers', 'Focus Sash', 'Rocky Helmet', 'Choice Scarf'] })]]));
      expect(solved?.itemReason).not.toBe('boost');
    });

    test('a decided Scarf or a guessed boost item is not this rung\'s business', () => {
      const own = solve(new Map([[key, known({ itemOffers: [world.item] })]]), world.other);
      expect(own?.itemReason).not.toBe('boost');
    });

    test('the Item Clause holds: a teammate known to hold the item blocks it, a limit of two lets it through', () => {
      const team = sets();
      const partner = asSet('Garchomp', 'Jolly', evs({ atk: world.max }), world.level, ['Earthquake'], world.item);
      const solveWith = (limit: number | undefined) => inferSpreads(observations, { p1: team.p1, p2: [...team.p2, partner] }, world.formatid, [], new Map([
        [key, known({ itemOffers: [world.item], ...(limit === undefined ? {} : { itemLimit: limit }) })],
        ['p2:garchomp', known({ itemKnown: true })],
      ])).get(key);
      expect(solveWith(1)?.itemReason, 'limit 1: the partner holds it').not.toBe('boost');
      expect(solveWith(2)?.itemReason, 'limit 2').toBe('boost');
      expect(solveWith(undefined)?.itemReason, 'no clause (a Custom Game)').toBe('boost');
    });

    test('a guessed item of a teammate does not block it', () => {
      const team = sets();
      const partner = asSet('Garchomp', 'Jolly', evs({ atk: world.max }), world.level, ['Earthquake'], world.item);
      const solved = inferSpreads(observations, { p1: team.p1, p2: [...team.p2, partner] }, world.formatid, [], new Map([
        [key, known({ itemOffers: [world.item], itemLimit: 1 })],
        ['p2:garchomp', known()],
      ])).get(key);
      expect(solved?.itemReason).toBe('boost');
    });
  });
}

describe('an item the species needs is never swapped out (a Mega Stone)', () => {
  const gen = Dex.forGen(7);
  test('the Dex names the stone and the rung leaves it', () => {
    expect(gen.species.get('Charizard-Mega-X').requiredItem).toBe('Charizardite X');
    const world = { formatid: 'gen7ou', gen: calcGenerationFor(7), level: 100, max: 252 } as const;
    const mega: Attacker = { species: 'Charizard-Mega-X', guessed: 'Jolly', plus: 'Adamant', moves: ['Flare Blitz', 'Dragon Claw'] };
    const { defender, move, without, withItem } = scene(world, 'Life Orb', mega);
    expect(without).toBeLessThan(0.97);
    expect(withItem).toBeGreaterThanOrEqual(1.01);
    const set = asSet('Charizard-Mega-X', 'Jolly', evs({ atk: 252, spe: 252 }), 100, [move, 'Protect'], 'Charizardite X');
    const wall = asSet(defender, 'Hardy', evs({}), 100, ['Protect']);
    const hit = (): DamageObservation => ({
      attackerSpecies: 'Charizard-Mega-X', defenderSpecies: defender, attackerSide: 'p2', moveId: toId(move), observedFraction: 1, lethal: true,
      attackerBoosts: {}, defenderBoosts: {}, attackerStatus: '', screens: [], weather: '', defenderShown: { before: { hp: 100, maxhp: 100 } },
    });
    const solved = inferSpreads([hit(), hit()], { p1: [wall], p2: [set] }, world.formatid, [], new Map([
      ['p2:charizardmegax', known({ itemOffers: ['Life Orb', 'Choice Band'] })],
    ])).get('p2:charizardmegax');
    expect(solved?.itemReason).not.toBe('boost');
    expect(solved?.item).toBeUndefined();
  });
});
