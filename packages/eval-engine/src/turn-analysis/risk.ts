import type { RankedChoice, ReadRecommendation } from '../types';
import {
  CHANCE_THRESHOLD, DECIDED_SCORE, PAYOFF_WINDOW, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type TurnAttribution,
} from './types';
import { bestWindowPayoff } from './grading';

/**
 * A flagged risk whose punishing reply was never clicked reads differently
 * from a punished misplay. Where the pair's expected value is known, the
 * payoff over the safe guarantee grades the read: clearly ahead = a good
 * play, clearly behind = a plain misplay even unpunished, between = risk.
 * UNTIERED turns enter too, but only as genuine gambles — the play deviated
 * from the engine's pick AND gave up a mistake-sized floor vs the safe line
 * (draft T50: a co-optimal switch whose floor priced in Earth Power). They
 * can only EARN the paid-off credit; with no verdict to soften, the risk
 * labels stay off. Two honesty bounds (GPL T35): no praise from an
 * already-lost position (garbage time makes every move a "gamble" outcome
 * noise can credit), and the credit grades on the IMMEDIATE outcome only —
 * the payoff window softens flagged risks; here it would attribute the
 * opponent's follow-up choices and the rolls to the gamble.
 */

/** An untiered play that deviated from the engine's pick AND gave up a mistake-sized floor, from a not-yet-lost position. */
function isGamble(params: AnalyzeTurnParams, key: Side, side: SideAnalysis, tiered: boolean): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  return !tiered && side.played !== null && side.best !== null && side.safe !== null
    && side.played.choice !== side.best.choice
    && side.played.choice !== side.safe.choice
    && side.safe.worstCase - side.played.worstCase >= TIER_THRESHOLDS.mistake
    && ownBefore > -DECIDED_SCORE
    && params.playedOutcome !== null;
}

/**
 * Books the windowed payoff over the safe guarantee on the side record —
 * the BEST expected outcome within the window (tiered turns look
 * PAYOFF_WINDOW turns ahead, gambles at the immediate outcome only). True
 * when the read clearly FAILED, which keeps every risk label off.
 */
function bookRiskPayoff(params: AnalyzeTurnParams, key: Side, side: SideAnalysis, tiered: boolean): boolean {
  if (!(params.playedOutcome !== null && side.safe)) return false;
  const chain = tiered
    ? [params.playedOutcome, ...(params.futureOutcomes ?? [])].slice(0, PAYOFF_WINDOW + 1)
    : [params.playedOutcome];
  const { payoff, payoffTurn } = bestWindowPayoff(chain, key, side.safe.worstCase);
  if (payoff === null) return false;
  side.riskPayoff = payoff;
  if (payoffTurn > 0) side.riskPayoffTurn = payoffTurn;
  if (payoff <= -RISK_PAYOFF_MARGIN) return true;
  if (payoff >= RISK_PAYOFF_MARGIN - RISK_PAYOFF_EPSILON) side.riskPaidOff = true;
  return false;
}

/**
 * The opponent model's best response matches the played choice: the
 * machine id is authoritative; the label match only serves cached reads
 * written before choice ids existed.
 */
function readMatches(read: ReadRecommendation | null | undefined, played: RankedChoice | null): boolean {
  return !!(read && played && (read.choice.choiceId !== undefined
    ? read.choice.choiceId === played.choice
    : read.choice.label === played.label));
}

/** Marks the side's risk fields in place (riskPayoff, riskPayoffTurn, riskPaidOff, riskUnpunished, riskWasRead). */
export function markRisk(params: AnalyzeTurnParams, key: Side, side: SideAnalysis, opponent: SideAnalysis): void {
  // A phantom stay-in has no real floor to price a read against.
  if (side.sacrifice || side.neverActed) return;
  const tiered = side.tier === 'mistake' || side.tier === 'blunder';
  const gamble = isGamble(params, key, side, tiered);
  if (!tiered && !gamble) return;
  if (!side.played?.punishedBy || !opponent.played) return;
  if (opponent.played.label === side.played.punishedBy) return;
  if (bookRiskPayoff(params, key, side, tiered)) return;
  // Gambles stop here: paid-off credit or nothing.
  if (!tiered) return;
  side.riskUnpunished = true;
  // The opponent model agrees: this "risk" was the exploitative best
  // response to how the opponent actually plays — phrase it as a read.
  if (readMatches(params.reads?.[key], side.played)) side.riskWasRead = true;
}

const badTier = (side: SideAnalysis): boolean => side.tier === 'mistake' || side.tier === 'blunder';

/**
 * Who owns the swing when a verdict or a paid-off read stands. A paid-off
 * read does not count as a decision problem; neither does an inaccuracy
 * or a leniency-softened verdict. Null when nothing crossed a blame
 * threshold.
 */
function culpritAttribution(p1: SideAnalysis, p2: SideAnalysis): TurnAttribution | null {
  const p1Bad = badTier(p1) && !p1.riskPaidOff;
  const p2Bad = badTier(p2) && !p2.riskPaidOff;
  if (p1Bad && p2Bad) return 'both-decision';
  if (p1Bad) return 'p1-decision';
  if (p2Bad) return 'p2-decision';
  if (p1.riskPaidOff && p2.riskPaidOff) return 'both-read';
  if (p1.riskPaidOff) return 'p1-read';
  if (p2.riskPaidOff) return 'p2-read';
  return null;
}

/** The movement itself: a roll, a shift or an unclear turn, or quiet. */
function movementAttribution(
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
): TurnAttribution {
  if (chanceDelta !== null && Math.abs(chanceDelta) >= CHANCE_THRESHOLD) return 'chance';
  if (swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD) {
    // The score clearly moved but nothing crossed a blame threshold: either
    // a side's choice never surfaced (unclear), or pressure and rolls just
    // added up (shift) — never "quiet".
    return p1.played === null || p2.played === null ? 'unclear' : 'shift';
  }
  return 'quiet';
}

/** The turn's attribution, culprits before movement, in the original precedence. */
export function attributionFor(
  playedTracking: boolean,
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
): TurnAttribution {
  if (!playedTracking) {
    // Without played actions only the movement itself can be described.
    return swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  }
  return culpritAttribution(p1, p2) ?? movementAttribution(p1, p2, swing, chanceDelta);
}
