import type { RankedChoice, ReadRecommendation } from '../types.ts';
import {
  CHANCE_THRESHOLD, DECIDED_SCORE, PAYOFF_WINDOW, RISK_PAYOFF_EPSILON, RISK_PAYOFF_MARGIN, TIER_THRESHOLDS,
  type AnalyzeTurnParams, type Side, type SideAnalysis, type TurnAnalysis, type TurnAttribution,
} from './types.ts';
import { bestWindowPayoff } from './sack-gates.ts';
import { beatsSafeCell, clickedCells } from './clicked-cell.ts';

// Risk marking: a flagged risk whose punishing reply was never clicked is graded by its payoff over the safe guarantee, and attribution of the turn.

/**
 * An untiered play that deviated from the engine's pick AND gave up a mistake-sized floor (a co-optimal switch whose floor priced in
 * Earth Power), from a not-yet-lost position: garbage time makes every move a "gamble" that outcome noise can credit. Gambles can only
 * EARN the paid-off credit; with no verdict to soften, the risk labels stay off.
 */
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
 * An inaccuracy that gave up floor against the safe line, from a not-yet-lost position, can earn the paid-off credit as a gamble does, on
 * the immediate outcome. It sits between the mistake band, which books its risk, and the gamble's bound of a mistake-sized floor (a Close
 * Combat into the Weavile switch paid 0.448 over the safe Mandibuzz line and read as a plain shift).
 */
function isInaccuracyRisk(params: AnalyzeTurnParams, key: Side, side: SideAnalysis): boolean {
  const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
  return side.tier === 'inaccuracy' && side.played !== null && side.safe !== null
    && side.played.choice !== side.safe.choice
    && side.played.worstCase < side.safe.worstCase
    && ownBefore > -DECIDED_SCORE
    && params.playedOutcome !== null;
}

/**
 * Books the windowed payoff over the safe guarantee on the side record: the BEST expected outcome within the window (tiered turns look
 * PAYOFF_WINDOW turns ahead, gambles at the immediate outcome only, since the window would credit the opponent's follow-up choices and
 * the rolls to the gamble). True when the read clearly FAILED, which keeps every risk label off.
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
  if (payoff >= RISK_PAYOFF_MARGIN - RISK_PAYOFF_EPSILON && readBeatSafeLine(params, key, side)) side.riskPaidOff = true;
  return false;
}

/**
 * A payoff over the safe line's floor is a read only when the played line also beat the safe line in the cell of the reply that came
 * (the same matrix, the same column). The cells go on the side as `safeAgainstClick`. With no cell to compare (no matrix, a hidden slot
 * of the click, the played line is the safe line) the payoff alone decides.
 */
function readBeatSafeLine(params: AnalyzeTurnParams, key: Side, side: SideAnalysis): boolean {
  if (!side.played || !side.safe || side.played.choice === side.safe.choice) return true;
  const cells = clickedCells(params, key, [side.played.choice, side.safe.choice]);
  if (!cells) return true;
  const [playedValue, safeValue] = cells.values;
  side.safeAgainstClick = { against: cells.against, playedValue, safeValue };
  return beatsSafeCell(playedValue, safeValue);
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
 * The read credit of an UNTIERED turn, the narrowest rule that carries its scene: not from a lost position, a choice the equilibrium gave
 * no weight, some floor given up against the safe line, an immediate payoff over the safe guarantee of at least the regret plus the read
 * margin, and within the window a mistake-sized edge on top of the regret. Card sentence only.
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

/** The opponent model's best response matches the played choice: the choice id is authoritative; the label match serves cached reads without one. */
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
  const gamble = isGamble(params, key, side, tiered) || isInaccuracyRisk(params, key, side);
  if (!tiered && !gamble) {
    // No band and no gamble: a quiet read can still earn its sentence.
    markQuietRead(params, key, side);
    return;
  }
  if (!side.played?.punishedBy || !opponent.played) return;
  if (opponent.played.label === side.played.punishedBy) return;
  if (bookRiskPayoff(params, key, side, tiered)) return;
  // Gambles stop here: paid-off credit or nothing.
  if (!tiered) return;
  side.riskUnpunished = true;
  // The opponent model agrees: this "risk" was the exploitative best response to how the opponent plays, so it reads as a read.
  if (readMatches(params.reads?.[key], side.played)) side.riskWasRead = true;
}

