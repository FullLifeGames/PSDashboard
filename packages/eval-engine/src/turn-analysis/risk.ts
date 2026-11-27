import type { RankedChoice, ReadRecommendation } from '../types.ts';
import {
  CHANCE_THRESHOLD, DECIDED_SCORE, PAYOFF_WINDOW, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type TurnAnalysis, type TurnAttribution,
} from './types.ts';
import { bestWindowPayoff } from './sack-gates.ts';
import { beatsSafeCell, clickedCells } from './clicked-cell.ts';
import { standsIn } from './played-match.ts';

// A not-yet-lost, untiered deviation that gave up a mistake-sized floor is a gamble: it can only EARN credit, no label.
function isGamble(params: AnalyzeTurnParams, key: Side, side: SideAnalysis, tiered: boolean): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  return !tiered && side.played !== null && side.best !== null && side.safe !== null
    && side.played.choice !== side.best.choice
    && side.played.choice !== side.safe.choice
    && side.safe.worstCase - side.played.worstCase >= TIER_THRESHOLDS.mistake
    && ownBefore > -DECIDED_SCORE
    && params.playedOutcome !== null;
}

// An inaccuracy that gave up floor, from a not-yet-lost position, can earn the paid-off credit as a gamble does.
function isInaccuracyRisk(params: AnalyzeTurnParams, key: Side, side: SideAnalysis): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  return side.tier === 'inaccuracy' && side.played !== null && side.safe !== null
    && side.played.choice !== side.safe.choice
    && side.played.worstCase < side.safe.worstCase
    && ownBefore > -DECIDED_SCORE
    && params.playedOutcome !== null;
}

// True when the read clearly FAILED (every risk label off); tiered turns look PAYOFF_WINDOW ahead, gambles at once.
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
  if (payoff >= RISK_PAYOFF_MARGIN - RISK_PAYOFF_EPSILON && readBeatSafeLine(params, key, side)) side.riskPaidOff = true;
  return false;
}

// A payoff over the safe floor is a read only when the played line also beat the safe line in the reply's cell;
// with no cell to compare (no matrix, a hidden click slot, the played line is the safe line) the payoff alone decides.
function readBeatSafeLine(params: AnalyzeTurnParams, key: Side, side: SideAnalysis): boolean {
  if (!side.played || !side.safe || side.played.choice === side.safe.choice) return true;
  const cells = clickedCells(params, key, [side.played.choice, side.safe.choice]);
  if (!cells) return true;
  const [playedValue, safeValue] = cells.values;
  side.safeAgainstClick = { against: cells.against, playedValue, safeValue };
  return beatsSafeCell(playedValue, safeValue);
}

const QUIET_READ_MAX_WEIGHT = 0.01;

function playedWeight(params: AnalyzeTurnParams, key: Side, played: RankedChoice): { weight: number; favourite: boolean } | null {
  const matrix = params.result.matrix;
  const choices = key === 'p1' ? matrix?.p1Choices : matrix?.p2Choices;
  const mix = key === 'p1' ? matrix?.mixes.p1 : matrix?.mixes.p2;
  const index = choices?.indexOf(played.choice) ?? -1;
  if (!mix || index < 0 || index >= mix.length) return null;
  return { weight: mix[index], favourite: mix[index] >= Math.max(...mix) };
}

function quietReadShape(params: AnalyzeTurnParams, key: Side, played: RankedChoice, safe: RankedChoice): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  if (ownBefore <= -DECIDED_SCORE || played.worstCase >= safe.worstCase) return false;
  const weight = playedWeight(params, key, played);
  return weight !== null && !weight.favourite && weight.weight < QUIET_READ_MAX_WEIGHT;
}

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

// The choice id is authoritative; the label match serves cached reads without one.
function readMatches(read: ReadRecommendation | null | undefined, played: RankedChoice | null): boolean {
  return !!(read && played && (read.choice.choiceId !== undefined
    ? read.choice.choiceId === played.choice
    : read.choice.label === played.label));
}

