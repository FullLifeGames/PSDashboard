import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A5: the fill over the real evaluation hook with a scripted worker. The stub spec reads the fill's
 * rules; this one reads that the status a real run goes through (reconstructing, searching, done, error, stopped) holds the
 * chips and Execute exactly as long as the run is pending.
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

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');
const { useDockFill } = await import('../../../src/hooks/useDockFill');

const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };

function useFilled(key: string, onChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, slot?: number) => void, executeTurn: () => Promise<string | null>) {
  const evaluation = useEvaluation();
  const handleEvaluate = (options?: { onResult?: (result: EvalResult) => void }) => evaluation.evaluate({
    cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position, tag: key, onResult: options?.onResult,
  });
  const fill = useDockFill({
    simState: simState('singles'), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation, liveEvalStatus: evaluation.status, evalViewKey: key, historyLength: 1, sessionKey: 's',
    handleEvaluate, getChoices: () => ({ p1: [], p2: [] }), setChoice: onChoice, executeTurn,
  });
  return { evaluation, fill };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify(matrixPrefs));
});

describe('useDockFill over a real evaluation run', () => {
  test('the chips are held from the start of the run to its result, then the fill is written and a waiting Execute runs', async () => {
    let release: (value: EvalResult) => void = () => {};
    script.evaluate = () => new Promise<EvalResult>(resolve => { release = resolve; });
    const setChoice = vi.fn();
    const executeTurn = vi.fn(async () => null);
    const { result } = renderHook(() => useFilled('variation:3', setChoice, executeTurn));
    await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
    expect(result.current.fill.pending).toBe(true);
    act(() => result.current.fill.queueExecute());
    expect(result.current.fill.waits).toBe(true);

    await act(async () => release(evalResult('singles')));
    await waitFor(() => expect(result.current.evaluation.status).toBe('done'));
    expect(setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
    expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect(result.current.fill.pending).toBe(false);
    expect(result.current.fill.waits).toBe(false);
    expect(result.current.fill.engine).toEqual({ p1: [true], p2: [true] });
    // The run is over: nothing starts a second one for the same position.
    expect(result.current.evaluation.status).toBe('done');
  });

  test('a failed run releases the chips and a waiting Execute, and writes nothing', async () => {
    script.evaluate = async () => { throw new Error('worker failed'); };
    const setChoice = vi.fn();
    const executeTurn = vi.fn(async () => null);
    const { result } = renderHook(() => useFilled('variation:3', setChoice, executeTurn));
    act(() => result.current.fill.queueExecute());
    await waitFor(() => expect(result.current.evaluation.status).toBe('error'));
    expect(result.current.fill.pending).toBe(false);
    expect(result.current.fill.waits).toBe(false);
    expect(setChoice).not.toHaveBeenCalled();
    expect(executeTurn).not.toHaveBeenCalled();
  });

  test('a stopped run releases them too', async () => {
    script.evaluate = () => new Promise<EvalResult>(() => {});
    const setChoice = vi.fn();
    const executeTurn = vi.fn(async () => null);
    const { result } = renderHook(() => useFilled('variation:3', setChoice, executeTurn));
    await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
    act(() => result.current.fill.queueExecute());
    expect(result.current.fill.waits).toBe(true);
    act(() => result.current.evaluation.cancel());
    expect(result.current.evaluation.status).toBe('idle');
    expect(result.current.fill.pending).toBe(false);
    expect(result.current.fill.waits).toBe(false);
    expect(setChoice).not.toHaveBeenCalled();
    expect(executeTurn).not.toHaveBeenCalled();
  });
});
