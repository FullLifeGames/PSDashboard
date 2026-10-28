import { useRef, useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { replayFixture } from '../fixtures/replay';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { usePlayOut } from '../../../src/hooks/usePlayOut';
import { useTransients } from '../../../src/hooks/controller/transients';
import { useEvalView } from '../../../src/hooks/useEvalView';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import type { TeamBuildSources } from '../../../src/lib/eval-acquire';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import type { FormatKind } from '../fixtures/sim-state';

// Round 77 (code-reading note of lane C): a play-out asked for more than one evaluation per position. The loop's own
// re-evaluation after an executed turn, its idle kick and the Auto effect of the view all fire in the commit where the turn lands.

type Evaluation = ReturnType<typeof useEvaluation>;
type Status = Evaluation['status'];

const START_TURN = 3;

const sources = {
  teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null },
  hpEvidence: [], getInferredSpreads: async () => undefined,
} as unknown as TeamBuildSources;

/**
 * The real play-out loop next to the real view hook (its Auto effect and Evaluate action), over a scripted evaluation and a
 * scripted branch: an executed turn lands as one history entry plus the end of `executing` in the same tick (execute.ts), a
 * forced replacement lands as an entry that consumes no turn. `evaluate` counts what the worker would be asked.
 */
function useRunHarness(kind: FormatKind, forcedAt: number[], endAfterTurns: number) {
  const { replayData, snapshots } = replayFixture(kind === 'doubles' ? 'doubles' : 'singles');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [resultTag, setResultTag] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [entries, setEntries] = useState(0);
  const [turns, setTurns] = useState(0);
  const counts = useRef({ evaluate: 0, tags: [] as (string | null)[], pendingTag: null as string | null });
  const viewTurn = START_TURN + turns;
  const evalViewKey = `variation:${viewTurn}`;
  const evaluation = {
    prefs: { depth: 1, samples: 1, mode: 'matrix', auto, autoAnalyze: false, tera: 'auto' },
    setPrefs: (next: { auto: boolean }) => setAuto(next.auto),
    setEngineOverride: vi.fn(), runGraphSweep: vi.fn(), reset: vi.fn(), clearGraph: vi.fn(),
    markStale: () => setStatus(previous => (previous === 'done' ? 'stale' : previous)),
    evaluate: (params: { tag?: string | null }) => {
      counts.current.evaluate += 1;
      counts.current.tags.push(params.tag ?? null);
      counts.current.pendingTag = params.tag ?? null;
      setStatus('reconstructing');
      setResult(null);
      setResultTag(params.tag ?? null);
    },
    status, result, resultTag, error: null,
    graph: evalGraph(kind, { scores: Array(10).fill(null), results: Array(10).fill(null), settings: Array(10).fill(null) }),
  } as unknown as Evaluation;
  // The board layer's reading of a result that belongs to another position.
  const liveEvalStatus: Status = status === 'done' && resultTag !== evalViewKey ? 'stale' : status;
  const transients = useTransients('gen9ou-1');
  const land = (kindOfEntry: 'turn' | 'forced') => {
    setExecuting(true);
    void Promise.resolve().then(() => {
      // One tick, as execute.ts does: the history entry and the end of `executing` batch into one render.
      setEntries(count => count + 1);
      if (kindOfEntry === 'turn') setTurns(count => count + 1);
      setExecuting(false);
    });
  };
  const handleEvaluate = useEvalView({
    replayData, snapshots, evaluation, replayGameType: kind === 'doubles' ? 'doubles' : 'singles', evalIsDoubles: kind === 'doubles',
    viewTurn, viewLine: 'variation', viewingVariation: true, liveTip: true, liveEvalView: true, evalViewKey, serializedAtView: null,
    liveEvalStatus, analysisTurn: viewTurn, analyzableTurns: 6, branching: true, executing, branchPreparing: false,
    playOutActive: transients.playOut?.active ?? false, smogonPending: false,
    acquire: { acquireBranchPosition: vi.fn(), acquireReplayPosition: vi.fn(), makeReplayAcquire: vi.fn(), makeSweepAcquireAll: vi.fn(() => vi.fn()) },
    sources, bringOnlyLists: null, setsFingerprint: 'fp', sensitivityTargetsFor: () => [], editedP1Info: null, editedP2Info: null,
    historyLength: entries, setVariationScores: vi.fn(),
  }).handleEvaluate;
  const playOut = usePlayOut({
    playOut: transients.playOut, setPlayOut: transients.setPlayOut, setPlayOutNotice: transients.setPlayOutNotice,
    playOutProcessedRef: transients.playOutProcessedRef, playOutRef: transients.playOutRef, stopPlayOutRef: transients.stopPlayOutRef,
    evaluation, fastPlayOut: false, evalViewKey, liveEvalStatus, liveTip: true, viewingVariation: true, atEndPosition: false,
    viewT0: false, viewTurn, tipTurn: viewTurn, holdTipFollow: vi.fn(), navigateTo: vi.fn(), setNavSeek: vi.fn(),
    executing, branchPreparing: false,
    getBattle: () => ({ ended: turns >= endAfterTurns }) as never,
    executeTurn: async () => { land('turn'); await Promise.resolve(); return null; },
    handleEvaluate,
    // The forced side of a one-sided position executes at once, like setChoice does for a forced replacement.
    applyEvalChoice: () => { if (forcedAt.includes(entries) && !executing) land('forced'); return true; },
    requestDeviation: vi.fn(), startLeadVariation: vi.fn(), leadPicksRef: { current: null }, setVariationNotice: vi.fn(),
  });
  const deliver = () => {
    const oneSided = forcedAt.includes(entries);
    const base = evalResult(kind);
    setResult(oneSided ? { ...base, perSide: { p1: base.perSide.p1, p2: [{ ...base.perSide.p2[0], choice: 'wait' }] } } : base);
    setResultTag(counts.current.pendingTag);
    setStatus('done');
  };
  return { counts, playOut, transients, deliver, status, turns, entries };
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Plays a run to its end: deliver the finished evaluation of every position the loop asked for. */
async function runToEnd(kind: FormatKind, forcedAt: number[], endAfterTurns: number) {
  const hook = renderHook(() => useRunHarness(kind, forcedAt, endAfterTurns));
  act(() => hook.result.current.playOut.startPlayOut());
  // Evaluations that finish are delivered one by one: the harness answers the latest request.
  for (let guard = 0; guard < 40 && hook.result.current.transients.playOut?.active; guard += 1) {
    if (hook.result.current.status === 'reconstructing') act(() => hook.result.current.deliver());
    await settle();
  }
  return hook.result.current;
}

describe('a play-out evaluates every position once', () => {
  test.each(['singles', 'doubles'] as const)('%s: one evaluation for the start and one after every executed turn', async kind => {
    const done = await runToEnd(kind, [], 3);
    expect(done.transients.playOut).toBeNull();
    expect(done.turns).toBe(3);
    // The start position, then the positions after turns 1, 2 and 3 (the last one only tells that the battle ended).
    expect(done.counts.current.evaluate).toBe(4);
    // Each one is tagged with the position it was asked for, never with the turn before.
    expect(done.counts.current.tags).toEqual(['variation:3', 'variation:4', 'variation:5', 'variation:6']);
  });

  test.each(['singles', 'doubles'] as const)('%s: a forced replacement is a position of its own and is evaluated once', async kind => {
    // The position after the first turn needs a replacement (history entry 1), then two more turns follow.
    const done = await runToEnd(kind, [1], 3);
    expect(done.transients.playOut).toBeNull();
    expect(done.turns).toBe(3);
    expect(done.entries).toBe(4);
    // Start, after turn 1, after the forced entry, after turns 2 and 3.
    expect(done.counts.current.evaluate).toBe(5);
    expect(done.counts.current.tags).toEqual(['variation:3', 'variation:4', 'variation:4', 'variation:5', 'variation:6']);
  });
});
