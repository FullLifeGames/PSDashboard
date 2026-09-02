import type { EvalChoiceOption, EvalResult, KoOddsInfo, KoOddsMismatch, UnansweredProfile } from '../types';

/**
 * The root's narrative payload shared by every search path (sync matrix,
 * orchestrated matrix, MCTS): per-option kill odds matched by choice
 * string onto the ranked rows, the sampler's mismatch diagnostics, and the
 * unanswered-mon profile. Pure — no sim imports, main-thread safe.
 */

/** Per-option kill odds keyed by choice string, one map per side. */
export type KoOddsMaps = { p1: Map<string, KoOddsInfo | null>; p2: Map<string, KoOddsInfo | null> };

/** Index-aligned odds arrays → choice-keyed maps (rows are ranked, so rows match by choice string). */
export function koOddsMapsFor(
  p1Options: EvalChoiceOption[],
  p2Options: EvalChoiceOption[],
  odds: { p1: (KoOddsInfo | null)[]; p2: (KoOddsInfo | null)[] },
): KoOddsMaps {
  return {
    p1: new Map<string, KoOddsInfo | null>(p1Options.map((option, index) => [option.choice, odds.p1[index] ?? null])),
    p2: new Map<string, KoOddsInfo | null>(p2Options.map((option, index) => [option.choice, odds.p2[index] ?? null])),
  };
}

/** Attaches real events only, matched by choice string. */
export function attachKoOdds(target: EvalResult, maps: KoOddsMaps | null): void {
  if (!maps) return;
  for (const side of ['p1', 'p2'] as const) {
    for (const row of target.perSide[side]) {
      const odds = maps[side].get(row.choice);
      if (odds) row.koOdds = odds;
    }
  }
}

/** A profile with anything to say: an open list, a switch-in stage, a decided sweep, or a near stage. */
export const hasUnansweredContent = (unanswered: UnansweredProfile): boolean =>
  unanswered.p1.length > 0 || unanswered.p2.length > 0 ||
  (unanswered.p1Entry?.length ?? 0) > 0 || (unanswered.p2Entry?.length ?? 0) > 0 ||
  unanswered.decided !== undefined || unanswered.nearDecided !== undefined;

export interface RootPayload {
  diagnostics: KoOddsMismatch[];
  koOddsMaps: KoOddsMaps | null;
  unanswered: UnansweredProfile | null | undefined;
}

/** Diagnostics, then kill odds, then the profile — the order every partial result gets them in. */
export function attachRootPayload(target: EvalResult, payload: RootPayload): void {
  if (payload.diagnostics.length > 0) target.koDiagnostics = payload.diagnostics;
  attachKoOdds(target, payload.koOddsMaps);
  if (payload.unanswered && hasUnansweredContent(payload.unanswered)) target.unanswered = payload.unanswered;
}
