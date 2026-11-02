import {
  branchSideChoicesReady, requiredChoicesForActiveSlots, switchChoiceKey,
  type BranchMoveOption, type BranchSimState, type BranchSlotChoice, type BranchSlotModifiers, type BranchSwitchOption,
  type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import type { PlayedPick } from './played-pick';

/**
 * Round 84 (turn dock): what a position asks of the two sides, read by the old panel and by the dock. Moved out of
 * BranchPanel.tsx unchanged; one rule lives here.
 */

export const EMPTY_MOVES: BranchMoveOption[] = [];
export const EMPTY_SWITCHES: BranchSwitchOption[] = [];
export const EMPTY_MODIFIERS: BranchSlotModifiers = { teraType: null, canMegaEvo: false, canUltraBurst: false, zMoves: [] };

/** The pick one slot shows: its own entry in a doubles record, else the side's pick on slot A. */
export function playedOfSlot(slots: (PlayedPick | null)[] | undefined, side: PlayedPick | null | undefined, slot: number): PlayedPick | null {
  if (slots) return slots[slot] ?? null;
  return slot === 0 ? side ?? null : null;
}

export function blockedSwitchKeys(choices: (BranchSlotChoice | null)[], required: boolean[], activeSlot: number): Set<string> {
  const blocked = new Set<string>();
  choices.forEach((choice, index) => {
    if (index === activeSlot) return;
    // A pending choice on a slot the request does not let act (a stale
    // pick during the other slot's forced replacement) must not reserve
    // a species — it locked the forced slot's only legal switch-in.
    if (!required[index]) return;
    const target = switchChoiceKey(choice);
    if (target !== null) blocked.add(target);
  });
  return blocked;
}

export function pendingLabelFor(simState: BranchSimState, bothChosen: boolean, isMultiActive: boolean): string {
  return bothChosen
    ? 'Execute Turn'
    : isMultiActive
      ? 'Select all active choices'
      : `Select ${!simState.p1Choice ? 'P1' : ''}${!simState.p1Choice && !simState.p2Choice ? ' & ' : ''}${!simState.p2Choice ? 'P2' : ''} choice`;
}

/** The identity part of one slot's controls: label and the active Pokémon. */
export function slotIdentity(side: 'p1' | 'p2', slot: number, activeSlots: (SimPokemonInfo | null)[], active: SimPokemonInfo | null) {
  const prefix = side === 'p1' ? 'P1' : 'P2';
  return {
    label: activeSlots.length > 1 ? `${prefix}${String.fromCharCode(65 + slot)}` : prefix,
    activeName: active?.name || '???',
    activeSpecies: active?.species || '',
    activeFainted: active?.fainted ?? true,
  };
}

/** What the position asks of each side: the required slots, whether Execute is ready, and which side waits for the other's replacement. */
export function panelFlags(simState: BranchSimState, p1ActiveSlots: (SimPokemonInfo | null)[], p2ActiveSlots: (SimPokemonInfo | null)[]) {
  const p1RequiredChoices = requiredChoicesForActiveSlots(p1ActiveSlots, simState.p1ForceSwitches);
  const p2RequiredChoices = requiredChoicesForActiveSlots(p2ActiveSlots, simState.p2ForceSwitches);
  const bothChosen = branchSideChoicesReady(simState.p1Choices, p1RequiredChoices) &&
    branchSideChoicesReady(simState.p2Choices, p2RequiredChoices);
  const isMultiActive = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1;
  return {
    isForceSwitch: simState.p1ForceSwitch || simState.p2ForceSwitch,
    p1RequiredChoices, p2RequiredChoices, bothChosen,
    pendingLabel: pendingLabelFor(simState, bothChosen, isMultiActive),
    // One side replaces while the other has nothing to choose: its pickers take no input, so no stale pick reaches the next turn (B5).
    p1Waits: simState.p2ForceSwitch && !simState.p1ForceSwitch,
    p2Waits: simState.p1ForceSwitch && !simState.p2ForceSwitch,
  };
}
