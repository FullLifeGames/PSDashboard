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

/** How many turns the deepening pass of a two-pass sweep may take on. */
export const KEY_TURN_CAP = 16;

/**
 * The turns worth a deeper look after a fast first pass: for every
 * blunder-sized swing, the turn that played into it AND the turn after it
 * (analysis compares both sides of a swing — mixing depths across a swing
 * boundary would blur exactly the numbers people click on). Biggest swings
 * win under the cap.
 */
export function selectKeyTurns(scores: (number | null)[], cap = KEY_TURN_CAP): number[] {
  const swings: { turn: number; magnitude: number }[] = [];
  for (let index = 1; index < scores.length; index++) {
    const previous = scores[index - 1];
    const current = scores[index];
    if (previous === null || current === null) continue;
    const magnitude = Math.abs(current - previous);
    if (magnitude >= BLUNDER_SWING) swings.push({ turn: index + 1, magnitude });
  }
  swings.sort((a, b) => b.magnitude - a.magnitude || a.turn - b.turn);
  const keys = new Set<number>();
  for (const { turn } of swings) {
    if (keys.size >= cap) break;
    keys.add(turn - 1);
    keys.add(turn);
  }
  return [...keys].filter(turn => turn >= 1 && turn <= scores.length).sort((a, b) => a - b);
}
