import { describe, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime, serializeLiveBattle, type BringWorld } from '@fulllifegames/eval-engine';
import { usePositionSource } from '../../../src/hooks/usePositionSource';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import type { ReconstructOutcome, ReplayJobRequest, ReplayJobResponse } from '../../../src/lib/replay-jobs/types';
import { clearWorldPositions, worldPositionsOf } from '../../../src/lib/eval/world-positions';
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

  // Round 79 (T290): only a sweep that asks gets the replacement requests, and they reach its callback with the point intact.
  test('acquireAll asks the worker for the replacement requests only when it has a consumer, and hands them on', async () => {
    const point = { turn: 1, ordinal: 0, forced: { p1: [0], p2: [] }, played: { p1: ['Toxapex'], p2: [] } };
    const { client, requests } = fakeReplayWorkerClient((request): ReplayJobResponse[] => (request.type === 'reconstruct'
      ? [
        { type: 'replayPosition', id: request.id, turn: 1, serialized: 'pos-1' },
        { type: 'replayReplacement', id: request.id, point, serialized: 'request-1' },
        { type: 'reconstructResult', id: request.id, outcome: outcome({ serialized: 'pos-2', turn: 2 }) },
      ]
      : []));
    const { result } = renderHook(() => usePositionSource(inputs(client)));
    const asked: [unknown, string][] = [];
    await result.current.acquireAll(2, vi.fn(), undefined, undefined, (received, serialized) => asked.push([received, serialized]));
    expect(asked).toEqual([[point, 'request-1']]);
    expect((requests.at(-1) as { job: { replacements?: boolean } }).job.replacements).toBe(true);

    await result.current.acquireAll(2, vi.fn());
    expect((requests.at(-1) as { job: { replacements?: boolean } }).job.replacements).toBeUndefined();
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

/**
 * Round 89 (#124): a short-side game plays every world of its unknown bodies. The position source reconstructs each world's main line,
 * hands out the heaviest world's positions, and registers the siblings of each one (the worker client reads them) before it hands
 * the position out. A sibling's position never enters the exact store. A game with one world or none reconstructs once and registers nothing.
 */
describe('usePositionSource with the worlds of a short side', () => {
  const world = (guess: string, weight: number): BringWorld =>
    ({ p1: ['Alpha', 'Beta', guess], p2: ['Gamma', 'Delta', 'Eps'], guessed: { p1: 1, p2: 0 }, weight });
  const WORLDS = [world('K', 0.6), world('N', 0.3), world('R', 0.1)];
  const guessOf = (request: ReplayJobRequest) => (request as Extract<ReplayJobRequest, { type: 'reconstruct' }>).job.bringOnly?.p1.at(-1) ?? 'none';

  /** A worker whose positions name their world: `pos-<turn>-<guess>`; a world named in `failing` answers with an error. */
  function worldWorker(failing: string[] = [], points: ReplayJobResponse[] = []) {
    return fakeReplayWorkerClient((request): ReplayJobResponse[] => {
      if (request.type !== 'reconstruct') return [];
      const guess = guessOf(request);
      if (failing.includes(guess)) return [{ type: 'replayError', id: request.id, message: `world ${guess} failed` }];
      const target = request.job.targetTurn;
      const streamed: ReplayJobResponse[] = [];
      for (let turn = 1; turn < target; turn += 1) streamed.push({ type: 'replayPosition', id: request.id, turn, serialized: `pos-${turn}-${guess}` });
      const asked = request.job.replacements ? points.map(point => ({ ...point, id: request.id, serialized: `${(point as { serialized: string }).serialized}-${guess}` })) : [];
      return [...streamed, ...(asked as ReplayJobResponse[]), { type: 'reconstructResult', id: request.id, outcome: outcome({ serialized: `pos-${target}-${guess}`, turn: target }) }];
    });
  }
  const withWorlds = (client: ReturnType<typeof fakeReplayWorkerClient>['client'], worlds: BringWorld[] | null = WORLDS) =>
    inputs(client, { bringOnlyLists: worlds ? { p1: worlds[0].p1, p2: worlds[0].p2, guessed: worlds[0].guessed } : null, bringWorlds: worlds });
  const registered = (position: string) => worldPositionsOf(position)?.map(entry => [entry.position, entry.weight]);

  test('acquireAll reconstructs every world, registers the siblings of each turn before handing it out, and stores only the heaviest world', async () => {
    clearWorldPositions();
    const { client, requests } = worldWorker();
    const { result } = renderHook(() => usePositionSource(withWorlds(client)));
    const seen: [number, [string, number][] | undefined][] = [];
    const positions = await result.current.acquireAll(3, vi.fn(), (turn, serialized) => seen.push([turn, registered(serialized) as [string, number][] | undefined]));

    expect(requests.map(guessOf)).toEqual(['N', 'R', 'K']);
    expect(positions).toEqual(['pos-1-K', 'pos-2-K', 'pos-3-K']);
    expect(seen).toEqual([1, 2, 3].map(turn => [turn, [[`pos-${turn}-K`, 0.6], [`pos-${turn}-N`, 0.3], [`pos-${turn}-R`, 0.1]]]));
    await waitFor(() => expect(result.current.getExact(2)).toBe('pos-2-K'));
    expect(result.current.getExact(3)).toBe('pos-3-K');
    expect(worldPositionsOf('pos-2-N')).toBeNull();
  }, 30_000);

  test('a world that fails drops out of every turn and the rest stay weighted', async () => {
    clearWorldPositions();
    const { client } = worldWorker(['N']);
    const { result } = renderHook(() => usePositionSource(withWorlds(client)));
    await result.current.acquireAll(2, vi.fn());
    expect(registered('pos-1-K')).toEqual([['pos-1-K', 0.6], ['pos-1-R', 0.1]]);
    expect(registered('pos-2-K')).toEqual([['pos-2-K', 0.6], ['pos-2-R', 0.1]]);
  }, 30_000);

  test('the replacement requests of the knockouts register their siblings by turn and ordinal', async () => {
    clearWorldPositions();
    const point = { turn: 1, ordinal: 0, forced: { p1: [0], p2: [] }, played: { p1: ['Toxapex'], p2: [] } };
    const { client } = worldWorker([], [{ type: 'replayReplacement', point, serialized: 'request-1' } as unknown as ReplayJobResponse]);
    const { result } = renderHook(() => usePositionSource(withWorlds(client)));
    const asked: string[] = [];
    await result.current.acquireAll(2, vi.fn(), undefined, undefined, (_, serialized) => asked.push(serialized));
    expect(asked).toEqual(['request-1-K']);
    expect(registered('request-1-K')).toEqual([['request-1-K', 0.6], ['request-1-N', 0.3], ['request-1-R', 0.1]]);
  }, 30_000);

  test('acquireExact registers the siblings of the turn, also for a position the store already holds', async () => {
    clearWorldPositions();
    const { client, requests } = worldWorker();
    const { result } = renderHook(() => usePositionSource(withWorlds(client)));
    // The branch start stores the heaviest world's position of its turn without siblings (`acquireRuntime`).
    result.current.storeExactPosition(2, 'pos-2-K');
    expect(worldPositionsOf('pos-2-K')).toBeNull();
    await expect(result.current.acquireExact(2, vi.fn())).resolves.toBe('pos-2-K');
    expect(requests.map(guessOf)).toEqual(['N', 'R']);
    expect(registered('pos-2-K')).toEqual([['pos-2-K', 0.6], ['pos-2-N', 0.3], ['pos-2-R', 0.1]]);
    // A second acquire finds them registered and asks for nothing.
    requests.length = 0;
    await result.current.acquireExact(2, vi.fn());
    expect(requests).toHaveLength(0);
  }, 30_000);

  test('acquireExact on a cold store reconstructs the siblings first and registers the heaviest position with them', async () => {
    clearWorldPositions();
    const { client, requests } = worldWorker();
    const { result } = renderHook(() => usePositionSource(withWorlds(client)));
    await expect(result.current.acquireExact(3, vi.fn())).resolves.toBe('pos-3-K');
    expect(requests.map(guessOf)).toEqual(['N', 'R', 'K']);
    expect(registered('pos-3-K')).toEqual([['pos-3-K', 0.6], ['pos-3-N', 0.3], ['pos-3-R', 0.1]]);
    expect(registered('pos-2-K')).toEqual([['pos-2-K', 0.6], ['pos-2-N', 0.3], ['pos-2-R', 0.1]]);
  }, 30_000);

  test('other worlds (the statistics moved the heaviest guess) empty the store, whose positions were built on the old list', async () => {
    clearWorldPositions();
    const { client } = worldWorker();
    const { result, rerender } = renderHook((props: Inputs) => usePositionSource(props), { initialProps: withWorlds(client) });
    await result.current.acquireExact(2, vi.fn());
    expect(result.current.getExact(2)).toBe('pos-2-K');
    rerender(withWorlds(client, [world('N', 0.7), world('K', 0.3)]));
    expect(result.current.getExact(2)).toBeNull();
    rerender(withWorlds(client, [world('N', 0.7), world('K', 0.3)]));
    await expect(result.current.acquireExact(2, vi.fn())).resolves.toBe('pos-2-N');
  }, 30_000);

  test('a game with no short side, or one world, reconstructs once and registers nothing', async () => {
    clearWorldPositions();
    for (const worlds of [null, [world('K', 1)]]) {
      const { client, requests } = worldWorker();
      const { result } = renderHook(() => usePositionSource(withWorlds(client, worlds)));
      await result.current.acquireAll(2, vi.fn());
      expect(requests).toHaveLength(1);
      expect(worldPositionsOf('pos-1-' + (worlds ? 'K' : 'none'))).toBeNull();
    }
  }, 30_000);
});
