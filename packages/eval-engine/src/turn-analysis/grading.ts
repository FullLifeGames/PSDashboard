import type { RankedChoice } from '../types.ts';
import type { PlayedAction, SackInfo } from '../played.ts';
import {
  DECIDED_SCORE, FEED_FLOOR_EPSILON, HEALTHY_SACK_FLOOR, PAYOFF_WINDOW, REGRET_THRESHOLD, RISK_PAYOFF_MARGIN,
  TIER_THRESHOLDS, type AnalyzeTurnParams, type SensitivityProbe, type Side, type SideAnalysis, type VerdictTier,
} from './types.ts';
import { matchPlayedChoice, matchPlayedSlots, phantomStayIn } from './played-match.ts';

/**
 * The grading half of one side's turn, stage by stage in analyzeTurn's
 * original order: the played match, the verified regret, the verdict band
 * with its leniencies (decided position, sack, item sensitivity). Every
 * stage is pure and reads analyzeTurn's params; the narrative signals live
 * in signals.ts and never touch the grading.
 */

/** The played action matched into the ranked list, with the doubles and phantom flags. */
interface PlayedMatch {
  played: RankedChoice | null;
  /** A slot's choice stayed hidden: `played` is the charitable consistent combo. */
  playedPartial: boolean;
  /** The side was KO'd before it acted: `played` is the stay-in phantom. */
  neverActed: boolean;
}

/** Doubles per slot (charitable on hidden slots), singles by choice id, then the stay-in phantom. */
function matchPlayedForSide(
  params: AnalyzeTurnParams,
  key: Side,
  playedSlots: (PlayedAction | null)[] | undefined,
  playedRaw: PlayedAction | null,
): PlayedMatch {
  let played: RankedChoice | null = null;
  let playedPartial = false;
  let neverActed = false;
  if (playedSlots) {
    const match = matchPlayedSlots(params.result.perSide[key], playedSlots);
    played = match.played;
    playedPartial = match.partial;
  } else if (params.played) {
    played = matchPlayedChoice(params.result, key, playedRaw);
    if (!played) {
      const phantom = phantomStayIn(params.result, key, params.played);
      if (phantom) {
        played = phantom;
        neverActed = true;
      }
    }
  }
  return { played, playedPartial, neverActed };
}

/**
 * best.ev − played.ev (own perspective), floored at 0. Verification can
 * only ACQUIT: a deep pass that confirms the gap keeps the shallow
 * equilibrium regret (the deep pair values are an exploitative lens, not a
 * fairer grade when they agree).
 */
function verifiedRegret(
  params: AnalyzeTurnParams,
  key: Side,
  played: RankedChoice | null,
  best: RankedChoice | null,
): { regret: number | null; verifiedAtDepth: boolean } {
  let regret = played && best ? Math.max(0, best.ev - played.ev) : null;
  let verifiedAtDepth = false;
  const verifiedSide = params.verified?.[key];
  if (verifiedSide && regret !== null && regret >= REGRET_THRESHOLD) {
    const sign = key === 'p1' ? 1 : -1;
    const deepRegret = Math.max(0, sign * (verifiedSide.bestDeep - verifiedSide.playedDeep));
    if (deepRegret < REGRET_THRESHOLD) {
      regret = deepRegret;
      verifiedAtDepth = true;
    }
  }
  return { regret, verifiedAtDepth };
}

const demoteTier = (current: VerdictTier | undefined): VerdictTier | undefined =>
  current === 'blunder' ? 'mistake' : current === 'mistake' ? 'inaccuracy' : undefined;

const tierOf = (regretValue: number): VerdictTier | undefined =>
  regretValue >= TIER_THRESHOLDS.blunder ? 'blunder'
    : regretValue >= TIER_THRESHOLDS.mistake ? 'mistake'
      : regretValue >= TIER_THRESHOLDS.inaccuracy ? 'inaccuracy' : undefined;

/** The regret's band, softened one tier in a decided position (own perspective). */
function baseTier(regret: number | null, key: Side, scoreBefore: number): VerdictTier | undefined {
  let tier: VerdictTier | undefined;
  if (regret !== null) {
    tier = tierOf(regret);
    const own = key === 'p1' ? scoreBefore : -scoreBefore;
    if (tier && Math.abs(own) >= DECIDED_SCORE) tier = demoteTier(tier);
  }
  return tier;
}

