import {
  evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSimState, type BranchSlotChoice, type RankedChoice,
} from '@fulllifegames/eval-engine';

type Side = 'p1' | 'p2';
type Choices = (BranchSlotChoice | null)[];

/**
 * Round 84 (turn dock): the engine's fill. The dock asks the engine for the position once and writes its best ranked joint
 * choice into every slot the user has not touched. A joint choice qualifies only when its parts agree with what the user
 * touched, so the fill never contradicts a pick.
 */

/** Maps an engine line onto the slots of one side, slot-aligned; null when a part does not resolve against the pickers. */
export function slotChoicesOf(state: BranchSimState, side: Side, ranked: RankedChoice): Choices | null {
  const movesBySlot = side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot;
  const switchesBySlot = side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot;
  // The engine's choice string carries one part per slot WITH choices: a doubles forced replacement is a single part that
  // belongs to the forced slot, so the mask aligns parts with the request's slots.
  const activeSlots = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
  const forcedSlots = side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
  const mask = requiredChoicesForActiveSlots(
    activeSlots.map(active => (active ? { fainted: active.fainted } : null)),
    forcedSlots,
  );
  return evalChoiceToSlotChoices(ranked.choice, movesBySlot, switchesBySlot, ranked.label, mask);
}

/** The part names the same action as the user's pick: the same move, or the same body to switch to. Target and gimmick stay the user's. */
function sameAction(part: BranchSlotChoice, touched: BranchSlotChoice): boolean {
  if (part.kind === 'move') return touched.kind === 'move' && touched.moveId === part.moveId;
  return touched.kind === 'switch' && touched.speciesId === part.speciesId;
}

function agreesWithTouched(parts: Choices, touched: Choices): boolean {
  return touched.every((pick, slot) => {
    if (!pick) return true;
    const part = parts[slot];
    return !!part && sameAction(part, pick);
  });
}

const modifierOf = (choice: BranchSlotChoice | null | undefined) => (choice?.kind === 'move' ? choice.modifier : undefined);

/** A gimmick kind a touched slot uses cannot be used again in a filled slot of the side (one Tera, one Mega per side). */
function clashesWithTouched(touched: Choices, filled: Choices): boolean {
  const used = new Set(touched.map(modifierOf).filter(modifier => modifier !== undefined));
  return filled.some(choice => {
    const modifier = modifierOf(choice);
    return modifier !== undefined && used.has(modifier);
  });
}

function activeCount(state: BranchSimState, side: Side): number {
  const slots = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
  return slots?.length ?? 1;
}

/**
 * The choices to write for one side: the first of `ranked` (best first, as the chess walk reads it) that maps onto the pickers,
 * agrees with every touched slot and clashes with none of their gimmicks. Touched slots come back null (the fill never writes
 * them), and so does every slot when no joint choice qualifies: those slots stay empty and the chip says "choose".
 * `touched[slot]` is the user's own pick, null where the user has not chosen.
 */
export function pickFill(side: Side, ranked: RankedChoice[], state: BranchSimState, touched: Choices): Choices {
  for (const candidate of ranked) {
    if (candidate.choice === 'wait') continue;
    const parts = slotChoicesOf(state, side, candidate);
    if (!parts || !agreesWithTouched(parts, touched)) continue;
    const filled = parts.map((part, slot) => (touched[slot] ? null : part));
    if (clashesWithTouched(touched, filled)) continue;
    return filled;
  }
  return new Array<BranchSlotChoice | null>(activeCount(state, side)).fill(null);
}
