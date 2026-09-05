import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { useEngineWalk, type EngineWalkInputs } from '../../src/hooks/useEngineWalk';
import type { useEvaluation } from '../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

type Evaluation = ReturnType<typeof useEvaluation>;

function evaluationOf(shape: { auto?: boolean; status?: Evaluation['status']; result?: EvalResult | null; resultTag?: string | null } = {}) {
  const setPrefs = vi.fn();
  const prefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: shape.auto ?? true, autoAnalyze: false, tera: 'auto' as const };
  const evaluation = {
    prefs, setPrefs, status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.resultTag ?? null,
  } as unknown as Evaluation;
  return { evaluation, setPrefs };
}

function inputs(overrides: Partial<EngineWalkInputs> = {}): EngineWalkInputs {
  return {
    simState: simState('singles'), liveTip: true, branching: true, branchPreparing: false, executing: false, confirmOpen: false,
    playOutActive: false, evaluation: evaluationOf().evaluation, evalViewKey: 'variation:3',
    getBattle: vi.fn(() => ({ ended: false }) as unknown as ReturnType<EngineWalkInputs['getBattle']>),
    executeTurn: vi.fn(async () => {}), handleEvaluate: vi.fn(), handleSetChoice: vi.fn(), requestDeviation: vi.fn(),
    setBranchDivergence: vi.fn(),
    ...overrides,
  };
}

const flush = () => act(async () => {});

