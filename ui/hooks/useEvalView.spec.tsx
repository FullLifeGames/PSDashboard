import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { useEvalView, type EvalViewInputs } from '../../src/hooks/useEvalView';
import type { useEvaluation } from '../../src/hooks/useEvaluation';
import type { TeamBuildSources } from '../../src/lib/eval-acquire';
import { evalGraph, evalResult } from '../fixtures/eval-result';
import { replayFixture } from '../fixtures/replay';

type Evaluation = ReturnType<typeof useEvaluation>;

const { replayData, snapshots } = replayFixture('singles');

interface EvalShape {
  status?: Evaluation['status'];
  result?: EvalResult | null;
  resultTag?: string | null;
  graph?: Evaluation['graph'];
  prefs?: Partial<Evaluation['prefs']>;
}

/** The evaluation surface as the view hook reads it, every action a spy. */
function evaluationOf(shape: EvalShape = {}) {
  const spies = { evaluate: vi.fn(), runGraphSweep: vi.fn(), markStale: vi.fn(), reset: vi.fn(), clearGraph: vi.fn(), setPrefs: vi.fn() };
  const prefs = { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto', ...shape.prefs } as Evaluation['prefs'];
  const evaluation = {
    ...spies, prefs, status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.resultTag ?? null,
    graph: shape.graph ?? evalGraph('singles', { scores: Array(10).fill(null), results: Array(10).fill(null), settings: Array(10).fill(null) }),
  } as unknown as Evaluation;
  return { evaluation, spies };
}

const sources = { teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null }, hpEvidence: [], getInferredSpreads: async () => undefined } as unknown as TeamBuildSources;

function inputs(evaluation: Evaluation, overrides: Partial<EvalViewInputs> = {}): EvalViewInputs {
  return {
    replayData, snapshots, evaluation, replayGameType: 'singles', evalIsDoubles: false, viewTurn: 3, viewLine: 'main',
    viewingVariation: false, liveTip: false, liveEvalView: false, evalViewKey: 'main:3', serializedAtView: null,
    liveEvalStatus: 'idle', analysisTurn: 3, analyzableTurns: 6, branching: false, executing: false, branchPreparing: false,
    playOutActive: false, smogonPending: false,
    acquire: { acquireBranchPosition: vi.fn(), acquireReplayPosition: vi.fn(), makeReplayAcquire: vi.fn(), makeSweepAcquireAll: vi.fn(() => vi.fn()) },
    sources, bringOnlyLists: null, setsFingerprint: 'fp1', sensitivityTargetsFor: vi.fn(() => []), editedP1Info: null, editedP2Info: null,
    historyLength: 0, setVariationScores: vi.fn(),
    ...overrides,
  };
}

