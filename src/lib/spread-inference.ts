import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../types';
import { evTotal, type EvBudget } from './spreads/ev-budget';
import { candidateLadder, type CandidateRung, type SpreadCandidate } from './spreads/ladder';
import {
  buildSolveContext, keyOf, observationError, physicalAttackerFor, priorDistance, speedError, spreadFor,
  type SolveContext,
} from './spreads/fit';

export { evBudget, legalizeEvs } from './spreads/ev-budget';
export type { SpreadCandidate } from './spreads/ladder';

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

function solveOne(ctx: SolveContext, key: string) {
  const monObservations = ctx.byMon.get(key) ?? [];
  const monSpeedOrders = ctx.speedByMon.get(key) ?? [];
  // Speed evidence stands alone: one proven move order is worth solving
  // for even when no damage line ever measured the mon.
  if (monObservations.length < MIN_OBSERVATIONS && monSpeedOrders.length === 0) return;
  const hasAttackerObs = monObservations.some(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const hasDefenderObs = monObservations.some(obs =>
    keyOf(obs.attackerSide === 'p1' ? 'p2' : 'p1', obs.defenderSpecies) === key);
  const prior = ctx.priors.get(key);
  if (!prior) return;
  const physicalAttacker = physicalAttackerFor(ctx, key);
  const ladder = candidateLadder(prior, physicalAttacker, hasAttackerObs, hasDefenderObs, monSpeedOrders.length > 0, ctx.budget);
  const best = bestRung(ctx, key, ladder, monObservations);
  if (!best) return;
  if (forfeitsToPrior(ctx, key, best, prior, monObservations)) {
    ctx.solved.delete(key);
    return;
  }
  const offenseStat: keyof PokemonEvs = physicalAttacker ? 'atk' : 'spa';
  const measured = new Set<keyof PokemonEvs>([
    ...(hasAttackerObs ? [offenseStat] : []),
    ...(hasDefenderObs ? (['hp', 'def', 'spd'] as (keyof PokemonEvs)[]) : []),
  ]);
  ctx.solved.set(key, { evs: topUpUnmeasured(best, offenseStat, measured, ctx.budget), nature: best.nature });
}

export function inferSpreads(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
  speedOrders: SpeedOrderObservation[] = [],
): Map<string, SpreadCandidate> {
  const ctx = buildSolveContext(observations, sets, formatid, speedOrders);

  // Greedy by observation count, then a refinement pass: the first pass can
  // solve a mon against a still-wrong partner guess; the second re-solves
  // everything against the first pass's answers (deterministic order).
  const order = [...new Set([...ctx.byMon.keys(), ...ctx.speedByMon.keys()])].sort((a, b) =>
    ((ctx.byMon.get(b)?.length ?? 0) - (ctx.byMon.get(a)?.length ?? 0)) || a.localeCompare(b));
  for (const key of order) {
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    ctx.priors.set(key, spreadFor(ctx, side, species));
  }
  for (const key of order) solveOne(ctx, key);
  for (const key of order) solveOne(ctx, key);

  return ctx.solved;
}