describe('useEngineWalk', () => {
  test('applyEvalChoice maps an engine line onto the live pickers, slot by slot', () => {
    const wired = inputs();
    const { result } = renderHook(() => useEngineWalk(wired));
    expect(result.current.applyEvalChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3))).toBe(true);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }, 0);
    expect(result.current.applyEvalChoice('p2', rankedChoice('switch rotomwash', '→ Rotom-Wash', 0))).toBe(true);
    expect(wired.handleSetChoice).toHaveBeenLastCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);
    expect(result.current.applyEvalChoice('p1', rankedChoice('move hyperbeam', 'Hyper Beam', 0))).toBe(false);
    expect(wired.handleSetChoice).toHaveBeenCalledTimes(2);
  });

  test('doubles: a combined choice fills both slots with their targets; no sim state maps nothing', () => {
    const wired = inputs({ simState: simState('doubles') });
    const { result } = renderHook(() => useEngineWalk(wired));
    expect(result.current.applyEvalChoice('p1', rankedChoice('move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus', 0.3))).toBe(true);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ kind: 'move', moveId: 'fakeout', targetLoc: 1 }), 0);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ kind: 'move', moveId: 'spore', targetLoc: 2 }), 1);

    const empty = renderHook(() => useEngineWalk(inputs({ simState: null })));
    expect(empty.result.current.applyEvalChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0))).toBe(false);
  });

  test('clicking an engine line on the live tip plays the turn out with the reply and re-evaluates', async () => {
    const { evaluation, setPrefs } = evaluationOf({ auto: false });
    const wired = inputs({ evaluation });
    const { result } = renderHook(() => useEngineWalk(wired));
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3), rankedChoice('move leechseed', 'Leech Seed', -0.3)));
    expect(setPrefs).toHaveBeenCalledWith(expect.objectContaining({ auto: true }));
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
    await flush();
    expect(wired.handleEvaluate).toHaveBeenCalledTimes(1);
  });

  test('without a reply the other side answers with the engine\'s top playable line', async () => {
    const done = evalResult('singles');
    const wired = inputs({ evaluation: evaluationOf({ status: 'done', result: done }).evaluation });
    const { result } = renderHook(() => useEngineWalk(wired));
    act(() => result.current.handleExploreChoice('p1', done.perSide.p1[0]));
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('a matrix cell plays exactly that pair', () => {
    const wired = inputs();
    const { result } = renderHook(() => useEngineWalk(wired));
    act(() => result.current.handlePickPair({ choice: 'move swordsdance', label: 'Swords Dance' }, { choice: 'move bodypress', label: 'Body Press' }));
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'swordsdance' }), 0);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('an ended branch refuses with the divergence notice; a line no picker knows evaluates instead of stalling', () => {
    const wired = inputs({ getBattle: vi.fn(() => ({ ended: true }) as unknown as ReturnType<EngineWalkInputs['getBattle']>) });
    const { result } = renderHook(() => useEngineWalk(wired));
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0)));
    const updater = (wired.setBranchDivergence as ReturnType<typeof vi.fn>).mock.calls[0][0] as (previous: string | null) => string | null;
    expect(updater(null)).toMatch(/already ended/);
    expect(updater('kept')).toBe('kept');
    expect(wired.handleSetChoice).not.toHaveBeenCalled();

    const noReply = inputs({ evaluation: evaluationOf({ status: 'done', result: evalResult('singles', { perSide: { p1: evalResult().perSide.p1, p2: [rankedChoice('wait', 'wait', 0)] } }) }).evaluation });
    const alone = renderHook(() => useEngineWalk(noReply));
    act(() => alone.result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0)));
    expect(noReply.executeTurn).not.toHaveBeenCalled();
    expect(noReply.handleEvaluate).toHaveBeenCalledTimes(1);
  });

  test('off the live tip the pick waits for the deviation flow and plays once the tip stands', () => {
    const wired = inputs({ liveTip: false });
    const { result, rerender } = renderHook((props: EngineWalkInputs) => useEngineWalk(props), { initialProps: wired });
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3), rankedChoice('move leechseed', 'Leech Seed', -0.3)));
    expect(wired.requestDeviation).toHaveBeenCalledWith(null);
    expect(wired.handleSetChoice).not.toHaveBeenCalled();

    rerender({ ...wired, liveTip: true, branchPreparing: true });
    expect(wired.handleSetChoice).not.toHaveBeenCalled();
    rerender({ ...wired, liveTip: true, branchPreparing: false });
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('a cancelled branch entry drops the queued pick', () => {
    const wired = inputs({ liveTip: false, branching: true });
    const { result, rerender } = renderHook((props: EngineWalkInputs) => useEngineWalk(props), { initialProps: wired });
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3)));
    rerender({ ...wired, branching: false });
    rerender({ ...wired, liveTip: true, branching: true });
    expect(wired.handleSetChoice).not.toHaveBeenCalled();
  });

  test('after a walked turn, a one-sided forced position auto-plays; the next two-sided position disarms', async () => {
    const wired = inputs();
    const { result, rerender } = renderHook((props: EngineWalkInputs) => useEngineWalk(props), { initialProps: wired });
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3), rankedChoice('move leechseed', 'Leech Seed', -0.3)));
    await flush();
    (wired.handleSetChoice as ReturnType<typeof vi.fn>).mockClear();

    const forced = evalResult('singles', { perSide: { p1: [rankedChoice('switch heatran', '→ Heatran', 0.1)], p2: [rankedChoice('wait', 'wait', 0)] } });
    rerender({ ...wired, evaluation: evaluationOf({ status: 'done', result: forced, resultTag: 'variation:3' }).evaluation });
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' }, 0);

    (wired.handleSetChoice as ReturnType<typeof vi.fn>).mockClear();
    rerender({ ...wired, evaluation: evaluationOf({ status: 'done', result: evalResult('singles'), resultTag: 'variation:3' }).evaluation });
    expect(wired.handleSetChoice).not.toHaveBeenCalled();
    // Disarmed: another forced position now waits for the user.
    rerender({ ...wired, evaluation: evaluationOf({ status: 'done', result: evalResult('singles', { perSide: forced.perSide }), resultTag: 'variation:3' }).evaluation });
    expect(wired.handleSetChoice).not.toHaveBeenCalled();
  });
});
