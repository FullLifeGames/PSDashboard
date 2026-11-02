import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BranchSimState, BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { useDockFill, type DockFillInputs } from '../../../src/hooks/useDockFill';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A6a: the engine fill at a replay turn (user answer Q19 b). The first chip click arms it; then the
 * same gate as at the tip applies. The fill never writes into the draft or the branch: it hands its choices to the view, for the
 * slots that have neither a logged action nor a pick of the user, and never for a slot whose tray is open.
 */

type Evaluation = ReturnType<typeof useEvaluation>;
type Choices = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

const KEY = 'main:3';

function evaluationOf(shape: { status?: Evaluation['status']; running?: boolean; tag?: string | null; result?: EvalResult | null } = {}) {
  return {
    status: shape.status ?? 'idle', result: shape.result ?? null, resultTag: shape.tag ?? null, setPrefs: vi.fn(),
    prefs: { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto' },
    graph: { running: shape.running ?? false },
  } as unknown as Evaluation;
}

const move = (moveId: string, moveName: string, targetLoc?: number): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...(targetLoc ? { targetLoc } : {}) });

/** A replay turn: the effective choices of the picker are the logged actions under the user's picks. */
function replayInputs(state: BranchSimState, overrides: Partial<DockFillInputs> = {}) {
  const handleEvaluate = vi.fn<(options?: { onResult?: (result: EvalResult) => void }) => void>();
  const executeTurn = vi.fn();
  const setChoice = vi.fn();
  const wired: DockFillInputs = {
    simState: state, liveTip: false, branching: false, executing: false, branchPreparing: false, playOutActive: false,
    evalAvailable: true, evaluation: evaluationOf(), liveEvalStatus: 'idle', evalViewKey: KEY, historyLength: 0, sessionKey: 'r1:0',
    stale: false, handleEvaluate, setChoice, executeTurn,
    getChoices: () => ({ p1: state.p1Choices, p2: state.p2Choices }),
    ...overrides,
  };
  return { wired, handleEvaluate, executeTurn, setChoice };
}

const onResultOf = (handleEvaluate: ReturnType<typeof replayInputs>['handleEvaluate']) => {
  const options = handleEvaluate.mock.calls[0][0];
  if (!options?.onResult) throw new Error('the run carries no result callback');
  return options.onResult;
};

const doublesResult = (): EvalResult => {
  const base = evalResult('doubles');
  return { ...base, perSide: { p1: base.perSide.p1, p2: [rankedChoice('move grassyglide 1, move tailwind', 'Grassy Glide → Incineroar + Tailwind', -0.25)] } };
};

/** Doubles: P1A logged Flare Blitz, P1B nothing (it flinched), both foes nothing. */
const doublesTurn = () => simState('doubles', { p1Choices: [move('flareblitz', 'Flare Blitz', 2), null] });
/** Singles: P2 logged Leech Seed, P1 nothing. */
const singlesTurn = () => simState('singles', { p2Choices: [move('leechseed', 'Leech Seed')] });

