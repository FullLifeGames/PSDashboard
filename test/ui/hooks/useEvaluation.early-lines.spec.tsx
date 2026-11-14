import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalLine, EvalResult, EvalSettings } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';
import { singlesLine } from '../fixtures/lines';

/**
 * Round 89 (#104), step G13: the early-lines stage's two calls on the evaluation. `searchLines` runs one tree search on the shared
 * pool without cancelling the others and hands back the lines; `attachLines` writes them into the stored matrix result of a turn
 * (graph, memory cache and store) and nothing else.
 */
const script = vi.hoisted(() => ({
  evaluate: null as null | ((serialized: string, settings: EvalSettings, opts?: { exclusive?: boolean }) => Promise<EvalResult>),
  saved: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/lib/eval/worker-client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(serialized: string, settings: EvalSettings, _handlers?: unknown, opts?: { exclusive?: boolean }) {
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate(serialized, settings, opts);
    }
    async evalPair() { return 0.1; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

vi.mock('../../../src/lib/eval-cache-store', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval-cache-store')>();
  return { ...actual, loadStoredEval: vi.fn(async () => null), loadStoredEvalsByPrefix: vi.fn(async () => null), saveStoredEval: vi.fn(async (value: Record<string, unknown>) => { script.saved.push(value); }) };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');

const position = () => JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const LINES = [singlesLine as EvalLine];
const settings = { depth: 1 as const, samples: 1 as const, mode: 'mcts' as const, tera: false as const, ruleset: 'standard' as const };

beforeEach(() => {
  script.evaluate = async () => evalResult('singles');
  script.saved = [];
});
afterEach(() => localStorage.clear());

async function swept(key: string) {
  const hook = renderHook(() => useEvaluation());
  act(() => hook.result.current.setPrefs(matrixPrefs));
  act(() => hook.result.current.runGraphSweep({
    turns: 2, tera: false as const, rules: logRules(''), doubles: false, cacheKeyFor: turn => `${key}:${turn}`,
    acquireFor: () => async () => position(), playedFor: () => null,
  }));
  await waitFor(() => expect(hook.result.current.graph.running).toBe(true));
  await waitFor(() => expect(hook.result.current.graph.running).toBe(false), { timeout: 10_000 });
  script.saved = [];
  return hook;
}

describe('searchLines', () => {
  test('one tree search on the shared pool that cancels nothing, answering with its lines', async () => {
    const hook = await swept('lines-a');
    const seen: { serialized: string; opts?: { exclusive?: boolean } }[] = [];
    script.evaluate = async (serialized, _settings, opts) => { seen.push({ serialized, opts }); return evalResult('singles', { lines: LINES }); };
    let lines: EvalLine[] = [];
    await act(async () => { lines = await hook.result.current.searchLines('position-1', settings); });
    expect(lines).toEqual(LINES);
    expect(seen).toEqual([{ serialized: 'position-1', opts: { exclusive: false } }]);
  });

  test('a search that kept no lines answers with an empty list', async () => {
    const hook = await swept('lines-b');
    let lines: EvalLine[] | null = null;
    await act(async () => { lines = await hook.result.current.searchLines('position-1', settings); });
    expect(lines).toEqual([]);
  });
});

describe('attachLines', () => {
  test('writes the lines into one result of the graph and leaves every other field of the graph as it was', async () => {
    const hook = await swept('lines-c');
    const before = hook.result.current.graph;
    const base = before.results[0]!;
    let written = false;
    act(() => { written = hook.result.current.attachLines(1, base, LINES, 'lines-c:1'); });
    expect(written).toBe(true);
    const after = hook.result.current.graph;
    expect(after.results[0]).toEqual({ ...base, lines: LINES });
    expect(after.results[1]).toBe(before.results[1]);
    expect({ ...after, results: [] }).toEqual({ ...before, results: [] });
  });

  test('saves the turn\'s store entry with the lines and the fields it already held', async () => {
    const hook = await swept('lines-d');
    const base = hook.result.current.graph.results[0]!;
    act(() => { hook.result.current.attachLines(1, base, LINES, 'lines-d:1'); });
    expect(script.saved).toHaveLength(1);
    expect(script.saved[0]).toMatchObject({ depth: 1, samples: 1, mode: 'matrix', result: { ...base, lines: LINES } });
    expect(String(script.saved[0].key)).toContain('lines-d:1');
    expect(script.saved[0]).toHaveProperty('playedOutcome');
  });

  test('a result that moved on since the search started is left alone', async () => {
    const hook = await swept('lines-e');
    const stale = evalResult('singles', { score: 0.77 });
    let written = true;
    act(() => { written = hook.result.current.attachLines(1, stale, LINES, 'lines-e:1'); });
    expect(written).toBe(false);
    expect(hook.result.current.graph.results[0]).not.toHaveProperty('lines');
    expect(script.saved).toHaveLength(0);
  });

  test('a later sweep keeps the lines: the graph carries them into the next run', async () => {
    const hook = await swept('lines-f');
    const base = hook.result.current.graph.results[0]!;
    act(() => { hook.result.current.attachLines(1, base, LINES, 'lines-f:1'); });
    act(() => hook.result.current.runGraphSweep({
      turns: 2, tera: false as const, rules: logRules(''), doubles: false, cacheKeyFor: turn => `lines-f:${turn}`,
      acquireFor: () => async () => position(), playedFor: () => null,
    }));
    await waitFor(() => expect(hook.result.current.graph.running).toBe(false), { timeout: 10_000 });
    expect(hook.result.current.graph.results[0]?.lines).toEqual(LINES);
  });
});
