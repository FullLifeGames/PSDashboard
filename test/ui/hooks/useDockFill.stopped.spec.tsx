import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

/**
 * Round 89 (SB-7, gate finding QUESTION 1): the user stops a search that has streamed a partial result (a forced replacement's quick
 * estimate, a deeper level of a normal turn). The dock keeps that result as the engine's pick: the chip holds the suggestion and
 * Execute stays. The partial belongs to the stop only: a run that something else cancelled (the game analysis) fills nothing, and a
 * stop before any partial leaves the chips empty.
 */

const script = vi.hoisted(() => ({
  handlers: null as null | { onPartial?: (result: EvalResult) => void },
  reject: null as null | ((error: Error) => void),
  runs: 0,
}));

vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(_serialized: string, _settings: unknown, handlers: { onPartial?: (result: EvalResult) => void }) {
      script.runs += 1;
      script.handlers = handlers;
      return new Promise<EvalResult>((_resolve, reject) => { script.reject = reject; });
    }
    cancel() { script.reject?.(new Error('cancelled')); }
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation: useRealEvaluation } = await import('../../../src/hooks/useEvaluation');
const { useDockFill } = await import('../../../src/hooks/useDockFill');

const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const KEY = 'variation:2';

function useFilled(kind: FormatKind, setChoice: (side: 'p1' | 'p2', choice: BranchSlotChoice, slot?: number) => void, onKey: string = KEY) {
  const evaluation = useRealEvaluation();
  const handleEvaluate = (options?: { onResult?: (result: EvalResult) => void }) => evaluation.evaluate({
    cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position, tag: onKey, onResult: options?.onResult,
  });
  const fill = useDockFill({
    simState: simState(kind), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation, liveEvalStatus: evaluation.status, evalViewKey: onKey, historyLength: 1, sessionKey: 's',
    handleEvaluate, getChoices: () => ({ p1: [], p2: [] }), setChoice, executeTurn: async () => null,
  });
  return { evaluation, fill };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ps-replay-interceptor:eval-prefs', JSON.stringify(matrixPrefs));
  script.handlers = null;
  script.reject = null;
  script.runs = 0;
});

const searching = async (result: { current: ReturnType<typeof useFilled> }) => {
  await waitFor(() => expect(result.current.evaluation.status).toBe('searching'));
};

describe('a stop keeps the result so far', () => {
  test.each(['singles', 'doubles'] as const)('%s: Stop after a partial result fills the chips from it and reads as stopped', async (kind) => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    const partial = evalResult(kind, { depthCompleted: 1 });
    act(() => script.handlers!.onPartial!(partial));
    await waitFor(() => expect(result.current.evaluation.result).toBe(partial));
    expect(result.current.fill.pending).toBe(true);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.fill.pending).toBe(false));
    expect(result.current.evaluation.status).toBe('stale');
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY });
    expect(result.current.evaluation.result).toBe(partial);
    expect(setChoice).toHaveBeenCalledWith('p1', expect.anything(), 0);
    expect(result.current.fill.engine.p1[0]).toBe(true);
    expect(result.current.fill.picks.p1[0]).not.toBeNull();
    // the stop starts no second run
    expect(script.runs).toBe(1);
  });

  test.each(['singles', 'doubles'] as const)('%s: a stop before any partial result leaves the chips empty and the evaluation idle', async (kind) => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    expect(result.current.evaluation.stopped).toBeNull();
    expect(setChoice).not.toHaveBeenCalled();
    expect(result.current.fill.engine).toEqual({ p1: [], p2: [] });
  });

  test.each(['singles', 'doubles'] as const)('%s: a run that something else cancelled (the game analysis) fills nothing, however far it got', async (kind) => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    act(() => script.handlers!.onPartial!(evalResult(kind)));
    await waitFor(() => expect(result.current.evaluation.result).not.toBeNull());
    act(() => result.current.evaluation.cancel());
    await waitFor(() => expect(result.current.evaluation.status).toBe('stale'));
    expect(result.current.evaluation.stopped).toBeNull();
    expect(setChoice).not.toHaveBeenCalled();
    expect(result.current.fill.engine).toEqual({ p1: [], p2: [] });
  });

  test('the next Evaluate clears the stopped mark: its own result is a plain one', async () => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled('singles', setChoice));
    await searching(result);
    act(() => script.handlers!.onPartial!(evalResult('singles')));
    await waitFor(() => expect(result.current.evaluation.result).not.toBeNull());
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.stopped).not.toBeNull());
    act(() => result.current.evaluation.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire: async () => position, tag: KEY }));
    expect(result.current.evaluation.stopped).toBeNull();
    await waitFor(() => expect(script.runs).toBe(2));
  });
});
