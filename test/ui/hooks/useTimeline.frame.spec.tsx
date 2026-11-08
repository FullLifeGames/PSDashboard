import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimeline, type TimelineInputs } from '../../../src/hooks/useTimeline';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import { replayFixture } from '../fixtures/replay';

const { snapshots } = replayFixture('singles');

/** One executed variation entry (the timeline reads its count, not its content). */
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

// Round 88 (T347, #83): the finish of a play-out leaves the frame where it stands, and the pointer takes its turn. The
// tip-follow's guard drops the frame's reports during the run; the timeline remembers the last one.
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
    expect(result.current.viewTurn).toBe(5); // dropped while the run holds the tip
    act(() => result.current.navigateTo({ turn: 5, line: 'variation' }, toFrame));
    expect(result.current).toMatchObject({ viewTurn: 3, viewLine: 'variation', viewingVariation: true, followedPlay: false });
    expect(result.current.navSeek).toBe(navSeek); // no seek: the frame stays where it is

    // The frame plays on: its reports move the pointer again.
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
