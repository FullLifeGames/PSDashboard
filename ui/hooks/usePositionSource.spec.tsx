import { describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, serializeLiveBattle } from '@fulllifegames/eval-engine';
import { usePositionSource } from '../../src/hooks/usePositionSource';
import type { TeamBuildSources } from '../../src/lib/eval-acquire';
import type { ReconstructOutcome, ReplayJobRequest, ReplayJobResponse } from '../../src/lib/replay-jobs/types';
import { replayFixture } from '../fixtures/replay';
import { fakeReplayWorkerClient } from '../fixtures/worker';

type Inputs = Parameters<typeof usePositionSource>[0];

const { replayData, snapshots, observations } = replayFixture('singles');

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

const outcome = (overrides: Partial<ReconstructOutcome> = {}): ReconstructOutcome => ({
  serialized: 'pos-final', log: [], invalid: null, reached: true, ended: false, turn: 3, timedOut: false, haxAlignment: [],
  choiceErrors: { count: 0, last: null }, ...overrides,
});

/** A worker that streams one position per boundary and lands on the target turn; `final` overrides the outcome. */
function streamingWorker(final: (job: ReplayJobRequest) => Partial<ReconstructOutcome> = () => ({})) {
  return fakeReplayWorkerClient((request): ReplayJobResponse[] => {
    if (request.type !== 'reconstruct') return [];
    const target = request.job.targetTurn;
    const positions: ReplayJobResponse[] = [];
    for (let turn = 1; turn < target; turn += 1) positions.push({ type: 'replayPosition', id: request.id, turn, serialized: `pos-${turn}` });
    return [...positions, { type: 'reconstructResult', id: request.id, outcome: outcome({ serialized: `pos-${target}`, turn: target, ...final(request) }) }];
  });
}

function inputs(client: ReturnType<typeof fakeReplayWorkerClient>['client'], overrides: Partial<Inputs> = {}): Inputs {
  return { replayData, snapshots, observations, sources, setsFingerprint: 'fp1', bringOnlyLists: null, smogonPending: false, replayWorker: client, ...overrides };
}

