import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSmogonSetAssumptions } from '../../src/hooks/useSmogonSetAssumptions';

/** A data.pkmn.cc sets file: named sets per species. */
const setsFile = {
  Garchomp: {
    'Swords Dance': { ability: 'Rough Skin', item: 'Loaded Dice', moves: ['Swords Dance', 'Scale Shot', 'Earthquake', 'Fire Fang'], nature: 'Jolly', evs: { atk: 252, spe: 252, spd: 4 } },
    'Choice Scarf': { ability: 'Rough Skin', item: 'Choice Scarf', moves: ['Earthquake', 'Outrage', 'Stone Edge', 'Fire Fang'], nature: 'Jolly', evs: { atk: 252, spe: 252, spd: 4 } },
  },
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const missing = () => new Response('', { status: 404 });

function stubSets(files: Record<string, unknown>) {
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

// The sets fetcher caches per format and species list for the life of the
// module, so every test below reads a different format.
describe('useSmogonSetAssumptions', () => {
  test('without a format or without species nothing loads', () => {
    const fetchMock = stubSets({});
    const noFormat = renderHook(() => useSmogonSetAssumptions(undefined, ['Garchomp']));
    const noSpecies = renderHook(() => useSmogonSetAssumptions('gen9ou', []));
    expect(noFormat.result.current).toEqual({ assumptions: null, loading: false, error: null });
    expect(noSpecies.result.current).toEqual({ assumptions: null, loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('loads the published sets and normalizes the first one per species, the rest as alternatives', async () => {
    stubSets({ '/sets/gen9ou.json': setsFile });
    const { result } = renderHook(() => useSmogonSetAssumptions('gen9ou', ['Garchomp', 'Heatran']));
    expect(result.current).toMatchObject({ assumptions: null, loading: true, error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    const garchomp = result.current.assumptions!.pokemon.garchomp;
    expect(garchomp.ability?.value).toBe('Rough Skin');
    expect(garchomp.item?.value).toBe('Loaded Dice');
    expect(garchomp.moves.map(move => move.value)).toEqual(['Swords Dance', 'Scale Shot', 'Earthquake', 'Fire Fang']);
    expect(garchomp.spread).toMatchObject({ nature: 'Jolly', value: 'Jolly:0/252/0/0/4/252' });
    expect(garchomp.alternatives?.[0].item?.value).toBe('Choice Scarf');
    // No published set is absence, not failure.
    expect(result.current.assumptions!.pokemon.heatran).toBeUndefined();
  });

  test('a format without any published set resolves to null without an error', async () => {
    stubSets({});
    const { result } = renderHook(() => useSmogonSetAssumptions('gen8ou', ['Garchomp']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ assumptions: null, error: null });
  });

  test('an unreachable network surfaces as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useSmogonSetAssumptions('gen7ou', ['Garchomp']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assumptions).toBeNull();
    expect(result.current.error).toMatch(/Smogon sets unavailable/);
  });

  test('a species change reads as loading at once', async () => {
    stubSets({ '/sets/gen6ou.json': setsFile });
    const { result, rerender } = renderHook((species: string[]) => useSmogonSetAssumptions('gen6ou', species), { initialProps: ['Garchomp'] });
    await waitFor(() => expect(result.current.assumptions?.pokemon.garchomp).toBeDefined());
    rerender(['Garchomp', 'Heatran']);
    expect(result.current).toMatchObject({ loading: true, assumptions: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.assumptions?.pokemon.garchomp).toBeDefined();
  });
});
