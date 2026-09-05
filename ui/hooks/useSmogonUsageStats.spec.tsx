import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSmogonUsageStats } from '../../src/hooks/useSmogonUsageStats';

/** A data.pkmn.cc stats file: fractional shares per species. */
const statsFile = (species: Record<string, { moves: Record<string, number>; items?: Record<string, number> }>) => ({
  pokemon: Object.fromEntries(Object.entries(species).map(([name, entry]) => [name, {
    count: 1000, abilities: { Pressure: 1 }, items: entry.items ?? { Leftovers: 0.8 }, moves: entry.moves, spreads: { 'Jolly:0/252/0/0/4/252': 0.6 },
  }])),
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const missing = () => new Response('', { status: 404 });

/** Answers the stats files by their path below the host; everything else is absent. */
function stubStats(files: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(files).find(([path]) => url.endsWith(path));
    return hit ? json(hit[1]) : missing();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// The stats fetcher caches per format for the life of the module, so every
// test below reads a different format.
describe('useSmogonUsageStats', () => {
  test('without a format nothing loads', () => {
    const fetchMock = stubStats({});
    const { result } = renderHook(() => useSmogonUsageStats(undefined));
    expect(result.current).toEqual({ stats: null, loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('loads the format file, parses it, and fills missing species from the generation fallbacks', async () => {
    stubStats({
      '/stats/gen8ou.json': statsFile({ Garchomp: { moves: { Earthquake: 0.9, 'Scale Shot': 0.5 } } }),
      '/stats/gen8ubers.json': statsFile({ Garchomp: { moves: { 'Dragon Claw': 1 } }, Kyogre: { moves: { 'Origin Pulse': 0.95 } } }),
    });
    const { result } = renderHook(() => useSmogonUsageStats('gen8ou'));
    expect(result.current).toMatchObject({ formatid: 'gen8ou', stats: null, loading: true, error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    const stats = result.current.stats!;
    expect(stats.format).toBe('gen8ou');
    // The format's own file wins for Garchomp; Ubers only adds the species OU lacks.
    expect(stats.pokemon.garchomp.moves.map(move => move.value)).toEqual(['Earthquake', 'Scale Shot']);
    expect(stats.pokemon.garchomp.moves[0].probability).toBe(0.9);
    expect(stats.pokemon.kyogre.moves[0]).toMatchObject({ value: 'Origin Pulse', probability: 0.95 });
  });

  test('formats without a stats file read their generation\'s OU', async () => {
    const fetchMock = stubStats({ '/stats/gen5ou.json': statsFile({ Excadrill: { moves: { Earthquake: 1 } } }) });
    const { result } = renderHook(() => useSmogonUsageStats('gen5customgame'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats?.pokemon.excadrill).toBeDefined();
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toContain('https://data.pkmn.cc/stats/gen5ou.json');
  });

  test('a VGC format reads the year file and fills from the doubles ladder', async () => {
    const fetchMock = stubStats({
      '/stats/gen9vgc2026.json': statsFile({ Incineroar: { moves: { 'Fake Out': 0.99 } } }),
      '/stats/gen9doublesou.json': statsFile({ Amoonguss: { moves: { Spore: 0.9 } } }),
    });
    const { result } = renderHook(() => useSmogonUsageStats('gen9vgc2026regi'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.keys(result.current.stats?.pokemon ?? {}).sort()).toEqual(['amoonguss', 'incineroar']);
    const paths = fetchMock.mock.calls.map(call => new URL(String(call[0])).pathname.replace(/^\/smogon\/data/, ''));
    expect(paths.slice(0, 2)).toEqual(['/stats/gen9vgc2026.json', '/stats/gen9doublesou.json']);
  });

  test('when every source is absent the error names it', async () => {
    stubStats({});
    const { result } = renderHook(() => useSmogonUsageStats('gen7ou'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ stats: null, error: 'No Smogon usage stats found for this format' });
  });

  test('an unreachable network reads the same as an absent file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useSmogonUsageStats('gen6ou'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('No Smogon usage stats found for this format');
  });

  test('a format change reads as loading at once and lands on the new file', async () => {
    stubStats({
      '/stats/gen4ou.json': statsFile({ Heatran: { moves: { 'Magma Storm': 0.7 } } }),
      '/stats/gen3ou.json': statsFile({ Skarmory: { moves: { Spikes: 0.9 } } }),
    });
    const { result, rerender } = renderHook((formatid: string) => useSmogonUsageStats(formatid), { initialProps: 'gen4ou' });
    await waitFor(() => expect(result.current.stats?.pokemon.heatran).toBeDefined());
    rerender('gen3ou');
    expect(result.current).toMatchObject({ formatid: 'gen3ou', loading: true, stats: null });
    await waitFor(() => expect(result.current.stats?.pokemon.skarmory).toBeDefined());
    expect(result.current.stats?.pokemon.heatran).toBeUndefined();
  });
});
