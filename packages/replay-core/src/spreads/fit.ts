import { Pokemon, calculate } from '@smogon/calc';
import { buildCalcPokemon, calcBaseStats, calcKnowsMove } from '../calc-build.ts';
import { calcGenerationFor, calcModOf, simGenNum, type CalcGeneration } from '../calc-gen.ts';
import { Dex } from '@pkmn/dex';
import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../types.ts';
import { typedHiddenPowerId } from '../hidden-power.ts';
import { calcIvs, coupleSpecial, evBudget, evsOfSet, onBudgetScale, statPointsOfEv, ZERO_EVS, type EvBudget } from './ev-budget.ts';
import type { CandidateRung, SpreadCandidate } from './ladder.ts';
import type { ItemDecision, SpeedKnowledgeMap } from './scarf.ts';
import type { ObservedMaxHp } from './max-hp.ts';
import { raceSpeed } from './race-speed.ts';
import { defenderSideOf, fieldOf, hitSideOf, moveOf, readObservation, type HitSide, type ReadObservation } from './observation-read.ts';
import { abilityAtHit } from './ability-at-hit.ts';
import { formeAbility } from './battle-forme.ts';
import { withItemAtHit } from './item-at-hit.ts';
import { genNumOf, toId } from '../ids.ts';
import { poweredMove } from './powered-move.ts';

/**
 * A violated move-order constraint outweighs any damage-fit error: the log
 * PROVED the order, while damage rolls only bound spreads. Rungs violating a
 * constraint lose to any non-violating rung; if every rung violates
 * (conflicting evidence), damage fit still decides among them.
 */
export const SPEED_VIOLATION_PENALTY = 1000;

/** HP-bar reading noise (the GPL pipeline is ±1–2%): error inside this slack is free. */
const OBSERVATION_SLACK = 0.02;

/**
 * An order as the solver reads it (round 64): each mover named by its set,
 * with the battle forme that raced when that forme runs on its own base
 * Speed (a Mega after its evolution, Terapagos-Terastal).
 */
export interface ReadOrder extends SpeedOrderObservation {
  firstForme?: string;
  secondForme?: string;
  /** A transformed mover's own set: it ran the race on the copied Pokémon's Speed with its own item (round 64). */
  firstHolder?: { side: 'p1' | 'p2'; species: string };
  secondHolder?: { side: 'p1' | 'p2'; species: string };
}

/** One mover of a read order: whose spread raced, in which forme, and whose item (the Scarf the order names first). */
export interface RaceSide {
  side: 'p1' | 'p2';
  species: string;
  forme?: string;
  held?: boolean;
  holder?: { side: 'p1' | 'p2'; species: string };
}

export const firstOf = (order: ReadOrder): RaceSide => ({
  side: order.firstSide, species: order.firstSpecies, forme: order.firstForme, held: order.firstScarf, holder: order.firstHolder,
});
export const secondOf = (order: ReadOrder): RaceSide => ({
  side: order.secondSide, species: order.secondSpecies, forme: order.secondForme, held: order.secondScarf, holder: order.secondHolder,
});

/** Everything one spread solve shares between its scoring functions. */
export interface SolveContext {
  gen: CalcGeneration;
  budget: EvBudget;
  sets: { p1: PokemonSet[]; p2: PokemonSet[] };
  solved: Map<string, SpreadCandidate>;
  /** Observations per mon (as attacker AND as defender). */
  byMon: Map<string, ReadObservation[]>;
  /** Observed same-turn move order, indexed per participant. */
  speedByMon: Map<string, ReadOrder[]>;
  /** The orders with sets on both sides, in observation order (round 37: the Scarf decisions walk them). */
  speedOrders: ReadOrder[];
  /** Choice Scarf decisions from the move orders, keyed like `solved` (round 37). */
  scarf: Map<string, ItemDecision>;
  /** What the build knows of each mon's item (round 69, T26: a guessed boost item may give way, a known one never). */
  knowledge: SpeedKnowledgeMap;
  /** Maximum HP per mon as the log printed it (round 40: pins the HP EVs). */
  maxHp: Map<string, ObservedMaxHp>;
  priors: Map<string, SpreadCandidate>;
}