describe('usePositionSource', () => {
  test('warms the worker once a replay is loaded and keys positions by replay, turn, and set knowledge', () => {
    const { client, spawnCount } = streamingWorker();
    const { result } = renderHook(() => usePositionSource(inputs(client)));
    expect(spawnCount()).toBe(1);
    expect(result.current.exactKeyFor(3)).toBe(`${replayData.id}:3:fp1`);
    expect(result.current.getExact(3)).toBeNull();
    expect(result.current.sweepAlignment).toBeNull();
  });

  test('acquireExact reconstructs in the worker once and answers from the store after that', async () => {
    const { client, requests } = streamingWorker();
    const { result } = renderHook(() => usePositionSource(inputs(client)));
    const report = vi.fn();
    await expect(result.current.acquireExact(3, report)).resolves.toBe('pos-3');

    expect(requests).toHaveLength(1);
    const job = (requests[0] as Extract<ReplayJobRequest, { type: 'reconstruct' }>).job;
    expect(job).toMatchObject({ format: getBranchSimulatorFormat(replayData), targetTurn: 3, mode: 'replay', replayLog: replayData.log, bringOnly: null });
    expect(job.p1Team.length).toBeGreaterThan(0);

    // The streamed boundaries and the target are stored; a second acquire never reaches the worker.
    await waitFor(() => expect(result.current.getExact(2)).toBe('pos-2'));
    expect(result.current.getExact(3)).toBe('pos-3');
    await expect(result.current.acquireExact(3, report)).resolves.toBe('pos-3');
    expect(requests).toHaveLength(1);
    await waitFor(() => expect(result.current.exactPositionsVersion).toBeGreaterThan(0));
  }, 30_000);

  test('a divergence, an invalid position, and a worker error reject with their reasons', async () => {
    const diverged = streamingWorker(() => ({ reached: false }));
    const one = renderHook(() => usePositionSource(inputs(diverged.client)));
    await expect(one.result.current.acquireExact(4, vi.fn())).rejects.toThrow(/diverged before turn 4/);
    expect(one.result.current.getExact(4)).toBeNull();

    const invalid = streamingWorker(() => ({ invalid: 'Team validation failed' }));
    const two = renderHook(() => usePositionSource(inputs(invalid.client)));
    await expect(two.result.current.acquireExact(2, vi.fn())).rejects.toThrow('Team validation failed');

    const crashed = fakeReplayWorkerClient(request => [{ type: 'replayError', id: request.id, message: 'worker crashed' }]);
    const three = renderHook(() => usePositionSource(inputs(crashed.client)));
    await expect(three.result.current.acquireExact(2, vi.fn())).rejects.toThrow('worker crashed');
  }, 30_000);

  test('new set knowledge empties the store; positions built while the Smogon data loads are not kept', async () => {
    const { client } = streamingWorker();
    const { result, rerender } = renderHook((props: Inputs) => usePositionSource(props), { initialProps: inputs(client) });
    await result.current.acquireExact(2, vi.fn());
    expect(result.current.getExact(2)).toBe('pos-2');

    rerender(inputs(client, { setsFingerprint: 'fp2' }));
    expect(result.current.getExact(2)).toBeNull();

    rerender(inputs(client, { setsFingerprint: 'fp2', smogonPending: true }));
    await result.current.acquireExact(2, vi.fn());
    expect(result.current.getExact(2)).toBeNull();
  }, 30_000);

  test('acquireAll streams every boundary in order, records the sim alignment, and names an early end', async () => {
    const alignment = [{ turn: 1 }] as unknown as ReconstructOutcome['haxAlignment'];
    const { client } = streamingWorker(() => ({ haxAlignment: alignment }));
    const { result } = renderHook(() => usePositionSource(inputs(client)));
    const seen: number[] = [];
    const positions = await result.current.acquireAll(3, vi.fn(), turn => seen.push(turn));
    expect(positions).toEqual(['pos-1', 'pos-2', 'pos-3']);
    expect(seen).toEqual([1, 2, 3]);
    await waitFor(() => expect(result.current.sweepAlignment).toBe(alignment));

    const early = streamingWorker(() => ({ ended: true, turn: 2 }));
    const short = renderHook(() => usePositionSource(inputs(early.client)));
    const onDiagnostic = vi.fn();
    await short.result.current.acquireAll(5, vi.fn(), undefined, onDiagnostic);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.stringMatching(/ended at turn 2 although the real game continued/));
  }, 30_000);

  test('acquireRuntime adopts a stored position as a live branch and stores a fresh worker result', async () => {
    const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
    const format = getBranchSimulatorFormat(replayData);
    const live = await reconstructBranchRuntime({ format, p1Team, p2Team, replayLog: replayData.log, targetTurn: 2, snapshot: snapshots[1] ?? null });
    const serialized = serializeLiveBattle(live.battleStream.battle!);

    const { client, requests } = fakeReplayWorkerClient(request => (request.type === 'reconstruct'
      ? [{ type: 'reconstructResult', id: request.id, outcome: outcome({ serialized, turn: 2 }) }]
      : []));
    const { result } = renderHook(() => usePositionSource(inputs(client)));
    const params = { format, p1Team, p2Team, replayLog: replayData.log, targetTurn: 2, snapshot: snapshots[1] ?? null };

    const fromWorker = await result.current.acquireRuntime(params, { isT0: false });
    expect(fromWorker.battleStream.battle?.turn).toBe(2);
    expect(requests).toHaveLength(1);
    await waitFor(() => expect(result.current.getExact(2)).toBe(serialized));

    const fromStore = await result.current.acquireRuntime(params, { isT0: false });
    expect(fromStore.battleStream.battle?.turn).toBe(2);
    expect(requests).toHaveLength(1);
  }, 60_000);
});
