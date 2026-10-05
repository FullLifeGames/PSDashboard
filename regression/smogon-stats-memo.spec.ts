import { describe, expect, test } from 'vitest';
import { fetchSmogonUsageStats } from '../src/lib/smogon-stats';

/**
 * T68: what the usage-stats memo keeps. An answer stays (stats, or a 404 from
 * every source: the format has no file); an abort, a network failure or a
 * server error does not, so the next load asks again. Every test brings its
 * own fetcher, and the memo keys by fetcher, so no test sees another's entry.
 */
const statsBody = (species: string) => JSON.stringify({ pokemon: { [species]: { count: 100, moves: { Earthquake: 0.9 } } } });
const ok = (species: string) => new Response(statsBody(species), { status: 200, headers: { 'content-type': 'application/json' } });
const status = (code: number) => new Response('', { status: code });
const abortError = () => new DOMException('signal is aborted without reason', 'AbortError');

/** A fetcher that answers with `answer(url, ask)`, counting the asks per stats file. */
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
