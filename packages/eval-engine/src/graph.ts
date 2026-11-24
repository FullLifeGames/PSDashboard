// Pure helpers for the full-game evaluation graph; no @pkmn/sim imports, main-bundle safe.

import { TIER_THRESHOLDS } from './analysis.ts';

export const BLUNDER_SWING = TIER_THRESHOLDS.blunder;

/** 1-based turns whose play made a blunder-sized swing; `scores[t-1]` starts turn t; null scores break the chain. */
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

const KEY_TURN_CAP = 16;

export const KEY_TURN_SWING = 0.25;

export function selectKeyTurns(scores: (number | null)[], cap = KEY_TURN_CAP): number[] {
  // Both sides of a swing: mixing depths across a swing boundary would blur the numbers people click on.
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
