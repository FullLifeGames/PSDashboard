import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { BiggestRoll, EvalResult, EvalSettings } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';

/**
 * Round 86 (T304): the sweep's last stage plays the game's biggest roll the other way. The report names the roll (a missed sure kill of
 * the winner), the replay worker plays the turn again with the die turned over, and the engine evaluates the copy's next root at the
 * engine the actual next root ran: one evaluation per replay with a named roll, none without. The result rides in the graph, so the
 * report is complete when `graph.running` turns false. A copy the log cannot give, an evaluation that fails and a cached evaluation
 * are all silent: the sentence then speaks without the number, or the stage reads the cache and plays nothing.
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
    dispose() { script.events.push('pool disposed'); }
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');

const position = (fainted: number) => JSON.stringify({
  sides: [{ pokemon: Array.from({ length: 6 }, (_, i) => ({ hp: i < fainted ? 0 : 100, fainted: i < fainted })) }],
});
const COPY_AT = 'copy-position';
const matrixPrefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };

const roll: BiggestRoll = {
  turn: 2, side: 'p1', winner: 'p2', amount: 0.3, move: 'Fire Fang', accuracy: 0.95, after: { score: -0.6 },
};

type Outcome = { serialized: string; stage: 'turn' | 'request' | 'ended'; terminal: number | null } | null;

beforeEach(() => {
  script.calls = [];
  script.events = [];
  script.evaluate = async serialized => evalResult('singles', { score: serialized === COPY_AT ? -0.9 : 0 });
});
afterEach(() => localStorage.clear());

const sweepOf = (named: BiggestRoll | null, copy: Outcome | (() => Promise<Outcome>)) => {
  const playCopy = vi.fn<(roll: BiggestRoll, position: string) => Promise<Outcome>>(async () => {
    script.events.push('copy plays');
    return typeof copy === 'function' ? copy() : copy;
  });
  const namedRoll = vi.fn(() => named);
  const acquireAll = vi.fn(async (_report: unknown, onPosition?: (turn: number, serialized: string) => void) => {
    for (const turn of [1, 2, 3]) onPosition?.(turn, position(turn - 1));
    return [position(0), position(1), position(2)];
  });
  return {
    playCopy, namedRoll, acquireAll,
    params: {
      turns: 3, tera: false as const, rules: logRules(''), cacheKeyFor: (turn: number) => `replay:${turn}:fp`,
      acquireFor: () => async () => position(0), acquireAll, playedFor: () => null,
      rolledCopy: { namedRoll, playCopy, keyFor: (turn: number) => `replay:${turn}x:fp` },
    },
  };
};

const runSweeps = async (params: ReturnType<typeof sweepOf>['params'], times = 1) => {
  const { result } = renderHook(() => useEvaluation());
  act(() => result.current.setPrefs(matrixPrefs));
  for (let run = 0; run < times; run++) {
    act(() => result.current.runGraphSweep(params));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
  }
  return result;
};

const copyCalls = () => script.calls.filter(entry => entry.serialized === COPY_AT);

describe('the sweep\'s biggest-roll stage', () => {
  test('a named roll: the copy plays from the turn\'s start position, the engine prices its next root at the next card\'s engine, and the graph holds it when the sweep ends', async () => {
    const { params, playCopy } = sweepOf(roll, { serialized: COPY_AT, stage: 'turn', terminal: null });
    const result = await runSweeps(params);
    expect(playCopy).toHaveBeenCalledTimes(1);
    expect(playCopy.mock.calls[0][0]).toBe(roll);
    expect(playCopy.mock.calls[0][1]).toBe(position(1));
    expect(copyCalls()).toHaveLength(1);
    expect(copyCalls()[0].settings).toMatchObject({ depth: 1, samples: 1, mode: 'matrix', prove: false });
    expect(result.current.graph.rollFlip).toEqual({ turn: 2, score: -0.9 });
    expect(result.current.graph.scores).toEqual([0, 0, 0]);
  });

  test('the pool gives its workers back before the copy\'s worker spawns: the stage never runs a worker beside a full pool (573756 died of it)', async () => {
    // Round 86 (B8): 573756 holds twelve pool workers and the replay worker at the end of its sweep, about 6.2 GB in the renderer;
    // the copy's own worker was the one more that took the page down, and the feedback test hung for 40 minutes.
    const { params } = sweepOf(roll, { serialized: COPY_AT, stage: 'request', terminal: null });
    await runSweeps(params);
    const playing = script.events.indexOf('copy plays');
    expect(playing).toBeGreaterThanOrEqual(0);
    expect(script.events.slice(0, playing)).toContain('pool disposed');
  });

  test('the evaluation runs inside the sweep: the flip is in the graph in the very state that ends the run', async () => {
    const { params } = sweepOf(roll, { serialized: COPY_AT, stage: 'request', terminal: null });
    const { result } = renderHook(() => useEvaluation());
    const states: { running: boolean; flip: unknown }[] = [];
    act(() => result.current.setPrefs(matrixPrefs));
    act(() => result.current.runGraphSweep(params));
    await waitFor(() => {
      states.push({ running: result.current.graph.running, flip: result.current.graph.rollFlip ?? null });
      expect(result.current.graph.running).toBe(false);
    }, { timeout: 10_000 });
    expect(states.filter(state => !state.running && state.flip === null)).toHaveLength(0);
    expect(result.current.graph.rollFlip).toEqual({ turn: 2, score: -0.9 });
  });

  test('a game that ends in the copy needs no evaluation: the end\'s score stands', async () => {
    const { params } = sweepOf(roll, { serialized: COPY_AT, stage: 'ended', terminal: -1 });
    const result = await runSweeps(params);
    expect(copyCalls()).toHaveLength(0);
    expect(result.current.graph.rollFlip).toEqual({ turn: 2, score: -1 });
  });

  test('no named roll: nothing is played, nothing is evaluated, the flip is null', async () => {
    const { params, playCopy } = sweepOf(null, { serialized: COPY_AT, stage: 'turn', terminal: null });
    const result = await runSweeps(params);
    expect(playCopy).not.toHaveBeenCalled();
    expect(copyCalls()).toHaveLength(0);
    expect(result.current.graph.rollFlip).toBeNull();
  });

  test('a copy the log cannot give is a silent gap: no evaluation, no error, no notice', async () => {
    const { params } = sweepOf(roll, null);
    const result = await runSweeps(params);
    expect(copyCalls()).toHaveLength(0);
    expect(result.current.graph.rollFlip).toBeNull();
    expect(result.current.graph.evalErrors).toEqual([null, null, null]);
    expect(result.current.graph.notice).toBeNull();
  });

  test('a failing worker or evaluation leaves the gap and the turns stand', async () => {
    script.evaluate = async serialized => {
      if (serialized === COPY_AT) throw new Error('worker crashed');
      return evalResult('singles', { score: 0 });
    };
    const failing = sweepOf(roll, { serialized: COPY_AT, stage: 'turn', terminal: null });
    const first = await runSweeps(failing.params);
    expect(first.current.graph.rollFlip).toBeNull();
    expect(first.current.graph.scores).toEqual([0, 0, 0]);
    const throwing = sweepOf(roll, async () => { throw new Error('replay worker crashed'); });
    const second = await runSweeps(throwing.params);
    expect(second.current.graph.rollFlip).toBeNull();
    expect(second.current.graph.notice).toBeNull();
  });

  test('a second sweep of the same game reads the evaluation from the cache: no new copy, no new search', async () => {
    const { params, playCopy } = sweepOf(roll, { serialized: COPY_AT, stage: 'turn', terminal: null });
    const result = await runSweeps(params, 2);
    expect(playCopy).toHaveBeenCalledTimes(1);
    expect(copyCalls()).toHaveLength(1);
    expect(result.current.graph.rollFlip).toEqual({ turn: 2, score: -0.9 });
  });

  test('a sweep without the stage (a single turn\'s analysis) keeps the flip of the full sweep before it', async () => {
    const { params } = sweepOf(roll, { serialized: COPY_AT, stage: 'turn', terminal: null });
    const result = await runSweeps(params);
    act(() => result.current.runGraphSweep({ ...params, rolledCopy: undefined, from: 1, to: 2 }));
    await waitFor(() => expect(result.current.graph.running).toBe(true));
    await waitFor(() => expect(result.current.graph.running).toBe(false), { timeout: 10_000 });
    expect(result.current.graph.rollFlip).toEqual({ turn: 2, score: -0.9 });
  });
});
