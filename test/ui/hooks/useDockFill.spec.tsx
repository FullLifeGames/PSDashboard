import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { useDockFill, type DockFillInputs } from '../../../src/hooks/useDockFill';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A5: the engine fill at the live tip of a variation. A stub evaluation stands in for the worker: the
 * spec reads when a run starts, what the result writes, and what Execute does while the run is pending.
 */

type Evaluation = ReturnType<typeof useEvaluation>;
type Choices = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

interface Shape {
  status?: Evaluation['status'];
  result?: EvalResult | null;
  resultTag?: string | null;
  running?: boolean;
  auto?: boolean;
  autoAnalyze?: boolean;
}

function evaluationOf(shape: Shape = {}) {
  const setPrefs = vi.fn();
  const evaluation = {
    status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.resultTag ?? null, setPrefs,
    prefs: { depth: 1, samples: 1, mode: 'matrix', auto: shape.auto ?? false, autoAnalyze: shape.autoAnalyze ?? false, tera: 'auto' },
    graph: { running: shape.running ?? false },
  } as unknown as Evaluation;
  return { evaluation, setPrefs };
}

/** The branch's pending picks, as the real hook keeps them: written in place, read at the moment. */
function branchOf(kind: FormatKind) {
  const slots = kind === 'doubles' ? 2 : 1;
  const choices: Choices = { p1: Array(slots).fill(null), p2: Array(slots).fill(null) };
  const setChoice = vi.fn((side: 'p1' | 'p2', choice: BranchSlotChoice, slot = 0) => {
    choices[side] = [...choices[side]];
    choices[side][slot] = choice;
  });
  const executeTurn = vi.fn(async () => null);
  return { choices, setChoice, executeTurn, getChoices: () => choices };
}

function inputsOf(kind: FormatKind, overrides: Partial<DockFillInputs> = {}) {
  const branch = branchOf(kind);
  const handleEvaluate = vi.fn<(options?: { onResult?: (result: EvalResult) => void }) => void>();
  const wired: DockFillInputs = {
    simState: simState(kind), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation: evaluationOf().evaluation, liveEvalStatus: 'idle', evalViewKey: 'variation:3', historyLength: 1, sessionKey: 's1',
    handleEvaluate, getChoices: branch.getChoices, setChoice: branch.setChoice, executeTurn: branch.executeTurn,
    ...overrides,
  };
  return { wired, branch, handleEvaluate };
}

const onResultOf = (handleEvaluate: ReturnType<typeof inputsOf>['handleEvaluate'], call = 0) => {
  const options = handleEvaluate.mock.calls[call][0];
  if (!options?.onResult) throw new Error('the run carries no result callback');
  return options.onResult;
};

/** The doubles fixture result with a second side the fixture's own pickers can play. */
const doublesResult = (): EvalResult => {
  const base = evalResult('doubles');
  return { ...base, perSide: { p1: base.perSide.p1, p2: [rankedChoice('move grassyglide 1, move tailwind', 'Grassy Glide → Incineroar + Tailwind', -0.25)] } };
};

const isNull = (value: unknown) => value === null;

