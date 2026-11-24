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

// Per-mon spreads are not ground truth (bulkier defender, weaker attacker fit alike); the pair reproduces the damage.

const FIT_FORFEIT_PER_OBSERVATION = 0.01;

const MIN_OBSERVATIONS = 2;

// An order measures Speed only when it refutes the prior and a rung repairs it; a satisfied one measures none.
function speedMeasured(ctx: SolveContext, key: string, ladder: CandidateRung[], prior: SpreadCandidate): boolean {
  const priorViolation = provenError(ctx, key, prior);
  return priorViolation > 0 && ladder.some(rung => provenError(ctx, key, rung) < priorViolation);
}

const provenError = (ctx: SolveContext, key: string, candidate: SpreadCandidate) =>
  speedError(ctx, key, candidate) + paradoxError(ctx, key, candidate);

// A reading, not a fit: it holds even when the damage evidence forfeits to the prior.
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

function guessedBoostItem(ctx: SolveContext, key: string): string | undefined {
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const set = setOf(ctx, side, species);
  if (!set?.item || (ctx.knowledge.get(key) ?? ctx.knowledge.get(keyOf(side, set.species)))?.itemKnown) return undefined;
  const dex = dexOfCalc(ctx.gen);
  return isBoostItem(dex, set.item) && !requiresItem(dex, set.species, set.item) ? set.item : undefined;
}

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

// A forfeited mon's prior is the speed-only pre-solve's build; a solve repairing speed-order violations never forfeits.
function forfeitsToPrior(ctx: SolveContext, key: string, best: CandidateRung, prior: SpreadCandidate, monObservations: DamageObservation[]): boolean {
  const damageResidual = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, best), 0);
  return monObservations.length > 0 &&
    damageResidual / monObservations.length > FIT_FORFEIT_PER_OBSERVATION &&
    provenError(ctx, key, best) >= provenError(ctx, key, prior);
}

// Knockouts without the shown HP text never trigger it.
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

function withItemRung(
  ctx: SolveContext, key: string, ladder: CandidateRung[], fitted: CandidateRung, droppable: boolean, evidence: MonEvidence,
): CandidateRung {
  return (!droppable && itemRung(ctx, key, ladder, fitted, evidence)) || fitted;
}

function itemDecision(best: CandidateRung): Pick<SpreadCandidate, 'item' | 'itemReason'> {
  if (best.item === '') return { item: '', itemReason: 'no-boost' };
  return best.item ? { item: best.item, itemReason: 'boost' } : {};
}

const damageError = (ctx: SolveContext, key: string, rung: CandidateRung, observations: DamageObservation[]) =>
  observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) + paradoxError(ctx, key, rung);

function neutralRoom(
  ctx: SolveContext, key: string, rung: CandidateRung, stat: keyof PokemonEvs, room: number, observations: DamageObservation[],
): number {
  const fitted = damageError(ctx, key, rung, observations);
  const step = evStep(ctx.budget);
  const adds = [...new Set([...Array.from({ length: Math.floor(room / step) }, (_, i) => (i + 1) * step), room])];
  const fits = (add: number) =>
    damageError(ctx, key, { ...rung, evs: { ...rung.evs, [stat]: (rung.evs[stat] ?? 0) + add } }, observations) <= fitted + 1e-12;
  let low = 0;
  let high = adds.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (fits(adds[mid])) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? 0 : adds[low - 1];
}

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
  hasOffenseEvidence: boolean;
  offenseOpen: boolean;
  attacked: boolean;
  hasDefenderObs: boolean;
  hasSpeedObs: boolean;
  fixedHp: number | undefined;
  paradoxBound: boolean;
}

// A knockout is a lower bound, but one the prior's best roll cannot reach (by the displayed HP) is refuted by the game.
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
    // Knock-outs are lower bounds: an attacker seen only in them keeps the prior's offense instead of yielding to bulk.
    hasOffenseEvidence,
    offenseOpen: hasOffenseEvidence || (attackerObs.length > 0 && prior !== undefined && offenseRefuted(ctx, key, prior, { observations, hasDefenderObs, fixedHp })),
    attacked: attackerObs.length > 0,
    hasDefenderObs,
    hasSpeedObs: (ctx.speedByMon.get(key) ?? []).length > 0,
    fixedHp,
    paradoxBound: prior !== undefined && paradoxError(ctx, key, prior) > 0,
  };
}

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
  // A proven move order stands alone; the log's maximum HP stands alone too, as a reading that runs no ladder.
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
  const origin = evidence.observations.length > 0 ? 'damage' : 'order';
  ctx.solved.set(key, { evs, nature: best.nature, origin, ...itemDecision(best) });
}

/** Infers a spread per mon from damage and move-order observations; `knowledge` carries Scarf decisions as `item`. */
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
  ctx.sets = settledSets(ctx, knowledge);

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
