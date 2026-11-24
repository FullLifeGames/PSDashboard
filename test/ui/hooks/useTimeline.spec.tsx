import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimeline, type TimelineInputs } from '../../../src/hooks/useTimeline';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import { replayFixture } from '../fixtures/replay';
import { INTERLUDE_CASES } from '../fixtures/variation-interludes';

const { snapshots } = replayFixture('singles');
const maxTurn = snapshots.length;

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

    act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
    expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, liveTip: false, serializedAtView: 'forced' });

    act(() => result.current.navigateTo({ turn: 2, line: 'variation' }));
    expect(result.current).toMatchObject({ viewTurn: 2, viewLine: 'variation', viewingVariation: false, evalViewKey: 'main:2' });
  });

  test('the pointer knows whether it followed an executed turn or the user moved it', () => {
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

  test('a rebuild that keeps the tip leaves the pointer where the user looks', () => {
    const { result, rerender, base } = setup();
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 4, followedPlay: true });

    act(() => result.current.navigateTo({ turn: 3, line: 'variation' }));
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', followedPlay: false });

    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] });
    expect(result.current).toMatchObject({ viewTurn: 2, viewLine: 'main', followedPlay: false });

    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3), entry(4)] });
    expect(result.current).toMatchObject({ viewTurn: 5, viewLine: 'variation', followedPlay: true });

    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));
    rerender({ ...base, branching: false, variationStartTurn: null, history: [] });
    rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3), entry(4)] });
    expect(result.current).toMatchObject({ viewTurn: 5, viewLine: 'variation', followedPlay: true });
  });

  describe('a turn that lands after the view was handed back', () => {
    const running = (history: BranchHistoryEntry[], executing: boolean, base: TimelineInputs): TimelineInputs =>
      ({ ...base, branching: true, variationStartTurn: 2, history, executing });

    test('stays out of the pointer once, then a turn played by hand follows again', () => {
      const { result, rerender, base } = setup();
      rerender(running([entry(2), entry(3)], true, base));
      expect(result.current.viewTurn).toBe(4);
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

  describe('turn 0 as a side trip', () => {
    const leadVariation = (base: TimelineInputs): TimelineInputs =>
      ({ ...base, branching: true, variationStartTurn: 0, history: [entry(0), entry(1), entry(2)] });

    test('a new game from T0 with the same span follows its tip once the start asks for it; a rebuild of the span stays on T0', () => {
      const { result, rerender, base } = setup();
      const leadGame = (): TimelineInputs => ({ ...base, branching: true, variationStartTurn: 0, history: [entry(0)] });
      rerender(leadGame());
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'variation', followedPlay: true });
      act(() => result.current.handleGraphSelectLine(0));
      expect(result.current.viewT0).toBe(true);
      rerender(leadGame());
      expect(result.current.viewT0).toBe(true);
      act(() => result.current.followNextTip());
      rerender(leadGame());
      expect(result.current).toMatchObject({ viewT0: false, viewTurn: 1, viewLine: 'variation', followedPlay: true });
    });

    test('from variation turn 1 the T0 view keeps the line, shows no variation, and the step forward lands on variation turn 1', () => {
      const { result, rerender, base } = setup();
      rerender(leadVariation(base));
      act(() => result.current.navigateTo({ turn: 1, line: 'variation' }));
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'variation', viewingVariation: true });

      act(() => result.current.handleGraphSelectLine(0));
      expect(result.current).toMatchObject({ viewT0: true, viewLine: 'variation', viewingVariation: false, liveTip: false, evalViewKey: 'main:1' });

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

  test('restorePointer puts the pointer back and the span that returns is not followed (A-2)', () => {
    const { result, rerender, base } = setup();
    const history = [entry(2), entry(3)];
    rerender({ ...base, branching: true, variationStartTurn: 2, history });
    act(() => result.current.navigateTo({ turn: 2, line: 'main' }));

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

    act(() => result.current.handleGraphSelectLine(0));
    expect(result.current).toMatchObject({ viewT0: true, analysisTurn: 0, viewTurn: 3 });

    act(() => result.current.handleGraphSelectLine(3, 'variation'));
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true, viewT0: false });
  });

  test('replay echoes move the pointer, except stale echoes during a seek', () => {
    const { result, rerender, base } = setup();
    act(() => result.current.handleReplayTurn(2));
    expect(result.current.viewTurn).toBe(2);

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

  describe('the branch frame\'s own navigation', () => {
    const variation = (length: number, base: TimelineInputs) => ({
      ...base, branching: true, variationStartTurn: 2, history: Array.from({ length }, (_, index) => entry(2 + index)),
    });

    test('Last turn and Next turn inside the variation move the pointer once the frame landed on the tip', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      expect(result.current).toMatchObject({ viewTurn: 5, viewingVariation: true });

      act(() => result.current.handleReplayTurn(4));
      expect(result.current.viewTurn).toBe(5);
      act(() => result.current.handleReplayTurn(5));
      expect(result.current.viewTurn).toBe(5);

      act(() => result.current.handleReplayTurn(4));
      expect(result.current).toMatchObject({ viewTurn: 4, viewLine: 'variation', viewingVariation: true, followedPlay: false });
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(3);
      act(() => result.current.handleReplayTurn(4));
      expect(result.current.viewTurn).toBe(4);
    });

    test('the frame landing on the tip spends the play, so a rebuild after it plays nothing in again', () => {
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
      expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true });
      act(() => result.current.handleReplayTurn(1));
      expect(result.current).toMatchObject({ viewTurn: 1, viewingVariation: false });
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

  describe('an ended variation', () => {
    afterEach(() => { vi.useRealTimers(); });

    test('the pointer knows it sits at the end, and the frame\'s last turn does not knock it back', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { result, rerender, base } = setup();
      rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)], variationEnded: true });
      expect(result.current).toMatchObject({ viewTurn: 4, viewingVariation: true, atVariationEnd: true });

      vi.setSystemTime(Date.now() + 30_000);
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(4);

      act(() => result.current.handleReplayTurn(2));
      expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, atVariationEnd: false });
    });

    test('the frame landing on the last played turn ends the guard: Last turn right after the end moves the pointer', () => {
      const { result, rerender, base } = setup();
      rerender({ ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)], variationEnded: true });
      expect(result.current).toMatchObject({ viewTurn: 4, atVariationEnd: true });
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(4);
      act(() => result.current.handleReplayTurn(2));
      expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true, atVariationEnd: false });
    });

    test('a win that lands a render after its turn retargets the guard to the last played turn', () => {
      const { result, rerender, base } = setup();
      const played = { ...base, branching: true, variationStartTurn: 2, history: [entry(2), entry(3)] };
      rerender(played);
      rerender({ ...played, variationEnded: true });
      expect(result.current).toMatchObject({ viewTurn: 4, atVariationEnd: true });
      act(() => result.current.handleReplayTurn(3));
      act(() => result.current.handleReplayTurn(2));
      expect(result.current.viewTurn).toBe(3);
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

describe.each(INTERLUDE_CASES)('useTimeline over a history with interludes, $name', ({ history, startTurn, settledAt, turns }) => {
  const tip = startTurn + turns;

  function setup() {
    const base: TimelineInputs = {
      replayId: 'gen9vgc-1', snapshots, branching: true, variationStartTurn: startTurn, history,
      interruptPlayOut: vi.fn(), onNavigate: vi.fn(),
    };
    return renderHook(() => useTimeline(base));
  }

  test('the span, the tip and the live turn count real turns', () => {
    const { result } = setup();
    expect(result.current.variationSpan).toEqual({ startTurn, length: turns });
    expect(result.current.tipTurn).toBe(tip);
    expect(result.current.liveSimTurn).toBe(tip);
  });

  test('every pointer turn inside the variation reads the position that settles the turns before it', () => {
    const { result } = setup();
    for (let turn = startTurn + 1; turn <= tip; turn += 1) {
      act(() => result.current.navigateTo({ turn, line: 'variation' }, { seek: false, internal: true }));
      expect(result.current.viewingVariation).toBe(true);
      expect(result.current.serializedAtView, `T${turn}`).toBe(`pos-${settledAt[turn]}`);
    }
  });
});

describe('useTimeline.frame', () => {
  const { snapshots } = replayFixture('singles');

  const entry = (turnNumber: number): BranchHistoryEntry => ({
    turnNumber, p1Choice: 'move earthquake', p2Choice: 'move leechseed', serializedPosition: `pos-${turnNumber}`,
    p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
  });

  function setup() {
    const base: TimelineInputs = {
      replayId: 'gen9ou-1', snapshots, branching: false, variationStartTurn: null, history: [],
      interruptPlayOut: vi.fn(), onNavigate: vi.fn(),
    };
    const hook = renderHook((inputs: TimelineInputs) => useTimeline(inputs), { initialProps: base });
    return { ...hook, base };
  }

  describe("the pointer takes the frame's turn without a seek", () => {
    const variation = (length: number, base: TimelineInputs, extra: Partial<TimelineInputs> = {}) => ({
      ...base, branching: true, variationStartTurn: 2, history: Array.from({ length }, (_, index) => entry(2 + index)), ...extra,
    });
    const toFrame = { toFrame: true as const, seek: false, internal: true };

    test('frame reports the play-in guard dropped are remembered, and the move to the frame spends the guard', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base)); // start 2, tip 5, guard on turn 5
      const navSeek = result.current.navSeek;
      act(() => result.current.handleReplayTurn(3));
      expect(result.current.viewTurn).toBe(5);
      act(() => result.current.navigateTo({ turn: 5, line: 'variation' }, toFrame));
      expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true, followedPlay: false });
      expect(result.current.navSeek).toBe(navSeek);

      act(() => result.current.handleReplayTurn(4));
      expect(result.current.viewTurn).toBe(4);
    });

    test('a frame on the start turn gives the first covered turn; a frame past the tip gives the tip', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      act(() => result.current.handleReplayTurn(2));
      act(() => result.current.navigateTo({ turn: 5, line: 'variation' }, toFrame));
      expect(result.current).toMatchObject({ viewTurn: 3, viewingVariation: true });

      rerender(variation(3, base));
      act(() => result.current.handleReplayTurn(9));
      act(() => result.current.navigateTo({ turn: 3, line: 'variation' }, toFrame));
      expect(result.current.viewTurn).toBe(5);
    });

    test('an ended variation with the frame on the last played turn keeps the pointer on the end position', () => {
      const { result, rerender, base } = setup();
      rerender(variation(2, base, { variationEnded: true })); // start 2, tip 4, frame lands on 3
      expect(result.current).toMatchObject({ viewTurn: 4, atVariationEnd: true });
      act(() => result.current.handleReplayTurn(3));
      act(() => result.current.navigateTo({ turn: 4, line: 'variation' }, toFrame));
      expect(result.current).toMatchObject({ viewTurn: 4, viewingVariation: true, atVariationEnd: true });
    });

    test('without a report the pointer takes the position it was given', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      act(() => result.current.navigateTo({ turn: 5, line: 'variation' }, toFrame));
      expect(result.current).toMatchObject({ viewTurn: 5, viewLine: 'variation', viewingVariation: true });
    });

    test('a number names the turn the frame is about to show (Watch from turn N), the lead variation reads T1 for turn 0', () => {
      const { result, rerender, base } = setup();
      rerender(variation(3, base));
      const navSeek = result.current.navSeek;
      act(() => result.current.navigateTo({ turn: 3, line: 'variation' }, { ...toFrame, toFrame: 4 }));
      expect(result.current).toMatchObject({ viewTurn: 4, viewingVariation: true });
      act(() => result.current.navigateTo({ turn: 2, line: 'variation' }, { ...toFrame, toFrame: 2 }));
      expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true });
      expect(result.current.navSeek).toBe(navSeek);

      rerender({ ...base, branching: true, variationStartTurn: 0, history: [entry(0), entry(1), entry(2)] });
      act(() => result.current.navigateTo({ turn: 0, line: 'variation' }, { ...toFrame, toFrame: 0 }));
      expect(result.current).toMatchObject({ viewTurn: 1, viewLine: 'variation', viewingVariation: true, viewT0: false });
    });
  });
});