describe('useDockFill: when a run starts', () => {
  test.each(['singles', 'doubles'] as const)('%s: one run per position, with a result callback, and never the Auto preference', (kind) => {
    const { evaluation, setPrefs } = evaluationOf();
    const { wired, handleEvaluate } = inputsOf(kind, { evaluation });
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    expect(handleEvaluate.mock.calls[0][0]).toEqual({ onResult: expect.any(Function) });
    expect(result.current.pending).toBe(true);
    rerender({ ...wired, evaluation: evaluationOf({ status: 'searching', resultTag: 'variation:3' }).evaluation });
    rerender({ ...wired, evaluation: evaluationOf({ status: 'searching', resultTag: 'variation:3' }).evaluation });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    // The next position of the variation (a turn executed) is a new key.
    rerender({ ...wired, historyLength: 2, evalViewKey: 'variation:4' });
    expect(handleEvaluate).toHaveBeenCalledTimes(2);
    expect(setPrefs).not.toHaveBeenCalled();
  });

  test('with "always on" an effect of the view starts the run of an idle live position: the fill starts none', () => {
    const { evaluation } = evaluationOf({ autoAnalyze: true });
    const { wired, handleEvaluate } = inputsOf('doubles', { evaluation, liveEvalStatus: 'idle' });
    renderHook(() => useDockFill(wired));
    expect(handleEvaluate).not.toHaveBeenCalled();
  });

  test('a new variation at the same turn is a new position and runs again', () => {
    const { wired, handleEvaluate } = inputsOf('singles');
    const { rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    rerender({ ...wired, sessionKey: 's2' });
    expect(handleEvaluate).toHaveBeenCalledTimes(2);
  });

  test('a forced replacement is the user pick: no run for either side, in either format', () => {
    for (const kind of ['singles', 'doubles'] as const) {
      const p1 = inputsOf(kind, { simState: simState(kind, { p1ForceSwitch: true }) });
      renderHook(() => useDockFill(p1.wired));
      const p2 = inputsOf(kind, { simState: simState(kind, { p2ForceSwitch: true }) });
      renderHook(() => useDockFill(p2.wired));
      expect(p1.handleEvaluate).not.toHaveBeenCalled();
      expect(p2.handleEvaluate).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['not at the live tip', { liveTip: false }],
    ['not in a variation', { branching: false }],
    ['without a position', { simState: null }],
    ['at an ended position', { simState: simState('singles', { ended: true }) }],
    ['while a turn executes', { executing: true }],
    ['while a branch prepares', { branchPreparing: true }],
    ['during a play-out', { playOutActive: true }],
    ['for a game type without evaluation', { evalAvailable: false }],
  ] as [string, Partial<DockFillInputs>][])('no run %s', (_name, overrides) => {
    const { wired, handleEvaluate } = inputsOf('singles', overrides);
    const { result } = renderHook(() => useDockFill(wired));
    expect(handleEvaluate).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  test('no run while the game analysis runs, a note for the chips, and one run when it has ended', () => {
    const running = evaluationOf({ running: true }).evaluation;
    const { wired, handleEvaluate } = inputsOf('doubles', { evaluation: running });
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    expect(handleEvaluate).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    expect(result.current.pending).toBe(false);
    rerender({ ...wired, evaluation: evaluationOf({ running: false }).evaluation });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.pending).toBe(true);
  });

  test('a run that the game analysis stopped starts again when the analysis has ended', () => {
    const { wired, handleEvaluate } = inputsOf('singles');
    const { rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    rerender({ ...wired, evaluation: evaluationOf({ running: true, status: 'idle', resultTag: 'variation:3' }).evaluation });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    rerender({ ...wired, evaluation: evaluationOf({ running: false, status: 'idle', resultTag: 'variation:3' }).evaluation });
    expect(handleEvaluate).toHaveBeenCalledTimes(2);
  });

  test('with Auto on, the evaluation that follows an executed turn is the Auto effect run: the fill waits for its result', () => {
    const { evaluation } = evaluationOf({ auto: true, status: 'done', resultTag: 'variation:2', result: evalResult('singles') });
    const { wired, handleEvaluate, branch } = inputsOf('singles', { evaluation, liveEvalStatus: 'stale' });
    const { rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    expect(handleEvaluate).not.toHaveBeenCalled();
    // The Auto run is under way for this position, then lands: its result fills.
    rerender({ ...wired, evaluation: evaluationOf({ auto: true, status: 'searching', resultTag: 'variation:3' }).evaluation, liveEvalStatus: 'searching' });
    expect(handleEvaluate).not.toHaveBeenCalled();
    const landed = evalResult('singles');
    rerender({ ...wired, evaluation: evaluationOf({ auto: true, status: 'done', resultTag: 'variation:3', result: landed }).evaluation, liveEvalStatus: 'done' });
    expect(branch.setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
    expect(branch.setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
  });
});

describe('useDockFill: what the result writes', () => {
  test('singles: both sides take the best ranked choice, marked as the engine', () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(branch.setChoice).toHaveBeenCalledWith('p1', { kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }, 0);
    expect(branch.setChoice).toHaveBeenCalledWith('p2', { kind: 'move', moveId: 'leechseed', moveName: 'Leech Seed' }, 0);
    expect(result.current.engine).toEqual({ p1: [true], p2: [true] });
    expect(result.current.pending).toBe(false);
  });

  test('doubles: a slot the user touched keeps its pick; the other slot takes the part that agrees', () => {
    const user: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 };
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    branch.choices.p1[0] = user;
    const { result } = renderHook(() => useDockFill(wired));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    // The best joint choice opens with Fake Out, so it disagrees with Flare Blitz: the second one decides.
    expect(branch.setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), 0);
    expect(branch.setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'ragepowder' }), 1);
    expect(branch.choices.p1[0]).toBe(user);
    expect(result.current.engine.p1).toEqual([false, true]);
    expect(result.current.engine.p2).toEqual([true, true]);
  });

  test('doubles: no joint choice agrees with the touched slot, so the slot stays empty and the other side still fills', () => {
    const user: BranchSlotChoice = { kind: 'move', moveId: 'protect', moveName: 'Protect' };
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    branch.choices.p1[0] = user;
    const { result } = renderHook(() => useDockFill(wired));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.choices.p1.slice(1).every(isNull)).toBe(true);
    expect(result.current.engine.p1).toEqual([false, false]);
    expect(result.current.engine.p2).toEqual([true, true]);
    expect(result.current.pending).toBe(false);
  });

  test('a pick of the user over an engine slot takes its mark away', () => {
    const { wired, handleEvaluate } = inputsOf('doubles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(result.current.engine.p1).toEqual([true, true]);
    act(() => result.current.onUserChoice('p1', 1));
    expect(result.current.engine.p1).toEqual([true, false]);
  });

  test('a result for a position that has moved on writes nothing', () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    const { rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    const stale = onResultOf(handleEvaluate);
    rerender({ ...wired, historyLength: 2, evalViewKey: 'variation:4' });
    act(() => stale(evalResult('singles')));
    expect(branch.setChoice).not.toHaveBeenCalled();
  });

  test('a result that lands during a play-out or a sweep writes nothing', () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    const { rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    const onResult = onResultOf(handleEvaluate);
    rerender({ ...wired, playOutActive: true });
    act(() => onResult(evalResult('singles')));
    rerender({ ...wired, evaluation: evaluationOf({ running: true }).evaluation });
    act(() => onResult(evalResult('singles')));
    expect(branch.setChoice).not.toHaveBeenCalled();
  });
});

describe('useDockFill: Execute while the run is pending', () => {
  test('an Execute pressed before the result waits, runs after the fill, and runs once', async () => {
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    const { result } = renderHook(() => useDockFill(wired));
    expect(result.current.waits).toBe(false);
    act(() => result.current.queueExecute());
    expect(result.current.waits).toBe(true);
    expect(branch.executeTurn).not.toHaveBeenCalled();
    await act(async () => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.setChoice).toHaveBeenCalledTimes(4);
    expect(branch.executeTurn).toHaveBeenCalledTimes(1);
    expect(branch.executeTurn.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...branch.setChoice.mock.invocationCallOrder));
    expect(result.current.waits).toBe(false);
  });

  test('a result without a queued Execute does not run the turn', async () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    renderHook(() => useDockFill(wired));
    await act(async () => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(branch.executeTurn).not.toHaveBeenCalled();
  });

  test('a failed or stopped run releases Execute and nothing runs', () => {
    const { wired, branch } = inputsOf('singles');
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.queueExecute());
    expect(result.current.waits).toBe(true);
    rerender({ ...wired, evaluation: evaluationOf({ status: 'error', resultTag: 'variation:3' }).evaluation });
    expect(result.current.pending).toBe(false);
    expect(result.current.waits).toBe(false);
    rerender({ ...wired, evaluation: evaluationOf({ status: 'idle', resultTag: 'variation:3' }).evaluation });
    expect(result.current.waits).toBe(false);
    expect(branch.executeTurn).not.toHaveBeenCalled();
    expect(branch.setChoice).not.toHaveBeenCalled();
  });

  test('an Execute queued at one position does not wait at the next', () => {
    const { wired } = inputsOf('singles');
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.queueExecute());
    rerender({ ...wired, historyLength: 2, evalViewKey: 'variation:4' });
    expect(result.current.pending).toBe(true);
    expect(result.current.waits).toBe(false);
  });
});

