import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from './types.ts';
import { capToBudget, evTotal, ZERO_EVS, type EvBudget } from './spreads/ev-budget.ts';
import { candidateLadder, type CandidateRung, type SpreadCandidate } from './spreads/ladder.ts';
import {
  buildSolveContext, hpBasisOf, keyOf, observationError, physicalAttackerFor, priorDistance, setOf, speedError, spreadFor,
  type SolveContext,
} from './spreads/fit.ts';
import { decideScarfs, type SpeedKnowledgeMap } from './spreads/scarf.ts';
import { hpEvsForMaxHp, type ObservedMaxHp } from './spreads/max-hp.ts';

export { evBudget, legalizeEvs } from './spreads/ev-budget.ts';
export type { SpreadCandidate } from './spreads/ladder.ts';
export type { SpeedKnowledge, SpeedKnowledgeMap } from './spreads/scarf.ts';

/**
 * Damage-consistent spread inference: the replay's observed damage fractions
 * bound each Pokémon's real bulk and power. A small discrete ladder of
 * standard spreads is scored with @smogon/calc against every observation a
 * Pokémon appears in; the best-fitting rung replaces the guessed EVs (only
 * where EVs were guessed — sheet/revealed/manual spreads are never touched;
 * the overlay in team-builder enforces that precedence).
 *
 * Honest limitation: with sparse observations, "the defender is bulkier" and
 * "the attacker is weaker" fit the same damage line — the greedy solve picks
 * one, so per-mon spreads are not ground truth. What the result guarantees is
 * PAIR consistency: forked eval battles reproduce the damage the replay
 * showed, so branches stop killing Pokémon that visibly survived.
 */

/**
 * Goodness-of-fit forfeit: mean squared misfit per observation above which
 * the evidence itself is unreliable and the prior stands. Sized on the GPL
 * video reconstruction — clean fits read ≤0.005 (draft/server logs ~0.0002),
 * while Vileplume's contradictory video HP bars left EVERY rung ≥0.05 and
 * the least-bad fit was an all-zero paper spread.
 */
const FIT_FORFEIT_PER_OBSERVATION = 0.01;

/** Minimum observations before a spread claim beats the existing guess. */
const MIN_OBSERVATIONS = 2;

/**
 * A move order measures Speed only when it REFUTES the prior and some rung
 * repairs it. An order the prior already satisfies measures nothing
 * downward (573756 after round 37: five satisfied Garchomp orders let the
 * budget shave the prior's 252 Spe to 4 for a 252-HP rung — a Garchomp
 * Kyurem outspeeds), and an order no rung can reproduce measures nothing
 * at all (the Choice Scarf the build does not carry). Both keep the prior's
 * Speed and speed nature; only a refuted, repairable order opens the Speed
 * rungs.
 */
function speedMeasured(ctx: SolveContext, key: string, ladder: CandidateRung[], prior: SpreadCandidate): boolean {
  const priorViolation = speedError(ctx, key, prior);
  return priorViolation > 0 && ladder.some(rung => speedError(ctx, key, rung) < priorViolation);
}

/**
 * The HP EVs the log's maximum HP pins for this mon (round 40), or
 * undefined without a usable sighting. A reading, not a fit: it holds even
 * when the damage evidence forfeits to the prior.
 */
function measuredHpEvs(ctx: SolveContext, key: string): number | undefined {
  const seen = ctx.maxHp.get(key);
  if (!seen) return undefined;
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const basis = hpBasisOf(ctx, side, species);
  if (!basis) return undefined;
  return hpEvsForMaxHp(basis.baseHp, seen.level, seen.maxhp, ctx.priors.get(key)?.evs.hp ?? 0, basis.iv);
}

/** The prior with the measured HP in place, legalized around it. */
function priorWithFixedHp(prior: SpreadCandidate, hp: number, budget: EvBudget): PokemonEvs {
  return capToBudget({ ...ZERO_EVS, ...prior.evs, hp }, new Set(), budget, new Set(), new Set(['hp']));
}

