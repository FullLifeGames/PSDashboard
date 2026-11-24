import type { BranchSimState, BranchSlotChoice } from '@fulllifegames/eval-engine';
import { stillOffered } from '../../lib/dock-seed';

export interface DraftChoices { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }

type OfferedState = Pick<BranchSimState, 'p1MovesBySlot' | 'p2MovesBySlot' | 'p1SwitchesBySlot' | 'p2SwitchesBySlot'>;

/** Drops the draft picks the rebuilt position no longer offers; returns the same object when nothing changed. */
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
