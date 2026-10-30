import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalResult, EvalSettings, ReplacementPoint, ReplacementRound } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';

/**
 * Round 79 (T290): the sweep's replacement stage over a scripted worker pool. The stage runs after the turn passes, prices each
 * request round of the protocol at the position the capture hook handed out, with the engine the following turn ran, and keeps
 * the result under its own cache key. A round the capture did not reach stays a silent gap.
 */

const script = vi.hoisted(() => ({
  evaluate: null as null | ((serialized: string, settings: EvalSettings) => Promise<EvalResult>),
  calls: [] as { serialized: string; settings: EvalSettings }[],
}));

vi.mock('../../../src/lib/eval/worker-client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(serialized: string, settings: EvalSettings) {
      script.calls.push({ serialized, settings });
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate(serialized, settings);
    }
    async evalPair() { return 0.1; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');

const position = (fainted: number) => JSON.stringify({
  sides: [{ pokemon: Array.from({ length: 6 }, (_, i) => ({ hp: i < fainted ? 0 : 100, fainted: i < fainted })) }],
});
const REPLACEMENT_AT = 'replacement-position';
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };

const round = (turn: number, ordinal: number, slots: ReplacementRound['slots'], species: ReplacementRound['species']): ReplacementRound =>
  ({ turn, ordinal, slots, species });
const pointOf = (entry: ReplacementRound): ReplacementPoint =>
  ({ turn: entry.turn, ordinal: entry.ordinal, forced: entry.slots, played: entry.species });

beforeEach(() => {
  script.calls = [];
  script.evaluate = async serialized => evalResult('singles', { score: serialized === REPLACEMENT_AT ? 0.5 : 0 });
});
afterEach(() => localStorage.clear());

const sweepOf = (rounds: ReplacementRound[] | undefined, reach: (onReplacement: (point: ReplacementPoint, serialized: string) => void) => void) => {
  const acquireAll = vi.fn(async (
    _report: unknown, onPosition?: (turn: number, serialized: string) => void, _onDiagnostic?: unknown,
    onReplacement?: (point: ReplacementPoint, serialized: string) => void,
  ) => {
    for (const turn of [1, 2, 3]) onPosition?.(turn, position(turn - 1));
    if (onReplacement) reach(onReplacement);
    return [position(0), position(1), position(2)];
  });
  return {
    acquireAll,
    params: {
      turns: 3, tera: false as const, rules: logRules(''), cacheKeyFor: (turn: number) => `replay:${turn}:fp`,
      acquireFor: () => async () => position(0), acquireAll, playedFor: () => null,
      ...(rounds ? { replacementRounds: rounds, replacementKeyFor: (turn: number, ordinal: number) => `replay:${turn}r${ordinal}:fp` } : {}),
    },
  };
};

const runOnce = async (params: ReturnType<typeof sweepOf>['params']) => {
  const { result } = renderHook(() => useEvaluation());
  act(() => result.current.setPrefs(matrixPrefs));
  act(() => result.current.runGraphSweep(params));
  await waitFor(() => expect(result.current.graph.running).toBe(true));
  await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
  return result;
};

