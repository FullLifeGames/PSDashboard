import { gradeSide, gradingFields } from './turn-analysis/grading.ts';
import { signalFields, signalSide } from './turn-analysis/signals.ts';
import { hitStoppedFor } from './turn-analysis/odds-stopped.ts';
import { attributionFor, markRisk } from './turn-analysis/risk.ts';
import { turnRolledFor } from './turn-analysis/luck.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis, TurnAnalysis } from './turn-analysis/types.ts';

/** Turns a turn's cached sweep data into a TurnAnalysis (regret per side, swing split into decision and chance). Pure: no @pkmn/sim imports, main-bundle safe. */

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
  const signals = signalSide(params, key, grading);
  // The KO-odds claims the opponent's actual click leaves without a landed hit.
  const hitStopped = hitStoppedFor(params, key, grading.options, grading.played, grading.best, signals.bestNull);
  return {
    ...gradingFields(params, key, grading),
    ...signalFields(signals),
    ...(hitStopped ? { hitStopped } : {}),
    ...shareField(params.faintedFraction),
  };
}

/** The turn's fainted share echoed onto the record, only where the param carries one. */
const shareField = (share: number | null | undefined): { faintedFraction?: number } =>
  typeof share === 'number' ? { faintedFraction: share } : {};

/**
 * The turn's rolls: the protocol's markers and played KO odds when the turn has its log, else the classes of the played cell.
 * A doubles search plans the cells of the played row and column, so the same reading holds there.
 */
function rolledForFields(params: AnalyzeTurnParams, p1: SideAnalysis, p2: SideAnalysis): Pick<TurnAnalysis, 'rolledFor'> {
  const rolledFor = turnRolledFor(params, p1, p2);
  return rolledFor ? { rolledFor } : {};
}

/** Explains one turn: what each side played against what the engine preferred, and how the score swing splits into decision and chance. */
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
  const attribution = attributionFor(playedTracking, p1, p2, swing, chanceDelta, decisionDelta);

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
    // Display only: the sentences split rolled from re-read.
    ...rolledForFields(params, p1, p2),
    // Display only: the shares the percent texts print at.
    ...shareField(params.faintedFraction),
    ...(typeof params.faintedFractionAfter === 'number' ? { faintedFractionAfter: params.faintedFractionAfter } : {}),
  };
}
