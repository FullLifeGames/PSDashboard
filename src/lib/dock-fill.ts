import {
  evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSimState, type BranchSlotChoice, type RankedChoice,
} from '@fulllifegames/eval-engine';

import { stillOffered, type SideChoices } from './dock-seed';

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

/** What the fill gives one side: the choices to write now, and the picks held slots will take once their trays close. */
export interface FillParts { filled: Choices; deferred: Choices }

/**
 * The choices for one side: the first of `ranked` (best first, as the chess walk reads it) that maps onto the pickers,
 * agrees with every touched slot and clashes with none of their gimmicks. Touched slots come back null (the fill never writes
 * them), and so does every slot when no joint choice qualifies: those slots stay empty and the chip says "choose".
 * `touched[slot]` is the user's own pick, null where the user has not chosen.
 * `held[slot]` marks a slot whose tray is open (the rule against jumping): it is never written, but it holds no pick, so it puts
 * no demand on the joint choice. Round 84 (A7a, ruling 1a): its part of the same joint choice comes back as `deferred`, which the
 * slot takes when its tray closes and the user chose nothing there.
 */
export function pickFillParts(side: Side, ranked: RankedChoice[], state: BranchSimState, touched: Choices, held: readonly boolean[] = []): FillParts {
  for (const candidate of ranked) {
    if (candidate.choice === 'wait') continue;
    const parts = slotChoicesOf(state, side, candidate);
    if (!parts || !agreesWithTouched(parts, touched)) continue;
    const filled = parts.map((part, slot) => (touched[slot] || held[slot] ? null : part));
    const deferred = parts.map((part, slot) => (!touched[slot] && held[slot] ? part : null));
    if (clashesWithTouched(touched, [...filled, ...deferred])) continue;
    return { filled, deferred };
  }
  const none = () => new Array<BranchSlotChoice | null>(activeCount(state, side)).fill(null);
  return { filled: none(), deferred: none() };
}

/** The choices to write now (see `pickFillParts`). */
export function pickFill(side: Side, ranked: RankedChoice[], state: BranchSimState, touched: Choices, held: readonly boolean[] = []): Choices {
  return pickFillParts(side, ranked, state, touched, held).filled;
}

/**
 * Whether a deferred pick still fits when its tray closes: the user may have chosen in the other slots meanwhile. A body another
 * slot of the side sends in does not fit, nor a second Tera or Mega on the side. `others` is the side's choices by slot.
 */
export function fitsBeside(choice: BranchSlotChoice, others: Choices, slot: number): boolean {
  const beside = others.map((other, index) => (index === slot ? null : other));
  if (choice.kind === 'switch') return !beside.some(other => other?.kind === 'switch' && other.speciesId === choice.speciesId);
  return !clashesWithTouched(beside, [choice]);
}

/**
 * A replay turn keeps the fill in the view, not in the draft (the draft is the user's touched mark). The state shown holds the
 * logged seed under the user's picks; an empty slot takes the fill, and only while the position still offers it (the exact
 * position can replace the snapshot picker after the fill landed). Returns the very same state when nothing changes.
 */
export function overlayFill(state: BranchSimState | null, fill: SideChoices | null): BranchSimState | null {
  if (!state || !fill) return state;
  let changed = false;
  const side = (key: Side): Choices => {
    const own = key === 'p1' ? state.p1Choices : state.p2Choices;
    // The effective choices can be shorter than the slots: with nothing logged and nothing picked they are the empty draft.
    return Array.from({ length: Math.max(own.length, fill[key].length) }, (_, slot) => {
      const held = own[slot] ?? null;
      const choice = fill[key][slot];
      if (held || !choice || !stillOffered(choice, state, key, slot)) return held;
      changed = true;
      return choice;
    });
  };
  const p1Choices = side('p1');
  const p2Choices = side('p2');
  if (!changed) return state;
  return { ...state, p1Choices, p1Choice: p1Choices[0] ?? null, p2Choices, p2Choice: p2Choices[0] ?? null };
}

/**
 * The state with the deferred picks of the held slots counted as chosen: Execute reads it, so its label counts the open slot and the
 * turn it sends carries the engine's pick. A deferred pick that no longer fits beside the user's choices stays out, as `release` does.
 */
export function withDeferred(state: BranchSimState, deferred: SideChoices | null | undefined): BranchSimState {
  if (!deferred) return state;
  let changed = false;
  const side = (key: Side): Choices => {
    const own = key === 'p1' ? state.p1Choices : state.p2Choices;
    // The list grows only where a deferred pick lands beyond the slots the state already lists.
    const reach = deferred[key].reduce((n, pick, slot) => (pick ? slot + 1 : n), 0);
    const merged = Array.from({ length: Math.max(own.length, reach) }, (_, slot): BranchSlotChoice | null => own[slot] ?? null);
    return merged.map((held, slot) => {
      const pick = deferred[key][slot];
      if (held || !pick || !fitsBeside(pick, merged, slot)) return held;
      changed = true;
      return pick;
    });
  };
  const p1Choices = side('p1');
  const p2Choices = side('p2');
  if (!changed) return state;
  return { ...state, p1Choices, p1Choice: p1Choices[0] ?? null, p2Choices, p2Choice: p2Choices[0] ?? null };
}
