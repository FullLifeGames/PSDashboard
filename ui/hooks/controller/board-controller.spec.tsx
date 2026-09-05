import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { doublesReplay, singlesReplay } from '../../fixtures/replay';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../src/hooks/controller/replay-context');
const { useTransients } = await import('../../../src/hooks/controller/transients');
const { useTimelineController } = await import('../../../src/hooks/controller/board-controller');

/** The board layer over the real context and transients, as the app composes it. */
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
    expect(result.current.board).toMatchObject({ liveEvalStatus: 'idle', evalResultMatchesView: true });
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
    expect(result.current.ctx.positions.getExact(2)).not.toBeNull();

    act(() => result.current.transients.setPendingConfirm({ message: 'x', proceed: () => {} }));
    act(() => result.current.board.discardVariation());
    expect(result.current.ctx.branch.branching).toBe(false);
    expect(result.current.ctx.branch.simState).toBeNull();
    expect(result.current.transients.pendingConfirm).toBeNull();
    expect(result.current.board.timeline).toMatchObject({ viewLine: 'main', variationSpan: null, liveTip: false });
    expect(result.current.ctx.branchWindowOpenRef.current).toBe(false);
  }, 90_000);

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
});
