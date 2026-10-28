import { toId } from '@fulllifegames/replay-core';
import { switchChoiceKey, switchOptionKey, type BranchSimState, type BranchSlotChoice } from '@fulllifegames/eval-engine';

export interface DraftChoices { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }

type OfferedState = Pick<BranchSimState, 'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot'>;

/** Whether the position still offers this pick for this slot (a move that is known and enabled, a switch that is on the bench). */
function stillOffered(choice: BranchSlotChoice, state: OfferedState, side: 'p1' | 'p2', slot: number): boolean {
  if (choice.kind === 'move') {
    const moves = (side === 'p1' ? state.p1MovesBySlot : state.p2MovesBySlot)[slot] ?? [];
    return moves.some(option => toId(option.name) === choice.moveId && !option.disabled);
  }
  const switches = (side === 'p1' ? state.p1SwitchesBySlot : state.p2SwitchesBySlot)[slot] ?? [];
  const wanted = switchChoiceKey(choice);
  return switches.some(option => !option.fainted && switchOptionKey(option) === wanted);
}

/**
 * A draft pick belongs to the position it was made on. When a set edit rebuilds that position and the move is gone
 * (or a switch target left the bench), the pick no longer resolves: Execute would fail on it. Returns the same
 * object when nothing was dropped, so a render-phase reconciliation settles after one pass (round 77, D2).
 */
export function dropStaleDraft(draft: DraftChoices, state: OfferedState): DraftChoices {
  let changed = false;
  const prune = (side: 'p1' | 'p2'): (BranchSlotChoice | null)[] => draft[side].map((choice, slot) => {
    if (choice && !stillOffered(choice, state, side, slot)) {
      changed = true;
      return null;
    }
    return choice;
  });
  const next = { p1: prune('p1'), p2: prune('p2') };
  return changed ? next : draft;
}
