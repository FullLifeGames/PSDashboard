import { test, expect } from '@playwright/test';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { enrichPokemonInfo, unknownEvs } from '../packages/replay-core/src/team-info';
import type { RevealedPokemonInfo } from '../packages/replay-core/src/types';

const sampleInfo: RevealedPokemonInfo = {
  species: 'Great Tusk',
  moves: [{ name: 'Rapid Spin', source: 'revealed' }],
  ability: { value: '', source: 'unknown' },
  item: { value: '', source: 'unknown' },
  teraType: { value: '', source: 'unknown' },
  evs: unknownEvs(),
  level: 100,
  gender: '',
};

test.describe('Smogon set assumptions', () => {
  test('normalizes @pkmn/smogon set data into fallback assumptions', async () => {
    const payload = {
      'Great Tusk': {
        'Bulky Spinner': {
          ability: 'Protosynthesis',
          item: 'Booster Energy',
          nature: 'Jolly',
          evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 },
          moves: ['Headlong Rush', 'Rapid Spin', 'Ice Spinner', 'Close Combat'],
        },
      },
    };

    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen9ou',
      species: ['Great Tusk'],
      fetcher: async () => ({
        json: async () => payload,
      }),
    });

    expect(assumptions?.pokemon.greattusk).toMatchObject({
      species: 'Great Tusk',
      ability: { value: 'Protosynthesis' },
      item: { value: 'Booster Energy' },
      moves: [
        { value: 'Headlong Rush' },
        { value: 'Rapid Spin' },
        { value: 'Ice Spinner' },
        { value: 'Close Combat' },
      ],
      spread: {
        nature: 'Jolly',
        evs: { atk: 252, def: 4, spe: 252 },
      },
    });
  });

  test('resolves Custom Game set assumptions from the generation OU', async () => {
    const payload = {
      Metagross: {
        'Choice Band': {
          ability: 'Clear Body',
          item: 'Choice Band',
          nature: 'Adamant',
          evs: { hp: 252, atk: 252, def: 0, spa: 0, spd: 4, spe: 0 },
          moves: ['Meteor Mash', 'Earthquake', 'Explosion', 'Rock Slide'],
        },
      },
    };

    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen3customgame',
      species: ['Metagross'],
      fetcher: async () => ({
        json: async () => payload,
      }),
    });

    expect(assumptions?.format).toBe('gen3ou');
    expect(assumptions?.pokemon.metagross).toMatchObject({
      species: 'Metagross',
      ability: { value: 'Clear Body' },
      item: { value: 'Choice Band' },
    });
  });

  test('uses set assumptions after revealed data and before unknown defaults', () => {
    const enriched = enrichPokemonInfo(sampleInfo, null, {
      format: 'gen9ou',
      source: 'mock',
      pokemon: {
        greattusk: {
          species: 'Great Tusk',
          sourceDetail: 'Smogon sets gen9ou',
          ability: { value: 'Protosynthesis', sourceDetail: 'Smogon sets gen9ou' },
          item: { value: 'Booster Energy', sourceDetail: 'Smogon sets gen9ou' },
          moves: [
            { value: 'Headlong Rush', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'Rapid Spin', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'Ice Spinner', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'Close Combat', sourceDetail: 'Smogon sets gen9ou' },
          ],
        },
      },
    });

    expect(enriched.ability).toMatchObject({ value: 'Protosynthesis', source: 'guessed' });
    expect(enriched.item).toMatchObject({ value: 'Booster Energy', source: 'guessed' });
    expect(enriched.moves.map(move => move.name)).toEqual([
      'Rapid Spin',
      'Headlong Rush',
      'Ice Spinner',
      'Close Combat',
    ]);
  });
});
