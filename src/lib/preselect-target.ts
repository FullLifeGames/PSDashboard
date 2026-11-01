import type { BranchMoveOption } from '@fulllifegames/eval-engine';

/**
 * Round 84 (turn dock), lane A: the target a move opens with in doubles, so a pick takes one click. The played target wins for
 * the played move; else the foe the move hurts most (the highest maximum damage); else the first target the move lists. A move
 * with no target options (singles, spread and self moves) has nothing to preselect.
 */
export interface PreselectInput {
  /** The highest roll against each target, by the target's label ("P2A"). */
  damage?: Record<string, { maxPercent: number } | undefined>;
  /** The target the viewed line played for this move. */
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
