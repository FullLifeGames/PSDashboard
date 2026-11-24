import { test, expect, describe } from 'vitest';
import { enrichTeamInfo, unknownEvs, type OpponentTeamInfo } from '@fulllifegames/replay-core';
import {
  buildSmogonStatsUrls,
  fetchSmogonUsageStats,
  getSpeciesUsageSet,
  parseSmogonChaosStats,
  parseSpread,
  type SmogonUsageStats,
} from '../../src/lib/smogon-stats';
import { smogonDataPath, withSmogonFallback } from '../../src/lib/smogon/hosts';
import { fetcherKey } from '../../src/lib/smogon/fetcher-key';

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

describe('Smogon usage stat enrichment', () => {
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
    const urls = buildSmogonStatsUrls('gen9vgc2026regi');
    expect(urls.map(candidate => candidate.format)).toEqual([
      'gen9vgc2026', 'gen9doublesou', 'gen9ou', 'gen9ubers',
    ]);
  });

  test('Champions VGC reads its own year-level stats file, not the Scarlet/Violet one', () => {
    for (const format of ['gen9championsvgc2026regmb', 'gen9championsvgc2026regmcbo3']) {
      expect(buildSmogonStatsUrls(format).map(candidate => candidate.format)).toEqual([
        'gen9championsvgc2026', 'gen9doublesou', 'gen9ou', 'gen9ubers',
      ]);
    }
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

    const stats = await fetchSmogonUsageStats('gen9vgc2026regi', {
      now: new Date('2026-08-04T00:00:00Z'),
      fetcher,
    });

    expect(stats?.format).toBe('gen9vgc2026');
    expect(stats?.pokemon.incineroar.moves.map(move => move.value)).toEqual(['Fake Out']);
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

describe('coherent move enrichment', () => {
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

    // Body Press scales with Defense, so Swords Dance does not serve it; Iron Head repeats Heavy Slam's Steel damage.
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

    expect(enriched.moves.map(move => move.name)).toEqual([
      'Super Fang', 'Air Slash', 'U-turn', 'Roost',
    ]);
    expect(enriched.item).toEqual({
      value: 'Heavy-Duty Boots', source: 'guessed', sourceDetail: 'Smogon sets gen9ou',
    });
  });
});

describe('Smogon data host fallback', () => {
  const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  test('maps both hosts onto one data path and collapses double slashes', () => {
    expect(smogonDataPath('https://data.pkmn.cc//sets/gen8ou.json')).toBe('/sets/gen8ou.json');
    expect(smogonDataPath('https://pkmn.github.io/smogon/data/stats/gen8ou.json')).toBe('/stats/gen8ou.json');
    expect(smogonDataPath('https://replay.pokemonshowdown.com/x.json')).toBeNull();
  });

  test('a network failure on the primary host falls through to the mirror', async () => {
    const asked: string[] = [];
    const fetcher = withSmogonFallback(async url => {
      asked.push(url);
      if (url.startsWith('https://data.pkmn.cc')) throw new TypeError('Failed to fetch');
      return okJson({ mirror: true });
    });
    const response = await fetcher('https://data.pkmn.cc//sets/gen8ou.json');
    expect(await response.json()).toEqual({ mirror: true });
    expect(asked).toEqual(['https://data.pkmn.cc/sets/gen8ou.json', 'https://pkmn.github.io/smogon/data/sets/gen8ou.json']);
  });

  test('a 404 is an answer, not a reason to try the mirror', async () => {
    const asked: string[] = [];
    const fetcher = withSmogonFallback(async url => {
      asked.push(url);
      return new Response('', { status: 404 });
    });
    const response = await fetcher('https://data.pkmn.cc/sets/gen8nosuchformat.json');
    expect(response.status).toBe(404);
    expect(asked).toHaveLength(1);
  });

  test('foreign URLs pass through untouched', async () => {
    const asked: string[] = [];
    const fetcher = withSmogonFallback(async url => { asked.push(url); return okJson({}); });
    await fetcher('https://replay.pokemonshowdown.com/x.json');
    expect(asked).toEqual(['https://replay.pokemonshowdown.com/x.json']);
  });
});

