import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from './types.ts';
import { capToBudget, evStep, evTotal, ZERO_EVS, type EvBudget } from './spreads/ev-budget.ts';
import { candidateLadder, type CandidateRung, type SpreadCandidate } from './spreads/ladder.ts';
import {
  buildSolveContext, genNumOf, hpBasisOf, keyOf, observationError, physicalAttackerFor, priorDistance, setOf, speedError, spreadFor,
  type SolveContext,
} from './spreads/fit.ts';
import { decideScarfs, type SpeedKnowledgeMap } from './spreads/scarf.ts';
import { defenderSideOf } from './spreads/observation-read.ts';
import { paradoxError } from './spreads/paradox.ts';
import { hpEvsForMaxHp, type ObservedMaxHp } from './spreads/max-hp.ts';
import { readableOrders, settledSets } from './spreads/order-limit.ts';
import { isBoostItem, requiresItem } from './spreads/boost-items.ts';
import { simGenNum } from './calc-gen.ts';

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
  const priorViolation = provenError(ctx, key, prior);
  return priorViolation > 0 && ladder.some(rung => provenError(ctx, key, rung) < priorViolation);
}

/**
 * What the log proved of a body beyond the damage: the move orders it must keep and, since round 69 (T167), the stat a
 * Protosynthesis or Quark Drive activation named. Both outweigh any damage-fit error, and a rung that repairs either
 * measures the stat.
 */
const provenError = (ctx: SolveContext, key: string, candidate: SpreadCandidate) =>
  speedError(ctx, key, candidate) + paradoxError(ctx, key, candidate);

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
  return hpEvsForMaxHp(basis.baseHp, seen.level, seen.maxhp, ctx.priors.get(key)?.evs.hp ?? 0, basis.iv, ctx.budget);
}

/** The prior with the measured HP in place, legalized around it. */
function priorWithFixedHp(prior: SpreadCandidate, hp: number, budget: EvBudget): PokemonEvs {
  return capToBudget({ ...ZERO_EVS, ...prior.evs, hp }, new Set(), budget, new Set(), new Set(['hp']));
}

/**
 * The set's item when it is a guessed boost item the damage lines may take away (round 69, T26): the build guessed it,
 * no log line, team sheet or edit showed it, the simulator gives it a damage hook and the species does not need it.
 */
function guessedBoostItem(ctx: SolveContext, key: string): string | undefined {
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const set = setOf(ctx, side, species);
  if (!set?.item || (ctx.knowledge.get(key) ?? ctx.knowledge.get(keyOf(side, set.species)))?.itemKnown) return undefined;
  const gen = simGenNum(ctx.gen);
  return isBoostItem(gen, set.item) && !requiresItem(gen, set.species, set.item) ? set.item : undefined;
}

/**
 * The ladder rung with the least error; ties break toward the prior. With `withoutItem` every rung is scored
 * twice, with the set's item and without it (T26): the lower error wins, the prior's distance breaks a tie,
 * and a tie of both keeps the item.
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
 * When even the best rung misfits the damage evidence badly (video-read
 * HP bars, attribution confounds), the evidence is unreliable — keep the
 * prior instead of confidently fielding a paper spread (GPL: all-zero
 * Vileplume, 252-HP-only Clefable). A solve that REPAIRS speed-order
 * violations the prior carries always stands. In the two-stage chain the
 * prior is the speed-only pre-solve's build: solveReplaySpreads hands that
 * entry back for a forfeited mon (round 53).
 */
function forfeitsToPrior(ctx: SolveContext, key: string, best: CandidateRung, prior: SpreadCandidate, monObservations: DamageObservation[]): boolean {
  const damageResidual = monObservations.reduce((sum, obs) => sum + observationError(ctx, obs, key, best), 0);
  return monObservations.length > 0 &&
    damageResidual / monObservations.length > FIT_FORFEIT_PER_OBSERVATION &&
    provenError(ctx, key, best) >= provenError(ctx, key, prior);
}

