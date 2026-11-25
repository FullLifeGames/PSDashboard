import { dexOf } from '@fulllifegames/replay-core';
import type { RankedChoice } from '../types.ts';
import type { SackInfo } from '../played.ts';
import {
  DECIDED_SCORE, FEED_FLOOR_EPSILON, HEALTHY_SACK_FLOOR, PAYOFF_WINDOW, RISK_PAYOFF_MARGIN,
  type AnalyzeTurnParams, type Side,
} from './types.ts';
import { rulesOfActives } from './rules.ts';

export interface WindowPayoff {
  payoff: number | null;
  /** Index of the first peak (0 = the turn itself). */
  payoffTurn: number;
}

/** The best expected outcome in the window over a guarantee (null entries skipped); a setup turn pays later. */
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

// Only when the realized outcome landed on the played line's priced floor (the worst case was accepted and came).
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

// The body's action failed by dice while its move carried a knock-out: a hit would have kept it alive.
// A doubles option's odds may be the partner slot's: they count as none until the odds name their attacker.
function deniedByDice(sack: SackInfo, played: RankedChoice | null): boolean {
  const odds = played?.koOdds;
  return sack.rolled !== undefined && !!odds && !odds.label && odds.killFraction > 0;
}

export interface SackGate {
  sackApplies: boolean;
  feedPayoff: number | null;
}

/** The sack gate of a side: every own faint of the turn must pass its own gate; no after-score fails closed. */
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

// null = a plain loss with no sack shape.
const turnFaints = (sack: SackInfo): (SackInfo | null)[] => [sack, ...(sack.others ?? [])];

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

// Only when no roll went the side's way (`rolledFor`, luck.ts): the switch-in's death already sits in the pair's cell,
// so the gap to the next root is two searches, no die. Without the rolls the score test stays (FEED_FLOOR_EPSILON).
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

// The opponent's near-decided click removes the fed body: its way into the sweep, so letting it fall is no sacrifice.
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

/** Praise for an untiered side: a stayed feed past the floor gate or a hazard sack repaying the regret plus margin. */
export function praisedSack(
  params: AnalyzeTurnParams,
  key: Side,
  g: SackGrade,
): boolean {
  if (!g.sack || g.regret === null || g.neverActed) return false;
  if ((key === 'p1' ? params.scoreBefore : -params.scoreBefore) <= -DECIDED_SCORE) return false;
  return turnFaints(g.sack).every(shape => praisedFaint(params, key, shape, g, g.regret!));
}

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

