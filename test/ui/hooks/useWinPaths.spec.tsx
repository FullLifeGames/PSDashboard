import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult, WinPaths, WinPathsRequest, WinStep } from '@fulllifegames/eval-engine';
import type { PokemonSnapshot, ReplayData, TurnSnapshot } from '@fulllifegames/replay-core';
import type { AppController } from '../../../src/hooks/useAppController';
import { useWinPaths } from '../../../src/hooks/useWinPaths';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { misplayedSide, turnAnalysis } from '../fixtures/analysis';

/**
 * Round 89 (#130), step G8b: the hook behind the Endgame row. The worker client is a stand-in that records what it was asked and lets
 * the test finish its steps one by one; the hook is the only caller of the job.
 */
interface Call { position: string; request: WinPathsRequest; ruleset: string; signal: AbortSignal; onStep: (step: WinStep) => void; finish: (paths: WinPaths) => void; fail: (error: Error) => void }
const calls: Call[] = [];
const disposed = vi.fn();

vi.mock('../../../src/lib/eval/worker-client', () => ({
  EvalWorkerClient: class {
    winPaths(position: string, request: WinPathsRequest, ruleset: string, handlers: { signal: AbortSignal; onStep: (step: WinStep) => void }) {
      return new Promise<WinPaths>((resolve, reject) => {
        calls.push({ position, request, ruleset, signal: handlers.signal, onStep: handlers.onStep, finish: resolve, fail: reject });
      });
    }
    dispose() { disposed(); }
  },
}));

const mon = (fainted: boolean): PokemonSnapshot => ({ name: 'x', speciesForme: 'x', hp: fainted ? 0 : 100, maxhp: 100, hpPercent: fainted ? 0 : 100, status: '', fainted, isActive: false, boosts: {}, moves: [], ability: '', item: '', terastallized: '', level: 50, gender: '' });
const side = (id: 'p1' | 'p2', fallen: number) => ({ name: id, id, pokemon: Array.from({ length: 6 }, (_, index) => mon(index < fallen)), sideConditions: {} });
const snapshot = (turn: number, fallen1: number, fallen2: number): TurnSnapshot => ({ turn, p1: side('p1', fallen1), p2: side('p2', fallen2), field: { weather: '', terrain: '', pseudoWeather: {} }, log: [] });
// turns 1 and 2 hold many bodies; turns 3 and 4 hold three and two
const SNAPSHOTS = [snapshot(1, 0, 0), snapshot(2, 3, 3), snapshot(3, 4, 5), snapshot(4, 5, 5)];
const REPLAY = (id: string, winner = 'devin'): ReplayData => ({ id, format: 'gen6ou', formatid: 'gen6ou', players: ['BKC', 'devin'], log: `|turn|4\n|win|${winner}`, uploadtime: 0, views: 0 });

const result: EvalResult = { ...evalResult('singles'), perSide: {
  p1: [rankedChoice('move scald', 'Scald', 0.3), rankedChoice('move hydropump', 'Hydro Pump', 0.2)],
  p2: [rankedChoice('move bulletpunch', 'Bullet Punch', -0.2), rankedChoice('move highjumpkick', 'High Jump Kick', -0.4)],
} };

function app(extra: { smogonPending?: boolean; snapshots?: TurnSnapshot[]; acquire?: () => Promise<string> } = {}): AppController {
  const analyses = [null, null, turnAnalysis(3, { p2: { ...misplayedSide('mistake'), played: rankedChoice('move highjumpkick', 'High Jump Kick', -0.4) } }), null];
  return {
    ctx: { replay: { snapshots: extra.snapshots ?? SNAPSHOTS }, evaluation: { graph: { results: [null, null, result, null] } } },
    board: { timeline: { analyzableTurns: 4 } },
    analysis: { gameAnalyses: analyses },
    engine: {
      smogonPending: extra.smogonPending ?? false,
      acquire: { makeReplayAcquire: () => () => (extra.acquire ? extra.acquire() : Promise.resolve('{"position":true}')) },
      evalView: { effectiveTera: true, effectiveSleepClause: true, effectiveRuleset: 'standard' },
    },
  } as unknown as AppController;
}

const step = (kind: WinStep['kind'], status: WinStep['status'] = 'found'): WinStep => ({ kind, status, spent: { cells: 1, turns: 1 } });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { calls.length = 0; disposed.mockClear(); });
afterEach(() => vi.clearAllMocks());