/** The mon's damage misfit under a spread (the bestRung sum without the move-order term), plus the Paradox stat it must keep. */
const damageError = (ctx: SolveContext, key: string, rung: CandidateRung, observations: DamageObservation[]) =>
  observations.reduce((sum, obs) => sum + observationError(ctx, obs, key, rung), 0) + paradoxError(ctx, key, rung);

/**
 * The most EVs a measured stat takes, in the ladder's steps (4 EVs, one Stat
 * Point) up to `room`, while the mon's damage lines fit as well as they do at `rung`.
 */
function neutralRoom(
  ctx: SolveContext, key: string, rung: CandidateRung, stat: keyof PokemonEvs, room: number, observations: DamageObservation[],
): number {
  const fitted = damageError(ctx, key, rung, observations);
  const step = evStep(ctx.budget);
  const adds = [...new Set([...Array.from({ length: Math.floor(room / step) }, (_, i) => (i + 1) * step), room])];
  const fits = (add: number) =>
    damageError(ctx, key, { ...rung, evs: { ...rung.evs, [stat]: (rung.evs[stat] ?? 0) + add } }, observations) <= fitted + 1e-12;
  // Bisection: a stat's fit mostly leaves the rolls once and stays out; where it does not, the add it
  // returns still fits (round 64 census: 3 of 1548 bank sets differ from a step-by-step scan, at a
  // fraction of its calc calls).
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
 * Top up the leftover budget in the non-Speed stats: a winner like "252
 * HP only" would otherwise field a systematically under-statted sim mon.
 * An unmeasured stat takes what fits (it carries no observation evidence
 * either way). A measured stat takes the most EVs at which the mon's
 * damage lines fit exactly as well as at the winning rung (round 64,
 * T122): the ladder knows a stat only at 0 and 252, so a winning 0 left
 * half the budget open where the evidence allowed more (66 of 1548 bank
 * sets at 260 EVs or fewer). Where the lines cannot tell spreads apart,
 * the prior is the better guess: each stat first refills toward the
 * prior's EVs, then the top-up order (offense, HP, Def, SpD) spends the
 * rest (573756: a Bold Toxapex's open 4 EVs went to Attack, the prior
 * runs them in SpD). The log's HP stays.
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
  const order = ([offenseStat, 'hp', 'def', 'spd', offenseStat === 'atk' ? 'spa' : 'atk'] as (keyof PokemonEvs)[])
    .filter(stat => stat !== 'hp' || evidence.fixedHp === undefined);
  for (const stat of order) give(stat, Math.min((prior.evs[stat] ?? 0) - (evs[stat] ?? 0), ctx.budget.perStat - (evs[stat] ?? 0), remaining));
  for (const stat of order.slice(0, -1)) give(stat, Math.min(ctx.budget.perStat - (evs[stat] ?? 0), remaining));
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
  /** The prior contradicts the stat a Protosynthesis or Quark Drive activation named (round 69, T167): a Speed rung may repair it. */
  paradoxBound: boolean;
}

function evidenceFor(ctx: SolveContext, key: string): MonEvidence {
  const observations = ctx.byMon.get(key) ?? [];
  const attackerObs = observations.filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  const prior = ctx.priors.get(key);
  return {
    observations,
    // Knock-outs are lower bounds (fit.ts): they refute rungs whose best roll
    // falls short, but an attacker seen only in knock-outs has no measured
    // offense — the prior's investment stands instead of yielding to bulk.
    hasOffenseEvidence: attackerObs.some(obs => !obs.lethal),
    attacked: attackerObs.length > 0,
    hasDefenderObs: observations.some(obs => keyOf(defenderSideOf(obs), obs.defenderSpecies) === key),
    hasSpeedObs: (ctx.speedByMon.get(key) ?? []).length > 0,
    fixedHp: measuredHpEvs(ctx, key),
    paradoxBound: prior !== undefined && paradoxError(ctx, key, prior) > 0,
  };
}

