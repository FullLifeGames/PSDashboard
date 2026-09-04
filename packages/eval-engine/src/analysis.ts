import { gradeSide, gradingFields } from './turn-analysis/grading.ts';
import { signalFields, signalSide } from './turn-analysis/signals.ts';
import { attributionFor, markRisk } from './turn-analysis/risk.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis, TurnAnalysis } from './turn-analysis/types.ts';

/**
 * Turns a sweep's cached per-turn data into a chess-style turn explanation:
 * what was played vs what the engine preferred (regret per side), and how
 * the score swing splits into a decision part and a chance part. Pure — no
 * @pkmn/sim imports, main-bundle safe. The stages live in turn-analysis/:
 * the vocabulary (types), the played match, the grading, the narrative
 * signals, and the risk/attribution pass.
 */

export {
  BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD,
  PAYOFF_WINDOW, REGRET_THRESHOLD, TIER_THRESHOLDS,
  decidedSeenKey, forcedWinSeenKey, unansweredSeenKey,
} from './turn-analysis/types.ts';
export type {
  AnalyzeTurnParams, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity, TurnVerification,
  VerdictTier,
} from './turn-analysis/types.ts';
export {
  diffChoices, findConsistentOptions, findPlayedOption, matchPlayedChoice, matchPlayedSide,
  phantomStayIn, playedSetupMove, splitCombinedLabel,
} from './turn-analysis/played-match.ts';

/** One side's record: the grading stages, then the narrative signals, keys in the report's order. */
function analyzeSide(params: AnalyzeTurnParams, key: Side): SideAnalysis {
  const grading = gradeSide(params, key);
  return { ...gradingFields(params, key, grading), ...signalFields(signalSide(params, key, grading)) };
}

export function analyzeTurn(params: AnalyzeTurnParams): TurnAnalysis {
  const playedTracking = params.playedTracking !== false;
  const p1 = analyzeSide(params, 'p1');
  const p2 = analyzeSide(params, 'p2');
  markRisk(params, 'p1', p1, p2);
  markRisk(params, 'p2', p2, p1);
  const swing = params.scoreAfter !== null ? params.scoreAfter - params.scoreBefore : null;
  const decisionDelta = params.playedOutcome !== null ? params.playedOutcome - params.scoreBefore : null;
  const chanceDelta = params.playedOutcome !== null && params.scoreAfter !== null
    ? params.scoreAfter - params.playedOutcome
    : null;
  const attribution = attributionFor(playedTracking, p1, p2, swing, chanceDelta);

  return {
    turn: params.turn,
    scoreBefore: params.scoreBefore,
    scoreAfter: params.scoreAfter,
    swing,
    playedOutcome: params.playedOutcome,
    decisionDelta,
    chanceDelta,
    attribution,
    p1,
    p2,
    playedTracking,
  };
}
