import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { EvalResult, EvalSettings, SearchProgress } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';

// The evaluation surface over a scripted worker pool client: the hook's
// contract is what it asks the client for and how it installs the answers.
const script = vi.hoisted(() => ({
  evaluate: null as null | ((serialized: string, settings: EvalSettings, handlers?: { onProgress?(p: SearchProgress): void; onPartial?(r: EvalResult): void }) => Promise<EvalResult>),
  calls: [] as { serialized: string; settings: EvalSettings }[],
  pairCalls: 0,
  cancelled: 0,
  disposed: 0,
}));

vi.mock('../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(serialized: string, settings: EvalSettings, handlers?: { onProgress?(p: SearchProgress): void; onPartial?(r: EvalResult): void }) {
      script.calls.push({ serialized, settings });
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate(serialized, settings, handlers);
    }
    async evalPair() { script.pairCalls += 1; return 0.1; }
    cancel() { script.cancelled += 1; }
    dispose() { script.disposed += 1; }
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../src/hooks/useEvaluation');

const PREFS_KEY = 'ps-replay-interceptor:eval-prefs';
const position = (fainted: number, total = 6) => JSON.stringify({
  sides: [{ pokemon: Array.from({ length: total }, (_, i) => ({ hp: i < fainted ? 0 : 100, fainted: i < fainted })) }],
});
const scoreOf = (serialized: string) => (JSON.parse(serialized) as { sides: { pokemon: { hp: number }[] }[] }).sides[0].pokemon.filter(p => p.hp === 0).length / 10;

beforeEach(() => {
  script.calls = [];
  script.pairCalls = 0;
  script.cancelled = 0;
  script.disposed = 0;
  script.evaluate = async serialized => evalResult('singles', { score: scoreOf(serialized) });
});

afterEach(() => {
  localStorage.clear();
});

const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };

describe('useEvaluation preferences', () => {
  test('defaults, sanitized restore from storage, and persistence', () => {
    const fresh = renderHook(() => useEvaluation());
    expect(fresh.result.current.prefs).toEqual({ depth: 2, samples: 3, mode: 'auto', auto: false, autoAnalyze: false, tera: 'auto' });

    localStorage.setItem(PREFS_KEY, JSON.stringify({ depth: 3, samples: 4, mode: 'weird', auto: 1, autoAnalyze: true, tera: 'on' }));
    const restored = renderHook(() => useEvaluation());
    expect(restored.result.current.prefs).toEqual({ depth: 2, samples: 3, mode: 'matrix', auto: true, autoAnalyze: true, tera: 'on' });

    act(() => restored.result.current.setPrefs({ ...matrixPrefs, samples: 5 }));
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ depth: 1, samples: 5, mode: 'matrix' });
  });

  test('a search-relevant preference change marks a finished result stale; the auto switch alone does not', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(0), tag: 'main:2' }));
    await waitFor(() => expect(result.current.status).toBe('done'));

    act(() => result.current.setPrefs({ ...matrixPrefs, auto: true }));
    expect(result.current.status).toBe('done');
    act(() => result.current.setPrefs({ ...matrixPrefs, auto: true, depth: 2 }));
    expect(result.current.status).toBe('stale');
  });
});