/**
 * The ladder for one mon: Speed rungs only where an order measured Speed, else the prior's Speed is kept. A prior that
 * contradicts a Paradox ability's named stat opens the Speed rungs too, and keeps its Speed when none of them repairs it.
 */
function ladderFor(
  ctx: SolveContext, key: string, prior: SpreadCandidate, physicalAttacker: boolean, evidence: MonEvidence,
  keep: Set<keyof PokemonEvs>,
): CandidateRung[] {
  const fixed: Partial<PokemonEvs> = evidence.fixedHp === undefined ? {} : { hp: evidence.fixedHp };
  const build = (hasSpeedObs: boolean) =>
    candidateLadder(prior, physicalAttacker, evidence.hasOffenseEvidence, evidence.hasDefenderObs, hasSpeedObs, ctx.budget, keep, fixed);
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
  // Speed evidence stands alone: one proven move order is worth solving
  // for even when no damage line ever measured the mon. The log's maximum
  // HP (round 40) stands alone too, but as a reading only: under the
  // observation minimum it sets the HP inside the prior and runs no ladder.
  if (evidence.observations.length < MIN_OBSERVATIONS && !evidence.hasSpeedObs && !evidence.paradoxBound) {
    if (evidence.fixedHp !== undefined) {
      ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature, origin: 'hp' });
    }
    return;
  }
  const physicalAttacker = physicalAttackerFor(ctx, key);
  const offenseStat: keyof PokemonEvs = physicalAttacker ? 'atk' : 'spa';
  const keep = new Set<keyof PokemonEvs>();
  if (evidence.attacked && !evidence.hasOffenseEvidence) keep.add(offenseStat);
  const droppable = evidence.attacked && guessedBoostItem(ctx, key) !== undefined;
  const best = bestRung(ctx, key, ladderFor(ctx, key, prior, physicalAttacker, evidence, keep), evidence.observations, droppable);
  if (!best) return;
  if (forfeitsToPrior(ctx, key, best, prior, evidence.observations)) {
    // The prior stands — with the log's HP where the log measured it.
    if (evidence.fixedHp === undefined) ctx.solved.delete(key);
    else ctx.solved.set(key, { evs: priorWithFixedHp(prior, evidence.fixedHp, ctx.budget), nature: prior.nature, origin: 'hp' });
    return;
  }
  const evs = topUp(ctx, key, best, prior, offenseStat, measuredIn(evidence, offenseStat), evidence);
  // Damage lines on the mon make the fit theirs; without any, a proven move order (or a Paradox activation) decided it (T69).
  const origin = evidence.observations.length > 0 ? 'damage' : 'order';
  // A guessed boost item the lines refute rides out on the candidate like a decided Scarf: the builder resolves its replacement.
  ctx.solved.set(key, { evs, nature: best.nature, origin, ...(best.item === '' ? { item: '', itemReason: 'no-boost' as const } : {}) });
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
  const ctx = buildSolveContext(observations, sets, formatid, readableOrders(speedOrders, sets, genNumOf(formatid)), maxHp);
  ctx.knowledge = knowledge;
  ctx.scarf = decideScarfs(ctx, knowledge);
  // T117 (round 63): every observed order holds in the sets the ladder starts from.
  ctx.sets = settledSets(ctx, knowledge);

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

  // A Speed IV the settling took (round 64) rides on the solved entry, as an item does.
  for (const side of ['p1', 'p2'] as const) {
    ctx.sets[side].forEach((set, index) => {
      if (set.ivs?.spe === sets[side][index]?.ivs?.spe) return;
      const key = keyOf(side, set.species);
      ctx.solved.set(key, { ...(ctx.solved.get(key) ?? { ...spreadFor(ctx, side, set.species), origin: 'prior' as const }), ivs: { ...set.ivs } });
    });
  }

  // A decided mon carries its item even when no spread was solved for it.
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