/** The ladder rung with the least error; ties break toward the prior. */
function bestRung(ctx: SolveContext, key: string, ladder: CandidateRung[], monObservations: DamageObservation[]): CandidateRung | null {
  let best: CandidateRung | null = null;
  let bestError = Infinity;
  for (const rung of ladder) {
    const error = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) +
      speedError(ctx, key, rung);
    if (error < bestError - 1e-12 ||
      (best !== null && Math.abs(error - bestError) <= 1e-12 && priorDistance(ctx, key, rung) < priorDistance(ctx, key, best))) {
      bestError = error;
      best = rung;
    }
  }
  return best;
}

/**
 * When even the best rung misfits the damage evidence badly (video-read
 * HP bars, attribution confounds), the evidence is unreliable — keep the
 * prior instead of confidently fielding a paper spread (GPL: all-zero
 * Vileplume, 252-HP-only Clefable). A solve that REPAIRS speed-order
 * violations the prior carries always stands.
 */
function forfeitsToPrior(ctx: SolveContext, key: string, best: CandidateRung, prior: SpreadCandidate, monObservations: DamageObservation[]): boolean {
  const damageResidual = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, best), 0);
  return monObservations.length > 0 &&
    damageResidual / monObservations.length > FIT_FORFEIT_PER_OBSERVATION &&
    speedError(ctx, key, best) >= speedError(ctx, key, prior);
}

/**
 * Top up the leftover budget in UNMEASURED, non-Speed stats: a winner
 * like "252 HP only" would otherwise field a systematically
 * under-statted sim mon. Filled stats carry no observation evidence
 * either way (they are exactly the unmeasured ones), so the fill can
 * never contradict the solve.
 */
function topUpUnmeasured(best: CandidateRung, offenseStat: keyof PokemonEvs, measured: Set<keyof PokemonEvs>, budget: EvBudget): PokemonEvs {
  const evs: PokemonEvs = { ...best.evs };
  let remaining = budget.total - evTotal(evs);
  for (const stat of ([offenseStat, 'hp', 'def', 'spd'] as (keyof PokemonEvs)[])) {
    if (remaining <= 0) break;
    if (measured.has(stat)) continue;
    const add = Math.min(budget.perStat - (evs[stat] ?? 0), remaining);
    if (add > 0) {
      evs[stat] = (evs[stat] ?? 0) + add;
      remaining -= add;
    }
  }
  return evs;
}

/** What one mon's evidence can and cannot measure. */
interface MonEvidence {
  observations: DamageObservation[];
  /** Clean (non-lethal) attacker lines exist: offense is measurable. */
  hasOffenseEvidence: boolean;
  /** The mon attacked at all (knock-outs alone keep the prior's offense). */
  attacked: boolean;
  hasDefenderObs: boolean;
  hasSpeedObs: boolean;
  /** HP EVs the log's maximum HP pinned (round 40). */
  fixedHp: number | undefined;
}

function evidenceFor(ctx: SolveContext, key: string): MonEvidence {
  const observations = ctx.byMon.get(key) ?? [];
  const attackerObs = observations.filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  return {
    observations,
    // Knock-outs are lower bounds (fit.ts): they refute rungs whose best roll
    // falls short, but an attacker seen only in knock-outs has no measured
    // offense — the prior's investment stands instead of yielding to bulk.
    hasOffenseEvidence: attackerObs.some(obs => !obs.lethal),
    attacked: attackerObs.length > 0,
    hasDefenderObs: observations.some(obs => keyOf(obs.attackerSide === 'p1' ? 'p2' : 'p1', obs.defenderSpecies) === key),
    hasSpeedObs: (ctx.speedByMon.get(key) ?? []).length > 0,
    fixedHp: measuredHpEvs(ctx, key),
  };
}

