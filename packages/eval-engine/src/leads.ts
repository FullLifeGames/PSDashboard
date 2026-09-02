import { TIER_THRESHOLDS, type VerdictTier } from './analysis';
import type { EvalResult, RankedChoice } from './types';

/**
 * Turn-0 (team preview) analysis: the lead decision graded like any other
 * simultaneous choice — played pair vs the equilibrium-best pair. Pure, no
 * sim imports, main-bundle safe. No decided-position leniency: the game
 * start is never decided.
 */

export interface LeadSideAnalysis {
  /** The actually led pair matched into the ranked options. */
  played: RankedChoice | null;
  best: RankedChoice | null;
  /** best.ev − played.ev (own perspective), floored at 0. */
  regret: number | null;
  tier?: VerdictTier;
}

export interface LeadAnalysis {
  p1: LeadSideAnalysis;
  p2: LeadSideAnalysis;
}

/** Sweep payload for the turn-0 slot. */
export interface LeadEvalData {
  result: EvalResult;
  played: { p1: string[] | null; p2: string[] | null };
}

/** 'Lead Scizor + Sneasler' → ['Scizor', 'Sneasler']; 'Lead Heatran' → ['Heatran']. */
export const leadSpeciesOf = (label: string): string[] =>
  label.replace(/^Lead /, '').split(' + ');

/**
 * Matches led species against a ranked lead option as an UNORDERED set —
 * the engine enumerates pairs i<j while the replay shows actual slot order.
 */
export function matchLeadOption(
  options: RankedChoice[],
  species: string[] | null,
): RankedChoice | null {
  if (!species || species.length === 0) return null;
  const wanted = [...species].sort().join('|');
  return options.find(option => leadSpeciesOf(option.label).sort().join('|') === wanted) ?? null;
}

export function analyzeLeads(
  result: EvalResult,
  played: { p1: string[] | null; p2: string[] | null },
): LeadAnalysis {
  const side = (key: 'p1' | 'p2'): LeadSideAnalysis => {
    const options = result.perSide[key];
    const best = options[0] ?? null;
    const matched = matchLeadOption(options, played[key]);
    const regret = matched && best ? Math.max(0, best.ev - matched.ev) : null;
    let tier: VerdictTier | undefined;
    if (regret !== null) {
      if (regret >= TIER_THRESHOLDS.blunder) tier = 'blunder';
      else if (regret >= TIER_THRESHOLDS.mistake) tier = 'mistake';
      else if (regret >= TIER_THRESHOLDS.inaccuracy) tier = 'inaccuracy';
    }
    return { played: matched, best, regret, ...(tier ? { tier } : {}) };
  };
  return { p1: side('p1'), p2: side('p2') };
}
