import { test, expect } from 'vitest';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';
import { fetcherKey } from '../src/lib/smogon/fetcher-key';

/**
 * The usage cache lives per module, so two fakes serving different files in
 * one process must not share an entry — round 51 measured "0 of 120 sets
 * different" between the harness fixtures and .smogon-cache because the
 * second source got the first one's answer. gen4ou is this file's own
 * format; no other spec fetches it, and the module cache never resets.
 */
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