function genOf(formatid: string) {
  return calcGenerationFor(genNumOf(formatid), calcModOf(formatid));
}

export const keyOf = (side: 'p1' | 'p2', species: string) => `${side}:${toId(species)}`;

export function setOf(ctx: SolveContext, side: 'p1' | 'p2', species: string): PokemonSet | undefined {
  return ctx.sets[side].find(entry => toId(entry.species) === toId(species) || toId(entry.name || '') === toId(species));
}

/** The species' base HP (the set's species, else the key's) and its HP IV (31 on Stat Points), for the max-HP inversion. */
export function hpBasisOf(ctx: SolveContext, side: 'p1' | 'p2', species: string): { baseHp: number; iv: number } | undefined {
  const set = setOf(ctx, side, species);
  const baseStats = calcBaseStats(ctx.gen, set?.species ?? species);
  if (!baseStats) return undefined;
  return { baseHp: baseStats.hp, iv: calcIvs(set?.ivs, ctx.budget)?.hp ?? 31 };
}

/** The sets with every spread on the budget's scale: a Stat Point solve never reads EVs as points (round 67). */
function onScale(sets: { p1: PokemonSet[]; p2: PokemonSet[] }, budget: EvBudget): { p1: PokemonSet[]; p2: PokemonSet[] } {
  if (!budget.statPoints) return sets;
  const scaled = (team: PokemonSet[]) => team.map(set => ({ ...set, evs: onBudgetScale({ ...ZERO_EVS, ...set.evs }, budget) }));
  return { p1: scaled(sets.p1), p2: scaled(sets.p2) };
}

/**
 * Indexes the evidence per participant. Speed constraints are over the
 * BUILT configuration's effective speed (spread × the set's Scarf), the
 * pair-consistency philosophy: branches must reproduce the order the
 * replay showed, whatever the true item was.
 */
export function buildSolveContext(
  observations: DamageObservation[],
  sets: { p1: PokemonSet[]; p2: PokemonSet[] },
  formatid: string,
  speedOrders: ReadOrder[],
  maxHp: Map<string, ObservedMaxHp> = new Map(),
): SolveContext {
  const budget = evBudget(formatid);
  const ctx: SolveContext = {
    gen: genOf(formatid),
    budget,
    sets: onScale(sets, budget),
    solved: new Map<string, SpreadCandidate>(),
    byMon: new Map<string, ReadObservation[]>(),
    speedByMon: new Map<string, ReadOrder[]>(),
    speedOrders: [],
    scarf: new Map<string, ItemDecision>(),
    knowledge: new Map(),
    maxHp,
    priors: new Map<string, SpreadCandidate>(),
  };
  const { byMon, speedByMon } = ctx;

  const dex = Dex.forGen(simGenNum(ctx.gen));
  for (const raw of observations) {
    // A Z-move or a Max move prices from the Dex's placeholder power, not from the base move's (round 73, T229): no reading.
    if (poweredMove(dex, raw.moveId)) continue;
    const obs = readObservation(dex, ctx.sets, raw);
    const defenderSide = defenderSideOf(obs);
    if (setOf(ctx, obs.attackerSide, obs.attackerSpecies) && setOf(ctx, defenderSide, obs.defenderSpecies)) {
      const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
      const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
      byMon.set(attackerKey, [...(byMon.get(attackerKey) ?? []), obs]);
      byMon.set(defenderKey, [...(byMon.get(defenderKey) ?? []), obs]);
    }
  }

  for (const order of speedOrders) {
    if (!setOf(ctx, order.firstSide, order.firstSpecies) || !setOf(ctx, order.secondSide, order.secondSpecies)) continue;
    // A transformed mover's race needs its own set too: its item ran the race.
    if ([order.firstHolder, order.secondHolder].some(holder => holder && !setOf(ctx, holder.side, holder.species))) continue;
    const firstKey = keyOf(order.firstSide, order.firstSpecies);
    const secondKey = keyOf(order.secondSide, order.secondSpecies);
    if (firstKey === secondKey) continue;
    speedByMon.set(firstKey, [...(speedByMon.get(firstKey) ?? []), order]);
    speedByMon.set(secondKey, [...(speedByMon.get(secondKey) ?? []), order]);
    ctx.speedOrders.push(order);
  }
  return ctx;
}

