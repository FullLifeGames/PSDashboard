import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { stillOffered } from '../../lib/dock-seed';

export interface DraftChoices { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }

type OfferedState = Pick<BranchSimState, 'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot'>;

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
