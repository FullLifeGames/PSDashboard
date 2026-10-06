import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { calcSingleDamageRange } from '../src/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';

/**
 * T96 point 1: the preview's damage of a multi-hit move is the sum of its
 * hits, as the calc itself sums them (Result.range), and its KO text is the
 * calc's verdict over all the hits (Result.kochance).
 */
const gen9 = Generations.get(9);
const STATS = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function mon(species: string, overrides: Partial<SimPokemonInfo> = {}, gen = gen9): SimPokemonInfo {
  const evs = overrides.evs ?? { ...STATS, hp: 252, atk: 252 };
  const maxhp = new Pokemon(gen, species, { level: overrides.level ?? 100, evs, ability: overrides.ability || undefined }).maxHP();
  return {
    name: species, species, hp: maxhp, maxhp, hpPercent: 100, status: '', fainted: false, isActive: true, activeSlot: 0,
    moves: [], ability: '', item: '', stats: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, gender: '', teraType: '', boosts: {}, level: 100,
    types: [], ...overrides,
  };
}

function move(name: string, targetType = 'normal'): BranchMoveOption {
  return { name, activeSlot: 0, slot: 1, pp: 16, maxpp: 16, disabled: false, type: '', targetType, requiresTarget: false, targetOptions: [] };
}

/** The calc's own result for the same two Pokémon, built straight from @smogon/calc; `hits` asks for one hit count. */
function calcDirect(attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, gen = gen9, hits?: number) {
  const poke = (info: SimPokemonInfo) => new Pokemon(gen, info.species, {
    level: info.level, ability: info.ability || undefined, item: info.item || undefined, nature: info.nature,
    evs: info.evs, ivs: info.ivs, curHP: info.hp,
  });
  const options = { ability: attacker.ability as never, item: (attacker.item || undefined) as never, ...(hits ? { hits } : {}) };
  return calculate(gen, poke(attacker), poke(defender), new Move(gen, name, options), new Field({ gameType: 'Singles' }));
}

const pct = (damage: number, maxhp: number) => Math.round(damage / maxhp * 1000) / 10;

describe('multi-hit moves in the damage preview', () => {
  test('Surging Strikes into Great Tusk shows all three hits, as the calc sums them (the scene)', () => {
    const urshifu = mon('Urshifu-Rapid-Strike', { ability: 'Unseen Fist' });
    const tusk = mon('Great Tusk', { evs: { ...STATS, hp: 252, def: 4 } });
    const direct = calcDirect(urshifu, tusk, 'Surging Strikes');
    const [min, max] = direct.range();
    const result = calcSingleDamageRange(urshifu, tusk, move('Surging Strikes'));
    expect(result.minPercent).toBe(pct(min, tusk.maxhp));
    expect(result.maxPercent).toBe(pct(max, tusk.maxhp));
    // The preview used to read one hit: the weakest three hits beat the strongest one twice over.
    const oneHitMax = Math.max(...(direct.damage as number[][])[0]);
    expect(result.minPercent).toBeGreaterThan(2 * pct(oneHitMax, tusk.maxhp));
  });

  test('Skill Link lands five hits, as the calc reads it from the attacker', () => {
    const cinccino = mon('Cinccino', { ability: 'Skill Link' });
    const target = mon('Blissey', { evs: { ...STATS, hp: 252, def: 252 } });
    const [min, max] = calcDirect(cinccino, target, 'Bullet Seed').range();
    const result = calcSingleDamageRange(cinccino, target, move('Bullet Seed'));
    expect([result.minPercent, result.maxPercent]).toEqual([pct(min, target.maxhp), pct(max, target.maxhp)]);
    expect(calcDirect(cinccino, target, 'Bullet Seed').move.hits).toBe(5);
  });

  test('the KO text of a multi-hit is the calc\'s verdict over all its hits at the target\'s current HP', () => {
    const urshifu = mon('Urshifu-Rapid-Strike', { ability: 'Unseen Fist' });
    const full = mon('Great Tusk', { evs: { ...STATS, hp: 252, def: 4 } });
    const [min, max] = calcDirect(urshifu, full, 'Surging Strikes').range();
    // Between the weakest and the strongest three hits: a KO only some roll combinations reach.
    const damaged = { ...full, hp: Math.round((min + max) / 2) };
    const verdict = calcDirect(urshifu, damaged, 'Surging Strikes').kochance(false);
    expect(verdict.n).toBe(1);
    expect(verdict.chance).toBeGreaterThan(0);
    expect(verdict.chance).toBeLessThan(1);
    expect(calcSingleDamageRange(urshifu, damaged, move('Surging Strikes')).koChance).toBe(verdict.text);
  });

  test('a fixed-damage Parental Bond hit counts twice', () => {
    const gen7 = Generations.get(7);
    const kangaskhan = mon('Kangaskhan-Mega', { ability: 'Parental Bond' }, gen7);
    const target = mon('Chansey', {}, gen7);
    const result = calcSingleDamageRange(kangaskhan, target, move('Seismic Toss'), { gen: 7 });
    expect(result.maxPercent).toBe(pct(200, target.maxhp));
    expect(result.minPercent).toBe(pct(200, target.maxhp));
  });

  test('a single hit reads as before', () => {
    const garchomp = mon('Garchomp');
    const kingambit = mon('Kingambit');
    const [min, max] = calcDirect(garchomp, kingambit, 'Earthquake').range();
    const result = calcSingleDamageRange(garchomp, kingambit, move('Earthquake', 'allAdjacent'));
    expect([result.minPercent, result.maxPercent]).toEqual([pct(min, kingambit.maxhp), pct(max, kingambit.maxhp)]);
  });
});

