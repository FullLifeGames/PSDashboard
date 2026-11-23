import { dexOf } from '@fulllifegames/replay-core';
import type { RankedChoice } from '../types.ts';
import type { SackInfo } from '../played.ts';
import {
  DECIDED_SCORE, FEED_FLOOR_EPSILON, HEALTHY_SACK_FLOOR, PAYOFF_WINDOW, RISK_PAYOFF_MARGIN,
  type AnalyzeTurnParams, type Side,
} from './types.ts';
import { rulesOfActives } from './rules.ts';

/** The sack gates of one side's grading: whether a fallen body was fed on purpose, and the windowed payoff behind it; pure. */

/** The best own-perspective outcome over a floor inside a chain, and the chain index where it peaked. */
export interface WindowPayoff {
  payoff: number | null;
  /** Index of the first peak (0 = the turn itself). */
  payoffTurn: number;
}

/** The best expected outcome within the window over a guarantee (null entries skipped); a setup turn's value arrives on later turns. */
export function bestWindowPayoff(chain: (number | null | undefined)[], key: Side, floor: number): WindowPayoff {
  let payoff: number | null = null;
  let payoffTurn = 0;
  chain.forEach((outcome, index) => {
    if (outcome === null || outcome === undefined) return;
    const own = key === 'p1' ? outcome : -outcome;
    const value = own - floor;
    if (payoff === null || value > payoff) {
      payoff = value;
      payoffTurn = index;
    }
  });
  return { payoff, payoffTurn };
}

/**
 * A stayed feed's windowed payoff over the safe guarantee, only when the realized outcome landed on the played line's priced floor
 * (the player accepted the known worst case and got it: the turn's own rolls added nothing). Null when that fails or no safe line exists.
 */
function stayedFeedPayoff(
  params: AnalyzeTurnParams,
  key: Side,
  played: RankedChoice | null,
  safe: RankedChoice | null,
): number | null {
  const ownOutcome = params.playedOutcome === null ? null
    : key === 'p1' ? params.playedOutcome : -params.playedOutcome;
  const atFloor = played !== null && ownOutcome !== null &&
    ownOutcome - played.worstCase <= FEED_FLOOR_EPSILON;
  if (!(atFloor && safe && params.playedOutcome !== null)) return null;
  const chain = [params.playedOutcome, ...(params.futureOutcomes ?? [])]
    .slice(0, PAYOFF_WINDOW + 1);
  return bestWindowPayoff(chain, key, safe.worstCase).payoff;
}

/**
 * The body's own action failed by dice while its move carried a knock-out: a hit would have kept it alive, so nobody fed it.
 * Without knock-out odds on the played line the feed reading stands. A doubles option's odds carry a label and may be the
 * partner slot's: they count as none until the odds name their attacker.
 */
function deniedByDice(sack: SackInfo, played: RankedChoice | null): boolean {
  const odds = played?.koOdds;
  return sack.rolled !== undefined && !!odds && !odds.label && odds.killFraction > 0;
}

/** What the sack gates decided: whether the leniency applies and, for a stayed feed, its windowed payoff. */
export interface SackGate {
  sackApplies: boolean;
  feedPayoff: number | null;
}

/**
 * Shape gates: low-HP applies unconditionally; healthy only while decisively ahead on both sides of the sack (trading surplus
 * material for certainty; both gates read engine scores, and no after-score means no excuse, so game ends and gap turns fail
 * closed); a stayed feed only when the realized outcome landed on the played line's priced floor AND the windowed payoff over the
 * safe guarantee clears the read margin. A body that dice denied (deniedByDice) gets no shape. Every own faint of the turn passes
 * its own gate, so a plain loss (no shape) or a body behind a stricter gate that fails blocks the leniency (a low-HP feed is
 * cheap, a partner lost next to it is not).
 */
export function sackGate(
  params: AnalyzeTurnParams,
  key: Side,
  sack: SackInfo | undefined,
  played: RankedChoice | null,
  safe: RankedChoice | null,
): SackGate {
  if (!sack) return { sackApplies: false, feedPayoff: null };
  const gates = turnFaints(sack).map(shape => (shape && !deniedByDice(shape, played) ? shapeGate(params, key, shape, played, safe) : null));
  if (gates.some(gate => gate === null || !gate.sackApplies)) return { sackApplies: false, feedPayoff: null };
  return { sackApplies: true, feedPayoff: gates.find(gate => gate!.feedPayoff !== null)?.feedPayoff ?? null };
}

/** Every own faint of the turn, the side's sack first; null = a plain loss with no sack shape. */
const turnFaints = (sack: SackInfo): (SackInfo | null)[] => [sack, ...(sack.others ?? [])];