describe('useDockFill: the rule against jumping', () => {
  test('doubles: the slot whose tray is open stays empty when the result lands, the other empty slot fills', () => {
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.holdTray({ side: 'p1', slot: 0 }));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.choices.p1[0]).toBeNull();
    expect(branch.choices.p1[1]).toEqual(expect.objectContaining({ moveId: 'spore' }));
    expect(result.current.engine.p1).toEqual([false, true]);
    expect(result.current.engine.p2).toEqual([true, true]);
  });

  test('singles: the open slot stays empty, the other side fills', () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.holdTray({ side: 'p2', slot: 0 }));
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(branch.choices.p2[0]).toBeNull();
    expect(branch.choices.p1[0]).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
    expect(result.current.engine).toEqual({ p1: [true], p2: [false] });
  });

  test('a tray that closed before the result lands holds nothing back', () => {
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.holdTray({ side: 'p1', slot: 0 }));
    act(() => result.current.holdTray(null));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.choices.p1[0]).not.toBeNull();
    expect(result.current.engine.p1).toEqual([true, true]);
  });

  test('the user touched a slot, the other one is held: the fill writes neither and still fills the other side', () => {
    const user: BranchSlotChoice = { kind: 'move', moveId: 'flareblitz', moveName: 'Flare Blitz', targetLoc: 2 };
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    branch.choices.p1[0] = user;
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.holdTray({ side: 'p1', slot: 1 }));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.choices.p1).toEqual([user, null]);
    expect(result.current.engine.p2).toEqual([true, true]);
  });

  test('a queued Execute closes the tray first, so the fill that lands writes the slot and the turn runs', async () => {
    const { wired, handleEvaluate, branch } = inputsOf('doubles');
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.holdTray({ side: 'p1', slot: 0 }));
    act(() => result.current.queueExecute());
    // The dock closes the tray on the Execute press, before the result lands.
    act(() => result.current.holdTray(null));
    await act(async () => onResultOf(handleEvaluate)(doublesResult()));
    expect(branch.choices.p1[0]).not.toBeNull();
    expect(branch.executeTurn).toHaveBeenCalledTimes(1);
  });
});

