import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import { useDockFill, type DockFillInputs } from '../../../src/hooks/useDockFill';
import type { useEvaluation } from '../../../src/hooks/useEvaluation';
import { evalResult, rankedChoice } from '../fixtures/eval-result';
import { simState, type FormatKind } from '../fixtures/sim-state';

/**
 * Round 89 (#153, Hard mode), the turn dock. The move in hand is the side whose slots the user set (a slot with a pick that no fill
 * wrote), provided the other side holds none: that other side is the opponent, and the fill writes the reply that hurts the joint
 * choice of the side in hand most (`worstReply`) where it wrote its best row before. A doubles side in hand counts with its partner
 * slot, which the fill wrote from the best joint choice that agrees. After the fill, a pick of the user in the event handler
 * (`onUserChoice` with the pick) writes the opponent's slots again. Setting off, nothing differs from the fill of round 84.
 */

type Evaluation = ReturnType<typeof useEvaluation>;
type Choices = { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };

function evaluationOf(hardMode: boolean | undefined) {
  return {
    status: 'idle', result: null, resultTag: null, setPrefs: vi.fn(),
    prefs: { depth: 1, samples: 1, mode: 'matrix', auto: false, autoAnalyze: false, tera: 'auto', ...(hardMode === undefined ? {} : { hardMode }) },
    graph: { running: false },
  } as unknown as Evaluation;
}

function setup(kind: FormatKind, hardMode: boolean | undefined, touched: Partial<Choices> = {}) {
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
  return { choices, setChoice, hook, land };
}

const move = (moveId: string, moveName: string, targetLoc?: number): BranchSlotChoice => ({ kind: 'move', moveId, moveName, ...(targetLoc === undefined ? {} : { targetLoc }) });

/** Singles: Earthquake and Swords Dance (p1) against Leech Seed, Body Press and the switch to Rotom-Wash. Earthquake is hurt most by the switch, Swords Dance by Body Press. */
function singles(): EvalResult {
  const base = evalResult('singles');
  return { ...base, matrix: { ...base.matrix!, values: [[0.35, 0.25, 0.15], [0.25, 0.05, 0.15], [0, -0.1, -0.2]] } };
}

/** Doubles: three joint choices a side the pickers map. R1 is hurt most by B, R2 by C, R3 by A. */
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
    // row R2 is hurt most by C
    expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'fakeout', targetLoc: 1 }), 0);
    expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'protect' }), 1);
    expect(setChoice).not.toHaveBeenCalledWith('p1', expect.anything(), expect.anything());
    expect(hook.result.current.engine).toEqual({ p1: [false, false], p2: [true, true] });
  });

  test('doubles, on: one slot set, the partner filled by the best joint choice that agrees: the row is read after that fill', () => {
    const { setChoice, land } = setup('doubles', true, { p1: [move('fakeout', 'Fake Out', 1), null] });
    land(doubles());
    expect(setChoice).toHaveBeenCalledWith('p1', expect.objectContaining({ moveId: 'spore' }), 1);
    // R1 (Fake Out + Spore) is hurt most by B
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
    // the engine wrote R1 (Fake Out + Spore) on slot 0 and 1; the user swaps slot 1 to Protect: Fake Out + Protect is R3, hurt most by A
    act(() => hook.result.current.onUserChoice('p1', 1, move('protect', 'Protect')));
    expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'grassyglide', targetLoc: 1 }), 0);
    expect(setChoice).toHaveBeenCalledWith('p2', expect.objectContaining({ moveId: 'tailwind' }), 1);
  });

  test('a pick on the opponent\'s side, a pick with the setting off and a pick without a pick (a hypothetical move) refill nothing', () => {
    const on = setup('singles', true);
    on.land(singles());
    on.setChoice.mockClear();
    // the user also chooses for p2: both sides are the user's now
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
