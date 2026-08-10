import { test, expect } from '@playwright/test';
import { enrichTeamInfo, unknownEvs } from '../src/lib/team-info';
import {
  buildSmogonStatsUrls,
  fetchSmogonUsageStats,
  getSpeciesUsageSet,
  parseSmogonChaosStats,
  parseSpread,
  type SmogonUsageStats,
} from '../src/lib/smogon-stats';
import type { OpponentTeamInfo } from '../src/types';

const usageStats: SmogonUsageStats = {
  format: 'gen9ou',
  month: '2026-03',
  source: 'https://www.smogon.com/stats/2026-03/chaos/gen9ou-0.json',
  pokemon: {
    garchomp: {
      species: 'Garchomp',
      rawCount: 1000,
      abilities: [
        { value: 'Rough Skin', probability: 0.924, sourceDetail: 'Smogon gen9ou 2026-03' },
        { value: 'Sand Veil', probability: 0.076, sourceDetail: 'Smogon gen9ou 2026-03' },
      ],
      items: [
        { value: 'Rocky Helmet', probability: 0.412, sourceDetail: 'Smogon gen9ou 2026-03' },
        { value: 'Loaded Dice', probability: 0.185, sourceDetail: 'Smogon gen9ou 2026-03' },
      ],
      moves: [
        { value: 'Earthquake', probability: 0.841, sourceDetail: 'Smogon gen9ou 2026-03' },
        { value: 'Scale Shot', probability: 0.662, sourceDetail: 'Smogon gen9ou 2026-03' },
        { value: 'Swords Dance', probability: 0.549, sourceDetail: 'Smogon gen9ou 2026-03' },
        { value: 'Stealth Rock', probability: 0.453, sourceDetail: 'Smogon gen9ou 2026-03' },
      ],
      spreads: [
        {
          value: 'Jolly:0/252/0/0/4/252',
          probability: 0.318,
          sourceDetail: 'Smogon gen9ou 2026-03',
          nature: 'Jolly',
          evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
        },
      ],
    },
  },
};