/**
 * T124 point 3: a move whose hit count the simulator draws (2 to 5 hits, or
 * Population Bomb under Loaded Dice) shows every count it can land, each
 * priced by the calc; the counts and their chances are the simulator's
 * (35/35/15/15 from gen 5 on, Loaded Dice 4 or 5 and 4 to 10; held against
 * the simulator in damage-calc-hit-counts.spec.ts).
 */
describe('multi-hit moves with a drawn hit count (T124 point 3)', () => {
  const breloom = mon('Breloom');
  const blissey = mon('Blissey', { evs: { ...STATS, hp: 252, def: 252 } });
  const spanOf = (attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, fewest: number, most: number) =>
    [pct(calcDirect(attacker, defender, name, gen9, fewest).range()[0], defender.maxhp), pct(calcDirect(attacker, defender, name, gen9, most).range()[1], defender.maxhp)];

  test("2 to 5 hits span the fewest hits' minimum to the most hits' maximum, singles and doubles", () => {
    for (const gameType of ['Singles', 'Doubles'] as const) {
      const result = calcSingleDamageRange(breloom, blissey, move('Bullet Seed'), { gameType });
      expect([result.minPercent, result.maxPercent], gameType).toEqual(spanOf(breloom, blissey, 'Bullet Seed', 2, 5));
    }
  });

  test('Loaded Dice lands 4 or 5 hits of a 2 to 5 hit move, and 4 to 10 of Population Bomb', () => {
    const dice = mon('Breloom', { item: 'Loaded Dice' });
    const seed = calcSingleDamageRange(dice, blissey, move('Bullet Seed'));
    expect([seed.minPercent, seed.maxPercent]).toEqual(spanOf(dice, blissey, 'Bullet Seed', 4, 5));
    const maushold = mon('Maushold', { item: 'Loaded Dice' });
    const bomb = calcSingleDamageRange(maushold, blissey, move('Population Bomb'));
    expect([bomb.minPercent, bomb.maxPercent]).toEqual(spanOf(maushold, blissey, 'Population Bomb', 4, 10));
    // Without Loaded Dice the ten hits stay the calc's own count: the preview reads a move that connects.
    const plain = calcSingleDamageRange(mon('Maushold'), blissey, move('Population Bomb'));
    expect([plain.minPercent, plain.maxPercent]).toEqual(spanOf(mon('Maushold'), blissey, 'Population Bomb', 10, 10));
  });

  test("the OHKO chance weighs every count by its chance; agreeing counts keep the calc's text", () => {
    // At 329 HP only 4 and 5 hits knock Blissey out: 0.15 x 99.6 % + 0.15 x 100 %.
    const damaged = { ...blissey, hp: 329 };
    const ohko = (hits: number) => {
      const verdict = calcDirect(breloom, damaged, 'Bullet Seed', gen9, hits).kochance(false);
      return verdict.n === 1 ? verdict.chance ?? 0 : 0;
    };
    const chance = 0.35 * ohko(2) + 0.35 * ohko(3) + 0.15 * ohko(4) + 0.15 * ohko(5);
    expect(chance).toBeGreaterThan(0.15);
    expect(chance).toBeLessThan(0.3);
    expect(calcSingleDamageRange(breloom, damaged, move('Bullet Seed')).koChance).toBe(`${Math.round(chance * 1000) / 10}% chance to OHKO`);
    expect(calcSingleDamageRange(breloom, { ...blissey, hp: 1 }, move('Bullet Seed')).koChance).toBe('guaranteed OHKO');
  });

  test("without an OHKO: the fewest hits' guaranteed verdict holds for every count, else a possible KO in the fewest uses", () => {
    // At 486 HP two hits guarantee a 3HKO, and every larger count a 2HKO.
    const at486 = { ...blissey, hp: 486 };
    expect(calcDirect(breloom, at486, 'Bullet Seed', gen9, 2).kochance(false).text).toBe('guaranteed 3HKO');
    expect(calcSingleDamageRange(breloom, at486, move('Bullet Seed')).koChance).toBe('guaranteed 3HKO');
    // At full HP two hits may need four uses, five hits always take two: two uses can do it, not always.
    expect(calcSingleDamageRange(breloom, blissey, move('Bullet Seed')).koChance).toBe('possible 2HKO');
  });
});
