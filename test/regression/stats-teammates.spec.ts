import { describe, expect, test } from 'vitest';
import { parseSmogonChaosStats } from '../../src/lib/smogon-stats';

/**
 * Round 88 (F, #101): the stats parser keeps the teammate lists. The stand-in step for a side that never showed all its bodies picks
 * its guesses from them, and the parser dropped the field before. data.pkmn.cc writes the fraction of the species' teams that carry
 * the teammate (a slice of the cached gen4ou file: Tyranitar's top rows); the Smogon chaos file counts them like its other buckets.
 */
const PKMN_SLICE = {
  battles: 61518,
  pokemon: {
    Tyranitar: {
      count: 61096,
      abilities: { 'Sand Stream': 1 },
      items: { Leftovers: 0.4 },
      moves: { Stealth_Rock: 0.2 },
      spreads: {},
      teammates: { Latias: 0.4074, Jirachi: 0.3667, Gyarados: 0.3641, Nothing: 0, Broken: 'x' },
    },
    Latias: { count: 20000, abilities: {}, items: {}, moves: {}, spreads: {} },
  },
};

describe('teammates in the usage stats', () => {
  test('data.pkmn.cc: the teammate rows keep the file\'s order and four digits', () => {
    const stats = parseSmogonChaosStats(PKMN_SLICE, { format: 'gen4ou', month: 'latest' });
    expect(stats.pokemon.tyranitar.teammates?.map(row => [row.value, row.probability])).toEqual([['Latias', 0.4074], ['Jirachi', 0.3667], ['Gyarados', 0.3641]]);
    expect(stats.pokemon.tyranitar.teammates?.[0].sourceDetail).toBeTruthy();
  });

  test('a species without a teammate list has none, and every other field reads as before', () => {
    const stats = parseSmogonChaosStats(PKMN_SLICE, { format: 'gen4ou', month: 'latest' });
    expect(stats.pokemon.latias.teammates).toBeUndefined();
    expect(stats.pokemon.tyranitar.rawCount).toBe(61096);
    expect(stats.pokemon.tyranitar.abilities[0]).toMatchObject({ value: 'Sand Stream', probability: 1 });
  });

  test('Smogon chaos: the Teammates bucket reads like the other counts of the species', () => {
    const stats = parseSmogonChaosStats({
      data: { Tyranitar: { 'Raw count': 1000, Abilities: {}, Items: {}, Moves: {}, Spreads: {}, Teammates: { Latias: 400, Jirachi: 250 } } },
    }, { format: 'gen4ou', month: '2026-03' });
    expect(stats.pokemon.tyranitar.teammates?.map(row => [row.value, row.probability])).toEqual([['Latias', 0.4], ['Jirachi', 0.25]]);
  });
});
