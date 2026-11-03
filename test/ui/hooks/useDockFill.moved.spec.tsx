import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A7h: the key of the fill moves while an evaluation is under way (a forced replacement is sent and
 * the next request of the same turn begins; both carry the evalViewKey `variation:2`). The run that was under way belongs to the
 * request before; its result must not fill the new request. The fill starts its own run for it and applies that one.
 */

const script = vi.hoisted(() => ({ evaluate: null as null | (() => Promise<EvalResult>) }));

vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate() {
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate();
    }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation: useRealEvaluation } = await import('../../../src/hooks/useEvaluation');
const { useDockFill } = await import('../../../src/hooks/useDockFill');

const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const KEY = 'variation:2';

/** Two runs the test releases by hand, in the order the fill starts them. */
function scriptRuns() {
  const runs: ((value: EvalResult) => void)[] = [];
  script.evaluate = () => new Promise<EvalResult>(resolve => { runs.push(resolve); });
  return runs;
}

function useFilled(kind: FormatKind, historyLength: number, setChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, slot?: number) => void) {
  const evaluation = useRealEvaluation();
  const handleEvaluate = (options?: { onResult?: (result: EvalResult) => void }) => evaluation.evaluate({
    cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position, tag: KEY, onResult: options?.onResult,
  });
  const fill = useDockFill({
    simState: simState(kind), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation, liveEvalStatus: evaluation.status, evalViewKey: KEY, historyLength, sessionKey: 's',
    handleEvaluate, getChoices: () => ({ p1: [], p2: [] }), setChoice, executeTurn: async () => null,
  });
  return { evaluation, fill };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify(matrixPrefs));
});

describe('useDockFill: the key moves while a run is under way', () => {
  test.each(['singles', 'doubles'] as const)('%s: the run of the request before does not fill the next one; the fill runs its own', async (kind) => {
    const runs = scriptRuns();
    const setChoice = vi.fn();
    const { result, rerender } = renderHook((props: { history: number }) => useFilled(kind, props.history, setChoice), { initialProps: { history: 1 } });
    await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
    expect(runs).toHaveLength(1);
    // The forced replacement is sent: the history grows by one, the evaluation's tag (the turn) stays.
    rerender({ history: 2 });
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(result.current.fill.pending).toBe(true);
    // The first run lands late: it is the replacement's analysis, so it fills nothing.
    await act(async () => runs[0](evalResult(kind)));
    expect(setChoice).not.toHaveBeenCalled();
    expect(result.current.fill.engine).toEqual({ p1: [], p2: [] });
    expect(result.current.fill.pending).toBe(true);
    // The fill's own run lands: it fills the new request.
    await act(async () => runs[1](evalResult(kind)));
    await waitFor(() => expect(result.current.evaluation.status).toBe('done'));
    expect(setChoice).toHaveBeenCalledWith('p1', expect.anything(), 0);
    expect(result.current.fill.pending).toBe(false);
    expect(result.current.fill.engine.p1[0]).toBe(true);
    expect(runs).toHaveLength(2);
  });

  test('a run that finished before the key moved still counts as the base: the next result fills (the slow case)', async () => {
    const runs = scriptRuns();
    const setChoice = vi.fn();
    const { result, rerender } = renderHook((props: { history: number }) => useFilled('singles', props.history, setChoice), { initialProps: { history: 1 } });
    await waitFor(() => expect(runs).toHaveLength(1));
    await act(async () => runs[0](evalResult('singles')));
    await waitFor(() => expect(result.current.evaluation.status).toBe('done'));
    setChoice.mockClear();
    rerender({ history: 2 });
    await waitFor(() => expect(runs).toHaveLength(2));
    await act(async () => runs[1](evalResult('singles')));
    await waitFor(() => expect(setChoice).toHaveBeenCalledWith('p1', expect.anything(), 0));
    expect(result.current.fill.pending).toBe(false);
  });

  test('the game analysis holds the fill while the foreign run lands: that result still fills nothing, and the fill runs once the analysis ended', () => {
    const evaluationOf = (status: string, result: EvalResult | null, graphRunning: boolean) => ({
      status, result, resultTag: KEY, prefs: { ...matrixPrefs }, graph: { running: graphRunning },
    }) as never;
    const setChoice = vi.fn();
    const handleEvaluate = vi.fn();
    const wired = {
      simState: simState('singles'), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
      evalAvailable: true, evaluation: evaluationOf('searching', null, true), liveEvalStatus: 'searching' as const, evalViewKey: KEY,
      historyLength: 1, sessionKey: 's', handleEvaluate, getChoices: () => ({ p1: [], p2: [] }), setChoice, executeTurn: async () => null,
    };
    const { rerender } = renderHook((props: typeof wired) => useDockFill(props), { initialProps: wired });
    // The key moves while the run is under way and the game analysis starts: the fill may not run.
    rerender({ ...wired, historyLength: 2, evaluation: evaluationOf('searching', null, true) });
    const landed = evalResult('singles');
    rerender({ ...wired, historyLength: 2, evaluation: evaluationOf('done', landed, true), liveEvalStatus: 'done' });
    rerender({ ...wired, historyLength: 2, evaluation: evaluationOf('done', landed, false), liveEvalStatus: 'done' });
    expect(setChoice).not.toHaveBeenCalled();
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });
});
