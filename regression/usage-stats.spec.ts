import { test, expect, describe } from 'vitest';
import {
  fillUsageMoves,
  getSpeciesUsageSet,
  parseSmogonChaosStats,
} from '../src/lib/smogon-stats';

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