export function spreadFor(ctx: SolveContext, side: 'p1' | 'p2', species: string): SpreadCandidate {
  const key = keyOf(side, species);
  const existing = ctx.solved.get(key);
  if (existing) return existing;
  const set = setOf(ctx, side, species);
  return { evs: evsOfSet(set?.evs, ctx.budget), nature: set?.nature || 'Hardy' };
}

/** The calculator's current HP for a fraction of the maximum: below the maximum whenever the fraction is (Multiscale reads full HP exactly). */
const hpAt = (maxHp: number, fraction: number) => Math.max(1, Math.min(maxHp - 1, Math.round(fraction * maxHp)));

type CalcOptions = NonNullable<ConstructorParameters<typeof Pokemon>[2]>;

/**
 * A body as the calculator reads it: the spread itself, Stat Points in evs for Champions' generation 0, which ignores IVs (round 68,
 * T186), and what the log shows of the side at the hit (`hit`, round 69, T86): stages, status, forme, Terastallization, HP, the
 * fallen of Supreme Overlord, the ability it fought with.
 */
export function calcPokemon(ctx: SolveContext, side: 'p1' | 'p2', species: string, spread: SpreadCandidate, hit: HitSide = {}) {
  const set = setOf(ctx, side, species);
  const dex = Dex.forGen(simGenNum(ctx.gen));
  const body = buildCalcPokemon(ctx.gen, hit.forme ?? set?.species ?? species, {
    level: set?.level || 100,
    ability: abilityAtHit(dex, formeAbility(dex, hit.forme, set?.ability), hit.ability, hit.suppressed),
    abilityOn: hit.abilityOn,
    item: (spread.item ?? set?.item) || undefined,
    nature: spread.nature,
    evs: coupleSpecial(spread.evs, ctx.budget),
    ivs: coupleSpecial(set?.ivs, ctx.budget),
    boosts: hit.boosts,
    // The stat the log named for an active Protosynthesis or Quark Drive (T167): the calculator boosts that one, not the best of its own reading.
    boostedStat: hit.boostedStat as CalcOptions['boostedStat'],
    status: (hit.status || undefined) as CalcOptions['status'],
    teraType: hit.tera as CalcOptions['teraType'],
    alliesFainted: hit.fallen,
  });
  if (hit.hp !== undefined && hit.hp < 1) body.originalCurHP = hpAt(body.maxHP(), hit.hp);
  return body;
}

/** The calc's roll range for one observation under the candidate spread, as HP fractions. */
export function rollRange(ctx: SolveContext, obs: ReadObservation, attackerSpread: SpreadCandidate, defenderSpread: SpreadCandidate): { min: number; max: number } | null {
  const { gen } = ctx;
  const defenderSide = defenderSideOf(obs);
  // The items the hit landed with: the client's at the line, not the set's (a popped Air Balloon, a Knock Off, a Trick).
  const dex = Dex.forGen(simGenNum(gen));
  const attackerBody = withItemAtHit(dex, attackerSpread, setOf(ctx, obs.attackerSide, obs.attackerSpecies)?.item, obs.attackerItem, obs.attackerItemChanged);
  const defenderBody = withItemAtHit(dex, defenderSpread, setOf(ctx, defenderSide, obs.defenderSpecies)?.item, obs.defenderItem, obs.defenderItemChanged);
  const attacker = calcPokemon(ctx, obs.attackerSide, obs.attackerSpecies, attackerBody, hitSideOf(obs, 'attacker'));
  const defender = calcPokemon(ctx, defenderSide, obs.defenderSpecies, defenderBody, hitSideOf(obs, 'defender'));
  // The protocol records typeless "hiddenpower"; calc it as the SET's
  // resolved variant, or the fit runs the IV-default type against a hit
  // the sim plays typed (653785: Dark-fitted spreads, Ice-rolled sim).
  const calcMoveId = obs.moveId === 'hiddenpower'
    ? typedHiddenPowerId(setOf(ctx, obs.attackerSide, obs.attackerSpecies)?.moves ?? []) ?? obs.moveId
    : obs.moveId;
  // A move the calculator's generation lacks (Pound in Champions' generation 0) builds as a 0-damage Status move: no judgment, no miss.
  if (!calcKnowsMove(gen, calcMoveId)) return null;
  // The calculator keys a few moves on the name (Weather Ball, Terrain Pulse); the typed Hidden Power is its own id.
  const moveName = calcMoveId === obs.moveId ? obs.moveName ?? calcMoveId : calcMoveId;
  const result = calculate(gen, attacker, defender, moveOf(gen, moveName, obs), fieldOf(obs));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  if (rolls.length === 0) return null;
  const maxHp = defender.maxHP();
  if (maxHp <= 0) return null;
  return { min: Math.min(...rolls) / maxHp, max: Math.max(...rolls) / maxHp };
}

