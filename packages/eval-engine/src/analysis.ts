import { gradeSide, gradingFields } from './turn-analysis/grading.ts';
import { signalFields, signalSide } from './turn-analysis/signals.ts';
import { hitStoppedFor } from './turn-analysis/odds-stopped.ts';
import { attributionFor, markRisk } from './turn-analysis/risk.ts';
import { turnRolledFor } from './turn-analysis/luck.ts';
import type { AnalyzeTurnParams, Side, SideAnalysis, TurnAnalysis } from './turn-analysis/types.ts';

/** Turns a turn's cached sweep data into a TurnAnalysis. Pure: no @pkmn/sim imports, main-bundle safe. */

export {
  BREADTH_MIN_OPTIONS, CHANCE_THRESHOLD,
  PAYOFF_WINDOW, REGRET_THRESHOLD, TIER_THRESHOLDS,
  decidedSeenKey, forcedWinSeenKey, unansweredSeenKey,
} from './turn-analysis/types.ts';
export type {
  AnalyzeTurnParams, NoChoiceSlot, SensitivityProbe, SideAnalysis, TurnAnalysis, TurnAttribution, TurnSensitivity,
  TurnVerification, VerdictTier,
} from './turn-analysis/types.ts';
export {
  diffChoices, findConsistentOptions, findPlayedOption, matchPlayedChoice, matchPlayedSide,
  hiddenSlots, phantomStayIn, playedSetupMove, splitCombinedLabel, standsIn,
} from './turn-analysis/played-match.ts';

function analyzeSide(params: AnalyzeTurnParams, key: Side): SideAnalysis {
  const grading = gradeSide(params, key);
  const signals = signalSide(params, key, grading);
  const hitStopped = hitStoppedFor(params, key, grading.options, grading.played, grading.best, signals.bestNull);
  return {
    ...gradingFields(params, key, grading),
    ...signalFields(signals),
    ...(hitStopped ? { hitStopped } : {}),
    ...shareField(params.faintedFraction),
  };
}

const shareField = (share: number | null | undefined): { faintedFraction?: number } =>
  typeof share === 'number' ? { faintedFraction: share } : {};

function rolledForFields(params: AnalyzeTurnParams, p1: SideAnalysis, p2: SideAnalysis): Pick<TurnAnalysis, 'rolledFor'> {
  const rolledFor = turnRolledFor(params, p1, p2);
  return rolledFor ? { rolledFor } : {};
}

/** Explains one turn: each side's play against the engine's pick, and the swing split into decision and chance. */
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
    ...rolledForFields(params, p1, p2),
    ...shareField(params.faintedFraction),
    ...(typeof params.faintedFractionAfter === 'number' ? { faintedFractionAfter: params.faintedFractionAfter } : {}),
  };
}
