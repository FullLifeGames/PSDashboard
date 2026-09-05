import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildTeamsFromReplay, getBranchSimulatorFormat } from '@fulllifegames/replay-core';
import { reconstructBranchRuntime } from '@fulllifegames/eval-engine';
import { useEvalAcquire } from '../../src/hooks/useEvalAcquire';
import type { PositionSource } from '../../src/hooks/usePositionSource';
import { replayFixture } from '../fixtures/replay';

type Inputs = Parameters<typeof useEvalAcquire>[0];

const { replayData, snapshots, observations } = replayFixture('singles');

function fakeSource(overrides: Partial<PositionSource> = {}) {
  const source = {
    exactKeyFor: vi.fn((turn: number) => `${replayData.id}:${turn}:fp`),
    hasStored: vi.fn(() => false), hasFailed: vi.fn(() => false), markFailed: vi.fn(),
    acquireExact: vi.fn(async (turn: number) => `{"turn":${turn}}`), acquireAll: vi.fn(async () => []),
    sweepAlignment: null, getExact: vi.fn(() => null), storeExactPosition: vi.fn(), exactPositionsVersion: 0,
    acquireRuntime: vi.fn(),
    ...overrides,
  };
  return source as unknown as PositionSource;
}

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return { replayData, source: fakeSource(), getBattle: vi.fn(() => null), viewTurn: 3, dwellEnabled: false, smogonPending: false, ...overrides };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useEvalAcquire', () => {
  test('the acquire surface wraps the position source turn by turn', async () => {
    const source = fakeSource();
    const { result } = renderHook(() => useEvalAcquire(inputs({ source })));
    const report = vi.fn();
    await expect(result.current.acquireReplayPosition(report)).resolves.toBe('{"turn":3}');
    expect(source.acquireExact).toHaveBeenCalledWith(3, report);

    await result.current.makeReplayAcquire(5)(report);
    expect(source.acquireExact).toHaveBeenLastCalledWith(5, report);

    const onPosition = vi.fn();
    await result.current.makeSweepAcquireAll(6)(report, onPosition);
    expect(source.acquireAll).toHaveBeenCalledWith(6, report, onPosition, undefined);
    expect(result.current.exactKeyFor(2)).toBe(`${replayData.id}:2:fp`);
  });

  test('the live branch position serializes the sim battle and refuses without one', async () => {
    const noBattle = renderHook(() => useEvalAcquire(inputs()));
    await expect(noBattle.result.current.acquireBranchPosition()).rejects.toThrow('No live branch battle to evaluate.');

    const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, { observations });
    const runtime = await reconstructBranchRuntime({
      format: getBranchSimulatorFormat(replayData), p1Team, p2Team, replayLog: replayData.log, targetTurn: 2, snapshot: snapshots[1] ?? null,
    });
    const battle = runtime.battleStream.battle!;
    const { result } = renderHook(() => useEvalAcquire(inputs({ getBattle: () => battle })));
    const serialized = await result.current.acquireBranchPosition();
    expect(JSON.parse(serialized)).toMatchObject({ turn: 2 });
  }, 60_000);

  test('the dwell rebuild fires after the pointer settles and marks a failed turn once', async () => {
    vi.useFakeTimers();
    const source = fakeSource();
    const { result, rerender } = renderHook((props: Inputs) => useEvalAcquire(props), { initialProps: inputs({ source, dwellEnabled: true }) });
    expect(source.acquireExact).not.toHaveBeenCalled();

    // Scrubbing restarts the timer; only the settled turn is acquired.
    act(() => vi.advanceTimersByTime(500));
    rerender(inputs({ source, dwellEnabled: true, viewTurn: 4 }));
    act(() => vi.advanceTimersByTime(500));
    expect(source.acquireExact).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(source.acquireExact).toHaveBeenCalledTimes(1);
    expect(source.acquireExact).toHaveBeenCalledWith(4, expect.any(Function));
    expect(result.current.exactAcquiringTurn).toBe(4);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(result.current.exactAcquiringTurn).toBeNull();

    (source.acquireExact as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('diverged'));
    rerender(inputs({ source, dwellEnabled: true, viewTurn: 5 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(source.markFailed).toHaveBeenCalledWith(`${replayData.id}:5:fp`);
  });

  test('no dwell while disabled, while the Smogon data loads, or for a turn already stored or failed', () => {
    vi.useFakeTimers();
    const stored = fakeSource({ hasStored: vi.fn(() => true) });
    renderHook(() => useEvalAcquire(inputs({ source: stored, dwellEnabled: true })));
    const failed = fakeSource({ hasFailed: vi.fn(() => true) });
    renderHook(() => useEvalAcquire(inputs({ source: failed, dwellEnabled: true })));
    const pending = fakeSource();
    renderHook(() => useEvalAcquire(inputs({ source: pending, dwellEnabled: true, smogonPending: true })));
    const disabled = fakeSource();
    renderHook(() => useEvalAcquire(inputs({ source: disabled, dwellEnabled: false })));
    act(() => vi.advanceTimersByTime(2000));
    for (const source of [stored, failed, pending, disabled]) expect(source.acquireExact).not.toHaveBeenCalled();
  });

  test('a waiting acquire is not restarted by the next dwell', async () => {
    vi.useFakeTimers();
    let release: (value: string) => void = () => {};
    const source = fakeSource({ acquireExact: vi.fn(() => new Promise<string>(resolve => { release = resolve; })) });
    const { rerender } = renderHook((props: Inputs) => useEvalAcquire(props), { initialProps: inputs({ source, dwellEnabled: true, viewTurn: 2 }) });
    act(() => vi.advanceTimersByTime(900));
    rerender(inputs({ source, dwellEnabled: true, viewTurn: 3 }));
    act(() => vi.advanceTimersByTime(900));
    expect(source.acquireExact).toHaveBeenCalledTimes(1);
    await act(async () => { release('{"turn":2}'); await vi.runAllTimersAsync(); });
  });
});