export function observationError(ctx: SolveContext, obs: ReadObservation, candidateKey: string, candidate: SpreadCandidate): number {
  const defenderSide = defenderSideOf(obs);
  const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
  const attackerSpread = attackerKey === candidateKey ? candidate : spreadFor(ctx, obs.attackerSide, obs.attackerSpecies);
  const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
  const defenderSpread = defenderKey === candidateKey ? candidate : spreadFor(ctx, defenderSide, obs.defenderSpecies);

  try {
    const range = rollRange(ctx, obs, attackerSpread, defenderSpread);
    if (!range) return 0;
    const { min, max } = range;
    // A lethal hit only says "at least this much": rungs whose best roll
    // could not reach the remaining HP are refuted, overkill rungs are
    // consistent. Read as a reading, every knock-out pulled the solve
    // toward "bulkier defender, weaker attacker" (573756 p1 Toxapex).
    const distance = obs.lethal
      ? (obs.observedFraction > max ? obs.observedFraction - max : 0)
      : obs.observedFraction < min
        ? min - obs.observedFraction
        : obs.observedFraction > max ? obs.observedFraction - max : 0;
    return Math.max(0, distance - OBSERVATION_SLACK) ** 2;
  } catch {
    // Unknown move/species for this gen: the observation cannot judge.
    return 0;
  }
}

/**
 * The Speed stat of a spread on the set's level and IVs (the spread's own IVs first; a battle forme's base
 * Speed when one raced; Stat Points in evs on Champions' generation 0, which reads no IV), 0 when the calc cannot build the species.
 */
export function speedStat(ctx: SolveContext, side: 'p1' | 'p2', species: string, spread: SpreadCandidate, forme?: string): number {
  const set = setOf(ctx, side, species);
  const name = forme ?? set?.species ?? species;
  const evs = coupleSpecial(spread.evs, ctx.budget);
  const ivs = coupleSpecial(spread.ivs ?? set?.ivs, ctx.budget);
  for (const candidate of [name, name.split('-')[0]]) {
    try {
      return buildCalcPokemon(ctx.gen, candidate, { level: set?.level || 100, nature: spread.nature, evs, ivs }).stats.spe;
    } catch {
      // Unknown forme: try the base species.
    }
  }
  return 0;
}

/** A move-order decision beats the set's item: a Scarf inferred in, or a guessed Scarf dropped. */
function holdsScarf(ctx: SolveContext, side: 'p1' | 'p2', species: string): boolean {
  const decision = ctx.scarf.get(keyOf(side, species));
  if (decision === 'holds') return true;
  if (decision === 'lacks') return false;
  return toId(setOf(ctx, side, species)?.item ?? '') === 'choicescarf';
}

/** Whether a race ran with a Scarf: the one the order says the mover held (round 63), else its holder's set's or decision's. */
export function racedWithScarf(ctx: SolveContext, mover: RaceSide): boolean {
  const holder = mover.holder ?? mover;
  return mover.held ?? holdsScarf(ctx, holder.side, holder.species);
}

