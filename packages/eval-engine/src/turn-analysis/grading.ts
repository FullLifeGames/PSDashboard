import { dexOf } from '@fulllifegames/replay-core';
import type { RankedChoice, StrandProbe } from '../types.ts';
import type { PlayedAction, SackInfo } from '../played.ts';
import {
  DECIDED_SCORE, REGRET_THRESHOLD, RISK_PAYOFF_MARGIN, demoteTier, tierOf,
  TIER_THRESHOLDS, type AnalyzeTurnParams, type SensitivityProbe, type Side, type SideAnalysis, type VerdictTier,
} from './types.ts';
import { matchPlayedChoice, matchPlayedSlots, phantomStayIn, setupMoveClicked } from './played-match.ts';
import { rulesOfActives } from './rules.ts';
import { strandDice } from './strand-die.ts';
import { turnRolledFor } from './luck.ts';
import { praisedSack, sackGate, type SackGate, type SackGrade } from './sack-gates.ts';

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
      const phantom = phantomStayIn(params.result, key, params.played, rulesOfActives(params.actives));
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

/** The verdict before sensitivity: a tiered side through the sack leniency, an untiered one through the praise forms. */
function sideVerdict(
  params: AnalyzeTurnParams,
  key: Side,
  g: SackGrade,
): SackVerdict {
  const tier = baseTier(g.regret, key, params.scoreBefore);
  if (tier) return sackVerdict(tier, g.regret, sackGate(params, key, g.sack, g.played, g.safe));
  const praised = praisedSack(params, key, g);
  return { sacrificed: praised, feedVerified: praised, tier: undefined };
}

const TIER_RANK: Record<VerdictTier | 'none', number> = { none: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

/** The strand the record owes its softer regret most: the largest chance times the move toward the played row, else the largest move. */
function leadingStrand(record: StrandProbe): StrandProbe['strands'][number] {
  const help = (strand: StrandProbe['strands'][number]) => (strand.role === 'P' ? 1 : -1) * (strand.searched - strand.before);
  const weigh = (strand: StrandProbe['strands'][number]) => strand.chance * help(strand);
  const helping = record.strands.filter(strand => help(strand) > 0);
  const pool = helping.length > 0 ? helping : record.strands;
  return pool.reduce((a, b) => (Math.abs(weigh(b)) > Math.abs(weigh(a)) ? b : a));
}

/**
 * Round 89 (T322, #59), block 2: the strand acquittal. The strand round (search/strand-run.ts) searched the shallow-priced
 * classes the grade hangs on and wrote the side's regret after them. The record belongs to the grade only when it names the
 * grade's own played and best choices. The regret it gives goes through the same verdict as the plain one (decided position,
 * sack leniency, `sideVerdict`), and the softer tier wins: a deeper read never adds blame. The score, the ranking and the
 * regret field stay as the engine read them.
 */
function strandAcquittal(
  params: AnalyzeTurnParams,
  key: Side,
  g: SackGrade,
  verdict: SackVerdict,
): { verdict: SackVerdict; strand: SideAnalysis['strand'] } {
  const record = params.result.strands?.[key];
  if (!record || !verdict.tier || !g.played || record.played !== g.played.choice || record.best !== params.result.perSide[key][0]?.choice) {
    return { verdict, strand: undefined };
  }
  const probed = sideVerdict(params, key, { ...g, regret: record.regret });
  if (TIER_RANK[probed.tier ?? 'none'] >= TIER_RANK[verdict.tier]) return { verdict, strand: undefined };
  const lead = leadingStrand(record);
  const rules = rulesOfActives(params.actives);
  const dice = rules ? strandDice(dexOf(rules), lead.classKey, { side: key, ownChoice: lead.role === 'P' ? record.played : record.best, column: lead.column }) : undefined;
  return {
    verdict: probed,
    strand: {
      role: lead.role, classKey: lead.classKey, chance: lead.chance, column: lead.column, tier: probed.tier ?? 'none', from: verdict.tier,
      ...(dice ? { dice } : {}),
    },
  };
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
    const probed = probes.map(probe => ({
      probe,
      tier: tierOf(Math.max(0, probe.bestEv - probe.playedEv)) ?? 'none' as const,
    }));
    const charitable = probed.reduce((a, b) => (TIER_RANK[b.tier] < TIER_RANK[a.tier] ? b : a));
    if (TIER_RANK[charitable.tier] < TIER_RANK[tier]) {
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
  /** Block 2 of T322: the strand that softened the verdict (absent = the record changed nothing). */
  strand: SideAnalysis['strand'];
}

/**
 * Round 79: the turn's dice for the sack gates, read before the side records exist: both sides' matched played lines go to
 * the one rule that builds `rolledFor` (luck.ts). Only a side with a sack asks.
 */
function rolledForTurn(params: AnalyzeTurnParams, key: Side, played: RankedChoice | null): { p1: boolean; p2: boolean } | undefined {
  if (!params.sacks?.[key]) return undefined;
  const foe: Side = key === 'p1' ? 'p2' : 'p1';
  const foePlayed = matchPlayedForSide(params, foe, foe === 'p1' ? params.played?.p1Slots : params.played?.p2Slots, params.played?.[foe] ?? null).played;
  const own = { played };
  const other = { played: foePlayed };
  return turnRolledFor(params, key === 'p1' ? own : other, key === 'p1' ? other : own);
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
  const graded: SackGrade = { sack, played, safe, regret, neverActed, rolledFor: rolledForTurn(params, key, played) };
  const stranded = strandAcquittal(params, key, graded, sideVerdict(params, key, graded));
  const acquittal = sensitivityAcquittal(stranded.verdict.tier, params.sensitivity?.[key]);
  return {
    playedRaw, playedSlots, played, playedPartial, neverActed, options, best, safe, regret, verifiedAtDepth,
    tier: acquittal.tier, sack, sacrificed: stranded.verdict.sacrificed, feedVerified: stranded.verdict.feedVerified,
    sensitivity: acquittal.sensitivity, strand: stranded.strand,
  };
}

/** The setup move the side clicked, by the replay's own Dex (round 75, T160); none without the board context. */
function setupField(params: AnalyzeTurnParams, g: SideGrading): { setupMove?: string } {
  const rules = rulesOfActives(params.actives);
  const setup = rules ? setupMoveClicked({ playedRaw: g.playedRaw, playedSlots: g.playedSlots }, dexOf(rules)) : null;
  return setup ? { setupMove: setup } : {};
}

/** The grading half of the side record, keys in the report's order. */
export function gradingFields(params: AnalyzeTurnParams, key: Side, g: SideGrading): SideAnalysis {
  return {
    playedRaw: g.playedRaw,
    ...setupField(params, g),
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
    ...(g.strand ? { strand: g.strand } : {}),
  };
}