/** The best own-perspective outcome over a floor inside a chain, and the chain index where it peaked. */
export interface WindowPayoff {
  payoff: number | null;
  /** Index of the first peak (0 = the turn itself). */
  payoffTurn: number;
}

/**
 * The payoff loop both the stayed-feed gate and the risk booking run: the
 * BEST expected outcome within the window over a guarantee (null entries
 * skipped) — a setup turn's value arrives on the turns after it.
 */
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
 * A stayed feed's windowed payoff over the safe guarantee — only when the
 * realized outcome landed on the played line's priced floor (the player
 * accepted the known worst case and got it — the turn's own rolls
 * contributed nothing positive; 573756 t68). Null when the floor gate
 * fails or no safe line exists.
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

/** What the sack gates decided: whether the leniency applies and, for a stayed feed, its windowed payoff. */
interface SackGate {
  sackApplies: boolean;
  feedPayoff: number | null;
}

/**
 * Shape gates: low-HP applies unconditionally; healthy only while
 * decisively ahead on both sides of the sack (trading surplus material
 * for certainty, GPL T35 Salazzle — expectation-based, not results-based:
 * both gates read engine scores, and no after-score means no excuse, so
 * game ends and gap turns fail closed); a stayed feed only when the
 * realized outcome landed on the played line's priced floor AND the
 * windowed payoff over the safe guarantee clears the read margin (573756
 * t68). Fails closed.
 */
function sackGate(
  params: AnalyzeTurnParams,
  key: Side,
  sack: SackInfo | undefined,
  played: RankedChoice | null,
  safe: RankedChoice | null,
): SackGate {
  let sackApplies = false;
  let feedPayoff: number | null = null;
  if (sack) {
    if (sack.stayed) {
      const payoff = stayedFeedPayoff(params, key, played, safe);
      sackApplies = payoff !== null && payoff >= RISK_PAYOFF_MARGIN;
      if (sackApplies) feedPayoff = payoff;
    } else if (sack.healthy) {
      const ownBefore = key === 'p1' ? params.scoreBefore : -params.scoreBefore;
      const ownAfter = params.scoreAfter === null ? null : (key === 'p1' ? params.scoreAfter : -params.scoreAfter);
      sackApplies = ownBefore >= HEALTHY_SACK_FLOOR &&
        ownAfter !== null && ownAfter >= HEALTHY_SACK_FLOOR;
    } else {
      sackApplies = true;
    }
  }
  return { sackApplies, feedPayoff };
}

/** The sack verdict on the tier: demoted one band, cleared for a verified feed, never excusing a blunder. */
interface SackVerdict {
  sacrificed: boolean;
  feedVerified: boolean;
  tier: VerdictTier | undefined;
}

/**
 * A sack of a nearly-dead body is a deliberate low-cost play: demote one
 * band (same shape as the decided-position leniency) and mark it so the
 * risk machinery and the report treat it neutrally. BOUNDED: a
 * blunder-sized regret is a throw whatever the body was worth — the sack
 * leniency never forgives the blunder band. A stayed feed VERIFIES when
 * its windowed payoff repaid the FULL regret with the read margin on top:
 * the line reached what the engine's best promised, measured from the
 * accepted floor upward (573756 t68 post-race: payoff 0.359 ≥ regret
 * 0.129 + 0.1), and no verdict band sticks.
 */
function sackVerdict(tier: VerdictTier | undefined, regret: number | null, gate: SackGate): SackVerdict {
  const sacrificed = !!(tier && gate.sackApplies && (regret ?? 0) < TIER_THRESHOLDS.blunder);
  const feedVerified = sacrificed && gate.feedPayoff !== null && regret !== null &&
    gate.feedPayoff >= regret + RISK_PAYOFF_MARGIN;
  return { sacrificed, feedVerified, tier: sacrificed ? (feedVerified ? undefined : demoteTier(tier)) : tier };
}

/**
 * Item-sensitivity: if the verdict changes band under a usage-plausible
 * alternative item for an opposing mon whose item is only a guess, the
 * verdict HINGES on hidden information — soften to the most charitable
 * probed band (acquit-only) and record the hinge.
 */
