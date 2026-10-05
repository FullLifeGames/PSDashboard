import type { RankedChoice, ReadRecommendation } from '../types.ts';
import {
  CHANCE_THRESHOLD, DECIDED_SCORE, PAYOFF_WINDOW, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type TurnAttribution,
} from './types.ts';
import { bestWindowPayoff } from './grading.ts';

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

/** A choice the side's equilibrium mix weighs under this share counts as one the engine gave no weight. */
const QUIET_READ_MAX_WEIGHT = 0.01;

/** The equilibrium weight on the played choice, and whether it is the mix's favourite; null without a solved mix. */
function playedWeight(params: AnalyzeTurnParams, key: Side, played: RankedChoice): { weight: number; favourite: boolean } | null {
  const matrix = params.result.matrix;
  const choices = key === 'p1' ? matrix?.p1Choices : matrix?.p2Choices;
  const mix = key === 'p1' ? matrix?.mixes.p1 : matrix?.mixes.p2;
  const index = choices?.indexOf(played.choice) ?? -1;
  if (!mix || index < 0 || index >= mix.length) return null;
  return { weight: mix[index], favourite: mix[index] >= Math.max(...mix) };
}

/** The read's shape: a live position, some floor given up against the safe line, a choice the equilibrium gave no weight. */
function quietReadShape(params: AnalyzeTurnParams, key: Side, played: RankedChoice, safe: RankedChoice): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  if (ownBefore <= -DECIDED_SCORE || played.worstCase >= safe.worstCase) return false;
  const weight = playedWeight(params, key, played);
  return weight !== null && !weight.favourite && weight.weight < QUIET_READ_MAX_WEIGHT;
}

/**
 * Round 63 (T17): the read credit of an UNTIERED turn (648453 t13), the
 * narrowest rule that carries the scene on the ten feedback dumps (eight
 * sides there, four singles and four doubles): not from a lost position
 * (the gamble bound), a choice the equilibrium gave no weight, some floor
 * given up against the safe line, an immediate payoff over the safe
 * guarantee of at least the regret plus the read margin, and within the
 * window a mistake-sized edge on top of the regret. Card sentence only.
 */
function markQuietRead(params: AnalyzeTurnParams, key: Side, side: SideAnalysis): void {
  const { played, safe } = side;
  if (side.tier || !played || !safe || params.playedOutcome === null || side.regret === null) return;
  if (!quietReadShape(params, key, played, safe)) return;
  const immediate = bestWindowPayoff([params.playedOutcome], key, safe.worstCase).payoff;
  if (immediate === null || immediate < side.regret + RISK_PAYOFF_MARGIN) return;
  const chain = [params.playedOutcome, ...(params.futureOutcomes ?? [])].slice(0, PAYOFF_WINDOW + 1);
  const { payoff, payoffTurn } = bestWindowPayoff(chain, key, safe.worstCase);
  if (payoff === null || payoff < side.regret + TIER_THRESHOLDS.mistake) return;
  side.readCredit = { payoff, ...(payoffTurn > 0 ? { payoffTurn } : {}) };
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
  if (!tiered && !gamble) {
    // Round 63 (T17): no band and no gamble — a quiet read can still earn its sentence.
    markQuietRead(params, key, side);
    return;
  }
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
