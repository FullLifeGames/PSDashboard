import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EvalResult } from '@fulllifegames/eval-engine';
import { useEngineWalk, type EngineWalkInputs } from '../../../src/hooks/useEngineWalk';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

type Evaluation = ReturnType<typeof useEvaluation>;

function evaluationOf(shape: { auto?: boolean; hardMode?: boolean; status?: Evaluation['status']; result?: EvalResult | null; resultTag?: string | null } = {}) {
  const setPrefs = vi.fn();
  const prefs = { depth: 1 as const, samples: 1 as const, mode: 'matrix' as const, auto: shape.auto ?? true, autoAnalyze: false, tera: 'auto' as const, ...(shape.hardMode === undefined ? {} : { hardMode: shape.hardMode }) };
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

  // A pick played from the queue arms the walk in the same effect pass in which the walk's own effect
  // still sees the result that stood before the click. That result is not the replacement position and must not
  // disarm the walk: the forced replacement that comes next still auto-plays. The arming does not read the game
  // type, so doubles (a combined choice per side, the same refs) take the same path; the singles case stands for both.
  test('off the tip the queued pick keeps the walk armed until the replacement position arrives', async () => {
    const before = evalResult('singles');
    const doneBefore = evaluationOf({ status: 'done', result: before, resultTag: 'variation:3' }).evaluation;
    const wired = inputs({ liveTip: false, evaluation: doneBefore });
    const { result, rerender } = renderHook((props: EngineWalkInputs) => useEngineWalk(props), { initialProps: wired });
    act(() => result.current.handleExploreChoice('p1', rankedChoice('move earthquake', 'Earthquake', 0.3), rankedChoice('move leechseed', 'Leech Seed', -0.3)));
    rerender({ ...wired, liveTip: true, branchPreparing: false });
    await flush();
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
    (wired.handleSetChoice as ReturnType<typeof vi.fn>).mockClear();

    const forced = evalResult('singles', { perSide: { p1: [rankedChoice('switch heatran', '→ Heatran', 0.1)], p2: [rankedChoice('wait', 'wait', 0)] } });
    rerender({ ...wired, liveTip: true, evaluation: evaluationOf({ status: 'done', result: forced, resultTag: 'variation:3' }).evaluation });
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' }, 0);
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

/**
 * A click on an engine move in a card or the live panel hands the result the card reads; with the setting on
 * the opponent answers with the reply that hurts the clicked move most (`worstReply`), else with the reply the card names (the best
 * row). A matrix cell names its pair and is played as clicked. Singles and doubles.
 */
describe('useEngineWalk, Hard mode', () => {
  const clicked = (kind: 'singles' | 'doubles', hardMode: boolean | undefined, result: EvalResult = evalResult(kind)) => {
    const wired = inputs({ simState: simState(kind), evaluation: evaluationOf({ status: 'done', result, hardMode }).evaluation });
    const walk = renderHook(() => useEngineWalk(wired));
    act(() => walk.result.current.handleExploreChoice('p1', result.perSide.p1[0], result.perSide.p2[0], result));
    return wired;
  };

  test('singles, on: the opponent answers with the reply that hurts the move most, not with its best row', () => {
    const wired = clicked('singles', true);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);
    expect(wired.handleSetChoice).not.toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('singles, off or unset: the reply the card names, as before', () => {
    for (const hardMode of [false, undefined]) {
      const wired = clicked('singles', hardMode);
      expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
      expect(wired.handleSetChoice).not.toHaveBeenCalledWith('p2', expect.objectContaining({ speciesId: 'rotomwash' }), 0);
    }
  });

  test('doubles, on: the joint worst answer fills both slots of the opponent with their targets', () => {
    // the fixture's own pickers: Rillaboom (slot 0) and Tornadus (slot 1) answer; the clicked row is hurt most by the second reply
    const base = evalResult('doubles');
    const replies = [rankedChoice('move grassyglide 1, move tailwind', 'A', -0.2), rankedChoice('move woodhammer 1, move taunt 1', 'B', -0.3)];
    const result: EvalResult = {
      ...base, perSide: { p1: base.perSide.p1, p2: replies },
      matrix: { ...base.matrix!, p2Labels: ['A', 'B'], p2Choices: replies.map(row => row.choice), values: [[0.3, 0.1], [0.2, 0.25]] },
    };
    const wired = clicked('doubles', true, result);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'woodhammer', targetLoc: 1 }), 0);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'taunt', targetLoc: 1 }), 1);
    expect(wired.handleSetChoice).not.toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'grassyglide' }), 0);
  });

  test('a worst answer no picker maps falls back down the ranked list: the turn still plays', () => {
    const base = evalResult('singles');
    const unmapped = rankedChoice('move hyperbeam', 'Hyper Beam', -0.5);
    const result = {
      ...base, perSide: { ...base.perSide, p2: [...base.perSide.p2, unmapped] },
      matrix: { ...base.matrix!, p2Labels: [...base.matrix!.p2Labels, 'Hyper Beam'], p2Choices: [...base.matrix!.p2Choices!, 'move hyperbeam'], values: base.matrix!.values.map(row => [...row, -0.9]) },
    };
    const wired = clicked('singles', true, result);
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
    expect(wired.executeTurn).toHaveBeenCalledTimes(1);
  });

  test('a matrix cell is played as clicked with the setting on', () => {
    const wired = inputs({ evaluation: evaluationOf({ status: 'done', result: evalResult('singles'), hardMode: true }).evaluation });
    const { result } = renderHook(() => useEngineWalk(wired));
    act(() => result.current.handlePickPair({ choice: 'move swordsdance', label: 'Swords Dance' }, { choice: 'move bodypress', label: 'Body Press' }));
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
    expect(wired.handleSetChoice).not.toHaveBeenCalledWith('p2', expect.objectContaining({ speciesId: 'rotomwash' }), 0);
  });

  test('off the live tip the worst answer is read at the click and kept for the pick that waits', () => {
    const result = evalResult('singles');
    const wired = inputs({ liveTip: false, evaluation: evaluationOf({ status: 'done', result, hardMode: true }).evaluation });
    const { result: walk, rerender } = renderHook((props: EngineWalkInputs) => useEngineWalk(props), { initialProps: wired });
    act(() => walk.current.handleExploreChoice('p1', result.perSide.p1[0], result.perSide.p2[0], result));
    // the position the deviation flow rebuilds carries another result: the pick still plays the reply read at the click
    rerender({ ...wired, liveTip: true, evaluation: evaluationOf({ status: 'done', result: evalResult('singles', { score: 0.9 }), hardMode: true }).evaluation });
    expect(wired.handleSetChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ speciesId: 'rotomwash' }), 0);
  });
});
