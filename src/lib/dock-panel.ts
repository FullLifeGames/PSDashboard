import {
  branchSideChoicesReady, requiredChoicesForActiveSlots, switchChoiceKey,
  type BranchMoveOption, type BranchSimState, type BranchSlotChoice, type BranchSlotModifiers, type BranchSwitchOption,
  type SimPokemonInfo,
} from '@fulllifegames/eval-engine';
import type { PlayedPick } from './played-pick';


export const EMPTY_MOVES: BranchMoveOption[] = [];
export const EMPTY_SWITCHES: BranchSwitchOption[] = [];
export const EMPTY_MODIFIERS: BranchSlotModifiers = { teraType: null, canMegaEvo: false, canUltraBurst: false, zMoves: [] };

export function playedOfSlot(slots: (PlayedPick | null)[] | undefined, side: PlayedPick | null | undefined, slot: number): PlayedPick | null {
  if (slots) return slots[slot] ?? null;
  return slot === 0 ? side ?? null : null;
}

export function blockedSwitchKeys(choices: (BranchSlotChoice | null)[], required: boolean[], activeSlot: number): Set<string> {
  const blocked = new Set<string>();
  choices.forEach((choice, index) => {
    if (index === activeSlot) return;
    // A stale pick on a slot that cannot act must not reserve a species: it locked the forced slot's only switch-in.
    if (!required[index]) return;
    const target = switchChoiceKey(choice);
    if (target !== null) blocked.add(target);
  });
  return blocked;
}

export function pendingLabelFor(
  simState: BranchSimState, bothChosen: boolean, isMultiActive: boolean, waits: { p1Waits: boolean; p2Waits: boolean } = { p1Waits: false, p2Waits: false },
): string {
  if (bothChosen) return 'Execute Turn';
  if (isMultiActive) return 'Select all active choices';
  const missing = [!simState.p1Choice && !waits.p1Waits ? 'P1' : '', !simState.p2Choice && !waits.p2Waits ? 'P2' : ''].filter(Boolean);
  return `Select ${missing.join(' & ')} choice`;
}

export function slotIdentity(side: 'p1' | 'p2', slot: number, activeSlots: (SimPokemonInfo | null)[], active: SimPokemonInfo | null) {
  const prefix = side === 'p1' ? 'P1' : 'P2';
  return {
    label: activeSlots.length > 1 ? `${prefix}${String.fromCharCode(65 + slot)}` : prefix,
    activeName: active?.name || '???',
    activeSpecies: active?.species || '',
    activeFainted: active?.fainted ?? true,
  };
}

export function panelFlags(simState: BranchSimState, p1ActiveSlots: (SimPokemonInfo | null)[], p2ActiveSlots: (SimPokemonInfo | null)[]) {
  const p1RequiredChoices = requiredChoicesForActiveSlots(p1ActiveSlots, simState.p1ForceSwitches);
  const p2RequiredChoices = requiredChoicesForActiveSlots(p2ActiveSlots, simState.p2ForceSwitches);
  // One side replaces while the other has nothing to choose: its pickers take no input, so no stale pick survives.
  const p1Waits = simState.p2ForceSwitch && !simState.p1ForceSwitch;
  const p2Waits = simState.p1ForceSwitch && !simState.p2ForceSwitch;
  const bothChosen = (p1Waits || branchSideChoicesReady(simState.p1Choices, p1RequiredChoices)) &&
    (p2Waits || branchSideChoicesReady(simState.p2Choices, p2RequiredChoices));
  const isMultiActive = p1ActiveSlots.length > 1 || p2ActiveSlots.length > 1;
  return {
    isForceSwitch: simState.p1ForceSwitch || simState.p2ForceSwitch,
    p1RequiredChoices, p2RequiredChoices, bothChosen,
    pendingLabel: pendingLabelFor(simState, bothChosen, isMultiActive, { p1Waits, p2Waits }),
    p1Waits, p2Waits,
  };
}
