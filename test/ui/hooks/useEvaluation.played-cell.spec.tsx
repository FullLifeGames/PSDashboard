import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { logRules } from '@fulllifegames/replay-core';
import type { EvalResult, EvalSettings, MatrixCell, PlayedAction, PlayedTurn } from '@fulllifegames/eval-engine';
import { evalResult } from '../fixtures/eval-result';

/**
 * Round 79 (T287): in tree mode the played pair is priced with the root's own cell of the merged matrix, the number the
 * roots around it are made of. The depth-1 sub-search (evalPair) stays only where the pair is no priced cell: a matrix
 * turn (its pair search is the cell's own machinery), a cell no tree visited, a result that carries no cells.
 */
const script = vi.hoisted(() => ({
  evaluate: null as null | ((serialized: string, settings: EvalSettings) => Promise<EvalResult>),
  pairCalls: 0,
}));

const PAIR_VALUE = 0.1234;

vi.mock('../../../src/lib/eval/worker-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/eval/worker-client')>();
  class FakeEvalWorkerClient {
    evaluate(serialized: string, settings: EvalSettings) {
      if (!script.evaluate) throw new Error('no evaluate script');
      return script.evaluate(serialized, settings);
    }
    async evalPair() { script.pairCalls += 1; return PAIR_VALUE; }
    cancel() {}
    dispose() {}
  }
  return { ...actual, EvalWorkerClient: FakeEvalWorkerClient };
});

const { useEvaluation } = await import('../../../src/hooks/useEvaluation');

const position = () => JSON.stringify({ sides: [{ pokemon: [{ hp: 100, fainted: false }] }] });
const doublesPosition = () => JSON.stringify({ gameType: 'doubles', ...JSON.parse(position()) });
const treePrefs = { depth: 1 as const, samples: 1 as const, mode: 'mcts' as const, auto: false, autoAnalyze: false, tera: 'auto' as const };
const matrixPrefs = { ...treePrefs, mode: 'matrix' as const };

const move = (name: string, targetLoc?: number): PlayedAction => ({ kind: 'move', name, ...(targetLoc !== undefined ? { targetLoc } : {}) });
const SINGLES_TURN: PlayedTurn = { p1: move('Swords Dance'), p2: move('Body Press') };
const DOUBLES_TURN: PlayedTurn = {
  p1: null, p2: null,
  p1Slots: [move('Flare Blitz', 1), move('Rage Powder')],
  p2Slots: [move('Taunt', 2), move('Wood Hammer', 1)],
};

/** A tree result: every cell carries its visits (the fixture's matrix has no `cells`, as a matrix-mode result). */
function treeResult(kind: 'singles' | 'doubles', visits: (i: number, j: number) => number, verified = false): EvalResult {
  const base = evalResult(kind);
  const matrix = base.matrix!;
  const cells: MatrixCell[][] = matrix.values.map((row, i) => row.map((_, j) => ({ visits: visits(i, j), verified })));
  return { ...base, matrix: { ...matrix, cells } };
}

const CELL = { singles: { row: 1, column: 1 }, doubles: { row: 1, column: 1 } };
const cellOf = (result: EvalResult, kind: 'singles' | 'doubles') => result.matrix!.values[CELL[kind].row][CELL[kind].column];

beforeEach(() => {
  script.pairCalls = 0;
  script.evaluate = null;
});

afterEach(() => {
  localStorage.clear();
});

let keyCounter = 0;
const sweepOf = async (kind: 'singles' | 'doubles', played: PlayedTurn, prefs: typeof treePrefs, result: EvalResult) => {
  script.evaluate = async () => result;
  const key = `played-cell:${keyCounter++}`;
  const { result: hook } = renderHook(() => useEvaluation());
  act(() => hook.current.setPrefs(prefs));
  act(() => hook.current.runGraphSweep({
    turns: 1, tera: false as const, rules: logRules(''), doubles: kind === 'doubles', cacheKeyFor: () => key,
    acquireFor: () => async () => (kind === 'doubles' ? doublesPosition() : position()), playedFor: () => played,
  }));
  await waitFor(() => expect(hook.current.graph.running).toBe(true));
  await waitFor(() => expect(hook.current.graph.running).toBe(false), { timeout: 10_000 });
  return { hook, key };
};

describe.each([
  ['singles', SINGLES_TURN],
  ['doubles', DOUBLES_TURN],
] as const)('the played pair of a tree turn, %s', (kind, played) => {
  test("reads the root's own cell and asks no sub-search", async () => {
    const result = treeResult(kind, () => 12);
    const { hook } = await sweepOf(kind, played, treePrefs, result);
    expect(hook.current.graph.settings[0]).toMatchObject({ mode: 'mcts' });
    expect(hook.current.graph.playedOutcome).toEqual([cellOf(result, kind)]);
    expect(cellOf(result, kind)).not.toBe(PAIR_VALUE);
    expect(script.pairCalls).toBe(0);
  });

  test('a verified cell counts as priced even with no visit of its own', async () => {
    const result = treeResult(kind, () => 0, true);
    const { hook } = await sweepOf(kind, played, treePrefs, result);
    expect(hook.current.graph.playedOutcome).toEqual([cellOf(result, kind)]);
    expect(script.pairCalls).toBe(0);
  });

  test('a cell no tree visited reads the root value, so the sub-search prices the pair', async () => {
    const result = treeResult(kind, (i, j) => (i === CELL[kind].row && j === CELL[kind].column ? 0 : 5));
    const { hook } = await sweepOf(kind, played, treePrefs, result);
    expect(hook.current.graph.playedOutcome).toEqual([PAIR_VALUE]);
    expect(script.pairCalls).toBe(1);
  });

  test('a tree result without cells keeps the sub-search', async () => {
    const { hook } = await sweepOf(kind, played, treePrefs, evalResult(kind));
    expect(hook.current.graph.playedOutcome).toEqual([PAIR_VALUE]);
    expect(script.pairCalls).toBe(1);
  });

  test('a matrix turn keeps its own pair search', async () => {
    const { hook } = await sweepOf(kind, played, matrixPrefs, treeResult(kind, () => 12));
    expect(hook.current.graph.settings[0]).toMatchObject({ mode: 'matrix' });
    expect(hook.current.graph.playedOutcome).toEqual([PAIR_VALUE]);
    expect(script.pairCalls).toBe(1);
  });

  test('a cached entry that never priced its pair reads the cell too', async () => {
    const result = treeResult(kind, () => 12);
    script.evaluate = async () => result;
    const key = `played-cell:${keyCounter++}`;
    const { result: hook } = renderHook(() => useEvaluation());
    act(() => hook.current.setPrefs(treePrefs));
    // A single evaluation caches the result without the played-pair expectation (undefined, not null).
    act(() => hook.current.evaluate({ cacheKey: key, tera: false, acquire: async () => (kind === 'doubles' ? doublesPosition() : position()), tag: 'single' }));
    await waitFor(() => expect(hook.current.status).toBe('done'));
    act(() => hook.current.runGraphSweep({
      turns: 1, tera: false as const, rules: logRules(''), doubles: kind === 'doubles', cacheKeyFor: () => key,
      acquireFor: () => async () => (kind === 'doubles' ? doublesPosition() : position()), playedFor: () => played,
    }));
    await waitFor(() => expect(hook.current.graph.running).toBe(true));
    await waitFor(() => expect(hook.current.graph.running).toBe(false), { timeout: 10_000 });
    expect(hook.current.graph.playedOutcome).toEqual([cellOf(result, kind)]);
    expect(script.pairCalls).toBe(0);
  });
});