/** The Speed a race ran at: the stat in the forme that raced, with the Scarf as the simulator rounds it (round 64). */
function effectiveSpeed(ctx: SolveContext, mover: RaceSide, spread: SpreadCandidate): number {
  return raceSpeed(simGenNum(ctx.gen), speedStat(ctx, mover.side, mover.species, spread, mover.forme), racedWithScarf(ctx, mover));
}

/**
 * A knock-out on a victim whose set runs a move below priority 0 (Trick
 * Room, Roar, Teleport): the victim may have clicked it and moved last at
 * any Speed, so the order is weak evidence (round 63). Priorities from the
 * Dex of the replay's generation.
 */
export function weakRace(ctx: SolveContext, order: ReadOrder): boolean {
  if (!order.knockOut) return false;
  const dex = Dex.forGen(simGenNum(ctx.gen));
  return (setOf(ctx, order.secondSide, order.secondSpecies)?.moves ?? []).some(move => dex.moves.get(move).priority < 0);
}

export function speedError(ctx: SolveContext, key: string, candidate: SpreadCandidate): number {
  let violations = 0;
  for (const order of ctx.speedByMon.get(key) ?? []) {
    const firstKey = keyOf(order.firstSide, order.firstSpecies);
    const firstSpread = firstKey === key ? candidate : spreadFor(ctx, order.firstSide, order.firstSpecies);
    const secondKey = keyOf(order.secondSide, order.secondSpecies);
    const secondSpread = secondKey === key ? candidate : spreadFor(ctx, order.secondSide, order.secondSpecies);
    if (effectiveSpeed(ctx, firstOf(order), firstSpread) < effectiveSpeed(ctx, secondOf(order), secondSpread)) {
      violations += 1;
    }
  }
  return violations * SPEED_VIOLATION_PENALTY;
}

export function physicalAttackerFor(ctx: SolveContext, key: string): boolean {
  const { gen } = ctx;
  const attacking = (ctx.byMon.get(key) ?? []).filter(obs => keyOf(obs.attackerSide, obs.attackerSpecies) === key);
  if (attacking.length === 0) {
    // Never observed attacking — classify by the set's damaging moves so
    // the leftover-EV fill lands in the right offense stat.
    const [side, species] = key.split(':') as ['p1' | 'p2', string];
    let physical = 0;
    let special = 0;
    for (const name of setOf(ctx, side, species)?.moves ?? []) {
      const category = gen.moves.get(toId(name) as Parameters<typeof gen.moves.get>[0])?.category;
      if (category === 'Physical') physical += 1;
      else if (category === 'Special') special += 1;
    }
    return physical >= special;
  }
  let physical = 0;
  for (const obs of attacking) {
    const category = gen.moves.get(obs.moveId as Parameters<typeof gen.moves.get>[0])?.category;
    if (category !== 'Special') physical += 1;
  }
  return physical * 2 >= attacking.length;
}

/** A changed nature weighs as much as 64 moved EVs; on Stat Points as the points with the same stats (8). */
const NATURE_DISTANCE_EVS = 64;

/**
 * Roll ranges are wide: opposite rungs (0 EV and 252 EV) can BOTH fit an
 * observation with zero error. Ties break toward the mon's prior guess —
 * evidence that cannot distinguish must not move the spread.
 */
export function priorDistance(ctx: SolveContext, key: string, rung: CandidateRung): number {
  const prior = ctx.priors.get(key);
  if (!prior) return 0;
  const stats: (keyof PokemonEvs)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const evDistance = stats.reduce((sum, stat) => sum + Math.abs((rung.evs[stat] ?? 0) - (prior.evs[stat] ?? 0)), 0);
  const natureDistance = ctx.budget.statPoints ? statPointsOfEv(NATURE_DISTANCE_EVS) : NATURE_DISTANCE_EVS;
  return evDistance + (rung.nature === prior.nature ? 0 : natureDistance);
}
