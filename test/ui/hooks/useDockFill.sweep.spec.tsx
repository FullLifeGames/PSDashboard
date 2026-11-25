import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { simState } from '../fixtures/sim-state';

// A single evaluation stops the analysis sweep, so the fill must never start while the sweep runs.
vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate() { return new Promise<EvalResult>(() => {}); }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');
const { useEvalView } = await import('../../../src/hooks/useEvalView');
const { useDockFill } = await import('../../../src/hooks/useDockFill');
const { replayFixture } = await import('../fixtures/replay');

const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const sources = { teamText: '', effectiveP1Info: null, effectiveP2Info: null, usageStats: { stats: null }, setAssumptions: { assumptions: null }, hpEvidence: [], getInferredSpreads: async () => undefined } as never;
const { replayData, snapshots } = replayFixture('singles');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify(matrixPrefs));
});
afterEach(() => localStorage.clear());

const miniSweep = () => ({
  turns: 6, from: 3, to: 4, tera: false as const, rules: logRules(''), ruleset: 'standard' as const, doubles: false,
  cacheKeyFor: (turn: number) => `replay:${turn}:fp`, acquireFor: () => async () => position, playedFor: () => null,
});

interface Where { branching: boolean }

function useWired(where: Where, calls: string[]) {
  const evaluation = useEvaluation();
  const tip = where.branching;
  const evalViewKey = tip ? 'variation:3' : 'main:3';
  const view = useEvalView({
    replayData, snapshots, evaluation, replayGameType: 'singles', evalIsDoubles: false, viewTurn: 3, viewLine: tip ? 'variation' : 'main',
    viewingVariation: false, liveTip: tip, liveEvalView: tip, evalViewKey, serializedAtView: null,
    liveEvalStatus: evaluation.status, analysisTurn: 3, analyzableTurns: 6, branching: where.branching, executing: false,
    branchPreparing: false, playOutActive: false, smogonPending: false,
    acquire: { acquireBranchPosition: async () => position, acquireReplayPosition: async () => position, makeReplayAcquire: vi.fn(), makeSweepAcquireAll: vi.fn(() => vi.fn()) },
    sources, bringOnlyLists: null, setsFingerprint: 'fp1', sensitivityTargetsFor: vi.fn(() => []), editedP1Info: null, editedP2Info: null,
    historyLength: 1, setVariationScores: vi.fn(),
  } as never);
  const fill = useDockFill({
    simState: simState('singles'), liveTip: tip, branching: where.branching, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: view.evalAvailable, evaluation, liveEvalStatus: evaluation.status, evalViewKey, historyLength: 1, sessionKey: 's',
    handleEvaluate: options => { calls.push(evalViewKey); view.handleEvaluate(options); },
    getChoices: () => ({ p1: [], p2: [] }), setChoice: vi.fn(), executeTurn: vi.fn(async () => null),
  });
  return { evaluation, fill };
}

describe('the engine fill and the game analysis', () => {
  test('a sweep started at the replay turn is over when Execute opens the variation, so the fill starts and stops nothing', async () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook((where: Where) => useWired(where, calls), { initialProps: { branching: false } });
    act(() => result.current.evaluation.runGraphSweep(miniSweep()));
    await waitFor(() => expect(result.current.evaluation.graph.running).toBe(true));
    expect(calls).toEqual([]);

    rerender({ branching: true });
    await waitFor(() => expect(result.current.evaluation.graph.running).toBe(false));
    expect(result.current.evaluation.graph.stopped ?? null).toBeNull();
    await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
    expect(calls).toEqual(['variation:3']);
    expect(result.current.fill.busy).toBe(false);
    expect(result.current.fill.pending).toBe(true);
  });

  test('a sweep started at the tip holds the fill: the chips read busy, no second run starts, and the fill starts again after the sweep', async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useWired({ branching: true }, calls));
    await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
    expect(calls).toEqual(['variation:3']);
    expect(result.current.fill.pending).toBe(true);

    act(() => result.current.evaluation.runGraphSweep(miniSweep()));
    await waitFor(() => expect(result.current.evaluation.graph.running).toBe(true));
    expect(result.current.fill.busy).toBe(true);
    expect(result.current.fill.pending).toBe(false);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(result.current.evaluation.graph.running).toBe(true);
    expect(result.current.evaluation.graph.stopped ?? null).toBeNull();
    expect(calls).toEqual(['variation:3']);

    act(() => result.current.evaluation.cancel());
    await waitFor(() => expect(calls).toEqual(['variation:3', 'variation:3']));
    expect(result.current.fill.busy).toBe(false);
  });
  test('at a replay turn a running sweep holds the click-armed fill: busy, no run, the sweep keeps running', async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useWired({ branching: false }, calls));
    act(() => result.current.evaluation.runGraphSweep(miniSweep()));
    await waitFor(() => expect(result.current.evaluation.graph.running).toBe(true));
    act(() => result.current.fill.arm());
    expect(result.current.fill.busy).toBe(true);
    expect(result.current.fill.pending).toBe(false);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(calls).toEqual([]);
    expect(result.current.evaluation.graph.running).toBe(true);
    expect(result.current.evaluation.graph.stopped ?? null).toBeNull();
  });
});
