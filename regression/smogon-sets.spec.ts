import { test, expect, describe } from 'vitest';
import { fetchSmogonSetAssumptions } from '../src/lib/smogon-sets';
import { enrichPokemonInfo, unknownEvs, type RevealedPokemonInfo } from '@fulllifegames/replay-core';

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

describe('Smogon set assumptions', () => {
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

  test('calls fetch as a free function (window.fetch throws on a foreign this)', async () => {
    // Mirrors the browser: a fetch that refuses a foreign `this`.
    const strictFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ Toxapex: { Wall: { nature: 'Calm', evs: { hp: 248, spd: 252 }, moves: ['Recover'] } } }) } as unknown as Response);
    };
    const assumptions = await fetchSmogonSetAssumptions({ formatId: 'gen8ou', species: ['Toxapex'], fetcher: strictFetch as never });
    expect(assumptions?.pokemon.toxapex?.spread?.evs.spd).toBe(252);
  });

  test('rejects when every species failed, and does not cache the failure', async () => {
    let calls = 0;
    const failing = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
    await expect(fetchSmogonSetAssumptions({ formatId: 'gen8ou', species: ['Toxapex', 'Corviknight'], fetcher: failing })).rejects.toThrow(/Failed to fetch/);
    const before = calls;
    await expect(fetchSmogonSetAssumptions({ formatId: 'gen8ou', species: ['Toxapex', 'Corviknight'], fetcher: failing })).rejects.toThrow();
    expect(calls).toBeGreaterThan(before);
  });

  test('a species without an entry is not an error', async () => {
    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen8ou', species: ['Toxapex', 'Kyurem'],
      fetcher: async () => ({ json: async () => ({ Toxapex: { Wall: { nature: 'Calm', evs: { hp: 248, spd: 252 }, moves: ['Recover'] } } }) }),
    });
    expect(assumptions?.pokemon.toxapex).toBeTruthy();
    expect(assumptions?.pokemon.kyurem).toBeUndefined();
    expect(assumptions?.errors).toBeUndefined();
  });

  const byUrl = (files: Record<string, unknown>) => async (url: string) => {
    const match = url.match(/\/sets\/([a-z0-9]+)\.json$/);
    const file = match ? files[match[1]] : undefined;
    if (!file) return { ok: false, status: 404, json: async () => { throw new Error('404'); } } as unknown as Response;
    return { ok: true, status: 200, json: async () => file } as unknown as Response;
  };
  const kyuremSet = { Kyurem: { 'Dragon Dance': { nature: 'Jolly', evs: { hp: 56, def: 236, spe: 216 }, moves: ['Substitute', 'Roost', 'Icicle Spear', 'Dragon Dance'] } } };
  const toxapexSet = { Toxapex: { Wall: { nature: 'Calm', evs: { hp: 248, spd: 252 }, moves: ['Recover'] } } };

  test('a species missing from the format file takes the generation Ubers set', async () => {
    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen8ou', species: ['Toxapex', 'Kyurem'], fetcher: byUrl({ gen8ou: toxapexSet, gen8ubers: kyuremSet }) as never,
    });
    expect(assumptions?.pokemon.kyurem?.spread?.evs).toMatchObject({ hp: 56, def: 236, spe: 216 });
    expect(assumptions?.pokemon.kyurem?.sourceDetail).toBe('Smogon sets gen8ubers');
    expect(assumptions?.pokemon.toxapex?.sourceDetail).toBe('Smogon sets gen8ou');
    expect(assumptions?.formats).toEqual(['gen8ou', 'gen8ubers']);
  });

  test('a species in both files keeps the format set', async () => {
    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen8ou', species: ['Toxapex'],
      fetcher: byUrl({ gen8ou: toxapexSet, gen8ubers: { Toxapex: { Other: { nature: 'Bold', evs: { def: 252 }, moves: ['Haze'] } } } }) as never,
    });
    expect(assumptions?.pokemon.toxapex?.spread?.nature).toBe('Calm');
    expect(assumptions?.formats).toEqual(['gen8ou']);
  });

  test('doubles formats fall back to Doubles Ubers', async () => {
    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen9vgc2026regi', species: ['Kyurem'], fetcher: byUrl({ gen9doublesou: {}, gen9doublesubers: kyuremSet }) as never,
    });
    expect(assumptions?.pokemon.kyurem?.sourceDetail).toBe('Smogon sets gen9doublesubers');
  });

  test('a missing fallback file is absence, not failure', async () => {
    const assumptions = await fetchSmogonSetAssumptions({
      formatId: 'gen8ou', species: ['Toxapex', 'Kyurem'], fetcher: byUrl({ gen8ou: toxapexSet }) as never,
    });
    expect(assumptions?.pokemon.kyurem).toBeUndefined();
    expect(assumptions?.errors).toBeUndefined();
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