describe('useDockFill: a queued Execute dies with its run', () => {
  test('a run that failed clears the queue: a manual Evaluate afterwards fills but never executes the turn', async () => {
    const { wired, branch } = inputsOf('doubles');
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.queueExecute());
    rerender({ ...wired, evaluation: evaluationOf({ status: 'error', resultTag: 'variation:3' }).evaluation });
    expect(result.current.waits).toBe(false);
    // The user presses Evaluate by hand: a run, then a result for the same position.
    rerender({ ...wired, evaluation: evaluationOf({ status: 'searching', resultTag: 'variation:3' }).evaluation });
    expect(result.current.waits).toBe(false);
    await act(async () => {
      rerender({ ...wired, evaluation: evaluationOf({ status: 'done', resultTag: 'variation:3', result: doublesResult() }).evaluation });
    });
    expect(branch.executeTurn).not.toHaveBeenCalled();
  });

  test('a run that the game analysis stopped clears the queue too', async () => {
    const { wired, handleEvaluate, branch } = inputsOf('singles');
    const { rerender, result } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    const onResult = onResultOf(handleEvaluate);
    act(() => result.current.queueExecute());
    rerender({ ...wired, evaluation: evaluationOf({ running: true }).evaluation });
    expect(result.current.waits).toBe(false);
    rerender({ ...wired, evaluation: evaluationOf({ running: false }).evaluation });
    await act(async () => onResult(evalResult('singles')));
    expect(branch.executeTurn).not.toHaveBeenCalled();
  });
});
