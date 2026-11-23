import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from './types.ts';
import { capToBudget, evStep, evTotal, ZERO_EVS, type EvBudget } from './spreads/ev-budget.ts';
import { candidateLadder, type CandidateRung, type SpreadCandidate } from './spreads/ladder.ts';
import {
  buildSolveContext, hpBasisOf, keyOf, observationError, physicalAttackerFor, priorDistance, setOf, speedError, spreadFor,
  type SolveContext,
} from './spreads/fit.ts';
import { decideScarfs, type SpeedKnowledgeMap } from './spreads/scarf.ts';
import { defenderSideOf } from './spreads/observation-read.ts';
import { paradoxError } from './spreads/paradox.ts';
import { hpEvsForMaxHp, type ObservedMaxHp } from './spreads/max-hp.ts';
import { readableOrders, settledSets } from './spreads/order-limit.ts';
import { isBoostItem, requiresItem } from './spreads/boost-items.ts';
import { itemOffers } from './spreads/item-rung.ts';
import { dexOf, dexOfCalc, formatRules } from './rules-dex.ts';

export { evBudget, legalizeEvs } from './spreads/ev-budget.ts';
export type { SpreadCandidate } from './spreads/ladder.ts';
export type { SpeedKnowledge, SpeedKnowledgeMap } from './spreads/scarf.ts';

/** Damage-consistent spread inference: a ladder of standard spreads is scored with @smogon/calc against each Pokémon's observations; the best fit replaces guessed EVs only. */
// With sparse observations "the defender is bulkier" and "the attacker is weaker" fit the same damage line, so per-mon spreads are not
// ground truth; the result guarantees pair consistency: forked battles reproduce the damage the replay showed.

/**
 * Mean squared misfit per observation above which the evidence is unreliable and the prior stands (clean fits read up to 0.005;
 * contradictory video HP bars left every rung at 0.05 or more and the least-bad fit was an all-zero spread).
 */
const FIT_FORFEIT_PER_OBSERVATION = 0.01;

const MIN_OBSERVATIONS = 2;

/**
 * A move order measures Speed only when it refutes the prior and some rung repairs it. An order the prior already satisfies measures
 * nothing downward (five satisfied Garchomp orders once shaved its 252 Spe to 4), and an order no rung can reproduce (a Choice Scarf the
 * build does not carry) measures nothing at all.
 */
function speedMeasured(ctx: SolveContext, key: string, ladder: CandidateRung[], prior: SpreadCandidate): boolean {
  const priorViolation = provenError(ctx, key, prior);
  return priorViolation > 0 && ladder.some(rung => provenError(ctx, key, rung) < priorViolation);
}

/**
 * What the log proved of a body beyond the damage: its move orders and the stat a Protosynthesis or Quark Drive activation named; a
 * rung that repairs either measures the stat.
 */
const provenError = (ctx: SolveContext, key: string, candidate: SpreadCandidate) =>
  speedError(ctx, key, candidate) + paradoxError(ctx, key, candidate);

/** The HP EVs the log's maximum HP pins: a reading, not a fit, so it holds even when the damage evidence forfeits to the prior. */
function measuredHpEvs(ctx: SolveContext, key: string): number | undefined {
  const seen = ctx.maxHp.get(key);
  if (!seen) return undefined;
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const basis = hpBasisOf(ctx, side, species);
  if (!basis) return undefined;
  return hpEvsForMaxHp(basis.baseHp, seen.level, seen.maxhp, ctx.priors.get(key)?.evs.hp ?? 0, basis.iv, ctx.budget);
}

function priorWithFixedHp(prior: SpreadCandidate, hp: number, budget: EvBudget): PokemonEvs {
  return capToBudget({ ...ZERO_EVS, ...prior.evs, hp }, new Set(), budget, new Set(), new Set(['hp']));
}

/**
 * The set's item when it is a guessed boost item the damage lines may take away: no log line, sheet or edit showed it, the simulator
 * gives it a damage hook and the species does not need it.
 */
function guessedBoostItem(ctx: SolveContext, key: string): string | undefined {
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const set = setOf(ctx, side, species);
  if (!set?.item || (ctx.knowledge.get(key) ?? ctx.knowledge.get(keyOf(side, set.species)))?.itemKnown) return undefined;
  const dex = dexOfCalc(ctx.gen);
  return isBoostItem(dex, set.item) && !requiresItem(dex, set.species, set.item) ? set.item : undefined;
}