describe('useWinPaths', () => {
  test('the endgame is the loser\'s and holds the turns that start with three bodies or fewer', () => {
    const { result: hook } = renderHook(() => useWinPaths(app(), REPLAY('g1')));
    expect(hook.current.endgame).toEqual({ loser: 'p1', turns: [3, 4] });
    expect(hook.current.run).toBeNull();
    expect(hook.current.unavailable).toBeNull();
  });

  test('a game with no winner, or one that never reached its endgame, has no endgame and show starts nothing', async () => {
    const tie = renderHook(() => useWinPaths(app(), { ...REPLAY('g2'), log: '|turn|4\n|tie' }));
    expect(tie.result.current.endgame).toBeNull();
    const early = renderHook(() => useWinPaths(app({ snapshots: SNAPSHOTS.slice(0, 2) }), REPLAY('g3')));
    expect(early.result.current.endgame).toBeNull();
    act(() => early.result.current.show(2));
    await flush();
    expect(calls).toHaveLength(0);
    expect(early.result.current.run).toBeNull();
  });

  test('the search for a turn asks the worker with the turn\'s ranking and shows the steps as they arrive', async () => {
    const { result: hook } = renderHook(() => useWinPaths(app(), REPLAY('g4', 'BKC')));
    // BKC won: devin (p2) lost
    expect(hook.current.endgame?.loser).toBe('p2');
    act(() => hook.current.show(3));
    expect(hook.current.run).toMatchObject({ turn: 3, side: 'p2', steps: [], status: 'positioning' });
    await flush();
    expect(hook.current.run?.status).toBe('searching');
    expect(calls).toHaveLength(1);
    expect(calls[0].position).toBe('{"position":true}');
    expect(calls[0].ruleset).toBe('standard');
    expect(calls[0].request).toEqual({
      side: 'p2', turn: 3, rootOrder: ['move bulletpunch', 'move highjumpkick'], first: { p1: 'move scald', p2: 'move bulletpunch' },
      foeRanking: [{ choice: 'move scald', ev: 0.3 }, { choice: 'move hydropump', ev: 0.2 }], played: 'move highjumpkick', tera: true, sleepClause: true, ruleset: 'standard',
    });
    expect(hook.current.playedLabel(3)).toBe('High Jump Kick');
    act(() => calls[0].onStep(step('stronger')));
    expect(hook.current.run?.steps.map(item => item.kind)).toEqual(['stronger']);
    act(() => calls[0].onStep(step('luck', 'none')));
    act(() => calls[0].onStep(step('mistake')));
    expect(hook.current.run?.steps.map(item => item.kind)).toEqual(['stronger', 'luck', 'mistake']);
    expect(hook.current.run?.status).toBe('searching');
    await act(async () => { calls[0].finish({ side: 'p2', turn: 3, steps: [] }); });
    expect(hook.current.run?.status).toBe('done');
    expect(calls[0].signal.aborted).toBe(false);
  });

  test('closing the panel stops the worker, and a late step of that search is dropped', async () => {
    const { result: hook } = renderHook(() => useWinPaths(app(), REPLAY('g5')));
    act(() => hook.current.show(3));
    await flush();
    const [call] = calls;
    act(() => hook.current.hide());
    expect(call.signal.aborted).toBe(true);
    expect(hook.current.run).toBeNull();
    act(() => call.onStep(step('stronger')));
    await act(async () => { call.fail(new Error('cancelled')); });
    expect(hook.current.run).toBeNull();
  });

  test('asking for another turn stops the first search; only the second one\'s steps are shown', async () => {
    const { result: hook } = renderHook(() => useWinPaths(app(), REPLAY('g6')));
    act(() => hook.current.show(3));
    await flush();
    act(() => hook.current.show(4));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
    act(() => calls[0].onStep(step('stronger')));
    act(() => calls[1].onStep(step('luck', 'none')));
    expect(hook.current.run).toMatchObject({ turn: 4, steps: [{ kind: 'luck' }] });
  });

  test('a job that breaks reads failed', async () => {
    const { result: hook } = renderHook(() => useWinPaths(app(), REPLAY('g7')));
    act(() => hook.current.show(3));
    await flush();
    await act(async () => { calls[0].fail(new Error('the worker broke')); });
    expect(hook.current.run?.status).toBe('failed');
  });

  test('a position that cannot be rebuilt reads failed and starts no worker', async () => {
    const { result: hook } = renderHook(() => useWinPaths(app({ acquire: () => Promise.reject(new Error('no position')) }), REPLAY('g8')));
    act(() => hook.current.show(3));
    await flush();
    expect(hook.current.run?.status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('another replay shows no search of the previous one, and stops it', async () => {
    const { result: hook, rerender } = renderHook(({ replay }) => useWinPaths(app(), replay), { initialProps: { replay: REPLAY('g9') } });
    act(() => hook.current.show(3));
    await flush();
    expect(hook.current.run).not.toBeNull();
    rerender({ replay: REPLAY('g10') });
    expect(hook.current.run).toBeNull();
    expect(calls[0].signal.aborted).toBe(true);
  });

  test('the sets still loading make the search unavailable', () => {
    const { result: hook } = renderHook(() => useWinPaths(app({ smogonPending: true }), REPLAY('g11')));
    expect(hook.current.unavailable).toMatch(/Smogon/);
  });

  test('leaving the page stops the search and ends the client', async () => {
    const { result: hook, unmount } = renderHook(() => useWinPaths(app(), REPLAY('g12')));
    act(() => hook.current.show(3));
    await flush();
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});