const statsFetcher = (species: string, requested: string[]) => (async (input: RequestInfo | URL) => {
  requested.push(String(input));
  return new Response(JSON.stringify({
    battles: 1_000,
    pokemon: { [species]: { count: 100, moves: { Earthquake: 0.9 } } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

test('two fetchers in one process keep their own usage stats', async () => {
  const fromFixtures = await fetchSmogonUsageStats('gen4ou', { fetcher: statsFetcher('Metagross', []) });
  const fromCache = await fetchSmogonUsageStats('gen4ou', { fetcher: statsFetcher('Salamence', []) });

  expect(Object.keys(fromFixtures!.pokemon)).toEqual(['metagross']);
  expect(Object.keys(fromCache!.pokemon)).toEqual(['salamence']);
});

test('the same fetcher asks for each candidate file once', async () => {
  const requested: string[] = [];
  const fetcher = statsFetcher('Tyranitar', requested);

  await fetchSmogonUsageStats('gen4ou', { fetcher });
  await fetchSmogonUsageStats('gen4ou', { fetcher });

  expect(requested).toEqual([
    'https://data.pkmn.cc/stats/gen4ou.json',
    'https://data.pkmn.cc/stats/gen4ubers.json',
  ]);
});

test('no fetcher keys as global, every custom fetcher as itself', () => {
  const fetcher = statsFetcher('Heatran', []);
  const key = fetcherKey(fetcher);

  expect(fetcherKey(undefined)).toBe('global');
  expect(key).not.toBe('global');
  expect(fetcherKey(fetcher)).toBe(key);
  expect(fetcherKey(statsFetcher('Heatran', []))).not.toBe(key);
});

const statsBody = (species: string) => JSON.stringify({ pokemon: { [species]: { count: 100, moves: { Earthquake: 0.9 } } } });
const ok = (species: string) => new Response(statsBody(species), { status: 200, headers: { 'content-type': 'application/json' } });
const status = (code: number) => new Response('', { status: code });
const abortError = () => new DOMException('signal is aborted without reason', 'AbortError');

function fetcher(answer: (path: string, ask: number, init?: RequestInit) => Promise<Response> | Response) {
  const asks = new Map<string, number>();
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/smogon\/data/, '');
    const ask = (asks.get(path) ?? 0) + 1;
    asks.set(path, ask);
    return answer(path, ask, init);
  }) as typeof fetch;
  return { fn, asks: (path: string) => asks.get(path) ?? 0 };
}

describe('the usage-stats memo keeps answers only', () => {
  test('an aborted load is forgotten: the next call fetches again', async () => {
    const source = fetcher((path, ask, init) => {
      if (init?.signal?.aborted) throw abortError();
      return path === '/stats/gen8ou.json' && ask > 1 ? ok('Dragapult') : status(404);
    });
    const controller = new AbortController();
    controller.abort();
    await expect(fetchSmogonUsageStats('gen8ou', { fetcher: source.fn, signal: controller.signal })).rejects.toThrow();
    const stats = await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    expect(Object.keys(stats?.pokemon ?? {})).toEqual(['dragapult']);
  });

  test('a caller that joins a load another caller then aborts asks again', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const source = fetcher(async (path, _ask, init) => {
      await new Promise<void>((resolve, reject) => {
        if (init?.signal?.aborted) return reject(abortError());
        init?.signal?.addEventListener('abort', () => reject(abortError()));
        void gate.then(resolve);
      });
      return path === '/stats/gen8ou.json' ? ok('Tyranitar') : status(404);
    });
    const first = new AbortController();
    const leaving = fetchSmogonUsageStats('gen8ou', { fetcher: source.fn, signal: first.signal });
    const joining = fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    first.abort();
    release();
    await expect(leaving).rejects.toThrow();
    expect((await joining)?.pokemon.tyranitar).toBeDefined();
  });

  test('a network failure is forgotten: the next call fetches again', async () => {
    let online = false;
    const source = fetcher(path => {
      if (!online) throw new TypeError('Failed to fetch');
      return path === '/stats/gen8ou.json' ? ok('Landorus-Therian') : status(404);
    });
    expect(await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn })).toBeNull();
    online = true;
    const stats = await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    expect(stats?.pokemon['landorustherian']).toBeDefined();
  });

  test('a server error on every host is forgotten like a network failure', async () => {
    let healthy = false;
    const source = fetcher(path => (healthy && path === '/stats/gen8ou.json' ? ok('Corviknight') : status(healthy ? 404 : 503)));
    expect(await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn })).toBeNull();
    healthy = true;
    expect((await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn }))?.pokemon.corviknight).toBeDefined();
  });

  test('a result with a failed fallback is returned but not kept', async () => {
    let flaky = true;
    const source = fetcher(path => {
      if (path === '/stats/gen8ou.json') return ok('Garchomp');
      if (path === '/stats/gen8ubers.json' && flaky) throw new TypeError('Failed to fetch');
      return path === '/stats/gen8ubers.json' ? ok('Zacian') : status(404);
    });
    const first = await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    expect(Object.keys(first?.pokemon ?? {})).toEqual(['garchomp']);
    flaky = false;
    const second = await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    expect(Object.keys(second?.pokemon ?? {}).sort()).toEqual(['garchomp', 'zacian']);
  });

  test('a 404 from every source is an answer and stays: one ask per file', async () => {
    const source = fetcher(() => status(404));
    expect(await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn })).toBeNull();
    expect(await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn })).toBeNull();
    expect(source.asks('/stats/gen8ou.json')).toBe(1);
    expect(source.asks('/stats/gen8ubers.json')).toBe(1);
  });

  test('stats that loaded stay: one ask per file', async () => {
    const source = fetcher(path => (path === '/stats/gen8ou.json' ? ok('Heatran') : status(404)));
    await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    const again = await fetchSmogonUsageStats('gen8ou', { fetcher: source.fn });
    expect(again?.pokemon.heatran).toBeDefined();
    expect(source.asks('/stats/gen8ou.json')).toBe(1);
  });
});
