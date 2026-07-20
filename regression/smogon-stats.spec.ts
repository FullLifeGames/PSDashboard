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

    expect(urls).toEqual([{
      format: 'gen9ou',
      month: 'latest',
      url: 'https://data.pkmn.cc/stats/gen9ou.json',
    }]);
  });

  test('strips the smogtours prefix before querying usage stats', () => {
    const urls = buildSmogonStatsUrls('smogtoursgen3ou');
    expect(urls[0].url).toBe('https://data.pkmn.cc/stats/gen3ou.json');
  });

  test('maps Custom Game formats straight to the generation OU stats', () => {
    expect(buildSmogonStatsUrls('gen3customgame')).toEqual([{
      format: 'gen3ou',
      month: 'latest',
      url: 'https://data.pkmn.cc/stats/gen3ou.json',
    }]);
  });

  test('adds the generation OU as fallback for formats missing from the stats', () => {
    const urls = buildSmogonStatsUrls('gen5nichemeta');
    expect(urls.map(candidate => candidate.format)).toEqual(['gen5nichemeta', 'gen5ou']);
    expect(urls[1].url).toBe('https://data.pkmn.cc/stats/gen5ou.json');
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
    ]);
    expect(stats?.format).toBe('gen4ou');
    expect(stats?.pokemon.metagross.moves[0].value).toBe('Meteor Mash');
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
