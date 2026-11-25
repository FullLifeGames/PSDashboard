import type { BranchMoveModifier, BranchSlotChoice } from '@fulllifegames/eval-engine';

/** What the viewed line played here: the replay's action on the main line, else the variation's recorded choice. */
// `targetLoc` is the log's location (1, 2 foe slots, negative own side), null when none, absent in singles.
export interface PlayedPick {
  kind: 'move' | 'switch';
  name: string;
  species?: string;
  targetLoc?: number | null;
  modifier?: BranchMoveModifier;
  recorded?: BranchSlotChoice;
}

/** Doubles carry one pick per slot (`p1Slots`, index 0 = slot A); singles the side's pick alone. */
export interface PlayedAtPosition {
  p1: PlayedPick | null;
  p2: PlayedPick | null;
  p1Slots?: (PlayedPick | null)[];
  p2Slots?: (PlayedPick | null)[];
}
