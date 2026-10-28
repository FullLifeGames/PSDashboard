import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalResult, EvalSettings } from '@fulllifegames/eval-engine';
import { evalGraph, evalResult } from '../fixtures/eval-result';

// Round 77 (C1): a single evaluation started while a sweep runs used to bump the shared run counter without clearing the
// sweep's running flag, so "analyzing… turn 0/2" and Cancel stayed on screen for good. The sweep is the same code for
// singles and doubles (the game type only picks the engine), so the specs run on the sweep's own surface.
const script = vi.hoisted(() => ({
  evaluate: null as null | ((serialized: string, settings: EvalSettings) => Promise<EvalResult>),
}));

vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(serialized: string, settings: EvalSettings) {
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate(serialized, settings);
    }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');
const { useEvalView } = await import('../../../src/hooks/useEvalView');
const { replayFixture } = await import('../fixtures/replay');

const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });

beforeEach(() => {
  // The sweep's searches never answer: the sweep stays running until something stops it.
  script.evaluate = () => new Promise<EvalResult>(() => {});
});
afterEach(() => localStorage.clear());

const miniSweep = (from: number, to: number) => ({
  turns: 6, from, to, tera: false as const, rules: logRules(''), ruleset: 'standard' as const, doubles: false,
  cacheKeyFor: (turn: number) => `replay:${turn}:fp`, acquireFor: () => async () => position, playedFor: () => null,
});

describe('a single evaluation and a running sweep (C1)', () => {
  test('a manual Evaluate stops the sweep and the graph says where it stopped; the Analyze buttons come back at once', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.runGraphSweep(miniSweep(3, 4)));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    expect(result.current.graph.progress).toEqual({ done: 0, total: 2 });

    act(() => result.current.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position, tag: 'variation:3' }));

    expect(result.current.graph.running).toBe(false);
    expect(result.current.graph.progress).toBeNull();
    expect(result.current.graph.stopped).toEqual({ done: 0, total: 2 });
  });

  test('a cache hit of Evaluate stops the sweep the same way', async () => {
    script.evaluate = async () => evalResult('singles', { score: 0.2 });
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: 'replay:1:fp', tera: false, ruleset: 'standard', acquire: async () => position, tag: 'main:1' }));
    await waitFor(() => expect(result.current.status).toBe('done'));

    script.evaluate = () => new Promise<EvalResult>(() => {});
    act(() => result.current.runGraphSweep(miniSweep(2, 3)));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    act(() => result.current.evaluate({ cacheKey: 'replay:1:fp', tera: false, ruleset: 'standard', acquire: async () => position, tag: 'main:1' }));
    expect(result.current.graph.running).toBe(false);
    expect(result.current.graph.stopped).toEqual({ done: 0, total: 2 });
  });

  test('Cancel on the sweep and a new sweep leave no stopped note behind', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.runGraphSweep(miniSweep(3, 4)));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    act(() => result.current.cancel());
    expect(result.current.graph.running).toBe(false);
    expect(result.current.graph.stopped ?? null).toBeNull();

    act(() => result.current.runGraphSweep(miniSweep(3, 4)));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position }));
    expect(result.current.graph.stopped).not.toBeNull();
    act(() => result.current.runGraphSweep(miniSweep(3, 4)));
    expect(result.current.graph.stopped ?? null).toBeNull();
  });
});

describe('the auto re-evaluation waits for a running sweep (C1)', () => {
  const { replayData, snapshots } = replayFixture('singles');
  const sources = { teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null }, hpEvidence: [], getInferredSpreads: async () => undefined } as never;
  const viewInputs = (evaluation: ReturnType<typeof useEvaluation>) => ({
    replayData, snapshots, evaluation, replayGameType: 'singles', evalIsDoubles: false, viewTurn: 3, viewLine: 'variation' as const,
    viewingVariation: false, liveTip: true, liveEvalView: true, evalViewKey: 'variation:3', serializedAtView: null,
    liveEvalStatus: 'stale' as const, analysisTurn: 3, analyzableTurns: 6, branching: true, executing: false, branchPreparing: false,
    playOutActive: false, smogonPending: false,
    acquire: { acquireBranchPosition: vi.fn(), acquireReplayPosition: vi.fn(), makeReplayAcquire: vi.fn(), makeSweepAcquireAll: vi.fn(() => vi.fn()) },
    sources, bringOnlyLists: null, setsFingerprint: 'fp1', sensitivityTargetsFor: vi.fn(() => []), editedP1Info: null, editedP2Info: null,
    historyLength: 0, setVariationScores: vi.fn(),
  });

  test('with Auto on and a stale live position, no evaluation starts while the sweep runs; it starts once the sweep ended', () => {
    const evaluate = vi.fn();
    const base = {
      evaluate, runGraphSweep: vi.fn(), markStale: vi.fn(), reset: vi.fn(), clearGraph: vi.fn(), setPrefs: vi.fn(),
      prefs: { ...matrixPrefs, auto: true }, status: 'stale', result: null, resultTag: null,
    };
    const running = { ...base, graph: evalGraph('singles', { running: true, progress: { done: 0, total: 2 } }) } as unknown as ReturnType<typeof useEvaluation>;
    const { rerender } = renderHook((props: ReturnType<typeof useEvaluation>) => useEvalView(viewInputs(props) as never), { initialProps: running });
    expect(evaluate).not.toHaveBeenCalled();

    rerender({ ...base, graph: evalGraph('singles', { running: false }) } as unknown as ReturnType<typeof useEvaluation>);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