/** Marks the side's risk fields in place (riskPayoff, riskPayoffTurn, riskPaidOff, riskUnpunished, riskWasRead). */
export function markRisk(params: AnalyzeTurnParams, key: Side, side: SideAnalysis, opponent: SideAnalysis): void {
  if (side.sacrifice || standsIn(side)) return;
  const tiered = side.tier === 'mistake' || side.tier === 'blunder';
  const gamble = isGamble(params, key, side, tiered) || isInaccuracyRisk(params, key, side);
  if (!tiered && !gamble) {
    markQuietRead(params, key, side);
    return;
  }
  if (!side.played?.punishedBy || !opponent.played) return;
  if (opponent.played.label === side.played.punishedBy) return;
  if (bookRiskPayoff(params, key, side, tiered)) return;
  if (!tiered) return;
  side.riskUnpunished = true;
  if (readMatches(params.reads?.[key], side.played)) side.riskWasRead = true;
}

const badTier = (side: SideAnalysis): boolean => side.tier === 'mistake' || side.tier === 'blunder';

// null when nothing crossed a blame threshold; an inaccuracy, softened verdict or paid-off read is no decision problem.
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

// The residual names the turn only when it is the larger part of the swing; a tie goes to the swing's own reading.
const chanceLeads = (chanceDelta: number, decisionDelta: number | null | undefined): boolean =>
  decisionDelta === null || decisionDelta === undefined || Math.abs(chanceDelta) > Math.abs(decisionDelta);

function movementAttribution(
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
  decisionDelta: number | null | undefined,
): TurnAttribution {
  if (chanceDelta !== null && Math.abs(chanceDelta) >= CHANCE_THRESHOLD && chanceLeads(chanceDelta, decisionDelta)) return 'chance';
  if (swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD) {
    // The score clearly moved without a blame threshold: unclear (a choice never surfaced) or shift, never "quiet".
    return p1.played === null || p2.played === null ? 'unclear' : 'shift';
  }
  return 'quiet';
}

export function attributionFor(
  playedTracking: boolean,
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
  decisionDelta: number | null = null,
): TurnAttribution {
  if (!playedTracking) {
    return swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  }
  return culpritAttribution(p1, p2) ?? movementAttribution(p1, p2, swing, chanceDelta, decisionDelta);
}

/** The click is the reply the played floor was priced on, and that floor trails the best line's by a mistake band. */
export function walkedInto(side: SideAnalysis, opponent: SideAnalysis): boolean {
  const { played, best } = side;
  return !!played && !!best && !!opponent.played && played.punishedBy !== null && punisherClicked(side, opponent)
    && best.worstCase - played.worstCase >= TIER_THRESHOLDS.mistake;
}

// A fresh search can name a sibling of the click as punisher: a played value within one inaccuracy of the floor ties.
function punisherClicked(side: SideAnalysis, opponent: SideAnalysis): boolean {
  const { played, hindsightRead } = side;
  if (!played || !opponent.played) return false;
  if (played.punishedBy === opponent.played.label) return true;
  return hindsightRead?.playedValue !== undefined && hindsightRead.against === opponent.played.label &&
    hindsightRead.playedValue - played.worstCase < TIER_THRESHOLDS.inaccuracy;
}

/** The side's estimate fell across the turn by at least RISK_PAYOFF_MARGIN; its read is then not praised. */
export function lostGround(analysis: Pick<TurnAnalysis, 'swing'>, side: Side): boolean {
  const swing = analysis.swing ?? null;
  if (swing === null) return false;
  return (side === 'p1' ? swing : -swing) <= -RISK_PAYOFF_MARGIN;
}

/** The attribution as card and badges show it: a read whose side lost ground no longer claims the turn. */
export function shownAttribution(analysis: TurnAnalysis): TurnAttribution {
  const { attribution, p1, p2 } = analysis;
  if (attribution !== 'p1-read' && attribution !== 'p2-read' && attribution !== 'both-read') return attribution;
  const p1Read = attribution !== 'p2-read' && !lostGround(analysis, 'p1');
  const p2Read = attribution !== 'p1-read' && !lostGround(analysis, 'p2');
  if (p1Read && p2Read) return 'both-read';
  if (p1Read) return 'p1-read';
  if (p2Read) return 'p2-read';
  return movementAttribution(p1, p2, analysis.swing, analysis.chanceDelta, analysis.decisionDelta);
}
