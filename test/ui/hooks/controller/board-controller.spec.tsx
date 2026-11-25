import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactElement } from 'react';
import { doublesReplay, singlesReplay } from '../../fixtures/replay';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';
import { playedRecord } from '../../fixtures/played-game';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../../src/hooks/controller/replay-context');
const { useTransients } = await import('../../../../src/hooks/controller/transients');
const { useTimelineController } = await import('../../../../src/hooks/controller/board-controller');

function useBoardHarness() {
  const ctx = useReplayContext();
  const transients = useTransients(ctx.replay.replayData?.id);
  const board = useTimelineController(ctx, transients);
  return { ctx, transients, board };
}

const choice = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' };

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay(), doublesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTimelineController', () => {
  test('before a replay the pointer sits at turn 1 of a one-turn range with nothing to evaluate', () => {
    const { result } = renderHook(() => useBoardHarness());
    expect(result.current.board.timeline).toMatchObject({ viewTurn: 1, maxTurn: 1, viewLine: 'main', variationSpan: null });
    expect(result.current.board).toMatchObject({ liveEvalStatus: 'idle', tipEvalStatus: 'idle', evalResultMatchesView: true });
    expect(result.current.board.deviation.branchPreparing).toBe(false);
  });

  test('a loaded replay sets the range; navigation clears the drafts and follows the analysis', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
    const turns = result.current.ctx.replay.snapshots.length;
    expect(result.current.board.timeline.maxTurn).toBe(turns);

    act(() => result.current.transients.setDraftChoices({ p1: [choice], p2: [] }));
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));
    expect(result.current.board.timeline.viewTurn).toBe(2);
    expect(result.current.board.timeline.analysisTurn).toBe(2);
    expect(result.current.transients.draftChoices).toEqual({ p1: [], p2: [] });
  });

  test('a deviation rebuilds the branch through the position source; discarding it returns to the main line', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
    await waitFor(() => expect(result.current.ctx.smogon.usageStats.loading).toBe(false));
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));

    act(() => result.current.board.deviation.requestDeviation(null));
    await waitFor(() => expect(result.current.board.deviation.branchPreparing).toBe(true));
    await waitFor(() => expect(result.current.ctx.branch.branching).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(result.current.board.deviation.branchPreparing).toBe(false));
    expect(result.current.ctx.branch.variationStartTurn).toBe(2);
    expect(result.current.ctx.branch.simState?.turnNumber).toBe(2);
    expect(result.current.board.timeline.liveTip).toBe(true);
    expect(result.current.board.timeline.liveSimTurn).toBe(2);
    expect(result.current.ctx.branchWindowOpenRef.current).toBe(true);
    // The store entry lands with the reconstruction result, a tick behind the branch flag on a loaded machine.
    await waitFor(() => expect(result.current.ctx.positions.getExact(2)).not.toBeNull());

    act(() => result.current.transients.setPendingConfirm({ message: 'x', proceed: () => {} }));
    act(() => result.current.board.discardVariation());
    expect(result.current.ctx.branch.branching).toBe(false);
    expect(result.current.ctx.branch.simState).toBeNull();
    expect(result.current.transients.pendingConfirm).toBeNull();
    expect(result.current.board.timeline).toMatchObject({ viewLine: 'main', variationSpan: null, liveTip: false });
    expect(result.current.ctx.branchWindowOpenRef.current).toBe(false);
  }, 90_000);

  test('discarding the variation during a play-out ends the run and restores the Auto setting', () => {
    const { result } = renderHook(() => useBoardHarness());
    act(() => result.current.ctx.evaluation.setPrefs({ ...result.current.ctx.evaluation.prefs, auto: false }));
    act(() => result.current.ctx.evaluation.setPrefs({ ...result.current.ctx.evaluation.prefs, auto: true }));
    expect(result.current.ctx.evaluation.prefs.auto).toBe(true);
    act(() => result.current.transients.setPlayOut({ active: true, executed: 0, turns: 2, startTurn: 3, prevAuto: false }));
    act(() => result.current.board.discardVariation());
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.ctx.evaluation.prefs.auto).toBe(false);

    act(() => result.current.ctx.evaluation.setPrefs({ ...result.current.ctx.evaluation.prefs, auto: true }));
    act(() => result.current.transients.setPlayOut({ active: true, executed: 0, turns: 0, startTurn: 3, prevAuto: true }));
    act(() => result.current.board.discardVariation());
    expect(result.current.ctx.evaluation.prefs.auto).toBe(true);
  });

  test('a stale evaluation result reads as stale until the pointer returns to its position', async () => {
    const replay = singlesReplay();
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.replay.loadReplay(replay.id); });
    expect(result.current.board.evalResultMatchesView).toBe(true);
    expect(result.current.board.liveEvalStatus).toBe('idle');
  });

  test('a new replay returns the pointer to turn 1 and stops any branch', async () => {
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.replay.loadReplay(singlesReplay().id); });
    act(() => result.current.board.timeline.navigateTo({ turn: 3, line: 'main' }));
    expect(result.current.board.timeline.viewTurn).toBe(3);

    await act(async () => { await result.current.ctx.replay.loadReplay(doublesReplay().id); });
    expect(result.current.board.timeline.viewTurn).toBe(1);
    expect(result.current.board.timeline.maxTurn).toBe(result.current.ctx.replay.snapshots.length);
    expect(result.current.ctx.branch.branching).toBe(false);
  });
  test('a saved game opened on its tip keeps the pointer there when the loading frame reports turn 1', async () => {
    const record = await playedRecord(1);
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.newGame.openRecord(record); });
    await waitFor(() => expect(result.current.board.timeline.maxTurn).toBe(2));
    expect(result.current.board.timeline.viewTurn).toBe(2);
    act(() => result.current.board.timeline.handleReplayTurn(1));
    expect(result.current.board.timeline.viewTurn).toBe(2);
    act(() => result.current.board.timeline.handleReplayTurn(2));
    act(() => result.current.board.timeline.handleReplayTurn(1));
    expect(result.current.board.timeline.viewTurn).toBe(1);
  }, 90_000);

  test('a saved game keeps its tip against a report of turn 1 that comes after the guard time of a selection', async () => {
    const record = await playedRecord(1);
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.newGame.openRecord(record); });
    await waitFor(() => expect(result.current.board.timeline.maxTurn).toBe(2));
    expect(result.current.board.timeline.viewTurn).toBe(2);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'], now: now + 60_000 });
    try {
      act(() => result.current.board.timeline.handleReplayTurn(1));
      expect(result.current.board.timeline.viewTurn).toBe(2);
      act(() => result.current.board.timeline.handleReplayTurn(2));
      act(() => result.current.board.timeline.handleReplayTurn(1));
      expect(result.current.board.timeline.viewTurn).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  }, 90_000);

  test('the user\'s own click on turn 1 after the landing wins over the held tip', async () => {
    const record = await playedRecord(1);
    const { result } = renderHook(() => useBoardHarness());
    await act(async () => { await result.current.ctx.newGame.openRecord(record); });
    await waitFor(() => expect(result.current.board.timeline.maxTurn).toBe(2));
    expect(result.current.board.timeline.viewTurn).toBe(2);
    act(() => result.current.board.timeline.handleGraphSelect(1));
    expect(result.current.board.timeline.viewTurn).toBe(1);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 });
    try {
      act(() => result.current.board.timeline.handleReplayTurn(1));
      act(() => result.current.board.timeline.handleReplayTurn(2));
      expect(result.current.board.timeline.viewTurn).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  }, 90_000);

  test('a saved game opened before the board mounts keeps its tip when the replay data arrives after the first run of the reset', async () => {
    const record = await playedRecord(1);
    const seen: { ctx?: ReturnType<typeof useReplayContext>; board?: ReturnType<typeof useTimelineController>; show?: (on: boolean) => void } = {};
    function Board({ ctx, transients }: { ctx: ReturnType<typeof useReplayContext>; transients: ReturnType<typeof useTransients> }): null {
      const board = useTimelineController(ctx, transients);
      useEffect(() => { seen.board = board; });
      return null;
    }
    function Host(): ReactElement | null {
      const ctx = useReplayContext();
      const transients = useTransients(ctx.replay.replayData?.id);
      const [shown, setShown] = useState(false);
      useEffect(() => { seen.ctx = ctx; seen.show = setShown; }, [ctx]);
      return shown ? <Board ctx={ctx} transients={transients} /> : null;
    }
    render(<Host />);
    expect(seen.board).toBeUndefined();
    let opened: Promise<unknown> = Promise.resolve();
    act(() => {
      opened = seen.ctx!.newGame.openRecord(record) as Promise<unknown>;
      seen.show!(true);
    });
    expect(seen.board).toBeDefined();
    expect(seen.ctx!.replay.replayData?.id).toBeUndefined();
    await act(async () => { await opened; });
    await waitFor(() => expect(seen.board!.timeline.maxTurn).toBe(2));
    expect(seen.ctx!.replay.replayData?.id).toBe(record.id);
    expect(seen.board!.timeline.viewTurn).toBe(2);
  }, 90_000);
});
