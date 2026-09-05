import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { singlesReplay } from '../../fixtures/replay';
import { stubReplayFetch } from '../../fixtures/network';
import { realReplayWorkerClient } from '../../fixtures/worker';
import { rankedChoice } from '../../fixtures/eval-result';

const worker = vi.hoisted(() => ({ current: null as null | ReturnType<typeof import('../../fixtures/worker').realReplayWorkerClient> }));
vi.mock('../../../src/hooks/useReplayWorker', () => ({ useReplayWorker: () => worker.current!.client }));

const { useReplayContext } = await import('../../../src/hooks/controller/replay-context');
const { useTransients } = await import('../../../src/hooks/controller/transients');
const { useTimelineController } = await import('../../../src/hooks/controller/board-controller');
const { useEngineController } = await import('../../../src/hooks/controller/engine-controller');

/** The engine layer over the real context, transients, and board. */
function useEngineHarness() {
  const ctx = useReplayContext();
  const transients = useTransients(ctx.replay.replayData?.id);
  const board = useTimelineController(ctx, transients);
  const engine = useEngineController(ctx, transients, board);
  return { ctx, transients, board, engine };
}

beforeEach(() => {
  worker.current = realReplayWorkerClient();
  stubReplayFetch([singlesReplay()]);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loaded() {
  const hook = renderHook(() => useEngineHarness());
  await act(async () => { await hook.result.current.ctx.replay.loadReplay(singlesReplay().id); });
  await waitFor(() => expect(hook.result.current.engine.smogonPending).toBe(false));
  return hook;
}

describe('useEngineController', () => {
  test('exposes the four surfaces in their idle state before a replay', () => {
    const { result } = renderHook(() => useEngineHarness());
    const { engine } = result.current;
    expect(engine.evalView.evalAvailable).toBe(false);
    expect(engine.positionPicker).toBeNull();
    expect(engine.pickerSimState).toBeNull();
    expect(engine.playedAtView).toBeNull();
    expect(engine.acquire.exactKeyFor(1)).toBeNull();
    expect(engine.walk.applyEvalChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0))).toBe(false);
    expect(typeof engine.playOutControls.startPlayOut).toBe('function');
  });

  test('a main-line turn shows the snapshot pickers and the played action, then upgrades to the exact position on dwell', async () => {
    const { result } = await loaded();
    expect(result.current.engine.evalView.evalAvailable).toBe(true);
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));

    await waitFor(() => expect(result.current.engine.positionPicker?.source).toBe('snapshot'), { timeout: 30_000 });
    const approximate = result.current.engine.pickerSimState!;
    expect(approximate.p1MovesBySlot[0].length).toBeGreaterThan(0);
    expect(approximate.p1ActiveSlots[0]?.species).toBeTruthy();
    expect(approximate.p2ActiveSlots[0]?.species).toBeTruthy();
    expect(result.current.engine.playedAtView?.p1?.kind).toMatch(/move|switch/);

    // The dwell rebuild lands the exact position and the pickers upgrade in place.
    await waitFor(() => expect(result.current.engine.positionPicker?.source).toBe('stored'), { timeout: 60_000 });
    expect(result.current.ctx.positions.getExact(2)).not.toBeNull();
    expect(result.current.engine.acquire.exactAcquiringTurn).toBeNull();
  }, 90_000);

  test('draft choices mirror into the picker state off the live tip', async () => {
    const { result } = await loaded();
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));
    await waitFor(() => expect(result.current.engine.pickerSimState).not.toBeNull(), { timeout: 30_000 });
    const choice = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake' };
    act(() => result.current.board.deviation.handleSetChoice('p1', choice));
    expect(result.current.transients.draftChoices.p1).toEqual([choice]);
    expect(result.current.engine.pickerSimState?.p1Choice).toEqual(choice);
    expect(result.current.ctx.branch.branching).toBe(false);
  }, 60_000);

  test('a play-out started off the tip enters the branch first and arms itself', async () => {
    const { result } = await loaded();
    act(() => result.current.board.timeline.navigateTo({ turn: 2, line: 'main' }));
    act(() => result.current.engine.playOutControls.startPlayOut());
    expect(result.current.transients.playOut).toMatchObject({ active: true, startTurn: 2 });
    await waitFor(() => expect(result.current.ctx.branch.branching).toBe(true), { timeout: 60_000 });
    expect(result.current.board.timeline.liveTip).toBe(true);
    act(() => result.current.engine.playOutControls.stopPlayOut());
    expect(result.current.transients.playOut).toBeNull();
    expect(result.current.transients.playOutNotice?.text).toMatch(/Play-out stopped/);
  }, 90_000);
});
