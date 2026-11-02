import { describe, expect, test } from 'vitest';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { panelFlags } from '../../../src/lib/dock-panel';
import { simState } from '../fixtures/sim-state';

/**
 * Round 84 (turn dock), step A7a, ruling 2a: at a forced replacement Execute is ready when the side that replaces holds its picks;
 * the side that waits has nothing to choose (before, its empty slots kept "every slot chosen" false for good, and Execute was hidden).
 */
const flags = (state: ReturnType<typeof simState>) => panelFlags(state, state.p1ActiveSlots, state.p2ActiveSlots);
const heatran: BranchSlotChoice = { kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' };
const rotom: BranchSlotChoice = { kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' };
const fluttermane: BranchSlotChoice = { kind: 'switch', speciesId: 'fluttermane', pokemonName: 'Flutter Mane' };
const kingambit: BranchSlotChoice = { kind: 'switch', speciesId: 'kingambit', pokemonName: 'Kingambit' };

describe('panelFlags at a forced replacement', () => {
  test('singles: the replacing side holds its pick, so Execute is ready although the waiting side holds none', () => {
    const forced = { p1ForceSwitch: true, p1ForceSwitches: [true] };
    expect(flags(simState('singles', forced)).bothChosen).toBe(false);
    expect(flags(simState('singles', { ...forced, p1Choices: [heatran], p1Choice: heatran })).bothChosen).toBe(true);
    expect(flags(simState('singles', { p2ForceSwitch: true, p2ForceSwitches: [true], p2Choices: [rotom], p2Choice: rotom })).bothChosen).toBe(true);
  });

  test('doubles: the forced slot of one side is the only one that needs a choice', () => {
    const forced = { p1ForceSwitch: true, p1ForceSwitches: [false, true] };
    expect(flags(simState('doubles', forced)).bothChosen).toBe(false);
    expect(flags(simState('doubles', { ...forced, p1Choices: [null, fluttermane] })).bothChosen).toBe(true);
  });

  test('both sides replacing: both must hold their picks', () => {
    const both = { p1ForceSwitch: true, p1ForceSwitches: [true], p2ForceSwitch: true, p2ForceSwitches: [true] };
    expect(flags(simState('singles', { ...both, p1Choices: [heatran] })).bothChosen).toBe(false);
    expect(flags(simState('singles', { ...both, p1Choices: [heatran], p2Choices: [rotom] })).bothChosen).toBe(true);
    const doubles = { p1ForceSwitch: true, p1ForceSwitches: [false, true], p2ForceSwitch: true, p2ForceSwitches: [true, false] };
    expect(flags(simState('doubles', { ...doubles, p1Choices: [null, fluttermane] })).bothChosen).toBe(false);
    expect(flags(simState('doubles', { ...doubles, p1Choices: [null, fluttermane], p2Choices: [kingambit, null] })).bothChosen).toBe(true);
  });

  test('a normal position is unchanged: every living slot of both sides', () => {
    expect(flags(simState('singles')).bothChosen).toBe(false);
    expect(flags(simState('doubles', { p1Choices: [heatran, fluttermane], p2Choices: [rotom, kingambit] })).bothChosen).toBe(true);
  });

  test('the waiting side is named in the flags and the label does not ask it for a choice', () => {
    const state = simState('singles', { p1ForceSwitch: true, p1ForceSwitches: [true] });
    expect(flags(state)).toMatchObject({ p1Waits: false, p2Waits: true, pendingLabel: 'Select P1 choice' });
  });
});
