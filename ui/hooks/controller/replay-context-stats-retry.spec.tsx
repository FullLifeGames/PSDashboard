import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReplayData } from '@fulllifegames/replay-core';
import { singlesReplay } from '../../fixtures/replay';
import { realReplayWorkerClient } from '../../fixtures/worker';

// The context runs its real hooks; the replay worker is the real job handler
// on this thread, and the network serves the fixture replays and, once it is
// back, the format's usage stats.
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../src/hooks/controller/replay-context');

const statsFile = { pokemon: { Garchomp: { count: 1000, abilities: { 'Rough Skin': 1 }, items: { Leftovers: 1 }, moves: { Earthquake: 1 }, spreads: { 'Jolly:0/252/0/0/4/252': 1 } } } };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Replays by id; the Smogon hosts fail like a dropped connection until `online` is set. */
function stubNetwork(replays: ReplayData[], network: { online: boolean }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const replay = replays.find(entry => url.includes(`/${entry.id}`));
    if (replay && url.includes('replay.pokemonshowdown.com')) return json(replay);
    if (!network.online) throw new TypeError('Failed to fetch');
    return url.endsWith('/stats/gen9ou.json') ? json(statsFile) : new Response('', { status: 404 });
  }));
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReplayContext usage stats after a network blip (T68)', () => {
  test('the next replay of the same format loads the stats the first one could not reach', async () => {
    const first = singlesReplay();
    const second = { ...singlesReplay(), id: `${first.id}-again` };
    const network = { online: false };
    stubNetwork([first, second], network);
    const { result } = renderHook(() => useReplayContext());

    await act(async () => { await result.current.replay.loadReplay(first.id); });
    await waitFor(() => expect(result.current.smogon.usageStats.loading).toBe(false));
    expect(result.current.smogon.usageStats.error).toMatch(/No Smogon usage stats/);

    network.online = true;
    await act(async () => { await result.current.replay.loadReplay(second.id); });
    expect(result.current.replay.replayData?.formatid).toBe(first.formatid);
    await waitFor(() => expect(result.current.smogon.usageStats.stats?.pokemon.garchomp).toBeDefined());
    expect(result.current.smogon.usageStats.error).toBeNull();
  });
});