describe('the sweep\'s replacement stage', () => {
  const singles = round(1, 0, { p1: [0], p2: [] }, { p1: ['Toxapex'], p2: [] });

  test('singles: the point is priced at the captured position and lands under the turn that follows the knockout', async () => {
    const { params } = sweepOf([singles], onReplacement => onReplacement(pointOf(singles), REPLACEMENT_AT));
    const result = await runOnce(params);
    const { graph } = result.current;
    expect(graph.replacements?.[0]).toBeNull();
    expect(graph.replacements?.[1]).toEqual([{
      turn: 1, ordinal: 0, forced: { p1: [0], p2: [] }, played: { p1: ['Toxapex'], p2: [] }, result: expect.objectContaining({ score: 0.5 }),
    }]);
    expect(graph.replacements?.[2]).toBeNull();
    // The turn scores stay what the turn passes made them.
    expect(graph.scores).toEqual([0, 0, 0]);
    const call = script.calls.find(entry => entry.serialized === REPLACEMENT_AT)!;
    expect(call.settings).toMatchObject({ depth: 1, samples: 1, mode: 'matrix', prove: false });
  });

  test('doubles: two slots of one side and a second request of the block arrive as two records of one turn, in ordinal order', async () => {
    const first = round(2, 0, { p1: [0, 1], p2: [] }, { p1: ['Garchomp', 'Rotom-Wash'], p2: [] });
    const second = round(2, 1, { p1: [], p2: [1] }, { p1: [], p2: ['Ting-Lu'] });
    const { params } = sweepOf([first, second], onReplacement => {
      onReplacement(pointOf(second), 'second-position');
      onReplacement(pointOf(first), 'first-position');
    });
    script.evaluate = async serialized => evalResult('doubles', { score: serialized === 'first-position' ? 0.3 : serialized === 'second-position' ? 0.4 : 0 });
    const result = await runOnce({ ...params, doubles: true });
    const records = result.current.graph.replacements?.[2];
    expect(records?.map(record => [record.ordinal, record.forced, record.played])).toEqual([
      [0, { p1: [0, 1], p2: [] }, { p1: ['Garchomp', 'Rotom-Wash'], p2: [] }],
      [1, { p1: [], p2: [1] }, { p1: [], p2: ['Ting-Lu'] }],
    ]);
  });

  test('each point runs at the engine the following turn ran: an auto sweep prices an early singles point on the matrix with three draws', async () => {
    const { params } = sweepOf([singles], onReplacement => onReplacement(pointOf(singles), REPLACEMENT_AT));
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs({ ...matrixPrefs, mode: 'auto' }));
    act(() => result.current.runGraphSweep(params));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
    const following = result.current.graph.settings[1];
    expect(script.calls.find(entry => entry.serialized === REPLACEMENT_AT)?.settings).toMatchObject({ depth: following?.depth, samples: following?.samples, mode: following?.mode });
  });

  test('a round the capture never reached is a silent gap: no search, no error, no notice', async () => {
    const { params } = sweepOf([singles], () => {});
    const result = await runOnce(params);
    expect(result.current.graph.replacements?.every(entry => entry === null)).toBe(true);
    expect(script.calls.some(entry => entry.serialized === REPLACEMENT_AT)).toBe(false);
    expect(result.current.graph.evalErrors).toEqual([null, null, null]);
    expect(result.current.graph.notice).toBeNull();
  });

  test('a failing search leaves the gap and the turns stand', async () => {
    script.evaluate = async serialized => {
      if (serialized === REPLACEMENT_AT) throw new Error('worker crashed');
      return evalResult('singles', { score: 0 });
    };
    const { params } = sweepOf([singles], onReplacement => onReplacement(pointOf(singles), REPLACEMENT_AT));
    const result = await runOnce(params);
    expect(result.current.graph.replacements?.every(entry => entry === null)).toBe(true);
    expect(result.current.graph.scores).toEqual([0, 0, 0]);
    expect(result.current.graph.evalErrors).toEqual([null, null, null]);
    expect(result.current.graph.notice).toBeNull();
  });

  test('a knockout of the last turn has no card after it and a sweep without rounds runs no stage', async () => {
    const last = round(3, 0, { p1: [0], p2: [] }, { p1: ['Toxapex'], p2: [] });
    const lastSweep = sweepOf([last], onReplacement => onReplacement(pointOf(last), REPLACEMENT_AT));
    expect((await runOnce(lastSweep.params)).current.graph.replacements?.every(entry => entry === null)).toBe(true);
    expect(script.calls.some(entry => entry.serialized === REPLACEMENT_AT)).toBe(false);

    const plain = sweepOf(undefined, onReplacement => onReplacement(pointOf(singles), REPLACEMENT_AT));
    const result = await runOnce(plain.params);
    expect(plain.acquireAll.mock.calls.every(call => call[3] === undefined)).toBe(true);
    expect(result.current.graph.replacements?.every(entry => entry === null)).toBe(true);
  });

  test('a second sweep of the same game serves the point from the cache: no new search, no new capture', async () => {
    const { params, acquireAll } = sweepOf([singles], onReplacement => onReplacement(pointOf(singles), REPLACEMENT_AT));
    const { result } = renderHook(() => useEvaluation());
    act(() => result.current.setPrefs(matrixPrefs));
    for (let run = 0; run < 2; run++) {
      act(() => result.current.runGraphSweep(params));
      await waitFor(() => expect(result.current.graph.running).toBe(true));
      await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
    }
    expect(acquireAll).toHaveBeenCalledTimes(1);
    expect(script.calls.filter(entry => entry.serialized === REPLACEMENT_AT)).toHaveLength(1);
    expect(result.current.graph.replacements?.[1]).toEqual([expect.objectContaining({ turn: 1, ordinal: 0, result: expect.objectContaining({ score: 0.5 }) })]);
  });
});