/** The ladder for one mon: Speed rungs only where an order measured Speed, else the prior's Speed is kept. */
function ladderFor(
  ctx: SolveContext, key: string, prior: SpreadCandidate, physicalAttacker: boolean, evidence: MonEvidence,
  keep: Set<keyof PokemonEvs>,
): CandidateRung[] {
  const fixed: Partial<PokemonEvs> = evidence.fixedHp === undefined ? {} : { hp: evidence.fixedHp };
  const build = (hasSpeedObs: boolean) =>
    candidateLadder(prior, physicalAttacker, evidence.hasOffenseEvidence, evidence.hasDefenderObs, hasSpeedObs, ctx.budget, keep, fixed);
  const ladder = build(evidence.hasSpeedObs);
  if (!evidence.hasSpeedObs || speedMeasured(ctx, key, ladder, prior)) return ladder;
  keep.add('spe');
  return build(false);
}

function solveOne(ctx: SolveContext, key: string) {
  const evidence = evidenceFor(ctx, key);
  const prior = ctx.priors.get(key);
  if (!prior) return;
  // Speed evidence stands alone: one proven move order is worth solving
  // for even when no damage line ever measured the mon. The log's maximum
  // HP (round 40) stands alone too, but as a reading only: under the
  // observation minimum it sets the HP inside the prior and runs no ladder.
  if (evidence.observations.length < MIN_OBSERVATIONS && !evidence.hasSpeedObs) {
    if (evidence.fixedHp !== undefined) {
      ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature });
    }
    return;
  }
  const physicalAttacker = physicalAttackerFor(ctx, key);
  const offenseStat: keyof PokemonEvs = physicalAttacker ? 'atk' : 'spa';
  const keep = new Set<keyof PokemonEvs>();
  if (evidence.attacked && !evidence.hasOffenseEvidence) keep.add(offenseStat);
  const best = bestRung(ctx, key, ladderFor(ctx, key, prior, physicalAttacker, evidence, keep), evidence.observations);
  if (!best) return;
  if (forfeitsToPrior(ctx, key, best, prior, evidence.observations)) {
    // The prior stands — with the log's HP where the log measured it.
    if (evidence.fixedHp === undefined) ctx.solved.delete(key);
    else ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature });
    return;
  }
  const measured = new Set<keyof PokemonEvs>([
    ...(evidence.hasOffenseEvidence ? [offenseStat] : []),
    ...(evidence.hasDefenderObs ? (['hp', 'def', 'spd'] as (keyof PokemonEvs)[]) : []),
    ...(evidence.fixedHp === undefined ? [] : (['hp'] as (keyof PokemonEvs)[])),
  ]);
  ctx.solved.set(key, { evs: topUpUnmeasured(best, offenseStat, measured, ctx.budget), nature: best.nature });
}

/**
 * `knowledge` (round 37) says per mon what the solver may assume about its
 * item and Speed; the Choice Scarf decisions fall before the ladder and
 * ride out on the candidates as `item`, so the builder and the panel carry
 * the same item. Without it, the built sets' priors are the only reference.
 */
export function inferSpreads(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
  speedOrders: SpeedOrderObservation[] = [],
  knowledge: SpeedKnowledgeMap = new Map(),
  maxHp: Map<string, ObservedMaxHp> = new Map(),
): Map<string, SpreadCandidate> {
  const ctx = buildSolveContext(observations, sets, formatid, speedOrders, maxHp);
  ctx.scarf = decideScarfs(ctx, knowledge);

  // Greedy by observation count, then a refinement pass: the first pass can
  // solve a mon against a still-wrong partner guess; the second re-solves
  // everything against the first pass's answers (deterministic order).
  // A mon the log measured (maximum HP) joins even without a damage line.
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

  // A decided mon carries its item even when no spread was solved for it.
  for (const [key, decision] of ctx.scarf) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    const base = ctx.solved.get(key) ?? spreadFor(ctx, side, species);
    ctx.solved.set(key, {
      ...base,
      item: decision === 'holds' ? 'Choice Scarf' : '',
      itemReason: decision === 'holds' ? 'moved-first' : 'moved-second',
    });
  }
  return ctx.solved;
}
