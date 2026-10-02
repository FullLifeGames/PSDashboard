import type { Battle } from '@pkmn/sim';
import { EVAL_WEIGHTS, featureWeights, type EvalFeatures } from './score/weights.ts';
import { evalFeatures } from './score/features.ts';
import type { MatchupCache } from './score/threat.ts';

/**
 * The static positional evaluation, p1's perspective in [-1, +1]. The
 * stages live in score/: the tuning and feature weights, the hazard
 * pricing, the threat proxy, the race clocks, the matchup and sweep
 * terms, the feature vector, and the unanswered-mon profile.
 */

export { DOUBLES_FEATURE_WEIGHTS, EVAL_WEIGHTS, FEATURE_WEIGHTS, featureWeights } from './score/weights.ts';
export type { EvalFeatures } from './score/weights.ts';
export { hazardCost, hazardRemovalEquity, strandedMons } from './score/hazards.ts';
export { boostedFraction, createMatchupCache, pairThreat, singleMoveFraction } from './score/threat.ts';
export type { MatchupCache } from './score/threat.ts';
export { raceClocks } from './score/races.ts';
export type { RaceSide } from './score/races.ts';
export { matchupTerms } from './score/matchup.ts';
export { evalFeatures } from './score/features.ts';
export { unansweredMons } from './score/unanswered.ts';

/** Static positional eval from p1's perspective in [-1, +1]; ±1 for ended battles. */
export function evaluatePosition(battle: Battle, cache?: MatchupCache): number {
  if (battle.ended) {
    if (!battle.winner) return 0;
    if (battle.winner === battle.sides[0].name) return 1;
    return -1;
  }

  const features = evalFeatures(battle, cache);
  const weights = featureWeights(battle.gameType === 'doubles');
  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  const normalizer = teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);
  let diff = 0;
  for (const key of Object.keys(weights) as (keyof EvalFeatures)[]) {
    diff += weights[key] * features[key];
  }
  return Math.tanh((diff / normalizer) * EVAL_WEIGHTS.scale);
}
