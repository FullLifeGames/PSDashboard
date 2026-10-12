import { gradeSide, gradingFields } from './turn-analysis/grading.ts';
import { signalFields, signalSide } from './turn-analysis/signals.ts';
import { attributionFor, markRisk } from './turn-analysis/risk.ts';
import { playedCellOf, rolledFromCell, rolledSides } from './turn-analysis/luck.ts';
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
  return {
    ...gradingFields(params, key, grading),
    ...signalFields(signalSide(params, key, grading)),
    ...shareField(params.faintedFraction),
  };
}

/** Round 69 (T51): the turn's fainted share echoed onto the record, only where the param carries one. */
const shareField = (share: number | null | undefined): { faintedFraction?: number } =>
  typeof share === 'number' ? { faintedFraction: share } : {};

/**
 * The turn's rolls: the protocol's markers and played KO odds when the turn has its log, else (round 69, T178) the
 * classes of the played cell. Doubles keep the log reading: their cells carry no plan.
 */
function rolledForFields(params: AnalyzeTurnParams, p1: SideAnalysis, p2: SideAnalysis): Pick<TurnAnalysis, 'rolledFor'> {
  const rolledFor = params.rolls
    ? rolledSides(params.rolls, p1, p2, params.actives)
    : rolledFromCell(playedCellOf(params.result, params.played));
  return rolledFor ? { rolledFor } : {};
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
    // Round 67 (T22): the turn's rolls, display only (the sentences split rolled from re-read).
    ...rolledForFields(params, p1, p2),
    // Round 69 (T51): the shares the percent texts print at, display only.
    ...shareField(params.faintedFraction),
    ...(typeof params.faintedFractionAfter === 'number' ? { faintedFractionAfter: params.faintedFractionAfter } : {}),
  };
}