describe('useEvalView', () => {
  test('resolves the format switches: Tera, Sleep Clause, and whether the format is evaluable', () => {
    const { evaluation } = evaluationOf();
    const singles = renderHook(() => useEvalView(inputs(evaluation)));
    expect(singles.result.current).toMatchObject({ effectiveSleepClause: false, evalAvailable: true });
    expect(singles.result.current.effectiveTera).toBe(false);
    const triples = renderHook(() => useEvalView(inputs(evaluation, { replayGameType: 'triples' })));
    expect(triples.result.current.evalAvailable).toBe(false);
    const empty = renderHook(() => useEvalView(inputs(evaluation, { replayData: null, snapshots: [] })));
    expect(empty.result.current.evalAvailable).toBe(false);
  });

  test('Evaluate targets the position under the pointer: live sim, recorded variation, or cached main line', async () => {
    const { evaluation, spies } = evaluationOf();
    const wired = inputs(evaluation, { liveTip: true, liveEvalView: true, evalViewKey: 'variation:3' });
    const { result, rerender } = renderHook((props: EvalViewInputs) => useEvalView(props), { initialProps: wired });

    act(() => result.current.handleEvaluate());
    expect(spies.evaluate).toHaveBeenLastCalledWith(expect.objectContaining({ cacheKey: null, tag: 'variation:3', acquire: wired.acquire.acquireBranchPosition }));

    rerender(inputs(evaluation, { viewingVariation: true, liveEvalView: true, serializedAtView: '{"turn":3}', evalViewKey: 'variation:3' }));
    act(() => result.current.handleEvaluate());
    const recorded = spies.evaluate.mock.calls.at(-1)![0] as { cacheKey: string | null; acquire: () => Promise<string> };
    expect(recorded.cacheKey).toBeNull();
    await expect(recorded.acquire()).resolves.toBe('{"turn":3}');

    const main = inputs(evaluation);
    rerender(main);
    act(() => result.current.handleEvaluate());
    expect(spies.evaluate).toHaveBeenLastCalledWith(expect.objectContaining({ cacheKey: `${replayData.id}:3:fp1`, tag: 'main:3', acquire: main.acquire.acquireReplayPosition }));
  });

  test('a finished evaluation on the variation feeds the graph overlay at its own turn only', () => {
    const done = evalResult('singles', { score: 0.42 });
    const { evaluation } = evaluationOf({ status: 'done', result: done, resultTag: 'variation:4' });
    const setVariationScores = vi.fn();
    renderHook(() => useEvalView(inputs(evaluation, { viewingVariation: true, viewTurn: 4, evalViewKey: 'variation:4', setVariationScores })));
    const updater = setVariationScores.mock.calls[0][0] as (previous: (number | null)[]) => (number | null)[];
    expect(updater([0.1, null, null])).toEqual([0.1, null, null, 0.42]);

    const stale = vi.fn();
    renderHook(() => useEvalView(inputs(evaluation, { viewingVariation: true, viewTurn: 5, evalViewKey: 'variation:5', setVariationScores: stale })));
    expect(stale).not.toHaveBeenCalled();
  });

  test('Analyze game sweeps every played turn; the deepen sweep covers the turn and its follow-up', () => {
    const { evaluation, spies } = evaluationOf();
    const { result } = renderHook(() => useEvalView(inputs(evaluation, { analyzableTurns: 6 })));
    act(() => result.current.handleAnalyzeGame());
    const sweep = spies.runGraphSweep.mock.calls[0][0] as { turns: number; cacheKeyFor: (turn: number) => string; storePrefix: string; from?: number };
    expect(sweep.turns).toBe(6);
    expect(sweep.from).toBeUndefined();
    expect(sweep.cacheKeyFor(3)).toBe(`${replayData.id}:3:fp1`);

    act(() => result.current.analyzeTurnNow(6, { depth: 2, samples: 3, mode: 'matrix' }));
    expect(spies.runGraphSweep.mock.calls[1][0]).toMatchObject({ from: 6, to: 6, settings: { depth: 2, samples: 3, mode: 'matrix' } });
  });

  test('the deepening ladder: sketch to configured, then one depth further, never past a tree or depth 3', () => {
    const graph = evalGraph('singles', {
      settings: [
        { depth: 1, samples: 1, mode: 'matrix' }, { depth: 2, samples: 3, mode: 'matrix' }, { depth: 3, samples: 1, mode: 'matrix' },
        { depth: 1, samples: 1, mode: 'mcts' }, null, null, null, null, null, null,
      ],
      faintedFractions: [0, 0.1, 0.2, 0.3, 0.5, null, null, null, null, null],
    });
    const { evaluation } = evaluationOf({ graph, prefs: { depth: 1, samples: 1, mode: 'matrix' } });
    const targetAt = (analysisTurn: number | null, extra: Partial<EvalViewInputs> = {}) =>
      renderHook(() => useEvalView(inputs(evaluation, { analysisTurn, ...extra }))).result.current.thinkDeeperTarget;

    expect(targetAt(1)).toEqual({ depth: 2, samples: 1, mode: 'matrix' });
    expect(targetAt(2)).toEqual({ depth: 3, samples: 3, mode: 'matrix' });
    expect(targetAt(3)).toBeNull();
    // A tree result under matrix preferences is a mode change: the rung is the configured engine.
    expect(targetAt(4)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
    expect(targetAt(5)).toEqual({ depth: 1, samples: 1, mode: 'matrix' });
    expect(targetAt(null)).toBeNull();
    expect(targetAt(1, { liveEvalView: true })).toBeNull();

    // A tree turn under tree preferences is the deepest engine the panel has: no rung.
    const tree = evaluationOf({ graph, prefs: { mode: 'mcts' } }).evaluation;
    expect(renderHook(() => useEvalView(inputs(tree, { analysisTurn: 4 }))).result.current.thinkDeeperTarget).toBeNull();

    const auto = evaluationOf({ graph, prefs: { mode: 'auto' } }).evaluation;
    const autoTarget = renderHook(() => useEvalView(inputs(auto, { analysisTurn: 6 }))).result.current.thinkDeeperTarget;
    expect(autoTarget).toEqual({ mode: 'auto' });
  });

  test('the analyzed result follows the selected turn in replay view and the live result on the sim', () => {
    const graph = evalGraph('singles');
    const live = evalResult('singles', { score: 0.9 });
    const { evaluation } = evaluationOf({ graph, result: live });
    const stored = renderHook(() => useEvalView(inputs(evaluation, { analysisTurn: 2 })));
    expect(stored.result.current.analyzedResult).toBe(graph.results[1]);
    expect(stored.result.current.analyzedSettings).toEqual(graph.settings[1]);
    const onSim = renderHook(() => useEvalView(inputs(evaluation, { liveEvalView: true, analysisTurn: 2 })));
    expect(onSim.result.current.analyzedResult).toBe(live);
    expect(onSim.result.current.analyzedSettings).toBeNull();
    const lead = renderHook(() => useEvalView(inputs(evaluation, { analysisTurn: 0 })));
    expect(lead.result.current.analyzedResult).toBeNull();
  });

  test('housekeeping: position changes mark the result stale, a new replay resets, new set knowledge clears the graph', () => {
    const { evaluation, spies } = evaluationOf();
    const { rerender } = renderHook((props: EvalViewInputs) => useEvalView(props), { initialProps: inputs(evaluation) });
    const counts = () => ({ stale: spies.markStale.mock.calls.length, reset: spies.reset.mock.calls.length, clear: spies.clearGraph.mock.calls.length });
    const before = counts();

    rerender(inputs(evaluation, { viewTurn: 4 }));
    expect(counts().stale).toBe(before.stale + 1);
    rerender(inputs(evaluation, { viewTurn: 4, replayData: { ...replayData, id: 'other' } }));
    expect(counts().reset).toBe(before.reset + 1);
    rerender(inputs(evaluation, { viewTurn: 4, replayData: { ...replayData, id: 'other' }, setsFingerprint: 'fp2' }));
    expect(counts().clear).toBe(before.clear + 2);
  });

  test('auto keeps a stale live position fresh; always-on starts the sweep once per replay and set knowledge', () => {
    const { evaluation, spies } = evaluationOf({ prefs: { auto: true } });
    renderHook(() => useEvalView(inputs(evaluation, { branching: true, liveEvalView: true, liveTip: true, liveEvalStatus: 'stale', evalViewKey: 'variation:3' })));
    expect(spies.evaluate).toHaveBeenCalledTimes(1);

    const always = evaluationOf({ prefs: { autoAnalyze: true } });
    const { rerender } = renderHook((props: EvalViewInputs) => useEvalView(props), { initialProps: inputs(always.evaluation) });
    expect(always.spies.runGraphSweep).toHaveBeenCalledTimes(1);
    rerender(inputs(always.evaluation, { viewTurn: 5 }));
    expect(always.spies.runGraphSweep).toHaveBeenCalledTimes(1);

    const pending = evaluationOf({ prefs: { autoAnalyze: true } });
    renderHook(() => useEvalView(inputs(pending.evaluation, { smogonPending: true })));
    expect(pending.spies.runGraphSweep).not.toHaveBeenCalled();
  });
});