function sensitivityAcquittal(
  tier: VerdictTier | undefined,
  probes: SensitivityProbe[] | undefined,
): { tier: VerdictTier | undefined; sensitivity: SideAnalysis['sensitivity'] } {
  let softened = tier;
  let sensitivity: SideAnalysis['sensitivity'];
  if (tier && probes && probes.length > 0) {
    const rank: Record<VerdictTier | 'none', number> = { none: 0, inaccuracy: 1, mistake: 2, blunder: 3 };
    const probed = probes.map(probe => ({
      probe,
      tier: tierOf(Math.max(0, probe.bestEv - probe.playedEv)) ?? 'none' as const,
    }));
    const charitable = probed.reduce((a, b) => (rank[b.tier] < rank[a.tier] ? b : a));
    if (rank[charitable.tier] < rank[tier]) {
      sensitivity = {
        species: charitable.probe.species,
        alternatives: probed
          .filter(entry => entry.probe.species === charitable.probe.species)
          .map(entry => ({ item: entry.probe.item, tier: entry.tier })),
      };
      softened = charitable.tier === 'none' ? undefined : charitable.tier;
    }
  }
  return { tier: softened, sensitivity };
}

/** Everything the grading stages produced for one side, in the order they ran. */
export interface SideGrading {
  playedRaw: PlayedAction | null;
  playedSlots: (PlayedAction | null)[] | undefined;
  played: RankedChoice | null;
  playedPartial: boolean;
  neverActed: boolean;
  options: RankedChoice[];
  /** The top choice by equilibrium EV — the grading reference. */
  best: RankedChoice | null;
  /** The max-floor choice — the engine's safe line, the safety reference. */
  safe: RankedChoice | null;
  regret: number | null;
  verifiedAtDepth: boolean;
  /** The verdict band after every leniency (absent = clean play). */
  tier: VerdictTier | undefined;
  sack: SackInfo | undefined;
  sacrificed: boolean;
  feedVerified: boolean;
  sensitivity: SideAnalysis['sensitivity'];
}

/** Runs the grading stages for one side: match, references, regret, band, sack, sensitivity. */
export function gradeSide(params: AnalyzeTurnParams, key: Side): SideGrading {
  const playedRaw = params.played?.[key] ?? null;
  const playedSlots = key === 'p1' ? params.played?.p1Slots : params.played?.p2Slots;
  const { played, playedPartial, neverActed } = matchPlayedForSide(params, key, playedSlots, playedRaw);
  const options = params.result.perSide[key];
  const best = options[0] ?? null;
  const safe = options.length > 0
    ? options.reduce((a, b) => (b.worstCase > a.worstCase ? b : a))
    : null;
  const { regret, verifiedAtDepth } = verifiedRegret(params, key, played, best);
  const sack = params.sacks?.[key];
  const verdict = sackVerdict(baseTier(regret, key, params.scoreBefore), regret, sackGate(params, key, sack, played, safe));
  const acquittal = sensitivityAcquittal(verdict.tier, params.sensitivity?.[key]);
  return {
    playedRaw, playedSlots, played, playedPartial, neverActed, options, best, safe, regret, verifiedAtDepth,
    tier: acquittal.tier, sack, sacrificed: verdict.sacrificed, feedVerified: verdict.feedVerified,
    sensitivity: acquittal.sensitivity,
  };
}

/** The grading half of the side record, keys in the report's order. */
export function gradingFields(params: AnalyzeTurnParams, key: Side, g: SideGrading): SideAnalysis {
  return {
    playedRaw: g.playedRaw,
    ...(params.played?.prevented?.[key] ? { prevented: params.played.prevented[key] } : {}),
    ...(g.playedSlots ? { playedSlots: g.playedSlots } : {}),
    ...(g.neverActed ? { neverActed: g.neverActed } : {}),
    played: g.played,
    best: g.best,
    safe: g.safe,
    regret: g.regret,
    choiceCount: g.options.length,
    ...(g.playedPartial ? { playedPartial: g.playedPartial } : {}),
    ...(g.verifiedAtDepth ? { verifiedAtDepth: g.verifiedAtDepth } : {}),
    ...(g.tier ? { tier: g.tier } : {}),
    ...(g.sacrificed && g.sack ? { sacrifice: g.feedVerified ? { ...g.sack, verified: true } : g.sack } : {}),
    ...(g.sensitivity ? { sensitivity: g.sensitivity } : {}),
  };
}
