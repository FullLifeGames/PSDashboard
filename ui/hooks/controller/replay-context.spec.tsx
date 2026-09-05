import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { doublesReplay, singlesReplay } from '../../fixtures/replay';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';

// The context runs its real hooks; the replay worker is the real job handler
// on this thread, and the network serves the fixture replays only.
const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../src/hooks/controller/replay-context');

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay(), doublesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useReplayContext', () => {
  test('starts with every section in its neutral state', () => {
    const { result } = renderHook(() => useReplayContext());
    const ctx = result.current;
    expect(ctx.replay.replayData).toBeNull();
    expect(ctx.replay.loadedReplayUrl).toBeNull();
    expect(ctx.replay.embed).toBe(false);
    expect(ctx.branch.branching).toBe(false);
    expect(ctx.evaluation.status).toBe('idle');
    expect(ctx.smogon.usageStats).toEqual({ stats: null, loading: false, error: null });
    expect(ctx.shared.sharedBranch).toBeNull();
    expect(ctx.refreshQueue.pendingBranchRefresh).toBeNull();
    expect(ctx.knowledge.effectiveP1Info).toBeNull();
    expect(ctx.meta).toEqual({ replayGen: 9, bringCount: null, bringOnlyLists: null, replayGameType: null, evalIsDoubles: false });
    expect(ctx.animateBranchTurns).toBe(true);
    expect(ctx.branchWindowOpenRef.current).toBe(false);
    expect(ctx.positions.getExact(1)).toBeNull();
  });

  test('a loaded replay fills the meta, the team knowledge, and the sources; the Smogon data settles as absent', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useReplayContext());
    await act(async () => { await result.current.replay.loadReplay(replay.id); });

    const ctx = result.current;
    expect(ctx.replay.replayData?.id).toBe(replay.id);
    expect(ctx.replay.loadedReplayUrl).toBe(`https://replay.pokemonshowdown.com/${replay.id}`);
    expect(ctx.replay.snapshots.length).toBeGreaterThan(1);
    expect(ctx.meta.replayGameType).toBe('singles');
    expect(ctx.meta.evalIsDoubles).toBe(false);
    expect(ctx.knowledge.effectiveP1Info?.pokemon.length).toBeGreaterThan(0);
    expect(ctx.teamSources.effectiveP2Info).toBe(ctx.knowledge.effectiveP2Info);
    expect(ctx.positions.exactKeyFor(2)).toBe(`${replay.id}:2:${ctx.knowledge.setsFingerprint}`);

    await waitFor(() => expect(result.current.smogon.usageStats.loading).toBe(false));
    expect(result.current.smogon.usageStats.error).toMatch(/No Smogon usage stats/);
    await waitFor(() => expect(result.current.smogon.setAssumptions.loading).toBe(false));
  });

  test('a doubles replay reads as doubles for the evaluation', async () => {
    const replay = doublesReplay();
    const { result } = renderHook(() => useReplayContext());
    await act(async () => { await result.current.replay.loadReplay(replay.id); });
    expect(result.current.meta.replayGameType).toBe('doubles');
    expect(result.current.meta.evalIsDoubles).toBe(true);
  });

  test('team edits queue a branch refresh only while a branch window is open', async () => {
    const { result } = renderHook(() => useReplayContext());
    await act(async () => { await result.current.replay.loadReplay(singlesReplay().id); });
    const teams = { p1: result.current.knowledge.effectiveP1Info!, p2: result.current.knowledge.effectiveP2Info! };
    act(() => result.current.refreshQueue.handleTeamsEdited(teams));
    expect(result.current.refreshQueue.pendingBranchRefresh).toBeNull();

    result.current.branchWindowOpenRef.current = true;
    act(() => result.current.refreshQueue.handleTeamsEdited(teams));
    expect(result.current.refreshQueue.pendingBranchRefresh).toMatchObject({ p1Info: teams.p1, p2Info: teams.p2, history: [], p1Choices: [], p2Choices: [] });
    act(() => result.current.refreshQueue.clearRefreshRequest());
    expect(result.current.refreshQueue.pendingBranchRefresh).toBeNull();
  });

  test('opening the original of a shared branch clears the share and loads the replay', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useReplayContext());
    await act(async () => { result.current.shared.handleLoadSharedOriginal(replay.id); });
    await waitFor(() => expect(result.current.replay.replayData?.id).toBe(replay.id));
    expect(result.current.shared.sharedBranch).toBeNull();
    act(() => result.current.setAnimateBranchTurns(false));
    expect(result.current.animateBranchTurns).toBe(false);
  });
});
