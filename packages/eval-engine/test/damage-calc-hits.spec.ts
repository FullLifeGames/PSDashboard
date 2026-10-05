import { describe, expect, test } from 'vitest';
import { Field, Generations, Move, Pokemon, calculate } from '@smogon/calc';
import { calcSingleDamageRange } from '../src/damage-calc';
import type { BranchMoveOption, SimPokemonInfo } from '../src/branch-engine';

/**
 * T96 point 1: the preview's damage of a multi-hit move is the sum of its
 * hits, as the calc itself sums them (Result.range), and its KO chance counts
 * every combination of the hits' own rolls.
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

/** The calc's own result for the same two Pokémon, built straight from @smogon/calc. */
function calcDirect(attacker: SimPokemonInfo, defender: SimPokemonInfo, name: string, gen = gen9) {
  const poke = (info: SimPokemonInfo) => new Pokemon(gen, info.species, {
    level: info.level, ability: info.ability || undefined, item: info.item || undefined, nature: info.nature,
    evs: info.evs, ivs: info.ivs, curHP: info.hp,
  });
  return calculate(gen, poke(attacker), poke(defender), new Move(gen, name, { ability: attacker.ability as never }), new Field({ gameType: 'Singles' }));
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

  test('the KO chance of a multi-hit counts every combination of the hits\' rolls', () => {
    const urshifu = mon('Urshifu-Rapid-Strike', { ability: 'Unseen Fist' });
    const full = mon('Great Tusk', { evs: { ...STATS, hp: 252, def: 4 } });
    const rows = calcDirect(urshifu, full, 'Surging Strikes').damage as number[][];
    const sums = rows.reduce<number[]>((acc, hit) => acc.flatMap(sum => hit.map(roll => sum + roll)), [0]);
    const [min, max] = [Math.min(...sums), Math.max(...sums)];
    const hp = Math.round((min + max) / 2);
    const damaged = { ...full, hp, maxhp: hp };
    const expected = Math.round(sums.filter(sum => sum >= hp).length / sums.length * 100);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(100);
    expect(calcSingleDamageRange(urshifu, damaged, move('Surging Strikes')).koChance).toBe(`${expected}% OHKO`);
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
