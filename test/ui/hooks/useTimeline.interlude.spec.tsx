import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimeline, type TimelineInputs } from '../../../src/hooks/useTimeline';
import { replayFixture } from '../fixtures/replay';
import { INTERLUDE_CASES } from '../fixtures/variation-interludes';

const { snapshots } = replayFixture('singles');

/**
 * Round 88 (T348, #84): the timeline reads a history with replacements on both sides by the one rule. The span, the tip and
 * the recorded position of every pointer turn count real turns, so the dock's position is the one the frame shows.
 */
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
