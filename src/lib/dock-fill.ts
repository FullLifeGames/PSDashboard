import {
  evalChoiceToSlotChoices, requiredChoicesForActiveSlots, type BranchSimState, type BranchSlotChoice, type RankedChoice,
} from '@fulllifegames/eval-engine';

import { stillOffered, type SideChoices } from './dock-seed';

type Side = 'p1' | 'p2';
type Choices = (BranchSlotChoice | null)[];


/** Maps an engine line onto one side's slots; null when a part does not resolve against the pickers. */
export function slotChoicesOf(state: BranchSimState, side: Side, ranked: RankedChoice): Choices | null {
  const movesBySlot = side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot;
  const switchesBySlot = side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot;
  // A choice string has one part per slot WITH choices (a doubles forced replacement: one), so the mask aligns them.
  const activeSlots = side === 'p1' ? state.p1ActiveSlots : state.p2ActiveSlots;
  const forcedSlots = side === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
  const mask = requiredChoicesForActiveSlots(
    activeSlots.map(active => (active ? { fainted: active.fainted, commanding: active.commanding } : null)),
    forcedSlots,
  );
  return evalChoiceToSlotChoices(ranked.choice, movesBySlot, switchesBySlot, ranked.label, mask);
}

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

// A side gets one Tera and one Mega.
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

export interface FillParts { filled: Choices; deferred: Choices }

/** The first ranked joint choice that fits the touched slots; a held slot is never written, its part is deferred. */
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

/** The ranked row the picks of one side stand for (Hard mode plays its worst reply); null when none agrees. */
export function rowOfChoices(side: Side, ranked: RankedChoice[], state: BranchSimState, picks: Choices, touched: Choices): RankedChoice | null {
  const candidates = ranked.flatMap(row => {
    const parts = row.choice === 'wait' ? null : slotChoicesOf(state, side, row);
    return parts ? [{ row, parts }] : [];
  });
  const has = (parts: Choices, against: Choices, strict: boolean): boolean => against.every((pick, slot) => {
    if (!pick) return true;
    const part = parts[slot];
    return !!part && sameAction(part, pick) && (!strict || modifierOf(part) === modifierOf(pick));
  });
  const found = candidates.find(entry => has(entry.parts, picks, true)) ?? candidates.find(entry => has(entry.parts, picks, false))
    ?? (touched.some(Boolean) ? candidates.find(entry => has(entry.parts, touched, false)) : undefined);
  return found?.row ?? null;
}

export function sameChoice(a: BranchSlotChoice | null | undefined, b: BranchSlotChoice | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const keys = (choice: BranchSlotChoice) => JSON.stringify(choice, (_key, value: unknown) => (
    value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : value
  ));
  return keys(a) === keys(b);
}

export function pickFill(side: Side, ranked: RankedChoice[], state: BranchSimState, touched: Choices, held: readonly boolean[] = []): Choices {
  return pickFillParts(side, ranked, state, touched, held).filled;
}

export function fitsBeside(choice: BranchSlotChoice, others: Choices, slot: number): boolean {
  const beside = others.map((other, index) => (index === slot ? null : other));
  if (choice.kind === 'switch') return !beside.some(other => other?.kind === 'switch' && other.speciesId === choice.speciesId);
  return !clashesWithTouched(beside, [choice]);
}

/** Whether another forced slot (either side) holds only the engine's pick; a bench click sends at once if not. */
export function engineHoldsForcedBeside(
  state: BranchSimState, engine: { p1: readonly boolean[]; p2: readonly boolean[] }, side: Side, slot: number,
): boolean {
  return (['p1', 'p2'] as const).some(other => {
    const forced = other === 'p1' ? state.p1ForceSwitches : state.p2ForceSwitches;
    return (forced ?? []).some((isForced, index) => isForced && !(other === side && index === slot) && !!engine[other][index]);
  });
}

/** The fill stays in the view, not in the draft: an empty slot takes it while the position still offers it. */
export function overlayFill(state: BranchSimState | null, fill: SideChoices | null): BranchSimState | null {
  if (!state || !fill) return state;
  let changed = false;
  const side = (key: Side): Choices => {
    const own = key === 'p1' ? state.p1Choices : state.p2Choices;
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

export function withDeferred(state: BranchSimState, deferred: SideChoices | null | undefined): BranchSimState {
  if (!deferred) return state;
  let changed = false;
  const side = (key: Side): Choices => {
    const own = key === 'p1' ? state.p1Choices : state.p2Choices;
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
