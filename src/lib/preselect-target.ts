import type { BranchMoveOption } from '@fulllifegames/eval-engine';

/** The doubles target a move opens with: the played one for the played move, else the foe hurt most, else the first. */
export interface PreselectInput {
  /** The highest roll against each target, by the target's label ("P2A"). */
  damage?: Record<string, { maxPercent: number } | undefined>;
  playedLoc?: number | null;
}

export function preselectTarget(move: BranchMoveOption, ownSide: 'p1' | 'p2', input: PreselectInput = {}): number | undefined {
  const options = move.targetOptions;
  if (options.length === 0) return undefined;
  const { damage = {}, playedLoc } = input;
  if (playedLoc != null && options.some(option => option.targetLoc === playedLoc)) return playedLoc;
  let best: { targetLoc: number; maxPercent: number } | null = null;
  for (const option of options) {
    const reading = damage[option.label];
    // The partner never competes: a move that hits it by choice is the user's pick.
    if (option.side === ownSide || !reading) continue;
    if (!best || reading.maxPercent > best.maxPercent) best = { targetLoc: option.targetLoc, maxPercent: reading.maxPercent };
  }
  return best ? best.targetLoc : options[0].targetLoc;
}