/** One fallen body's shape gate, with a stayed feed's windowed payoff. */
function shapeGate(
  params: AnalyzeTurnParams,
  key: Side,
  shape: SackInfo,
  played: RankedChoice | null,
  safe: RankedChoice | null,
): SackGate {
  if (shape.stayed) {
    const payoff = stayedFeedPayoff(params, key, played, safe);
    const sackApplies = payoff !== null && payoff >= RISK_PAYOFF_MARGIN;
    return { sackApplies, feedPayoff: sackApplies ? payoff : null };
  }
  if (shape.healthy) {
    const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
    const ownAfter = params.scoreAfter === null ? null : (key === 'p1' ? params.scoreAfter : -params.scoreAfter);
    return { sackApplies: ownBefore >= HEALTHY_SACK_FLOOR && ownAfter !== null && ownAfter >= HEALTHY_SACK_FLOOR, feedPayoff: null };
  }
  return { sackApplies: true, feedPayoff: null };
}

/**
 * A hazard sack's windowed payoff over the safe guarantee, only when no roll of the turn went the side's way (`rolledFor`,
 * turn-analysis/luck.ts). The switch-in's death already sits in the pair's cell (the attack aimed at it hits nothing), so the
 * floor gate of a stayed feed cannot apply. The pair is priced by the root's own cell, so the gap to the next root is the
 * difference of two searches, no die: the after score over the pair's value cannot read luck (+0.138 on a turn with nothing
 * random). Without the turn's rolls the score test stays: own after-score at most FEED_FLOOR_EPSILON over the pair's value.
 * Null when the gate fails.
 */
function hazardSackPayoff(
  params: AnalyzeTurnParams,
  key: Side,
  safe: RankedChoice | null,
  rolledFor: { p1: boolean; p2: boolean } | undefined,
): number | null {
  if (params.playedOutcome === null || params.scoreAfter === null || !safe) return null;
  if (rolledFor) {
    if (rolledFor[key]) return null;
  } else {
    const luckAfter = key === 'p1' ? params.scoreAfter - params.playedOutcome : params.playedOutcome - params.scoreAfter;
    if (luckAfter > FEED_FLOOR_EPSILON) return null;
  }
  const chain = [params.playedOutcome, ...(params.futureOutcomes ?? [])].slice(0, PAYOFF_WINDOW + 1);
  return bestWindowPayoff(chain, key, safe.worstCase).payoff;
}

/**
 * The fed body is the one the opponent's near-decided click removes: the opponent's way into its sweep, so letting it fall is no
 * win-condition sacrifice (Medicham-Mega one sure KO from clearing the rest by removing Lopunny-Mega, the body that was fed).
 * Formes of one species are one body (Lopunny and Lopunny-Mega), read from the Dex.
 */
function feedsOpposingSweep(params: AnalyzeTurnParams, key: Side, sack: SackInfo): boolean {
  const near = params.result.unanswered?.nearDecided;
  if (!near || near.side === key || !sack.species) return false;
  const rules = rulesOfActives(params.actives);
  const base = (species: string) => (rules ? dexOf(rules).species.get(species).baseSpecies : '') || species;
  return base(near.removes) === base(sack.species);
}

/** What the sack verdict reads of one side's grading; `rolledFor` is the turn's dice (undefined without them). */
export interface SackGrade {
  sack: SackInfo | undefined;
  played: RankedChoice | null;
  safe: RankedChoice | null;
  regret: number | null;
  neverActed: boolean;
  rolledFor: { p1: boolean; p2: boolean } | undefined;
}

/**
 * Praise without a band: an UNTIERED side earns the sacrifice stamp only as a stayed feed through the priced-floor gate or a
 * hazard sack through the luck gate, and only when the window repaid the regret with the read margin on top. Low-HP and healthy
 * faints stay leniencies for tiered turns; a phantom stay-in has no choice to praise, and an already-lost position earns no praise
 * (the gamble credit's bound). Every own faint of the turn must earn it.
 */
export function praisedSack(
  params: AnalyzeTurnParams,
  key: Side,
  g: SackGrade,
): boolean {
  if (!g.sack || g.regret === null || g.neverActed) return false;
  if ((key === 'p1' ? params.scoreBefore : -params.scoreBefore) <= -DECIDED_SCORE) return false;
  return turnFaints(g.sack).every(shape => praisedFaint(params, key, shape, g, g.regret!));
}

/** One fallen body's praise form: a stayed feed through the floor gate or a hazard sack, repaying the regret with the margin. */
function praisedFaint(
  params: AnalyzeTurnParams,
  key: Side,
  shape: SackInfo | null,
  g: Pick<SackGrade, 'played' | 'safe' | 'rolledFor'>,
  regret: number,
): boolean {
  const { played, safe } = g;
  if (!shape || deniedByDice(shape, played) || feedsOpposingSweep(params, key, shape)) return false;
  const payoff = shape.stayed ? stayedFeedPayoff(params, key, played, safe)
    : shape.hazard ? hazardSackPayoff(params, key, safe, g.rolledFor) : null;
  return payoff !== null && payoff >= regret + RISK_PAYOFF_MARGIN;
}