describe('useDockFill at a replay turn: when a run starts', () => {
  test.each([['singles', singlesTurn], ['doubles', doublesTurn]] as const)('%s: no run until the first chip click, then one run per position', (_kind, turn) => {
    const { wired, handleEvaluate } = replayInputs(turn());
    const { result, rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    expect(handleEvaluate).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
    act(() => result.current.arm());
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    expect(handleEvaluate.mock.calls[0][0]).toEqual({ onResult: expect.any(Function) });
    expect(result.current.pending).toBe(true);
    act(() => result.current.arm());
    rerender({ ...wired, evaluation: evaluationOf({ status: 'searching', tag: KEY }) });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });

  test('the arming belongs to its position: another turn needs its own click, and so does a return', () => {
    const { wired, handleEvaluate } = replayInputs(singlesTurn());
    const { result, rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.arm());
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    rerender({ ...wired, evalViewKey: 'main:4' });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
    rerender({ ...wired });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(false);
  });

  test.each([
    ['a stand-in for another position', { stale: true }],
    ['a forced replacement', { state: { p1ForceSwitch: true } }],
    ['an ended position', { state: { ended: true } }],
    ['a turn that executes', { executing: true }],
    ['a branch that prepares', { branchPreparing: true }],
    ['a play-out', { playOutActive: true }],
    ['a game type without evaluation', { evalAvailable: false }],
  ] as [string, Partial<DockFillInputs> & { state?: Partial<BranchSimState> }][])('no run on %s', (_name, change) => {
    const { state, ...overrides } = change;
    const { wired, handleEvaluate } = replayInputs(simState('doubles', state), overrides);
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    expect(handleEvaluate).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  test('no run while the game analysis runs, a note for the chips, and one run when it has ended', () => {
    const { wired, handleEvaluate } = replayInputs(doublesTurn(), { evaluation: evaluationOf({ running: true }) });
    const { result, rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.arm());
    expect(handleEvaluate).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(true);
    rerender({ ...wired, evaluation: evaluationOf() });
    expect(handleEvaluate).toHaveBeenCalledTimes(1);
  });
});

describe('useDockFill at a replay turn: what the result writes', () => {
  test('doubles: the slot with no logged action takes the part that agrees with the logged slot, the foes take theirs', () => {
    const { wired, handleEvaluate, setChoice } = replayInputs(doublesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    const written = result.current.choices;
    // The best joint choice opens with Fake Out; the logged Flare Blitz makes the second one decide.
    expect(written?.p1[0]).toBeNull();
    expect(written?.p1[1]).toEqual(expect.objectContaining({ moveId: 'ragepowder' }));
    expect(written?.p2.map(choice => choice?.kind)).toEqual(['move', 'move']);
    expect(result.current.engine).toEqual({ p1: [false, true], p2: [true, true] });
    expect(result.current.pending).toBe(false);
    // The view owns the choices: nothing is written into the branch or the draft.
    expect(setChoice).not.toHaveBeenCalled();
  });

  test('singles: the side with no logged action takes the best choice, the logged side keeps its move', () => {
    const { wired, handleEvaluate } = replayInputs(singlesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(result.current.choices?.p1[0]).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
    expect(result.current.choices?.p2[0]).toBeNull();
    expect(result.current.engine).toEqual({ p1: [true], p2: [false] });
  });

  test('the rule against jumping: the empty slot whose tray is open stays empty, the other empty slot fills', () => {
    const { wired, handleEvaluate } = replayInputs(doublesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => result.current.holdTray({ side: 'p1', slot: 1 }));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(result.current.choices?.p1).toEqual([null, null]);
    expect(result.current.choices?.p2.every(choice => choice !== null)).toBe(true);
    expect(result.current.engine.p1).toEqual([false, false]);
  });

  test('singles: the open slot stays empty while the other empty side fills', () => {
    const { wired, handleEvaluate } = replayInputs(simState('singles'));
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => result.current.holdTray({ side: 'p1', slot: 0 }));
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(result.current.choices?.p1[0]).toBeNull();
    expect(result.current.choices?.p2[0]).toEqual(expect.objectContaining({ moveId: 'leechseed' }));
  });

  test('a slot the user picked (it holds a choice) is never written, whatever the result says', () => {
    const user = move('protect', 'Protect');
    const { wired, handleEvaluate } = replayInputs(simState('doubles', { p1Choices: [null, user] }));
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(result.current.choices?.p1[1]).toBeNull();
  });

  test('a result for a position that has moved on writes nothing', () => {
    const { wired, handleEvaluate } = replayInputs(singlesTurn());
    const { result, rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.arm());
    const stale = onResultOf(handleEvaluate);
    rerender({ ...wired, evalViewKey: 'main:4' });
    act(() => stale(evalResult('singles')));
    expect(result.current.choices).toBeNull();
  });

  test('a user pick over an engine slot takes its mark away', () => {
    const { wired, handleEvaluate } = replayInputs(doublesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    act(() => result.current.onUserChoice('p2', 0));
    expect(result.current.engine.p2).toEqual([false, true]);
  });
});

describe('useDockFill at a replay turn: Execute while the run is pending', () => {
  test('an Execute pressed before the result waits, then runs once with the logged choices under the fill', async () => {
    const { wired, handleEvaluate, executeTurn } = replayInputs(doublesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => result.current.queueExecute());
    expect(result.current.waits).toBe(true);
    expect(executeTurn).not.toHaveBeenCalled();
    await act(async () => onResultOf(handleEvaluate)(doublesResult()));
    expect(executeTurn).toHaveBeenCalledTimes(1);
    const sent = executeTurn.mock.calls[0][0] as Choices;
    expect(sent.p1[0]).toEqual(expect.objectContaining({ moveId: 'flareblitz', targetLoc: 2 }));
    expect(sent.p1[1]).toEqual(expect.objectContaining({ moveId: 'ragepowder' }));
    expect(sent.p2.every(choice => choice !== null)).toBe(true);
    expect(result.current.waits).toBe(false);
  });

  test('a failed run clears the queue; a later manual Evaluate never executes the turn', async () => {
    const { wired, executeTurn } = replayInputs(singlesTurn());
    const { result, rerender } = renderHook((props: DockFillInputs) => useDockFill(props), { initialProps: wired });
    act(() => result.current.arm());
    act(() => result.current.queueExecute());
    rerender({ ...wired, evaluation: evaluationOf({ status: 'error', tag: KEY }) });
    expect(result.current.waits).toBe(false);
    rerender({ ...wired, evaluation: evaluationOf({ status: 'searching', tag: KEY }) });
    await act(async () => {
      rerender({ ...wired, evaluation: evaluationOf({ status: 'done', tag: KEY, result: evalResult('singles') }) });
    });
    expect(executeTurn).not.toHaveBeenCalled();
  });
});