const badTier = (side: SideAnalysis): boolean => side.tier === 'mistake' || side.tier === 'blunder';

/** Who owns the swing when a verdict or a paid-off read stands (an inaccuracy, a softened verdict and a paid-off read are no decision problem); null when nothing crossed a blame threshold. */
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

/**
 * The residual names the turn only when it is the larger part of the swing. The decision part (the played pair against the position
 * before) can be several times the residual (-1.34 against -0.42, a Wide Guard the played pair walked into), and a card that blames the
 * residual then never names the turn's cause. A tie goes to the swing's own reading; a turn without a decision part keeps the residual alone.
 */
const chanceLeads = (chanceDelta: number, decisionDelta: number | null | undefined): boolean =>
  decisionDelta === null || decisionDelta === undefined || Math.abs(chanceDelta) > Math.abs(decisionDelta);

/** The movement itself: a roll, a shift or an unclear turn, or quiet. */
function movementAttribution(
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
  decisionDelta: number | null | undefined,
): TurnAttribution {
  if (chanceDelta !== null && Math.abs(chanceDelta) >= CHANCE_THRESHOLD && chanceLeads(chanceDelta, decisionDelta)) return 'chance';
  if (swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD) {
    // The score clearly moved but nothing crossed a blame threshold: a side's choice never surfaced (unclear), or pressure and rolls
    // added up (shift); never "quiet".
    return p1.played === null || p2.played === null ? 'unclear' : 'shift';
  }
  return 'quiet';
}

/** The turn's attribution: culprits before movement. */
export function attributionFor(
  playedTracking: boolean,
  p1: SideAnalysis,
  p2: SideAnalysis,
  swing: number | null,
  chanceDelta: number | null,
  decisionDelta: number | null = null,
): TurnAttribution {
  if (!playedTracking) {
    // Without played actions only the movement itself can be described.
    return swing !== null && Math.abs(swing) >= CHANCE_THRESHOLD ? 'shift' : 'quiet';
  }
  return culpritAttribution(p1, p2) ?? movementAttribution(p1, p2, swing, chanceDelta, decisionDelta);
}

/**
 * The side walked into its played line's punisher: the opponent's actual click is the reply the played line's floor was priced on, and
 * that floor trails the best line's floor by at least a mistake band. The equilibrium may give the reply no weight (regret 0.0005, no
 * tier, the opponent clicked Pollen Puff with Wide Guard), so no grade says it; the card does. Display only.
 */
export function walkedInto(side: SideAnalysis, opponent: SideAnalysis): boolean {
  const { played, best } = side;
  return !!played && !!best && !!opponent.played && played.punishedBy !== null && punisherClicked(side, opponent)
    && best.worstCase - played.worstCase >= TIER_THRESHOLDS.mistake;
}

/**
 * The click is the played line's punisher, or ties it: a fresh search can name a sibling of the click as the punisher ("Pollen Puff→Rillaboom
 * + Wide Guard" for "Pollen Puff→Zamazenta-Crowned + Wide Guard"), and the floor does not tell them apart when the played line's value
 * against the click lies within one inaccuracy of that floor.
 */
function punisherClicked(side: SideAnalysis, opponent: SideAnalysis): boolean {
  const { played, hindsightRead } = side;
  if (!played || !opponent.played) return false;
  if (played.punishedBy === opponent.played.label) return true;
  return hindsightRead?.playedValue !== undefined && hindsightRead.against === opponent.played.label &&
    hindsightRead.playedValue - played.worstCase < TIER_THRESHOLDS.inaccuracy;
}

/** The side's own estimate fell across the turn by at least the edge a read must win (RISK_PAYOFF_MARGIN); its read is then not praised. */
export function lostGround(analysis: Pick<TurnAnalysis, 'swing'>, side: Side): boolean {
  const swing = analysis.swing ?? null;
  if (swing === null) return false;
  return (side === 'p1' ? swing : -swing) <= -RISK_PAYOFF_MARGIN;
}

/** The attribution as the card and the badges show it: a read whose side lost ground no longer claims the turn (the field stays). */
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
