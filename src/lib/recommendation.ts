import type { BranchMoveOption } from './branch-engine';
import type { DamageResult } from './damage-calc';

export interface MoveRecommendation {
  move: BranchMoveOption;
  targetLoc?: number;
  range?: string;
  score: number;
}

/**
 * Picks the highest-damage usable move. Allied slots are excluded from the
 * candidate targets — maximizing damage must never recommend attacking your
 * own doubles partner (B4). Moves that can only target allies are skipped.
 */
export function pickRecommendedMove(
  ownSide: 'p1' | 'p2',
  moves: BranchMoveOption[],
  defaultDamage: DamageResult[],
  targetDamage: Record<string, DamageResult | undefined>,
): MoveRecommendation | null {
  let best: MoveRecommendation | null = null;

  moves.forEach((move, index) => {
    if (move.disabled || (move.requiresTarget && move.targetOptions.length === 0)) return;

    const enemyTargets = move.targetOptions.filter(target => target.side !== ownSide);
    if (move.targetOptions.length > 0 && enemyTargets.length === 0) return;

    const candidates = enemyTargets.length > 0
      ? enemyTargets.map(target => ({
        move,
        targetLoc: target.targetLoc,
        damage: targetDamage[`${move.slot}:${target.targetLoc}`],
      }))
      : [{ move, targetLoc: undefined, damage: defaultDamage[index] }];

    for (const candidate of candidates) {
      const score = candidate.damage?.maxPercent ?? 0;
      if (!best || score > best.score) {
        best = {
          move: candidate.move,
          targetLoc: candidate.targetLoc,
          range: candidate.damage?.range,
          score,
        };
      }
    }
  });

  return best;
}
