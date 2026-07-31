/**
 * Pure helpers for the full-game evaluation graph. No @pkmn/sim imports —
 * main-bundle safe.
 */

/** Score swing between consecutive evaluated turns that marks a blunder. */
export const BLUNDER_SWING = 0.25;

/**
 * Returns the 1-based turn numbers whose score swung by at least
 * BLUNDER_SWING relative to the directly preceding evaluated turn. Gaps
 * (null scores) break the chain — a swing across several turns cannot be
 * pinned on one decision.
 */
export function computeBlunders(scores: (number | null)[]): number[] {
  const blunders: number[] = [];
  for (let index = 1; index < scores.length; index++) {
    const previous = scores[index - 1];
    const current = scores[index];
    if (previous === null || current === null) continue;
    if (Math.abs(current - previous) >= BLUNDER_SWING) blunders.push(index + 1);
  }
  return blunders;
}
