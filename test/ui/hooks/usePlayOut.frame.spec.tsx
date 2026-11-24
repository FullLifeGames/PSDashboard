import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { usePlayOut } from '../../../src/hooks/usePlayOut';
import { useTimeline } from '../../../src/hooks/useTimeline';
import { useTransients } from '../../../src/hooks/controller/transients';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

type Evaluation = ReturnType<typeof useEvaluation>;
const GUARD_MS = 20_000; // PLAY_IN_GUARD_MS, src/hooks/useTimeline.ts
const FIRST_TURN = 3;

const entry = (turnNumber: number): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move a', p2Choice: 'move b', serializedPosition: `pos-${turnNumber}`,
  p1Active: null, p1ActiveSlots: [], p2Active: null, p2ActiveSlots: [], p1Pokemon: [], p2Pokemon: [],
});

function harness(kind: 'singles' | 'doubles') {
  const { snapshots } = replayFixture(kind);
  const executeSpy = vi.fn();
  const hook = renderHook(() => {
    const transients = useTransients('gen9ou-1');
    const [history, setHistory] = useState<BranchHistoryEntry[]>([entry(2)]);
    const [executing, setExecuting] = useState(false);
    const [ev, setEv] = useState<{ status: 'idle' | 'done'; result: EvalResult | null; tag: string | null }>({ status: 'idle', result: null, tag: null });
    const timeline = useTimeline({
      replayId: 'gen9ou-1', snapshots, branching: true, variationStartTurn: 2, history,
      interruptPlayOut: transients.interruptPlayOut, onNavigate: () => {}, executing,
    });
    const evaluation = {
      prefs: { depth: 1, samples: 1, mode: 'matrix', auto: true, autoAnalyze: false, tera: 'auto' },
      setPrefs: () => {}, setEngineOverride: () => {},
      status: ev.status, result: ev.result, resultTag: ev.tag, error: null,
    } as unknown as Evaluation;
    usePlayOut({
      playOut: transients.playOut, setPlayOut: transients.setPlayOut, setPlayOutNotice: transients.setPlayOutNotice,
      playOutProcessedRef: transients.playOutProcessedRef, playOutRef: transients.playOutRef, stopPlayOutRef: transients.stopPlayOutRef,
      evaluation, fastPlayOut: false,
      tip: timeline.tip, tipEvalStatus: ev.status === 'done' && ev.tag !== timeline.tip?.key ? 'stale' : ev.status, liveTip: timeline.liveTip,
      viewingVariation: timeline.viewingVariation, atEndPosition: false, viewT0: timeline.viewT0, viewTurn: timeline.viewTurn,
      tipTurn: timeline.tipTurn, holdTipFollow: timeline.holdTipFollow, navigateTo: timeline.navigateTo, setNavSeek: timeline.setNavSeek,
      executing, executeError: null, branchPreparing: false,
      getBattle: (() => ({ ended: false })) as never,
      executeTurn: async () => { executeSpy(); setExecuting(true); await Promise.resolve(); setHistory(h => [...h, entry(2 + h.length)]); setExecuting(false); return null as never; },
      handleEvaluate: vi.fn(), applyEvalChoice: () => true,
      requestDeviation: () => {}, startLeadVariation: () => {}, leadPicksRef: { current: null }, setVariationNotice: () => {},
    });
    return { transients, timeline, setEv, setHistory };
  });
  const cur = () => hook.result.current;
  const result = (tag: string) => act(async () => { cur().setEv({ status: 'done', result: evalResult(kind), tag }); });
  const frame = (turn: number) => act(() => cur().timeline.handleReplayTurn(turn));
  const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
  const land = () => act(async () => { cur().setHistory(h => [...h, entry(2 + h.length)]); });
  const view = () => ({
    tip: cur().timeline.tipTurn, pointer: cur().timeline.viewTurn, liveTip: cur().timeline.liveTip,
    executed: executeSpy.mock.calls.length, active: !!cur().transients.playOut?.active,
  });
  async function armAndLand() {
    await act(async () => { cur().transients.setPlayOut({ active: true, executed: 0, turns: 0, startTurn: FIRST_TURN, prevAuto: false }); });
    await result(`variation:${FIRST_TURN}`);
    await act(async () => {});
  }
  return { armAndLand, result, frame, advance, land, view };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

for (const kind of ['singles', 'doubles'] as const) {
  describe(`play-out and the frame's reports, ${kind}`, () => {
    test('A (guard): a pause on the turn being played in, inside the guard, keeps the run going', async () => {
      const h = harness(kind);
      await h.armAndLand();
      expect(h.view()).toMatchObject({ tip: 4, executed: 1, active: true });
      h.frame(3);
      await h.advance(5_000);
      expect(h.view().liveTip).toBe(true);
      await h.result('variation:4');
      expect(h.view()).toMatchObject({ executed: 2, active: true });
    });

    test('B: a pause after the frame landed on the tip does not stop the next turn', async () => {
      const h = harness(kind);
      await h.armAndLand();
      h.frame(4);
      await h.advance(2_000);
      h.frame(3);
      await h.result('variation:4');
      await h.advance(1_000);
      expect(h.view()).toMatchObject({ executed: 2, active: true });
    });

    test('C: a pause after the guard lapsed does not stop the next turn', async () => {
      const h = harness(kind);
      await h.armAndLand();
      await h.advance(GUARD_MS + 1);
      h.frame(3);
      await h.result('variation:4');
      await h.advance(1_000);
      expect(h.view()).toMatchObject({ executed: 2, active: true });
    });

    test('E (guard): a landing with the frame parked off the tip brings the pointer back to the new tip', async () => {
      const h = harness(kind);
      await h.armAndLand();
      h.frame(4);
      h.frame(3);
      await h.land();
      expect(h.view()).toMatchObject({ tip: 5, liveTip: true });
    });
  });
}