/**
 * The ladder rung with the least error; ties break toward the prior. With `withoutItem` every rung is also scored without the set's
 * item: the lower error wins, the prior's distance breaks a tie, and a tie of both keeps the item.
 */
function bestRung(
  ctx: SolveContext, key: string, ladder: CandidateRung[], monObservations: DamageObservation[], withoutItem = false,
): CandidateRung | null {
  let best: CandidateRung | null = null;
  let bestError = Infinity;
  for (const rung of withoutItem ? ladder.flatMap(entry => [entry, { ...entry, item: '' }]) : ladder) {
    const error = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) +
      provenError(ctx, key, rung);
    if (error < bestError - 1e-12 ||
      (best !== null && Math.abs(error - bestError) <= 1e-12 && priorDistance(ctx, key, rung) < priorDistance(ctx, key, best))) {
      bestError = error;
      best = rung;
    }
  }
  return best;
}

/**
 * When even the best rung misfits the damage evidence badly (video-read HP bars, attribution confounds), the evidence is unreliable:
 * the prior stands rather than a paper spread (an all-zero Vileplume). A solve that repairs speed-order violations of the prior always
 * stands. In the two-stage chain the prior is the speed-only pre-solve's build, which solveReplaySpreads hands back for a forfeited mon.
 */
function forfeitsToPrior(ctx: SolveContext, key: string, best: CandidateRung, prior: SpreadCandidate, monObservations: DamageObservation[]): boolean {
  const damageResidual = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, best), 0);
  return monObservations.length > 0 &&
    damageResidual / monObservations.length > FIT_FORFEIT_PER_OBSERVATION &&
    provenError(ctx, key, best) >= provenError(ctx, key, prior);
}

/**
 * The usage-listed boost item that explains a knockout no spread reaches: the game refutes the best rung (a lethal observation read by
 * the shown HP) under the guessed item, so each item of `itemOffers` (usage order) re-scores the ladder, and the first whose best rung
 * reaches every knockout with a lower total error wins; null when none does. Knockouts without the shown text never trigger it.
 */
function itemRung(
  ctx: SolveContext, key: string, ladder: CandidateRung[], best: CandidateRung, evidence: MonEvidence,
): CandidateRung | null {
  const knockouts = evidence.observations.filter(obs => obs.lethal && obs.defenderShown && keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const refuted = (rung: CandidateRung) => knockouts.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0);
  if (!evidence.attacked || !(refuted(best) > 0)) return null;
  const total = (rung: CandidateRung) => evidence.observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) + provenError(ctx, key, rung);
  const floor = total(best);
  for (const item of itemOffers(ctx, key, evidence.hasSpeedObs)) {
    const rung = bestRung(ctx, key, ladder.map(entry => ({ ...entry, item })), evidence.observations);
    if (rung && refuted(rung) === 0 && total(rung) < floor - 1e-12) return rung;
  }
  return null;
}

/** The best spread, or the item rung's answer for a knockout the best spread leaves refuted (it runs before the forfeit rule). */
function withItemRung(
  ctx: SolveContext, key: string, ladder: CandidateRung[], fitted: CandidateRung, droppable: boolean, evidence: MonEvidence,
): CandidateRung {
  return (!droppable && itemRung(ctx, key, ladder, fitted, evidence)) || fitted;
}

/** The item a solved rung carries out: a guessed boost item the lines refute, or one a knockout needs, rides out like a decided Scarf. */
function itemDecision(best: CandidateRung): Pick<SpreadCandidate, 'item' | 'itemReason'> {
  if (best.item === '') return { item: '', itemReason: 'no-boost' };
  return best.item ? { item: best.item, itemReason: 'boost' } : {};
}

/** The mon's damage misfit under a spread (the bestRung sum without the move-order term), plus the Paradox stat it must keep. */
const damageError = (ctx: SolveContext, key: string, rung: CandidateRung, observations: DamageObservation[]) =>
  observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) + paradoxError(ctx, key, rung);

/** The most EVs a measured stat takes, in the ladder's steps up to `room`, while the damage lines fit as well as at `rung`. */
function neutralRoom(
  ctx: SolveContext, key: string, rung: CandidateRung, stat: keyof PokemonEvs, room: number, observations: DamageObservation[],
): number {
  const fitted = damageError(ctx, key, rung, observations);
  const step = evStep(ctx.budget);
  const adds = [...new Set([...Array.from({ length: Math.floor(room / step) }, (_, i) => (i + 1) * step), room])];
  const fits = (add: number) =>
    damageError(ctx, key, { ...rung, evs: { ...rung.evs, [stat]: (rung.evs[stat] ?? 0) + add } }, observations) <= fitted + 1e-12;
  // Bisection: a stat's fit mostly leaves the rolls once and stays out; where it does not, the add it returns still fits.
  let low = 0;
  let high = adds.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (fits(adds[mid])) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? 0 : adds[low - 1];
}

