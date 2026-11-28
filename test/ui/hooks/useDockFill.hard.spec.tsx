import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult, BranchSimState } from '@fulllifegames/eval-engine';
import { useDockFill, type DockFillInputs } from '../../../src/hooks/useDockFill';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

describe('useDockFill.hard', () => {
  type Evaluation = ReturnType<typeof useEvaluation>;
  type Choices = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

  function evaluationOf(hardMode: boolean | undefined) {
    return {
      status: 'idle', result: null, resultTag: null, setPrefs: vi.fn(),
      prefs: { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto', ...(hardMode === undefined ? {} : { hardMode }) },
      graph: { running: false },
    } as unknown as Evaluation;
  }

  function setupWired(kind: FormatKind, hardMode: boolean | undefined, touched: Partial<Choices> = {}) {
    const slots = kind === 'doubles' ? 2 : 1;
    const choices: Choices = { p1: Array(slots).fill(null), p2: Array(slots).fill(null), ...touched };
    const setChoice = vi.fn((side: 'p1' | 'p2', choice: BranchSlotChoice, slot = 0) => {
      choices[side] = [...choices[side]];
      choices[side][slot] = choice;
    });
    const handleEvaluate = vi.fn<(options?: { onResult?: (result: EvalResult) => void }) => void>();
    const wired: DockFillInputs = {
      simState: simState(kind), liveTip: true, branching: true, executing: false, branchPreparing: false, playOutActive: false,
      evalAvailable: true, evaluation: evaluationOf(hardMode), liveEvalStatus: 'idle', evalViewKey: 'variation:3', historyLength: 1, sessionKey: 's1',
      handleEvaluate, getChoices: () => choices, setChoice, executeTurn: vi.fn(async () => null),
    };
    const hook = renderHook(() => useDockFill(wired));
    const land = (result: EvalResult) => act(() => handleEvaluate.mock.calls[0][0]!.onResult!(result));
    return { choices, setChoice, hook, land, wired };
  }

  const setup = setupWired;

  const move = (moveId: string, moveName: string, targetLoc?: number): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...(targetLoc === undefined ? {} : { targetLoc }) });

  // Earthquake is hurt most by the switch to Rotom-Wash, Swords Dance by Body Press.
  function singles(): EvalResult {
    const base = evalResult('singles');
    return { ...base, matrix: { ...base.matrix!, values: [[0.35, 0.25, 0.15], [0.25, 0.05, 0.15], [0, -0.1, -0.2]] } };
  }

  // R1 is hurt most by B, R2 by C, R3 by A.
  function doubles(): EvalResult {
    const rows = (rows: [string, string][]) => rows.map(([choice, label], index) => rankedChoice(choice, label, 0.3 - 0.1 * index));
    const p1 = rows([['move fakeout 1, move spore 2', 'Fake Out → Rillaboom + Spore → Tornadus'], ['move flareblitz 1, move ragepowder', 'Flare Blitz → Rillaboom + Rage Powder'], ['move fakeout 1, move protect', 'Fake Out → Rillaboom + Protect']]);
    const p2 = rows([['move grassyglide 1, move tailwind', 'A'], ['move woodhammer 1, move taunt 1', 'B'], ['move fakeout 1, move protect', 'C']]);
    const base = evalResult('doubles');
    return {
      ...base, perSide: { p1, p2 },
      matrix: {
        p1Labels: p1.map(row => row.label), p2Labels: p2.map(row => row.label), p1Choices: p1.map(row => row.choice), p2Choices: p2.map(row => row.choice),
        values: [[0.3, 0.1, 0.2], [0.2, 0.25, 0], [0.1, 0.4, 0.3]], mixes: { p1: [1, 0, 0], p2: [1, 0, 0] },
      },
    };
  }

  describe('useDockFill, Hard mode: the fill', () => {
    test('singles, on: the user set a slot, so the opponent takes the reply that hurts it most, not its best row', () => {
      const { setChoice, hook, land } = setup('singles', true, { p1: [move('swordsdance', 'Swords Dance')] });
      land(singles());
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
      expect(setChoice).not.toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
      expect(hook.result.current.engine).toEqual({ p1: [false], p2: [true] });
    });

    test('singles, on, but nothing set: there is no move in hand, both sides take their best row; off: the same with a pick', () => {
      const none = setup('singles', true);
      none.land(singles());
      expect(none.setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'earthquake' }), 0);
      expect(none.setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
      for (const hardMode of [false, undefined]) {
        const off = setup('singles', hardMode, { p1: [move('swordsdance', 'Swords Dance')] });
        off.land(singles());
        expect(off.setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
      }
    });

    test('singles, on: both sides hold a pick of the user, so nobody is the opponent and the fill writes nothing', () => {
      const { setChoice, land } = setup('singles', true, { p1: [move('swordsdance', 'Swords Dance')], p2: [move('knockoff', 'Knock Off')] });
      land(singles());
      expect(setChoice).not.toHaveBeenCalled();
    });

    test('doubles, on: both slots of a side set by the user read as one joint row; the opponent takes its worst joint answer slot by slot', () => {
      const { setChoice, hook, land } = setup('doubles', true, { p1: [move('flareblitz', 'Flare Blitz', 1), move('ragepowder', 'Rage Powder')] });
      land(doubles());
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'fakeout', targetLoc: 1 }), 0);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'protect' }), 1);
      expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
      expect(hook.result.current.engine).toEqual({ p1: [false, false], p2: [true, true] });
    });

    test('doubles, on: one slot set, the partner filled by the best joint choice that agrees: the row is read after that fill', () => {
      const { setChoice, land } = setup('doubles', true, { p1: [move('fakeout', 'Fake Out', 1), null] });
      land(doubles());
      expect(setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'spore' }), 1);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'woodhammer' }), 0);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'taunt' }), 1);
    });

    test('doubles, on: the worst answer a picker cannot map gives way to the next ranked joint choice', () => {
      const result = doubles();
      result.perSide.p2 = [...result.perSide.p2, rankedChoice('move hyperbeam 1, move tailwind', 'D', 0)];
      result.matrix = { ...result.matrix!, p2Labels: [...result.matrix!.p2Labels, 'D'], p2Choices: [...result.matrix!.p2Choices!, 'move hyperbeam 1, move tailwind'], values: result.matrix!.values.map(row => [...row, -0.9]) };
      const { setChoice, land } = setup('doubles', true, { p1: [move('flareblitz', 'Flare Blitz', 1), move('ragepowder', 'Rage Powder')] });
      land(result);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'grassyglide' }), 0);
    });
  });

  describe('useDockFill, Hard mode: a pick after the fill', () => {
    test('singles: the opponent\'s engine slot is written again with the reply that hurts the new pick most, from the pick\'s handler', () => {
      const { setChoice, hook, land } = setup('singles', true);
      land(singles());
      setChoice.mockClear();
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
      expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
      expect(hook.result.current.engine).toEqual({ p1: [false], p2: [true] });
      act(() => hook.result.current.onUserChoice('p1', 0, move('earthquake', 'Earthquake')));
      expect(setChoice).toHaveBeenLastCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);
    });

    test('doubles: a pick in one slot reads the side\'s joint row with the engine-filled partner, and the opponent answers both slots', () => {
      const { setChoice, hook, land } = setup('doubles', true);
      land(doubles());
      setChoice.mockClear();
      act(() => hook.result.current.onUserChoice('p1', 1, move('protect', 'Protect')));
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'grassyglide', targetLoc: 1 }), 0);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'tailwind' }), 1);
    });

    test('a pick on the opponent\'s side, a pick with the setting off and a pick without a pick (a hypothetical move) refill nothing', () => {
      const on = setup('singles', true);
      on.land(singles());
      on.setChoice.mockClear();
      act(() => on.hook.result.current.onUserChoice('p2', 0, move('knockoff', 'Knock Off')));
      act(() => on.hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(on.setChoice).not.toHaveBeenCalled();
      const hypothetical = setup('singles', true);
      hypothetical.land(singles());
      hypothetical.setChoice.mockClear();
      act(() => hypothetical.hook.result.current.onUserChoice('p1', 0));
      expect(hypothetical.setChoice).not.toHaveBeenCalled();
      const off = setup('singles', false);
      off.land(singles());
      off.setChoice.mockClear();
      act(() => off.hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(off.setChoice).not.toHaveBeenCalled();
    });
  });

  describe('useDockFill, Hard mode: where the read stands', () => {
    const result = { singles, doubles } as const;
    const unranked = (kind: FormatKind) => (kind === 'singles' ? move('splash', 'Splash') : move('splash', 'Splash', 1));
    const ranked = (kind: FormatKind) => (kind === 'singles' ? move('swordsdance', 'Swords Dance') : move('flareblitz', 'Flare Blitz', 1));

    test.each(['singles', 'doubles'] as const)('%s: before and after the fill with no pick of the user the read waits; off or unset it is null', kind => {
      const on = setup(kind, true);
      expect(on.hook.result.current.reads).toBe('waiting');
      on.land(result[kind]());
      expect(on.hook.result.current.reads).toBe('waiting');
      for (const hardMode of [false, undefined]) {
        const off = setup(kind, hardMode, { p1: [ranked(kind), ...(kind === 'doubles' ? [null] : [])] });
        expect(off.hook.result.current.reads).toBeNull();
        off.land(result[kind]());
        expect(off.hook.result.current.reads).toBeNull();
      }
    });

    test.each(['singles', 'doubles'] as const)('%s: a pick with a ranked row at the fill reads answered, a pick with none reads unranked and leaves the opponent on the fill', kind => {
      const slots = (pick: BranchSlotChoice) => ({ p1: [pick, ...(kind === 'doubles' ? [null] : [])] });
      const answered = setup(kind, true, slots(ranked(kind)));
      answered.land(result[kind]());
      expect(answered.hook.result.current.reads).toBe('answered');
      const none = setup(kind, true, slots(unranked(kind)));
      none.land(result[kind]());
      expect(none.hook.result.current.reads).toBe('unranked');
      expect(none.hook.result.current.engine.p2).toEqual(Array(kind === 'doubles' ? 2 : 1).fill(true));
      expect(none.setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: kind === 'singles' ? 'leechseed' : 'grassyglide' }), 0);
    });

    test.each(['singles', 'doubles'] as const)('%s: picks on both sides at the fill read both', kind => {
      const both = setup(kind, true, { p1: [ranked(kind), ...(kind === 'doubles' ? [null] : [])], p2: [move('knockoff', 'Knock Off'), ...(kind === 'doubles' ? [null] : [])] });
      both.land(result[kind]());
      expect(both.hook.result.current.reads).toBe('both');
      expect(both.hook.result.current.engine.p2.some(Boolean)).toBe(false);
    });

    test.each(['singles', 'doubles'] as const)('%s: a pick after the fill moves the read between answered and unranked, an unranked one writes nothing, a pick made with the setting off leaves no read, both sides read both', kind => {
      const { setChoice, hook, land, wired } = setupWired(kind, true);
      land(result[kind]());
      const slot = kind === 'doubles' ? 1 : 0;
      const answered = kind === 'singles' ? ranked(kind) : move('protect', 'Protect');
      act(() => hook.result.current.onUserChoice('p1', slot, answered));
      expect(hook.result.current.reads).toBe('answered');
      setChoice.mockClear();
      act(() => hook.result.current.onUserChoice('p1', slot, move('splash', 'Splash')));
      expect(hook.result.current.reads).toBe('unranked');
      expect(setChoice).not.toHaveBeenCalled();
      expect(hook.result.current.engine.p2).toEqual(Array(kind === 'doubles' ? 2 : 1).fill(true));
      const off = (action: () => void) => { wired.evaluation = evaluationOf(false); hook.rerender(); act(action); wired.evaluation = evaluationOf(true); hook.rerender(); };
      off(() => hook.result.current.onUserChoice('p1', slot, answered));
      expect(hook.result.current.reads).toBe('waiting');
      act(() => hook.result.current.onUserChoice('p1', slot, answered));
      off(() => hook.result.current.restore('p1', slot));
      expect(hook.result.current.reads).toBe('waiting');
      act(() => hook.result.current.onUserChoice('p1', slot, answered));
      act(() => hook.result.current.onUserChoice('p2', 0, move('knockoff', 'Knock Off')));
      expect(hook.result.current.reads).toBe('both');
    });

    test('a hypothetical move without a pick leaves the read as it was; turning the setting off reads null', () => {
      const wired = setupWired('singles', true);
      wired.land(singles());
      act(() => wired.hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      act(() => wired.hook.result.current.onUserChoice('p1', 0));
      expect(wired.hook.result.current.reads).toBe('answered');
      wired.wired.evaluation = evaluationOf(false);
      wired.hook.rerender();
      expect(wired.hook.result.current.reads).toBeNull();
    });
  });

  describe('useDockFill: Back to the engine\'s pick', () => {
    const turnOff = (wired: { evaluation: Evaluation }, hook: { rerender: () => void }) => { wired.evaluation = evaluationOf(false); hook.rerender(); };

    test('singles, on: the engine\'s fill stays as `picks` whatever the user picks, and restore returns it', () => {
      const { setChoice, hook, land } = setup('singles', true);
      land(singles());
      expect(hook.result.current.picks).toEqual({ p1: [expect.objectContaining({ moveId: 'earthquake' })], p2: [expect.objectContaining({ moveId: 'leechseed' })] });
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(hook.result.current.picks.p1[0]).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
      setChoice.mockClear();
      let back: BranchSlotChoice | null = null;
      act(() => { back = hook.result.current.restore('p1', 0); });
      expect(back).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
      expect(setChoice).toHaveBeenCalledWith('p2', { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }, 0);
      expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
      expect(hook.result.current.engine).toEqual({ p1: [true], p2: [true] });
    });

    test('singles, on: a pick after the restore is the user\'s again', () => {
      const { setChoice, hook, land } = setup('singles', true);
      land(singles());
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      act(() => { hook.result.current.restore('p1', 0); });
      setChoice.mockClear();
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(hook.result.current.engine.p1).toEqual([false]);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
    });

    test('singles, off: the opponent returns to its fill as at the start (the setting was on when the user picked)', () => {
      const { setChoice, hook, land, wired } = setupWired('singles', true);
      land(singles());
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      expect(setChoice).toHaveBeenLastCalledWith('p2', expect.objectContaining({ moveId: 'bodypress' }), 0);
      turnOff(wired, hook);
      setChoice.mockClear();
      act(() => { hook.result.current.restore('p1', 0); });
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'leechseed' }), 0);
      expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
    });

    test('singles, off from the start: the opponent was never rewritten, so nothing is written for it', () => {
      const { setChoice, hook, land } = setup('singles', false);
      land(singles());
      act(() => hook.result.current.onUserChoice('p1', 0, move('swordsdance', 'Swords Dance')));
      setChoice.mockClear();
      let back: BranchSlotChoice | null = null;
      act(() => { back = hook.result.current.restore('p1', 0); });
      expect(back).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
      expect(setChoice).not.toHaveBeenCalled();
    });

    test('a slot the fill never wrote (the user picked before the result landed) has nothing to restore', () => {
      const { setChoice, hook, land } = setup('singles', true, { p1: [move('swordsdance', 'Swords Dance')] });
      land(singles());
      expect(hook.result.current.picks.p1).toEqual([null]);
      setChoice.mockClear();
      let back: BranchSlotChoice | null = move('x', 'X');
      act(() => { back = hook.result.current.restore('p1', 0); });
      expect(back).toBeNull();
      expect(setChoice).not.toHaveBeenCalled();
    });

    test('before the fill landed there is nothing to restore either', () => {
      const { hook } = setup('singles', true);
      expect(hook.result.current.picks).toEqual({ p1: [], p2: [] });
      expect(hook.result.current.restore('p1', 0)).toBeNull();
    });

    test('doubles, on: one slot goes back, the partner stays and the opponent answers the joint row again', () => {
      const { setChoice, hook, land } = setup('doubles', true);
      land(doubles());
      expect(hook.result.current.picks.p1).toEqual([expect.objectContaining({ moveId: 'fakeout' }), expect.objectContaining({ moveId: 'spore' })]);
      act(() => hook.result.current.onUserChoice('p1', 1, move('protect', 'Protect')));
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'grassyglide' }), 0);
      setChoice.mockClear();
      let back: BranchSlotChoice | null = null;
      act(() => { back = hook.result.current.restore('p1', 1); });
      expect(back).toEqual(expect.objectContaining({ moveId: 'spore' }));
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'woodhammer' }), 0);
      expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'taunt' }), 1);
      expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
      expect(hook.result.current.engine).toEqual({ p1: [true, true], p2: [true, true] });
    });

    test('doubles, off: both slots of the opponent return to the fill as at the start', () => {
      const { setChoice, hook, land, wired } = setupWired('doubles', true);
      land(doubles());
      const start = hook.result.current.picks.p2;
      act(() => hook.result.current.onUserChoice('p1', 1, move('ragepowder', 'Rage Powder')));
      expect(setChoice).toHaveBeenLastCalledWith('p2', expect.objectContaining({ moveId: 'protect' }), 1);
      turnOff(wired, hook);
      setChoice.mockClear();
      act(() => { hook.result.current.restore('p1', 1); });
      expect(setChoice).toHaveBeenCalledWith('p2', start[0], 0);
      expect(setChoice).toHaveBeenCalledWith('p2', start[1], 1);
    });

    test('doubles, on: the opponent\'s slots the user set themselves are left alone', () => {
      const { setChoice, hook, land } = setup('doubles', true);
      land(doubles());
      act(() => hook.result.current.onUserChoice('p1', 1, move('protect', 'Protect')));
      act(() => hook.result.current.onUserChoice('p2', 0, move('woodhammer', 'Wood Hammer', 1)));
      setChoice.mockClear();
      act(() => { hook.result.current.restore('p1', 1); });
      expect(setChoice).not.toHaveBeenCalledWith('p2', expect.anything(), expect.anything());
    });
  });
});

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

