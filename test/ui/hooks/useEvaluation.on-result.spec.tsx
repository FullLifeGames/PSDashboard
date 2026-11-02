import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';

/**
 * Round 84 (turn dock), step A5: `onResult` of `EvaluateParams`. The dock's engine fill acts where a result lands: after a
 * search, on a stored hit and on a memory hit. A run that was superseded, cancelled or failed calls nothing.
 */

const script = vi.hoisted(() => ({
  evaluate: null as null | (() => Promise<EvalResult>),
  stored: null as null | { result: EvalResult },
}));

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

vi.mock('../../../src/lib/eval-cache-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval-cache-store')>();
  return { ...actual, loadStoredEval: vi.fn(async () => script.stored), saveStoredEval: vi.fn(async () => {}) };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');

const position = JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const acquire = async () => position;
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };

beforeEach(() => {
  localStorage.clear();
  script.stored = null;
  script.evaluate = async () => evalResult('singles', { score: 0.25 });
});

describe('EvaluateParams.onResult', () => {
  test('a search calls it once with the final result, never with a partial', async () => {
    const final = evalResult('singles', { score: 0.25 });
    script.evaluate = async () => final;
    const onResult = vi.fn();
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire, tag: 'variation:3', onResult }));
    expect(onResult).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(final);
  });

  test('a stored hit and a memory hit call it with the stored result', async () => {
    const stored = evalResult('singles', { score: 0.6 });
    script.stored = { result: stored };
    const fromStore = vi.fn();
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: 'replay:3:fp', tera: false, ruleset: 'standard', acquire, tag: 'main:3', onResult: fromStore }));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(fromStore).toHaveBeenCalledWith(stored);

    const fromMemory = vi.fn();
    act(() => result.current.evaluate({ cacheKey: 'replay:3:fp', tera: false, ruleset: 'standard', acquire, tag: 'main:3', onResult: fromMemory }));
    expect(fromMemory).toHaveBeenCalledTimes(1);
    expect(fromMemory).toHaveBeenCalledWith(stored);
  });

  test('a superseded run and a failed run call nothing', async () => {
    let release: (value: EvalResult) => void = () => {};
    script.evaluate = () => new Promise<EvalResult>(resolve => { release = resolve; });
    const superseded = vi.fn();
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire, tag: 'variation:3', onResult: superseded }));
    await waitFor(() => expect(result.current.status).toBe('searching'));
    act(() => result.current.cancel());
    await act(async () => release(evalResult('singles')));
    expect(superseded).not.toHaveBeenCalled();

    script.evaluate = async () => { throw new Error('worker failed'); };
    const failed = vi.fn();
    act(() => result.current.evaluate({ cacheKey: null, tera: false, ruleset: 'standard', acquire, tag: 'variation:3', onResult: failed }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(failed).not.toHaveBeenCalled();
  });
});