/**
 * The fewest offense EVs, in the ladder's steps up to `room`, that reach every knockout the game refutes at `rung`, when that costs the
 * other lines nothing beyond the rung's own misfit; else 0 and the top-up measures from the rung. A top-up measured from the rung let a
 * clean line overshoot (Iron Valiant's Special Attack 180 where 32 to 56 reach the knockout and fit the hit on Moltres).
 */
function knockoutReach(
  ctx: SolveContext, key: string, rung: CandidateRung, offenseStat: keyof PokemonEvs, room: number, observations: DamageObservation[],
): number {
  const knockouts = observations.filter(obs => obs.lethal && obs.defenderShown && keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const at = (add: number): CandidateRung => ({ ...rung, evs: { ...rung.evs, [offenseStat]: (rung.evs[offenseStat] ?? 0) + add } });
  const short = (add: number) => knockouts.reduce((sum, obs) => sum + observationError(ctx, obs, key, at(add)), 0);
  if (room <= 0 || !(short(0) > 0)) return 0;
  const step = evStep(ctx.budget);
  const adds = [...new Set([...Array.from({ length: Math.floor(room / step) }, (_, i) => (i + 1) * step), room])];
  if (short(adds[adds.length - 1]) > 0) return 0;
  // A hit's best roll never falls as the offense rises, so the reach is monotone: the first add that reaches it.
  let low = 0;
  let high = adds.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (short(adds[mid]) === 0) high = mid;
    else low = mid + 1;
  }
  return damageError(ctx, key, at(adds[low]), observations) <= damageError(ctx, key, rung, observations) + 1e-12 ? adds[low] : 0;
}

/**
 * Tops up the leftover budget in the non-Speed stats, so a winner like "252 HP only" does not field an under-statted mon. An unmeasured
 * stat takes what fits; a measured stat takes the most EVs at which its damage lines fit as well as at the winning rung (the ladder knows
 * a stat only at 0 and 252). Each stat first refills toward the prior's EVs, then the order offense, HP, Def, SpD spends the rest (a Bold
 * Toxapex's open 4 EVs went to Attack where the prior runs them in SpD). The log's HP stays.
 */
function topUp(
  ctx: SolveContext, key: string, best: CandidateRung, prior: SpreadCandidate, offenseStat: keyof PokemonEvs,
  measured: Set<keyof PokemonEvs>, evidence: MonEvidence,
): PokemonEvs {
  const evs: PokemonEvs = { ...best.evs };
  let remaining = ctx.budget.total - evTotal(evs);
  const give = (stat: keyof PokemonEvs, room: number) => {
    if (room <= 0) return;
    const add = measured.has(stat) ? neutralRoom(ctx, key, { evs, nature: best.nature, item: best.item }, stat, room, evidence.observations) : room;
    evs[stat] = (evs[stat] ?? 0) + add;
    remaining -= add;
  };
  // A knockout the winning rung leaves refuted: the offense starts from the fewest EVs that reach it, and the plateau is measured from there.
  if (measured.has(offenseStat)) {
    const reach = knockoutReach(ctx, key, { evs, nature: best.nature, item: best.item }, offenseStat, Math.min(ctx.budget.perStat - (evs[offenseStat] ?? 0), remaining), evidence.observations);
    evs[offenseStat] = (evs[offenseStat] ?? 0) + reach;
    remaining -= reach;
  }
  const order = ([offenseStat, 'hp', 'def', 'spd', offenseStat === 'atk' ? 'spa' : 'atk'] as (keyof PokemonEvs)[])
    .filter(stat => stat !== 'hp' || evidence.fixedHp === undefined);
  for (const stat of order) give(stat, Math.min((prior.evs[stat] ?? 0) - (evs[stat] ?? 0), ctx.budget.perStat - (evs[stat] ?? 0), remaining));
  for (const stat of order.slice(0, -1)) give(stat, Math.min(ctx.budget.perStat - (evs[stat] ?? 0), remaining));
  return evs;
}

