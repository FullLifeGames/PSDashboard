import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimeline, type TimelineInputs } from '../../src/hooks/useTimeline';
import type { BranchHistoryEntry } from '../../src/hooks/useBranch';
import { replayFixture } from '../fixtures/replay';

const { snapshots } = replayFixture('singles');
const maxTurn = snapshots.length;

/** One executed variation entry; `kind: 'forced'` marks a forced interlude that consumes no turn. */
const entry = (turnNumber: number, extra: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move earthquake', p2Choice: 'move leechseed', serializedPosition: `pos-${turnNumber}`,
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  ...extra,
});

function setup(overrides: Partial<TimelineInputs> = {}) {
  const interruptPlayOut = vi.fn();
  const onNavigate = vi.fn();
  const base: TimelineInputs = {
    replayId: 'gen9ou-1', snapshots, branching: false, variationStartTurn: null, history: [],
    interruptPlayOut, onNavigate, ...overrides,
  };
  const hook = renderHook((inputs: TimelineInputs) => useTimeline(inputs), { initialProps: base });
  return { ...hook, base, interruptPlayOut, onNavigate };
}

describe('useTimeline', () => {
  test('starts at turn 1 on the main line with the replay length as its range', () => {
    const { result } = setup();
    expect(maxTurn).toBeGreaterThan(2);
    expect(result.current).toMatchObject({
      viewTurn: 1, viewLine: 'main', viewT0: false, maxTurn, variationSpan: null, viewingVariation: false,
      liveTip: false, liveEvalView: false, evalViewKey: 'main:1', tipTurn: null, analysisTurn: 1,
    });
  });

  test('navigateTo moves the pointer, clamps to the range, seeks once, and stops a play-out', () => {
    const { result, interruptPlayOut, onNavigate } = setup();
    act(() => result.current.navigateTo({ turn: 3, line: 'main' }));
    expect(result.current.viewTurn).toBe(3);
    expect(result.current.viewTurnRef.current).toBe(3);
    expect(result.current.navSeek).toEqual({ turn: 3, seq: 1 });
    expect(result.current.analysisTurn).toBe(Math.min(3, result.current.analyzableTurns));
    expect(interruptPlayOut).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    act(() => result.current.navigateTo({ turn: 99, line: 'main' }, { seek: false, internal: true }));
    expect(result.current.viewTurn).toBe(maxTurn);
    expect(result.current.navSeek).toEqual({ turn: 3, seq: 1 });
    expect(interruptPlayOut).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  test('an executed variation moves the pointer to its tip and marks the live position', () => {
    const { result, rerender, base } = setup();
    const history = [entry(2), entry(2, { kind: 'forced', serializedPosition: 'forced' }), entry(3)];
    rerender({ ...base, branching: true, variationStartTurn: 2, history });

    expect(result.current.variationSpan).toEqual({ startTurn: 2, length: 2 });
    expect(result.current.tipTurn).toBe(4);
    expect(result.current).toMatchObject({
      viewTurn: 4, viewLine: 'variation', viewingVariation: true, liveSimTurn: 4, liveTip: true,
      liveEvalView: true, evalViewKey: 'variation:4', serializedAtView: 'pos-3',
    });

    // Turn 3's position is the one after the forced interlude that followed entry 2.
    act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
    expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, liveTip: false, serializedAtView: 'forced' });

    // Turn 2 is the shared prefix: no variation position exists there, the
    // pointer lands on the main line while the line intent stays sticky.
    act(() => result.current.navigateTo({ turn: 2, line: 'variation' }));
    expect(result.current).toMatchObject({ viewTurn: 2, viewLine: 'variation', viewingVariation: false, evalViewKey: 'main:2' });
  });

  test('the variation span needs an executed turn: a forced interlude alone opens nothing', () => {
    const { result } = setup({ branching: true, variationStartTurn: 2, history: [entry(2, { kind: 'forced' })] });
    expect(result.current.variationSpan).toBeNull();
    expect(result.current.liveSimTurn).toBe(2);
  });

  test('graph selections name their line; turn 0 opens the team preview', () => {
    const { result, rerender, base, interruptPlayOut } = setup();
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });

    act(() => result.current.handleGraphSelectLine(3, 'main'));
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'main', viewingVariation: false, analysisTurn: 3 });
    expect(interruptPlayOut).toHaveBeenCalled();

    // Turn 0 from the main line: the lead picker opens and the analysis follows it.
    act(() => result.current.handleGraphSelectLine(0));
    expect(result.current).toMatchObject({ viewT0: true, analysisTurn: 0, viewTurn: 3 });

    act(() => result.current.handleGraphSelectLine(3, 'variation'));
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true, viewT0: false });
  });

  test('replay echoes move the pointer, except stale echoes during a seek and inside a variation', () => {
    const { result, rerender, base } = setup();
    act(() => result.current.handleReplayTurn(2));
    expect(result.current.viewTurn).toBe(2);

    // A programmatic seek to turn 3 opens a window in which the embed still echoes the old turn.
    act(() => result.current.navigateTo({ turn: 3, line: 'main' }));
    act(() => result.current.handleReplayTurn(2));
    expect(result.current.viewTurn).toBe(3);
    act(() => result.current.handleReplayTurn(3));
    expect(result.current.viewTurn).toBe(3);
    act(() => result.current.handleReplayTurn(1));
    expect(result.current.viewTurn).toBe(1);

    rerender({ ...base, branching: true, variationStartTurn: 1, history: [entry(1), entry(2)] });
    expect(result.current.viewingVariation).toBe(true);
    act(() => result.current.handleReplayTurn(1));
    expect(result.current.viewTurn).toBe(3);
  });

  test('resetPointer returns to turn 1 on the main line and drops the overlay', () => {
    const { result } = setup();
    act(() => {
      result.current.navigateTo({ turn: 2, line: 'main' });
      result.current.setVariationScores([0.1, 0.2]);
      result.current.setViewT0(true);
    });
    act(() => result.current.resetPointer());
    expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'main', viewT0: false, navSeek: null, variationScores: [] });
  });

  test('the end snapshot is the one without a |turn| line, and the pointer knows when it sits there', () => {
    const { result } = setup();
    const last = snapshots[snapshots.length - 1];
    const expectedEnd = last.log.some(line => line.startsWith('|turn|')) ? null : last.turn;
    expect(result.current.endSnapshotTurn).toBe(expectedEnd);
    expect(result.current.atEndPosition).toBe(false);
    act(() => result.current.navigateTo({ turn: maxTurn, line: 'main' }));
    expect(result.current.atEndPosition).toBe(expectedEnd !== null);
  });
});