describe('useEvaluation single position', () => {
  test('evaluates through the pool with the configured engine, streams progress, installs and caches the result', async () => {
    script.evaluate = async (serialized, _settings, handlers) => {
      handlers?.onProgress?.({ done: 1, total: 4, depth: 1 });
      handlers?.onPartial?.(evalResult('singles', { score: -0.5 }));
      await new Promise(resolve => setTimeout(resolve, 150));
      return evalResult('singles', { score: scoreOf(serialized) });
    };
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    const acquire = vi.fn(async () => position(1));
    act(() => result.current.evaluate({ cacheKey: 'replay:3:fp', tera: false, sleepClause: true, acquire, tag: 'main:3' }));
    expect(result.current.status).toBe('reconstructing');
    expect(result.current.resultTag).toBe('main:3');

    await waitFor(() => expect(result.current.status).toBe('searching'));
    await waitFor(() => expect(result.current.progress).toEqual({ done: 1, total: 4, depth: 1 }));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.score).toBe(0.1);
    expect(result.current.progress).toBeNull();
    expect(script.calls[0].settings).toEqual({ depth: 1, samples: 1, mode: 'matrix', tera: false, sleepClause: true });

    // The same position with the same engine is a cache hit: no acquisition, no search.
    act(() => result.current.evaluate({ cacheKey: 'replay:3:fp', tera: false, acquire, tag: 'main:3' }));
    expect(result.current.status).toBe('done');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(script.calls).toHaveLength(1);
  });

  test('auto mode reads the fainted fraction off the acquired position and routes to the tree once bodies fell', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs({ ...matrixPrefs, mode: 'auto' }));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(0), tag: 'a' }));
    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(script.calls[0].settings.mode).toBe('matrix');

    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(4), tag: 'b' }));
    await waitFor(() => expect(script.calls).toHaveLength(2));
    expect(script.calls[1].settings.mode).toBe('mcts');
  });

  test('cancel drops an in-flight search and a late answer never lands', async () => {
    let finish: (result: EvalResult) => void = () => {};
    script.evaluate = () => new Promise(resolve => { finish = resolve; });
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(0) }));
    await waitFor(() => expect(result.current.status).toBe('searching'));

    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');
    expect(script.cancelled).toBe(1);
    await act(async () => { finish(evalResult()); });
    expect(result.current.result).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  test('a failed acquisition or search reads as an error with its message', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => { throw new Error('diverged before turn 3'); } }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('diverged before turn 3');

    script.evaluate = async () => { throw new Error('worker crashed'); };
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(0) }));
    await waitFor(() => expect(result.current.error).toBe('worker crashed'));
  });

  test('markStale and reset move a finished result along; unmount disposes the pool', async () => {
    const { result, unmount } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.evaluate({ cacheKey: null, tera: false, acquire: async () => position(0) }));
    await waitFor(() => expect(result.current.status).toBe('done'));
    act(() => result.current.markStale());
    expect(result.current.status).toBe('stale');
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ status: 'idle', result: null, error: null });
    unmount();
    expect(script.disposed).toBe(1);
  });
});

describe('useEvaluation whole-game sweep', () => {
  const sweepParams = (acquireFor: (turn: number) => () => Promise<string>) => ({
    turns: 3, tera: false as const, cacheKeyFor: (turn: number) => `replay:${turn}:fp`, acquireFor, playedFor: () => null,
  });

  test('sweeps every turn through the pool and fills the graph in turn order', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.runGraphSweep(sweepParams(turn => async () => position(turn - 1))));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });

    const { graph } = result.current;
    expect(graph.scores).toEqual([0, 0.1, 0.2]);
    expect(graph.results.map(entry => entry?.score)).toEqual([0, 0.1, 0.2]);
    expect(graph.settings).toEqual([{ depth: 1, samples: 1, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'matrix' }, { depth: 1, samples: 1, mode: 'matrix' }]);
    // A fixed engine never needs the fainted fraction; only auto routing reads it.
    expect(graph.faintedFractions).toEqual([null, null, null]);
    expect(graph.evalErrors).toEqual([null, null, null]);
    expect(graph.notice).toBeNull();
    expect(graph.progress).toBeNull();
    expect(script.calls).toHaveLength(3);
  });

  test('a failed search records its error and the notice names it; a turn without a position is a silent gap; clearGraph empties everything', async () => {
    script.evaluate = async serialized => {
      if (scoreOf(serialized) === 0.1) throw new Error('worker crashed');
      return evalResult('singles', { score: scoreOf(serialized) });
    };
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.runGraphSweep(sweepParams(turn => async () => {
      if (turn === 3) throw new Error('no position captured');
      return position(turn - 1);
    })));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
    expect(result.current.graph.scores).toEqual([0, null, null]);
    expect(result.current.graph.evalErrors).toEqual([null, 'worker crashed', null]);
    expect(result.current.graph.notice).toBe('1 turn had a live position but could not be evaluated (first error: "worker crashed").');

    act(() => result.current.clearGraph());
    expect(result.current.graph.scores).toEqual([]);
    expect(result.current.graph.notice).toBeNull();
  });

  test('a streamed acquisition feeds the turns as their positions arrive and the coverage notice names missing turns', async () => {
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    const acquireAll = vi.fn(async (_report: unknown, onPosition?: (turn: number, serialized: string) => void) => {
      onPosition?.(1, position(0));
      onPosition?.(2, position(1));
      return [position(0), position(1), null];
    });
    act(() => result.current.runGraphSweep({ ...sweepParams(() => async () => position(0)), acquireAll }));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
    expect(acquireAll).toHaveBeenCalledTimes(1);
    expect(result.current.graph.scores).toEqual([0, 0.1, null]);
    expect(result.current.graph.notice).toMatch(/reached the game's end one turn early/);
  });
});
