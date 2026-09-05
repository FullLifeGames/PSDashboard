import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SmogonUsageStats, SpreadCandidate } from '@fulllifegames/replay-core';
import { useHpResolver, useSheetTeams, useSpreadSolve, useTeamPaste } from '../../src/hooks/useTeamSources';
import type { useSmogonSetAssumptions } from '../../src/hooks/useSmogonSetAssumptions';
import type { useSmogonUsageStats } from '../../src/hooks/useSmogonUsageStats';
import { replayFixture } from '../fixtures/replay';
import { fakeReplayWorkerClient } from '../fixtures/worker';

const PASTE_KEY = 'ps-replay-interceptor:team-paste';

const EXPORT = [
  'Garchomp @ Loaded Dice', 'Ability: Rough Skin', 'EVs: 252 Atk / 4 SpD / 252 Spe', 'Jolly Nature',
  '- Swords Dance', '- Scale Shot', '- Earthquake', '- Fire Fang', '',
  'Heatran @ Leftovers', 'Ability: Flash Fire', 'EVs: 252 HP / 4 SpD / 252 Spe', 'Timid Nature',
  '- Magma Storm', '- Earth Power', '- Taunt', '- Stealth Rock',
].join('\n');

const usage = (stats: SmogonUsageStats | null = null, loading = false): ReturnType<typeof useSmogonUsageStats> => ({ stats, loading, error: null });
const sets = (loading = false): ReturnType<typeof useSmogonSetAssumptions> => ({ assumptions: null, loading, error: null });

describe('useTeamPaste', () => {
  test('starts empty, reads a Showdown export, and remembers it for the next visit', () => {
    const { result } = renderHook(() => useTeamPaste());
    expect(result.current).toMatchObject({ teamText: '', pastedSets: null, teamPasteParseError: null });

    act(() => result.current.handleTeamLoad(EXPORT));
    expect(result.current.pastedSets?.map(set => set.species)).toEqual(['Garchomp', 'Heatran']);
    expect(result.current.teamText).toContain('Garchomp @ Loaded Dice');
    expect(result.current.teamPasteParseError).toBeNull();
    expect(localStorage.getItem(PASTE_KEY)).toContain('Garchomp');

    const again = renderHook(() => useTeamPaste());
    expect(again.result.current.pastedSets?.map(set => set.species)).toEqual(['Garchomp', 'Heatran']);
  });

  test('text without a readable set is refused; an empty paste clears everything', () => {
    const { result } = renderHook(() => useTeamPaste());
    act(() => result.current.handleTeamLoad(EXPORT));
    act(() => result.current.handleTeamLoad('just some words'));
    expect(result.current.teamPasteParseError).toMatch(/Could not read any Pokémon sets/);
    expect(result.current.pastedSets).toHaveLength(2);

    act(() => result.current.handleTeamLoad('   '));
    expect(result.current).toMatchObject({ teamText: '', pastedSets: null, teamPasteParseError: null });
    expect(localStorage.getItem(PASTE_KEY)).toBeNull();
  });
});

describe('useHpResolver', () => {
  const manectric: SmogonUsageStats = {
    format: 'gen6ou', month: 'test', source: 'test',
    pokemon: { manectric: { species: 'Manectric', rawCount: 100, abilities: [], items: [], spreads: [], moves: [
      { value: 'hiddenpowerice', probability: 0.6, sourceDetail: 'test' }, { value: 'hiddenpowergrass', probability: 0.3, sourceDetail: 'test' },
    ] } },
  };
  const gen6 = { ...replayFixture('singles').replayData, log: '|gen|6\n|tier|[Gen 6] OU\n|turn|1' };

  test('reads the generation off the log and resolves Hidden Power once the module is loaded', async () => {
    const evidence = [{ attackerSide: 'p1' as const, attackerSpecies: 'Manectric', defenderSpecies: 'Skarmory', marker: 'resisted' as const }];
    const { result } = renderHook(() => useHpResolver(gen6, evidence, usage(manectric)));
    expect(result.current.replayGenNumber).toBe(6);
    expect(result.current.hpResolverFor('p1')).toBeUndefined();
    await waitFor(() => expect(result.current.hpResolverFor('p1')).toBeDefined());
    // p1's evidence rules Ice out; p2 has no evidence and takes the usage top.
    expect(result.current.hpResolverFor('p1')!('Manectric')).toBe('Hidden Power Grass');
    expect(result.current.hpResolverFor('p2')!('Manectric')).toBe('Hidden Power Ice');
  });

  test('without a replay the generation defaults to 9 and nothing loads', () => {
    const { result } = renderHook(() => useHpResolver(null, [], usage()));
    expect(result.current.replayGenNumber).toBe(9);
    expect(result.current.hpResolverFor('p1')).toBeUndefined();
  });
});