interface MonEvidence {
  observations: DamageObservation[];
  /** Clean (non-lethal) attacker lines exist: offense is measurable. */
  hasOffenseEvidence: boolean;
  /** The offense rungs are open: clean lines measure it, or a knockout the game refutes the prior's offense for (offenseRefuted). */
  offenseOpen: boolean;
  /** The mon attacked at all (knock-outs alone keep the prior's offense). */
  attacked: boolean;
  hasDefenderObs: boolean;
  hasSpeedObs: boolean;
  /** HP EVs the log's maximum HP pinned. */
  fixedHp: number | undefined;
  /** The prior contradicts the stat a Protosynthesis or Quark Drive activation named: a Speed rung may repair it. */
  paradoxBound: boolean;
}

/**
 * Whether the game refutes the prior's offense and a rung repairs it. A knockout is a lower bound and measures no ceiling, but one the
 * prior's best roll cannot reach, read by the HP the log displays (hp-display.ts), is refuted by the game: when an offense rung reaches
 * it with a lower error the offense rungs open, the same test `speedMeasured` asks of a move order. Knockouts without the text never open it.
 */
function offenseRefuted(ctx: SolveContext, key: string, prior: SpreadCandidate, evidence: Pick<MonEvidence, 'observations' | 'hasDefenderObs' | 'fixedHp'>): boolean {
  const lethal = evidence.observations.filter(obs => obs.lethal && obs.defenderShown && keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const refuted = lethal.reduce((sum, obs) => sum + observationError(ctx, obs, key, prior), 0);
  if (!(refuted > 0)) return false;
  const fixed: Partial<PokemonEvs> = evidence.fixedHp === undefined ? {} : { hp: evidence.fixedHp };
  const rungs = candidateLadder(dexOfCalc(ctx.gen), prior, physicalAttackerFor(ctx, key), true, evidence.hasDefenderObs, false, ctx.budget, new Set(), fixed);
  return rungs.some(rung => lethal.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) < refuted);
}

function evidenceFor(ctx: SolveContext, key: string): MonEvidence {
  const observations = ctx.byMon.get(key) ?? [];
  const attackerObs = observations.filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const prior = ctx.priors.get(key);
  const hasDefenderObs = observations.some(obs => keyOf(defenderSideOf(obs), obs.defenderSpecies) === key);
  const fixedHp = measuredHpEvs(ctx, key);
  const hasOffenseEvidence = attackerObs.some(obs => !obs.lethal);
  return {
    observations,
    // Knock-outs are lower bounds (fit.ts): an attacker seen only in knock-outs has no measured offense, and the prior's investment
    // stands instead of yielding to bulk.
    hasOffenseEvidence,
    offenseOpen: hasOffenseEvidence || (attackerObs.length > 0 && prior !== undefined && offenseRefuted(ctx, key, prior, { observations, hasDefenderObs, fixedHp })),
    attacked: attackerObs.length > 0,
    hasDefenderObs,
    hasSpeedObs: (ctx.speedByMon.get(key) ?? []).length > 0,
    fixedHp,
    paradoxBound: prior !== undefined && paradoxError(ctx, key, prior) > 0,
  };
}

/** The ladder for one mon: Speed rungs only where an order (or the stat a Paradox ability named) measured Speed, else the prior's Speed is kept. */
function ladderFor(
  ctx: SolveContext, key: string, prior: SpreadCandidate, physicalAttacker: boolean, evidence: MonEvidence,
  keep: Set<keyof PokemonEvs>,
): CandidateRung[] {
  const fixed: Partial<PokemonEvs> = evidence.fixedHp === undefined ? {} : { hp: evidence.fixedHp };
  const build = (hasSpeedObs: boolean) =>
    candidateLadder(dexOfCalc(ctx.gen), prior, physicalAttacker, evidence.offenseOpen, evidence.hasDefenderObs, hasSpeedObs, ctx.budget, keep, fixed);
  if (!evidence.hasSpeedObs && !evidence.paradoxBound) return build(false);
  const ladder = build(true);
  if (speedMeasured(ctx, key, ladder, prior)) return ladder;
  if (evidence.hasSpeedObs) keep.add('spe');
  return build(false);
}

