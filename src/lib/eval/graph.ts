/**
 * Pure helpers for the full-game evaluation graph. No @pkmn/sim imports —
 * main-bundle safe.
 */

import { TIER_THRESHOLDS } from './analysis';

/**
 * Score swing between consecutive evaluated turns that marks a blunder.
 * Scores are wp-units, so the blunder ring means what the verdict band
 * means: a blunder-sized (20% win-probability) move between turns.
 */
export const BLUNDER_SWING = TIER_THRESHOLDS.blunder;

/**
 * Returns the 1-based turn numbers whose PLAY created a blunder-sized swing:
 * scores[t-1] is the position at the start of turn t, so a swing between
 * scores[index-1] and scores[index] was played on turn `index` — the marker
 * must sit on that turn (clicking it opens the analysis that explains the
 * swing), not on the turn after, where the drop merely becomes visible.
 * Gaps (null scores) break the chain — a swing across several turns cannot
 * be pinned on one decision.
 */
export function computeBlunders(scores: (number | null)[]): number[] {
  const blunders: number[] = [];
  for (let index = 1; index < scores.length; index++) {
    const previous = scores[index - 1];
    const current = scores[index];
    if (previous === null || current === null) continue;
    if (Math.abs(current - previous) >= BLUNDER_SWING) blunders.push(index);
  }
  return blunders;
}

/** How many turns the deepening pass of a two-pass sweep may take on. */
const KEY_TURN_CAP = 16;

/**
 * Swing that earns the deepening pass — the SAME constant the report's key
 * moments use (report.ts re-exports it), so the report can never name a
 * turn the sweep left on the fast scan. When the wp-unit conversion moved
 * the blunder band to 0.4, the old BLUNDER_SWING-based selection silently
 * stopped covering report-worthy 0.25–0.4 swings: the GPL sweep deepened
 * NOTHING and its chips carried d1 badges under MCTS prefs.
 */
export const KEY_TURN_SWING = 0.25;

/**
 * The turns worth a deeper look after a fast first pass: for every
 * report-worthy swing, the turn that played into it AND the turn after it
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
    if (magnitude >= KEY_TURN_SWING) swings.push({ turn: index + 1, magnitude });
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