describe('useSpreadSolve', () => {
  const { replayData, observations, speedOrders } = replayFixture('singles');
  const candidate: SpreadCandidate = { evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, nature: 'Jolly' };
  const worker = () => fakeReplayWorkerClient(request => (request.type === 'solveSpreads'
    ? [{ type: 'solveSpreadsResult', id: request.id, entries: [['p1:garchomp', candidate]] }]
    : []));
  type Inputs = Parameters<typeof useSpreadSolve>[0];
  const inputs = (client: Inputs['replayWorker'], overrides: Partial<Inputs> = {}): Inputs => ({
    replayData, observations, speedOrders, teamText: '', effectiveP1Info: null, effectiveP2Info: null,
    usageStats: usage(), setAssumptions: sets(), replayWorker: client, ...overrides,
  });

  test('solves in the worker once per input set and keeps the solution', async () => {
    const { client, requests } = worker();
    const props = inputs(client);
    const { result } = renderHook(() => useSpreadSolve(props));
    expect(observations.length + speedOrders.length).toBeGreaterThan(0);
    const solved = await result.current.getInferredSpreads();
    expect(solved?.get('p1:garchomp')).toEqual(candidate);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ type: 'solveSpreads', job: { log: replayData.log, userTeamText: undefined } });
    await waitFor(() => expect(result.current.solvedSpreads?.get('p1:garchomp')).toEqual(candidate));

    await result.current.getInferredSpreads();
    expect(requests).toHaveLength(1);
    // cachedOnly hands the standing solution out and never starts one.
    await expect(result.current.getInferredSpreads(undefined, undefined, { cachedOnly: true })).resolves.toBe(solved);
  });

  test('never starts a solve while the Smogon data loads, with nothing to fit, or in cached-only mode without a cache', async () => {
    const { client, requests } = worker();
    const loading = renderHook(() => useSpreadSolve(inputs(client, { usageStats: usage(null, true) })));
    await expect(loading.result.current.getInferredSpreads()).resolves.toBeUndefined();
    const cachedOnly = renderHook(() => useSpreadSolve(inputs(client)));
    await expect(cachedOnly.result.current.getInferredSpreads(undefined, undefined, { cachedOnly: true })).resolves.toBeUndefined();
    const nothing = renderHook(() => useSpreadSolve(inputs(client, { observations: [], speedOrders: [] })));
    await expect(nothing.result.current.getInferredSpreads()).resolves.toBeUndefined();
    expect(requests).toHaveLength(0);
  });

  test('a new replay drops the solution', async () => {
    const { client } = worker();
    const { result, rerender } = renderHook((props: Inputs) => useSpreadSolve(props), { initialProps: inputs(client) });
    await result.current.getInferredSpreads();
    await waitFor(() => expect(result.current.solvedSpreads).not.toBeNull());
    rerender(inputs(client, { replayData: { ...replayData, id: 'other' } }));
    expect(result.current.solvedSpreads).toBeNull();
  });
});

describe('useSheetTeams', () => {
  test('chat-posted team sheets become built sets; a replay without sheets yields none', async () => {
    const doubles = replayFixture('doubles').replayData;
    const { result, rerender } = renderHook((replay: typeof doubles | null) => useSheetTeams(replay), { initialProps: doubles });
    await waitFor(() => expect(result.current.p1).not.toBeNull());
    expect(result.current.p1?.map(set => set.species)).toEqual(['Pikachu', 'Eevee', 'Raichu', 'Jolteon']);
    expect(result.current.p2?.[0]).toMatchObject({ species: 'Bulbasaur', item: 'Eviolite' });

    rerender(replayFixture('singles').replayData);
    expect(result.current).toEqual({ p1: null, p2: null });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(result.current).toEqual({ p1: null, p2: null });
  });
});
