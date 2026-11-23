import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

/**
 * The user stops a search that has streamed a partial result (a forced replacement's quick
 * estimate, a deeper level of a normal turn). The dock keeps that result as the engine's pick: the chip holds the suggestion and
 * Execute stays. The partial belongs to the stop only: a run that something else cancelled (the game analysis) fills nothing, and a
 * stop before any partial leaves the chips empty.
 */

const script = vi.hoisted(() => ({
  handlers: null as null | { onPartial?: (result: EvalResult) => void },
  reject: null as null | ((error: Error) => void),
  runs: 0,
  acquire: null as unknown as () => Promise<string>,
  graphRunning: false,
  liveTip: true,
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
    cacheKey: null, tera: false, ruleset: 'standard', acquire: script.acquire, tag: onKey, onResult: options?.onResult,
  });
  const dockEvaluation = script.graphRunning ? { ...evaluation, graph: { ...evaluation.graph, running: true } } : evaluation;
  const fill = useDockFill({
    simState: simState(kind), liveTip: script.liveTip, branching: true, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation: dockEvaluation, liveEvalStatus: evaluation.status, evalViewKey: onKey, historyLength: 1, sessionKey: 's',
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
  script.acquire = async () => position;
  script.graphRunning = false;
  script.liveTip = true;
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
    expect(script.runs).toBe(1);
  });

  // A tree search streams its first interim result (tree depth 3 to 5, not the quick estimate)
  // after 150 iterations of its first tree; a Cancel after it keeps that result in a doubles replacement like any other partial.
  test('doubles: Stop after a tree\'s interim result (depth 3) fills the replacement chips from it and reads as the result so far', async () => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled('doubles', setChoice));
    await searching(result);
    const partial = evalResult('doubles', { depthCompleted: 3 });
    act(() => script.handlers!.onPartial!(partial));
    await waitFor(() => expect(result.current.evaluation.result).toBe(partial));
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.fill.pending).toBe(false));
    expect(result.current.evaluation.status).toBe('stale');
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY });
    expect(result.current.evaluation.result?.depthCompleted).toBe(3);
    expect(setChoice).toHaveBeenCalledWith('p1', expect.anything(), 0);
    expect(result.current.fill.engine.p1[0]).toBe(true);
    expect(script.runs).toBe(1);
  });

  test.each(['singles', 'doubles'] as const)('%s: a stop before any partial result leaves the chips empty and the evaluation idle, and marks the stop as empty', async (kind) => {
    const setChoice = vi.fn();
    const { result } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    expect(script.runs).toBe(1);
    expect(setChoice).not.toHaveBeenCalled();
    expect(result.current.fill.engine).toEqual({ p1: [], p2: [] });
  });

  // The same stop while the position is still being rebuilt, before the search's first level.
  test.each(['singles', 'doubles'] as const)('%s: a stop while the position is rebuilt marks the stop as empty and starts no search', async (kind) => {
    const setChoice = vi.fn();
    script.acquire = () => new Promise<string>(() => {});
    const { result } = renderHook(() => useFilled(kind, setChoice));
    await waitFor(() => expect(result.current.evaluation.status).toBe('reconstructing'));
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    expect(script.runs).toBe(0);
    expect(setChoice).not.toHaveBeenCalled();
  });

  // The Cancel click can land between the run's first state change and the commit's effects (a long
  // task after the paint). The stop reads the run's own status, not the last committed one.
  test.each(['singles', 'doubles'] as const)('%s: a stop in the same batch as the run\'s start (before the effects of its render) still marks the stop as empty, and the fill leaves the position alone', async (kind) => {
    const setChoice = vi.fn();
    script.liveTip = false;
    script.acquire = () => new Promise<string>(() => {});
    const { result, rerender } = renderHook(() => useFilled(kind, setChoice));
    act(() => {
      result.current.evaluation.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire: script.acquire, tag: KEY });
      result.current.evaluation.stop();
    });
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    script.liveTip = true;
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(script.runs).toBe(0);
    expect(result.current.evaluation.status).toBe('idle');
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    expect(setChoice).not.toHaveBeenCalled();
  });

  // The game analysis ends: the fill, which starts again after an analysis took its run, leaves a
  // position the user stopped before its first result alone, as it does for one that kept a result.
  test.each(['singles', 'doubles'] as const)('%s: after a stop before a first result the game analysis starts and ends, and the fill starts no search', async (kind) => {
    const setChoice = vi.fn();
    const { result, rerender } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    script.graphRunning = true;
    rerender();
    script.graphRunning = false;
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(script.runs).toBe(1);
    expect(result.current.evaluation.status).toBe('idle');
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true });
    expect(setChoice).not.toHaveBeenCalled();
  });

  test.each(['singles', 'doubles'] as const)('%s: after a stop that kept a result the game analysis starts and ends, and the fill starts no search', async (kind) => {
    const setChoice = vi.fn();
    const { result, rerender } = renderHook(() => useFilled(kind, setChoice));
    await searching(result);
    act(() => script.handlers!.onPartial!(evalResult(kind, { depthCompleted: 1 })));
    await waitFor(() => expect(result.current.evaluation.result).not.toBeNull());
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('stale'));
    script.graphRunning = true;
    rerender();
    script.graphRunning = false;
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(script.runs).toBe(1);
    expect(result.current.evaluation.stopped).toEqual({ tag: KEY });
  });

  // The next position of the same turn (a forced replacement answered, the next request has the same tag) is the fill's again.
  test('a stop before a first result does not hold back the fill at the next position of the turn', async () => {
    const setChoice = vi.fn();
    let history = 1;
    const { result, rerender } = renderHook(() => {
      const evaluation = useRealEvaluation();
      const handleEvaluate = (options?: { onResult?: (result: EvalResult) => void }) => evaluation.evaluate({
        cacheKey: null, tera: false, ruleset: 'standard', acquire: script.acquire, tag: KEY, onResult: options?.onResult,
      });
      const fill = useDockFill({
        simState: simState('doubles'), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
        evalAvailable: true, evaluation, liveEvalStatus: evaluation.status, evalViewKey: KEY, historyLength: history, sessionKey: 's',
        handleEvaluate, getChoices: () => ({ p1: [], p2: [] }), setChoice, executeTurn: async () => null,
      });
      return { evaluation, fill };
    });
    await searching(result);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.stopped).toEqual({ tag: KEY, empty: true }));
    history = 2;
    rerender();
    await waitFor(() => expect(script.runs).toBe(2));
  });

  // The game analysis's Cancel button calls the same stop: with no single search under way it marks nothing.
  test.each(['singles', 'doubles'] as const)('%s: a stop while no single search runs leaves no mark', async (kind) => {
    const { result } = renderHook(() => useFilled(kind, vi.fn()));
    await searching(result);
    act(() => result.current.evaluation.stop());
    await waitFor(() => expect(result.current.evaluation.status).toBe('idle'));
    act(() => result.current.evaluation.reset());
    await waitFor(() => expect(result.current.evaluation.stopped).toBeNull());
    act(() => result.current.evaluation.stop());
    expect(result.current.evaluation.stopped).toBeNull();
    expect(result.current.evaluation.status).toBe('idle');
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