const doublesTurn = () => simState('doubles', { p1Choices: [move('flareblitz', 'Flare Blitz', 2), null] });
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
    expect(written?.p1[0]).toBeNull();
    expect(written?.p1[1]).toEqual(expect.objectContaining({ moveId: 'ragepowder' }));
    expect(written?.p2.map(choice => choice?.kind)).toEqual(['move', 'move']);
    expect(result.current.engine).toEqual({ p1: [false, true], p2: [true, true] });
    expect(result.current.pending).toBe(false);
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

describe('useDockFill at a replay turn: the setting reads in a variation only', () => {
  const reading = (): Evaluation => {
    const base = evaluationOf();
    return { ...base, prefs: { ...base.prefs, hardMode: true } } as Evaluation;
  };

  test.each([
    ['singles', singlesTurn, () => evalResult('singles')],
    ['doubles', doublesTurn, doublesResult],
  ] as const)('%s: with the setting on the dock names no read before, after the fill and after a pick', (_kind, turn, result) => {
    const { wired, handleEvaluate } = replayInputs(turn(), { evaluation: reading() });
    const hook = renderHook(() => useDockFill(wired));
    expect(hook.result.current.reads).toBeNull();
    act(() => hook.result.current.arm());
    act(() => onResultOf(handleEvaluate)(result()));
    expect(hook.result.current.reads).toBeNull();
    act(() => hook.result.current.onUserChoice('p1', 0, move('protect', 'Protect')));
    expect(hook.result.current.reads).toBeNull();
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

describe('useDockFill at a replay turn: the engine\'s choice for the clicked slot waits until its tray closes', () => {
  test('doubles: the clicked empty slot keeps a deferred pick, the view shows it only after the release', () => {
    const { wired, handleEvaluate, setChoice } = replayInputs(doublesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => result.current.holdTray({ side: 'p2', slot: 0 }));
    act(() => onResultOf(handleEvaluate)(doublesResult()));
    expect(result.current.deferred.p2[0]).toEqual(expect.objectContaining({ moveId: 'grassyglide' }));
    expect(result.current.choices?.p2[0]).toBeNull();
    expect(result.current.choices?.p2[1]).toEqual(expect.objectContaining({ moveId: 'tailwind' }));
    act(() => result.current.release('p2', 0));
    expect(result.current.choices?.p2[0]).toEqual(expect.objectContaining({ moveId: 'grassyglide' }));
    expect(result.current.engine.p2).toEqual([true, true]);
    expect(result.current.deferred.p2).toEqual([null, null]);
    expect(setChoice).not.toHaveBeenCalled();
  });

  test('singles: a choice of the user in the slot drops the deferred pick', () => {
    const { wired, handleEvaluate } = replayInputs(singlesTurn());
    const { result } = renderHook(() => useDockFill(wired));
    act(() => result.current.arm());
    act(() => result.current.holdTray({ side: 'p1', slot: 0 }));
    act(() => onResultOf(handleEvaluate)(evalResult('singles')));
    expect(result.current.deferred.p1[0]).toEqual(expect.objectContaining({ moveId: 'earthquake' }));
    act(() => result.current.onUserChoice('p1', 0));
    act(() => result.current.release('p1', 0));
    expect(result.current.choices?.p1[0]).toBeNull();
  });
});
