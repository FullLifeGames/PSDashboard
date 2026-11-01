import type { BranchMoveModifier, BranchSlotChoice } from '@fulllifegames/eval-engine';

/**
 * What the viewed line actually played at this position (the badge on the matching button and the dock's seed): the replay's
 * action on the main line, the variation's recorded choice on variation positions.
 *
 * Round 84 (turn dock): the pick also carries the target and the gimmick of the move. `targetLoc` is the simulator's location
 * as the log names it (1 and 2 the foe slots, negative the own side), null when the line names none, and absent in singles. A
 * spread move still carries the first name its line shows, so the dock's seed keeps a target only where the move lists it.
 * `recorded` is a variation entry's whole choice (dice included), set only behind the tip.
 */
export interface PlayedPick {
  kind: 'move' | 'switch';
  name: string;
  species?: string;
  targetLoc?: number | null;
  modifier?: BranchMoveModifier;
  recorded?: BranchSlotChoice;
}

/**
 * What each side played at a position. Doubles carry one pick per slot (`p1Slots`, index 0 = slot A);
 * singles carry the side's pick alone.
 */
export interface PlayedAtPosition {
  p1: PlayedPick | null;
  p2: PlayedPick | null;
  p1Slots?: (PlayedPick | null)[];
  p2Slots?: (PlayedPick | null)[];
}