test.describe('Smogon usage stat enrichment', () => {
  test('only queries the client-safe data.pkmn.cc endpoint (smogon.com never sends CORS headers)', () => {
    const urls = buildSmogonStatsUrls('gen9ou');

    expect(urls[0]).toEqual({
      format: 'gen9ou',
      month: 'latest',
      url: 'https://data.pkmn.cc/stats/gen9ou.json',
    });
    expect(urls.every(candidate => candidate.url.startsWith('https://data.pkmn.cc/stats/'))).toBe(true);
  });

  test('strips the smogtours prefix before querying usage stats', () => {
    const urls = buildSmogonStatsUrls('smogtoursgen3ou');
    expect(urls[0].url).toBe('https://data.pkmn.cc/stats/gen3ou.json');
  });

  test('maps Custom Game formats straight to the generation OU stats', () => {
    const urls = buildSmogonStatsUrls('gen3customgame');
    expect(urls[0]).toEqual({
      format: 'gen3ou',
      month: 'latest',
      url: 'https://data.pkmn.cc/stats/gen3ou.json',
    });
    expect(urls.map(candidate => candidate.format)).toEqual(['gen3ou', 'gen3ubers']);
  });

  test('adds the generation OU and Ubers as per-species fallbacks', () => {
    const urls = buildSmogonStatsUrls('gen5nichemeta');
    expect(urls.map(candidate => candidate.format)).toEqual(['gen5nichemeta', 'gen5ou', 'gen5ubers']);
    expect(urls[1].url).toBe('https://data.pkmn.cc/stats/gen5ou.json');
  });

  test('maps VGC formats to the year-level stats file with doubles fallbacks', () => {
    const urls = buildSmogonStatsUrls('gen9championsvgc2026regmb');
    expect(urls.map(candidate => candidate.format)).toEqual([
      'gen9vgc2026', 'gen9doublesou', 'gen9ou', 'gen9ubers',
    ]);
  });

  test('fetchSmogonUsageStats assumes OU when the format has no stats file', async () => {
    const requestedUrls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      if (String(input).includes('gen4nichemeta')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({
        pokemon: {
          Metagross: { count: 10, moves: { 'Meteor Mash': 0.9 } },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const stats = await fetchSmogonUsageStats('gen4nichemeta', { fetcher });

    expect(requestedUrls).toEqual([
      'https://data.pkmn.cc/stats/gen4nichemeta.json',
      'https://data.pkmn.cc/stats/gen4ou.json',
      'https://data.pkmn.cc/stats/gen4ubers.json',
    ]);
    expect(stats?.format).toBe('gen4ou');
    expect(stats?.pokemon.metagross.moves[0].value).toBe('Meteor Mash');
  });

  test('merges species missing from the format file from the fallback files', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('gen9vgc2026')) {
        return new Response(JSON.stringify({
          pokemon: { Incineroar: { count: 100, moves: { 'Fake Out': 0.9 } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('gen9ubers')) {
        return new Response(JSON.stringify({
          pokemon: {
            Annihilape: { count: 50, moves: { 'Rage Fist': 0.95, 'Close Combat': 0.9 } },
            Incineroar: { count: 10, moves: { 'Knock Off': 0.8 } },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const stats = await fetchSmogonUsageStats('gen9championsvgc2026regmb', {
      now: new Date('2026-08-04T00:00:00Z'),
      fetcher,
    });

    // The format's own data wins for species it covers…
    expect(stats?.format).toBe('gen9vgc2026');
    expect(stats?.pokemon.incineroar.moves.map(move => move.value)).toEqual(['Fake Out']);
    // …and species it lacks merge in from the fallback files.
    expect(stats?.pokemon.annihilape.moves.map(move => move.value)).toEqual(['Rage Fist', 'Close Combat']);
    expect(stats?.pokemon.annihilape.moves[0].sourceDetail).toBe('Smogon gen9ubers latest');
  });

  test('parses data.pkmn.cc usage stats as fractional probabilities', () => {
    const parsed = parseSmogonChaosStats({
      battles: 12_345,
      pokemon: {
        Garchomp: {
          count: 321,
          abilities: { 'Rough Skin': 0.924, 'Sand Veil': 0.076 },
          items: { 'Rocky Helmet': 0.412, Nothing: 0.031 },
          moves: { Earthquake: 0.841, 'Scale Shot': 0.662 },
          spreads: { 'Jolly:0/252/0/0/4/252': 0.318 },
        },
      },
    }, { format: 'gen9ou', month: 'latest' });

    expect(parsed.source).toBe('https://data.pkmn.cc/stats/gen9ou.json');
    expect(parsed.pokemon.garchomp.abilities[0]).toEqual({
      value: 'Rough Skin',
      probability: 0.924,
      sourceDetail: 'Smogon gen9ou latest',
    });
    expect(parsed.pokemon.garchomp.items.map(item => item.value)).toEqual(['Rocky Helmet']);
    expect(parsed.pokemon.garchomp.moves.map(move => move.probability)).toEqual([0.841, 0.662]);
    expect(parsed.pokemon.garchomp.spreads[0].probability).toBe(0.318);
  });

  test('fetches and parses client-safe usage stats', async () => {
    const requestedUrls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        battles: 12_345,
        pokemon: {
          Garchomp: {
            count: 321,
            abilities: { 'Rough Skin': 0.924 },
            items: { 'Rocky Helmet': 0.412 },
            moves: { Earthquake: 0.841 },
            spreads: { 'Jolly:0/252/0/0/4/252': 0.318 },
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const stats = await fetchSmogonUsageStats('gen9ou', {
      now: new Date('2026-04-28T00:00:00Z'),
      fetcher,
    });

    expect(requestedUrls[0]).toBe('https://data.pkmn.cc/stats/gen9ou.json');
    expect(stats?.pokemon.garchomp.items[0]).toEqual({
      value: 'Rocky Helmet',
      probability: 0.412,
      sourceDetail: 'Smogon gen9ou latest',
    });
  });

  test('extracts the top set pieces and spread from usage data', () => {
    const set = getSpeciesUsageSet(usageStats, 'Garchomp');

    expect(set?.ability).toEqual({
      value: 'Rough Skin',
      probability: 0.924,
      sourceDetail: 'Smogon gen9ou 2026-03',
    });
    expect(set?.item).toEqual({
      value: 'Rocky Helmet',
      probability: 0.412,
      sourceDetail: 'Smogon gen9ou 2026-03',
    });
    expect(set?.moves.map(move => move.value)).toEqual([
      'Earthquake',
      'Scale Shot',
      'Swords Dance',
      'Stealth Rock',
    ]);
    expect(parseSpread('Jolly:0/252/0/0/4/252')).toEqual({
      nature: 'Jolly',
      evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    });
  });

  test('marks Smogon-derived fallbacks as guessed with probabilities', () => {
    const teamInfo: OpponentTeamInfo = {
      pokemon: [{
        species: 'Garchomp',
        moves: [{ name: 'Earthquake', source: 'revealed' }],
        ability: { value: '', source: 'unknown' },
        item: { value: '(has item)', source: 'revealed' },
        teraType: { value: '', source: 'unknown' },
        evs: unknownEvs(),
        level: 100,
        gender: '',
      }],
    };

    const enriched = enrichTeamInfo(teamInfo, usageStats);
    const garchomp = enriched.pokemon[0];

    expect(garchomp.ability).toEqual({
      value: 'Rough Skin',
      source: 'guessed',
      probability: 0.924,
      sourceDetail: 'Smogon gen9ou 2026-03',
    });
    expect(garchomp.nature).toEqual({
      value: 'Jolly',
      source: 'guessed',
      probability: 0.318,
      sourceDetail: 'Smogon gen9ou 2026-03',
    });
    expect(garchomp.item).toEqual({
      value: 'Rocky Helmet',
      source: 'guessed',
      probability: 0.412,
      sourceDetail: 'Smogon gen9ou 2026-03',
    });
    expect(garchomp.moves).toEqual([
      { name: 'Earthquake', source: 'revealed' },
      { name: 'Scale Shot', source: 'guessed', probability: 0.662, sourceDetail: 'Smogon gen9ou 2026-03' },
      { name: 'Swords Dance', source: 'guessed', probability: 0.549, sourceDetail: 'Smogon gen9ou 2026-03' },
      { name: 'Stealth Rock', source: 'guessed', probability: 0.453, sourceDetail: 'Smogon gen9ou 2026-03' },
    ]);
  });
});

/**
 * The displayed set guesses must be assembled by the SAME machinery the
 * simulator's team builder uses (curated selection + coherence vetoes) — the
 * GPL finding was Cobalion showing Body Press next to revealed Swords Dance
 * while the built team had already vetoed it.
 */
test.describe('coherent move enrichment', () => {
  const detail = 'Smogon gen9ou 2026-03';
  const monInfo = (species: string, moves: OpponentTeamInfo['pokemon'][number]['moves']) => ({
    pokemon: [{
      species,
      moves,
      ability: { value: '', source: 'unknown' },
      item: { value: '', source: 'unknown' },
      teraType: { value: '', source: 'unknown' },
      evs: unknownEvs(),
      level: 100,
      gender: '',
    }],
  }) as OpponentTeamInfo;
  const statsFor = (species: string, entries: {
    moves: [string, number][]; item?: [string, number];
  }): SmogonUsageStats => ({
    format: 'gen9ou', month: '2026-03', source: 'test',
    pokemon: {
      [species.toLowerCase()]: {
        species, rawCount: 100,
        abilities: [{ value: 'Justified', probability: 1, sourceDetail: detail }],
        items: entries.item ? [{ value: entries.item[0], probability: entries.item[1], sourceDetail: detail }] : [],
        moves: entries.moves.map(([value, probability]) => ({ value, probability, sourceDetail: detail })),
        spreads: [],
      },
    },
  } as unknown as SmogonUsageStats);

  test('a boost-contradicting usage fill is vetoed from the displayed set', () => {
    const info = monInfo('Cobalion', [
      { name: 'Swords Dance', source: 'revealed' },
      { name: 'Heavy Slam', source: 'revealed' },
    ]);
    const stats = statsFor('Cobalion', {
      moves: [['Iron Head', 0.8], ['Body Press', 0.7], ['Stone Edge', 0.5], ['Close Combat', 0.4]],
      item: ['Leftovers', 0.5],
    });

    const enriched = enrichTeamInfo(info, stats).pokemon[0];

    // Body Press scales with Defense — Swords Dance does not serve it; Iron
    // Head duplicates the revealed Heavy Slam's Steel damage. Both drop and
    // the usage tail refills the display, exactly like the built team.
    expect(enriched.moves.map(move => move.name)).toEqual([
      'Swords Dance', 'Heavy Slam', 'Stone Edge', 'Close Combat',
    ]);
    expect(enriched.moves[2]).toEqual({
      name: 'Stone Edge', source: 'guessed', probability: 0.5, sourceDetail: detail,
    });
  });

  test('a Choice-item guess suppresses guessed status fills in the display', () => {
    const info = monInfo('Dragapult', []);
    const stats = statsFor('Dragapult', {
      moves: [['Draco Meteor', 0.8], ['Calm Mind', 0.7], ['Flamethrower', 0.6], ['Recover', 0.5]],
      item: ['Choice Specs', 0.6],
    });

    const enriched = enrichTeamInfo(info, stats).pokemon[0];

    expect(enriched.item.value).toBe('Choice Specs');
    expect(enriched.moves.map(move => move.name)).toEqual(['Draco Meteor', 'Flamethrower']);
  });

  test('revealed moves are immune however incoherent the pairing looks', () => {
    // Revealed Body Press survives a pool whose boost serves Attack — proof
    // is never second-guessed. (Stone Edge, not Close Combat: a Fighting
    // fill would be same-type-redundant next to the revealed Body Press.)
    const info = monInfo('Cobalion', [{ name: 'Body Press', source: 'revealed' }]);
    const stats = statsFor('Cobalion', {
      moves: [['Swords Dance', 0.9], ['Stone Edge', 0.8]],
    });

    const enriched = enrichTeamInfo(info, stats).pokemon[0];

    expect(enriched.moves.map(move => move.name)).toEqual([
      'Body Press', 'Swords Dance', 'Stone Edge',
    ]);
  });

  test('a revealed move selects the coherent curated set for the display', () => {
    const info = monInfo('Noivern', [{ name: 'Super Fang', source: 'revealed' }]);
    const stats = statsFor('Noivern', {
      moves: [['Draco Meteor', 0.7], ['Super Fang', 0.3]],
      item: ['Leftovers', 0.5],
    });
    const sets = {
      format: 'gen9ou', source: 'test',
      pokemon: {
        noivern: {
          species: 'Noivern', sourceDetail: 'Smogon sets gen9ou',
          item: { value: 'Choice Specs', sourceDetail: 'Smogon sets gen9ou' },
          moves: [
            { value: 'Draco Meteor', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'Hurricane', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'Flamethrower', sourceDetail: 'Smogon sets gen9ou' },
            { value: 'U-turn', sourceDetail: 'Smogon sets gen9ou' },
          ],
          alternatives: [{
            species: 'Noivern', sourceDetail: 'Smogon sets gen9ou',
            item: { value: 'Heavy-Duty Boots', sourceDetail: 'Smogon sets gen9ou' },
            moves: [
              { value: 'Super Fang', sourceDetail: 'Smogon sets gen9ou' },
              { value: 'Air Slash', sourceDetail: 'Smogon sets gen9ou' },
              { value: 'U-turn', sourceDetail: 'Smogon sets gen9ou' },
              { value: 'Roost', sourceDetail: 'Smogon sets gen9ou' },
            ],
          }],
        },
      },
    } as unknown as Parameters<typeof enrichTeamInfo>[2];

    const enriched = enrichTeamInfo(info, stats, sets).pokemon[0];

    // The alternative covers the revealed Super Fang — its moves AND its item
    // fill the display (the first set contradicts what we saw).
    expect(enriched.moves.map(move => move.name)).toEqual([
      'Super Fang', 'Air Slash', 'U-turn', 'Roost',
    ]);
    expect(enriched.item).toEqual({
      value: 'Heavy-Duty Boots', source: 'guessed', sourceDetail: 'Smogon sets gen9ou',
    });
  });
});