/** The stats the mon's evidence measured: the top-up lets them take EVs only as far as the lines still fit. */
function measuredIn(evidence: MonEvidence, offenseStat: keyof PokemonEvs): Set<keyof PokemonEvs> {
  return new Set<keyof PokemonEvs>([
    ...(evidence.hasOffenseEvidence ? [offenseStat] : []),
    ...(evidence.hasDefenderObs ? (['hp', 'def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ...(evidence.fixedHp === undefined ? [] : (['hp'] as (keyof PokemonEvs)[])),
  ]);
}

function solveOne(ctx: SolveContext, key: string) {
  const evidence = evidenceFor(ctx, key);
  const prior = ctx.priors.get(key);
  if (!prior) return;
  // Speed evidence stands alone: one proven move order is worth solving for even when no damage line measured the mon. The log's maximum
  // HP stands alone too, as a reading only: under the observation minimum it sets the HP inside the prior and runs no ladder.
  if (evidence.observations.length < MIN_OBSERVATIONS && !evidence.hasSpeedObs && !evidence.paradoxBound) {
    if (evidence.fixedHp !== undefined) {
      ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature, origin: 'hp' });
    }
    return;
  }
  const physicalAttacker = physicalAttackerFor(ctx, key);
  const offenseStat: keyof PokemonEvs = physicalAttacker ? 'atk' : 'spa';
  const keep = new Set<keyof PokemonEvs>();
  if (evidence.attacked && !evidence.offenseOpen) keep.add(offenseStat);
  const droppable = evidence.attacked && guessedBoostItem(ctx, key) !== undefined;
  const ladder = ladderFor(ctx, key, prior, physicalAttacker, evidence, keep);
  const fitted = bestRung(ctx, key, ladder, evidence.observations, droppable);
  if (!fitted) return;
  const best = withItemRung(ctx, key, ladder, fitted, droppable, evidence);
  if (forfeitsToPrior(ctx, key, best, prior, evidence.observations)) {
    if (evidence.fixedHp === undefined) ctx.solved.delete(key);
    else ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature, origin: 'hp' });
    return;
  }
  const evs = topUp(ctx, key, best, prior, offenseStat, measuredIn(evidence, offenseStat), evidence);
  // Damage lines on the mon make the fit theirs; without any, a proven move order (or a Paradox activation) decided it.
  const origin = evidence.observations.length > 0 ? 'damage' : 'order';
  ctx.solved.set(key, { evs, nature: best.nature, origin, ...itemDecision(best) });
}

/**
 * Infers a spread per mon from damage and move-order observations; the Choice Scarf decisions from `knowledge` ride out on the
 * candidates as `item`.
 */
export function inferSpreads(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
  speedOrders: SpeedOrderObservation[] = [],
  knowledge: SpeedKnowledgeMap = new Map(),
  maxHp: Map<string, ObservedMaxHp> = new Map(),
): Map<string, SpreadCandidate> {
  const ctx = buildSolveContext(observations, sets, formatid, readableOrders(speedOrders, sets, dexOf(formatRules(formatid))), maxHp);
  ctx.knowledge = knowledge;
  ctx.scarf = decideScarfs(ctx, knowledge);
  // Every observed order holds in the sets the ladder starts from.
  ctx.sets = settledSets(ctx, knowledge);

  // Greedy by observation count, then a refinement pass: the first pass can solve a mon against a still-wrong partner guess; the second
  // re-solves everything against the first pass's answers. A mon the log measured (maximum HP) joins even without a damage line.
  const measuredKeys = [...ctx.maxHp.keys()].filter(key => {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    return setOf(ctx, side, species) !== undefined;
  });
  const order = [...new Set([...ctx.byMon.keys(), ...ctx.speedByMon.keys(), ...measuredKeys])].sort((a, b) =>
    ((ctx.byMon.get(b)?.length ?? 0) - (ctx.byMon.get(a)?.length ?? 0)) || a.localeCompare(b));
  for (const key of order) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    ctx.priors.set(key, spreadFor(ctx, side, species));
  }
  for (const key of order) solveOne(ctx, key);
  for (const key of order) solveOne(ctx, key);

  // A Speed IV the settling took rides on the solved entry, as an item does.
  for (const side of ['p1', 'p2'] as const) {
    ctx.sets[side].forEach((set, index) => {
      if (set.ivs?.spe === sets[side][index]?.ivs?.spe) return;
      const key = keyOf(side, set.species);
      ctx.solved.set(key, { ...(ctx.solved.get(key) ?? { ...spreadFor(ctx, side, set.species), origin: 'prior' as const }), ivs: { ...set.ivs } });
    });
  }

  for (const [key, decision] of ctx.scarf) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    const base = ctx.solved.get(key) ?? { ...spreadFor(ctx, side, species), origin: 'prior' as const };
    ctx.solved.set(key, {
      ...base,
      item: decision === 'holds' ? 'Choice Scarf' : '',
      itemReason: decision === 'holds' ? 'moved-first' : 'moved-second',
    });
  }
  return ctx.solved;
}
