import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimeline, type TimelineInputs } from '../../../src/hooks/useTimeline';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
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

  test('the pointer knows whether it followed an executed turn or the user moved it', () => {
    // Round 77 (user report 28.10.2026): the branch frame plays a turn in only when the pointer followed that turn.
    const { result, rerender, base } = setup();
    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    expect(result.current.followedPlay).toBe(false);
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2)] });
    expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, followedPlay: true });

    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    expect(result.current.followedPlay).toBe(false);
    act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
    expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, followedPlay: false });

    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 4, followedPlay: true });
    act(() => result.current.handleGraphSelect(2));
    expect(result.current.followedPlay).toBe(false);
  });

  test('a rebuild that keeps the tip leaves the pointer where the user looks (round 77, D3)', () => {
    const { result, rerender, base } = setup();
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 4, followedPlay: true });

    // Inside the variation: a set edit rebuilds the same history into new objects.
    act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', followedPlay: false });

    // On the main line: the same rebuild leaves the pointer on its main turn.
    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 2, viewLine: 'main', followedPlay: false });

    // An executed turn still follows to the new tip.
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3), entry(4)] });
    expect(result.current).toMatchObject({ viewTurn: 5, viewLine: 'variation', followedPlay: true });

    // A variation that ends and a new one with the same span follows again.
    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    rerender({ ...base, branching: false, variationStartTurn: null, history: [] });
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3), entry(4)] });
    expect(result.current).toMatchObject({ viewTurn: 5, viewLine: 'variation', followedPlay: true });
  });

  // Round 77 (C5): Stop hands the view back; the turn still in flight lands after it and must not drag the pointer to the tip.
  describe('a turn that lands after the view was handed back', () => {
    const running = (history: BranchHistoryEntry[], executing: boolean, base: TimelineInputs): TimelineInputs =>
      ({ ...base, branching: true, variationStartTurn: 2, history, executing });

    test('stays out of the pointer once, then a turn played by hand follows again', () => {
      const { result, rerender, base } = setup();
      rerender(running([entry(2), entry(3)], true, base));
      expect(result.current.viewTurn).toBe(4);
      // The play-out stops with a third turn in flight and returns the pointer to its start turn.
      act(() => {
        result.current.holdTipFollow();
        result.current.navigateTo({ turn: 3, line: 'variation' }, { seek: true, internal: true });
      });
      rerender(running([entry(2), entry(3), entry(4)], false, base));
      expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', followedPlay: false, tipTurn: 5 });

      rerender(running([entry(2), entry(3), entry(4), entry(5)], false, base));
      expect(result.current).toMatchObject({ viewTurn: 6, viewLine: 'variation', followedPlay: true });
    });

    test('with nothing in flight the hold is void: the next played turn follows', () => {
      const { result, rerender, base } = setup();
      rerender(running([entry(2)], false, base));
      act(() => result.current.holdTipFollow());
      rerender(running([entry(2)], true, base));
      rerender(running([entry(2), entry(3)], false, base));
      expect(result.current).toMatchObject({ viewTurn: 4, followedPlay: true });
    });

    test('a turn that fails after the hold clears it', () => {
      const { result, rerender, base } = setup();
      rerender(running([entry(2)], true, base));
      act(() => result.current.holdTipFollow());
      rerender(running([entry(2)], false, base));
      rerender(running([entry(2)], true, base));
      rerender(running([entry(2), entry(3)], false, base));
      expect(result.current).toMatchObject({ viewTurn: 4, followedPlay: true });
    });
  });

  // Round 77 (C9): T0 is a side trip. The arrow forward returns to the line the user came from.
  describe('turn 0 as a side trip', () => {
    const leadVariation = (base: TimelineInputs): TimelineInputs =>
      ({ ...base, branching: true, variationStartTurn: 0, history: [entry(0), entry(1), entry(2)] });

    test('from variation turn 1 the T0 view keeps the line, shows no variation, and the step forward lands on variation turn 1', () => {
      const { result, rerender, base } = setup();
      rerender(leadVariation(base));
      act(() => result.current.navigateTo({ turn: 1, line: 'variation' }));
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'variation', viewingVariation: true });

      act(() => result.current.handleGraphSelectLine(0));
      expect(result.current).toMatchObject({ viewT0: true, viewLine: 'variation', viewingVariation: false, liveTip: false, evalViewKey: 'main:1' });

      // The bar's forward arrow at T0 asks for turn 1 on the stored line.
      act(() => result.current.navigateTo({ turn: 1, line: result.current.viewLine }));
      expect(result.current).toMatchObject({ viewT0: false, viewTurn: 1, viewLine: 'variation', viewingVariation: true });
    });

    test('from the main line the step forward returns to the main line; an explicit main selection still sets it', () => {
      const { result, rerender, base } = setup();
      rerender(leadVariation(base));
      act(() => result.current.navigateTo({ turn: 1, line: 'main' }));
      act(() => result.current.handleGraphSelectLine(0));
      expect(result.current).toMatchObject({ viewT0: true, viewLine: 'main' });
      act(() => result.current.navigateTo({ turn: 1, line: result.current.viewLine }));
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'main', viewingVariation: false });

      act(() => result.current.navigateTo({ turn: 2, line: 'variation' }));
      act(() => result.current.handleGraphSelectLine(1, 'main'));
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'main' });
    });
  });

  test('restorePointer puts the pointer back and the span that returns is not followed (round 77, A-2)', () => {
    const { result, rerender, base } = setup();
    const history = [entry(2), entry(3)];
    rerender({ ...base, branching: true, variationStartTurn: 2, history });
    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));

    // A refused execute: the rebuild emptied the variation, then the old one came back.
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [] });
    act(() => {
      result.current.restorePointer({ turn: 2, line: 'main' }, { startTurn: 2, length: 2 });
    });
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 2, viewLine: 'main', followedPlay: false });
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

  test('replay echoes move the pointer, except stale echoes during a seek', () => {
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

  // Round 77 (swarm A-4): inside a variation the frame's own Last turn / Next turn move the pointer as on the main line.
  describe('the branch frame\'s own navigation', () => {
    const variation = (length: number, base: TimelineInputs) => ({
      ...base, branching: true, variationStartTurn: 2, history: Array.from({ length }, (_, index) => entry(2 + index)),
    });

    test('Last turn and Next turn inside the variation move the pointer once the frame landed on the tip', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      expect(result.current).toMatchObject({ viewTurn: 5, viewingVariation: true });

      // The frame opens at the turn before the tip and plays it in: that report is the app's own doing.
      act(() => result.current.handleReplayTurn(4));
      expect(result.current.viewTurn).toBe(5);
      act(() => result.current.handleReplayTurn(5));
      expect(result.current.viewTurn).toBe(5);

      // Now a report is the user's: Last turn, Last turn, Next turn.
      act(() => result.current.handleReplayTurn(4));
      expect(result.current).toMatchObject({ viewTurn: 4, viewLine: 'variation', viewingVariation: true, followedPlay: false });
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(3);
      act(() => result.current.handleReplayTurn(4));
      expect(result.current.viewTurn).toBe(4);
    });

    test('the frame landing on the tip spends the play, so a rebuild after it plays nothing in again (round 77)', () => {
      // The acceptance e2e: a set edit at the tip rebuilt the variation, the new frame document opened at the turn before
      // the tip to play it in again (followedPlay still held from the executed turn), and its landing there moved the
      // pointer off the tip onto the main line. The play is spent once the frame lands on the tip it followed.
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      expect(result.current).toMatchObject({ viewTurn: 5, followedPlay: true });
      act(() => result.current.handleReplayTurn(4));
      act(() => result.current.handleReplayTurn(5));
      expect(result.current).toMatchObject({ viewTurn: 5, viewingVariation: true, followedPlay: false });
    });

    test('a seek the app sent is not knocked back by the old turn the frame still reports', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      act(() => result.current.handleReplayTurn(5));
      act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
      act(() => result.current.handleReplayTurn(5));
      expect(result.current.viewTurn).toBe(3);
      act(() => result.current.handleReplayTurn(3));
      act(() => result.current.handleReplayTurn(2));
      expect(result.current).toMatchObject({ viewTurn: 2, viewingVariation: false });
    });

    test('Reset reports turn 0, which the pointer ignores as on the main line; a turn before the start leaves the variation', () => {
      const { result, rerender, base } = setup();
      rerender(variation(2, base));
      act(() => result.current.handleReplayTurn(4));
      act(() => result.current.handleReplayTurn(3));
      act(() => result.current.handleReplayTurn(0));
      expect(result.current.viewTurn).toBe(3);
      act(() => result.current.handleReplayTurn(1));
      expect(result.current).toMatchObject({ viewTurn: 1, viewingVariation: false });
    });
  });

  // Round 77 (swarm A-6): the variation's ended tip is an end position like the main line's.
  describe('an ended variation', () => {
    afterEach(() => { vi.useRealTimers(); });

    test('the pointer knows it sits at the end, and the frame\'s last turn does not knock it back', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { result, rerender, base } = setup();
      rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)], variationEnded: true });
      expect(result.current).toMatchObject({ viewTurn: 4, viewingVariation: true, atVariationEnd: true });

      // The echo guard of the executed turn lapsed (20 s since round 77); the frame stays on the last played turn.
      vi.setSystemTime(Date.now() + 30_000);
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(4);

      // Going back with the frame's own button is the user's: turn 2 is before the end.
      act(() => result.current.handleReplayTurn(2));
      expect(result.current).toMatchObject({ viewTurn: 2, atVariationEnd: false });
    });

    test('a variation that has not ended has no end position', () => {
      const { result } = setup({ branching: true, variationStartTurn: 2, history: [entry(2)] });
      expect(result.current.atVariationEnd).toBe(false);
    });
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
