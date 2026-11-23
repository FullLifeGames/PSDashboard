import { test, expect, describe } from 'vitest';
import { fillUsageMoves, getSpeciesUsageSet, parseSmogonChaosStats } from '../../src/lib/smogon-stats';

const SAMPLE_CHAOS = {
  info: {
    metagame: 'gen9ou',
    cutoff: 0,
    'cutoff deviation': 0,
  },
  data: {
    'Great Tusk': {
      'Raw count': 100,
      Abilities: {
        Protosynthesis: 100,
      },
      Items: {
        'Booster Energy': 70,
        Leftovers: 30,
      },
      Moves: {
        'Headlong Rush': 90,
        'Rapid Spin': 80,
        'Ice Spinner': 40,
        'Close Combat': 30,
        Earthquake: 10,
      },
      Spreads: {
        'Jolly:0/252/4/0/0/252': 60,
        'Impish:252/0/252/0/4/0': 40,
      },
    },
  },
};
describe('usage stats and doubles support', () => {
  test('parses Smogon chaos stats into probability-backed guesses', () => {
    const stats = parseSmogonChaosStats(SAMPLE_CHAOS, {
      format: 'gen9ou',
      month: '2026-03',
    });

    const usageSet = getSpeciesUsageSet(stats, 'Great Tusk');

    expect(usageSet?.ability).toMatchObject({
      value: 'Protosynthesis',
      probability: 1,
    });
    expect(usageSet?.item).toMatchObject({
      value: 'Booster Energy',
      probability: 0.7,
    });
    expect(fillUsageMoves('Great Tusk', [{ name: 'Rapid Spin', source: 'revealed' }], stats))
      .toEqual([
        { name: 'Rapid Spin', source: 'revealed' },
        { name: 'Headlong Rush', source: 'guessed', probability: 0.9, sourceDetail: 'Smogon gen9ou 2026-03' },
        { name: 'Ice Spinner', source: 'guessed', probability: 0.4, sourceDetail: 'Smogon gen9ou 2026-03' },
        { name: 'Close Combat', source: 'guessed', probability: 0.3, sourceDetail: 'Smogon gen9ou 2026-03' },
      ]);
  });
});

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
