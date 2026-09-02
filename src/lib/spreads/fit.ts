import { Generations, Pokemon, Move, Field, calculate } from '@smogon/calc';
import type { PokemonSet } from '@pkmn/sim';
import type { DamageObservation, PokemonEvs, SpeedOrderObservation } from '../../types';
import { WEATHER_BY_ID } from '../calc-field';
import { typedHiddenPowerId } from '../hidden-power';
import { evBudget, ZERO_EVS, type EvBudget } from './ev-budget';
import type { CandidateRung, SpreadCandidate } from './ladder';
import { toId } from '../ids';

/**
 * A violated move-order constraint outweighs any damage-fit error: the log
 * PROVED the order, while damage rolls only bound spreads. Rungs violating a
 * constraint lose to any non-violating rung; if every rung violates
 * (conflicting evidence), damage fit still decides among them.
 */
const SPEED_VIOLATION_PENALTY = 1000;

/** HP-bar reading noise (the GPL pipeline is ±1–2%): error inside this slack is free. */
const OBSERVATION_SLACK = 0.02;

/** Client condition ids the shared calc map doesn't spell out. */
const WEATHER_ALIASES: Record<string, string> = {
  sand: 'sandstorm', rain: 'raindance', sun: 'sunnyday',
};

const weatherFor = (raw: string) => WEATHER_BY_ID[WEATHER_ALIASES[toId(raw)] ?? toId(raw)];

/** Everything one spread solve shares between its scoring functions. */
export interface SolveContext {
  gen: ReturnType<typeof Generations.get>;
  budget: EvBudget;
  sets: { p1: PokemonSet[]; p2: PokemonSet[] };
  solved: Map<string, SpreadCandidate>;
  /** Observations per mon (as attacker AND as defender). */
  byMon: Map<string, DamageObservation[]>;
  /** Observed same-turn move order, indexed per participant. */
  speedByMon: Map<string, SpeedOrderObservation[]>;
  priors: Map<string, SpreadCandidate>;
}

function genOf(formatid: string) {
  const genNumber = parseInt(formatid.match(/^gen(\d)/)?.[1] ?? '9', 10);
  return Generations.get(Math.min(Math.max(genNumber, 1), 9) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9);
}

export const keyOf = (side: 'p1' | 'p2', species: string) => `${side}:${toId(species)}`;

function setOf(ctx: SolveContext, side: 'p1' | 'p2', species: string): PokemonSet | undefined {
  return ctx.sets[side].find(entry => toId(entry.species) === toId(species) || toId(entry.name || '') === toId(species));
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
  speedOrders: SpeedOrderObservation[],
): SolveContext {
  const ctx: SolveContext = {
    gen: genOf(formatid),
    budget: evBudget(formatid),
    sets,
    solved: new Map<string, SpreadCandidate>(),
    byMon: new Map<string, DamageObservation[]>(),
    speedByMon: new Map<string, SpeedOrderObservation[]>(),
    priors: new Map<string, SpreadCandidate>(),
  };
  const { byMon, speedByMon } = ctx;

  for (const obs of observations) {
    const defenderSide = obs.attackerSide === 'p1' ? 'p2' : 'p1';
    if (setOf(ctx, obs.attackerSide, obs.attackerSpecies) && setOf(ctx, defenderSide, obs.defenderSpecies)) {
      const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
      const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
      byMon.set(attackerKey, [...(byMon.get(attackerKey) ?? []), obs]);
      byMon.set(defenderKey, [...(byMon.get(defenderKey) ?? []), obs]);
    }
  }

  for (const order of speedOrders) {
    if (!setOf(ctx, order.firstSide, order.firstSpecies) || !setOf(ctx, order.secondSide, order.secondSpecies)) continue;
    const firstKey = keyOf(order.firstSide, order.firstSpecies);
    const secondKey = keyOf(order.secondSide, order.secondSpecies);
    if (firstKey === secondKey) continue;
    speedByMon.set(firstKey, [...(speedByMon.get(firstKey) ?? []), order]);
    speedByMon.set(secondKey, [...(speedByMon.get(secondKey) ?? []), order]);
  }
  return ctx;
}

export function spreadFor(ctx: SolveContext, side: 'p1' | 'p2', species: string): SpreadCandidate {
  const key = keyOf(side, species);
  const existing = ctx.solved.get(key);
  if (existing) return existing;
  const set = setOf(ctx, side, species);
  return { evs: { ...ZERO_EVS, ...(set?.evs ?? {}) }, nature: set?.nature || 'Hardy' };
}

function calcPokemon(ctx: SolveContext, side: 'p1' | 'p2', species: string, spread: SpreadCandidate, obsBoosts: Record<string, number>, status: string) {
  const set = setOf(ctx, side, species);
  return new Pokemon(ctx.gen, set?.species ?? species, {
    level: set?.level || 100,
    ability: set?.ability || undefined,
    item: set?.item || undefined,
    nature: spread.nature,
    evs: spread.evs,
    ivs: set?.ivs,
    boosts: obsBoosts,
    status: (status || undefined) as ConstructorParameters<typeof Pokemon>[2] extends { status?: infer S } ? S : never,
  });
}

/** The calc's roll range for one observation under the candidate spread, as HP fractions. */
function rollRange(ctx: SolveContext, obs: DamageObservation, attackerSpread: SpreadCandidate, defenderSpread: SpreadCandidate): { min: number; max: number } | null {
  const { gen } = ctx;
  const defenderSide = obs.attackerSide === 'p1' ? 'p2' : 'p1';
  const attacker = calcPokemon(ctx, obs.attackerSide, obs.attackerSpecies, attackerSpread, obs.attackerBoosts, obs.attackerStatus);
  const defender = calcPokemon(ctx, defenderSide, obs.defenderSpecies, defenderSpread, obs.defenderBoosts, '');
  const screens = new Set(obs.screens);
  // The protocol records typeless "hiddenpower"; calc it as the SET's
  // resolved variant, or the fit runs the IV-default type against a hit
  // the sim plays typed (653785: Dark-fitted spreads, Ice-rolled sim).
  const calcMoveId = obs.moveId === 'hiddenpower'
    ? typedHiddenPowerId(setOf(ctx, obs.attackerSide, obs.attackerSpecies)?.moves ?? []) ?? obs.moveId
    : obs.moveId;
  const result = calculate(gen, attacker, defender, new Move(gen, calcMoveId), new Field({
    weather: weatherFor(obs.weather),
    defenderSide: {
      isReflect: screens.has('reflect'),
      isLightScreen: screens.has('lightscreen'),
      isAuroraVeil: screens.has('auroraveil'),
    },
  }));
  const rolls = (Array.isArray(result.damage) ? (result.damage as number[]).flat() : [Number(result.damage)]).map(Number);
  if (rolls.length === 0) return null;
  const maxHp = defender.maxHP();
  if (maxHp <= 0) return null;
  return { min: Math.min(...rolls) / maxHp, max: Math.max(...rolls) / maxHp };
}

export function observationError(ctx: SolveContext, obs: DamageObservation, candidateKey: string, candidate: SpreadCandidate): number {
  const defenderSide = obs.attackerSide === 'p1' ? 'p2' : 'p1';
  const attackerKey = keyOf(obs.attackerSide, obs.attackerSpecies);
  const attackerSpread = attackerKey === candidateKey ? candidate : spreadFor(ctx, obs.attackerSide, obs.attackerSpecies);
  const defenderKey = keyOf(defenderSide, obs.defenderSpecies);
  const defenderSpread = defenderKey === candidateKey ? candidate : spreadFor(ctx, defenderSide, obs.defenderSpecies);

  try {
    const range = rollRange(ctx, obs, attackerSpread, defenderSpread);
    if (!range) return 0;
    const { min, max } = range;
    const distance = obs.observedFraction < min
      ? min - obs.observedFraction
      : obs.observedFraction > max ? obs.observedFraction - max : 0;
    return Math.max(0, distance - OBSERVATION_SLACK) ** 2;
  } catch {
    // Unknown move/species for this gen: the observation cannot judge.
    return 0;
  }
}

function effectiveSpeed(ctx: SolveContext, side: 'p1' | 'p2', species: string, spread: SpreadCandidate): number {
  const set = setOf(ctx, side, species);
  try {
    const mon = new Pokemon(ctx.gen, set?.species ?? species, {
      level: set?.level || 100,
      nature: spread.nature,
      evs: spread.evs,
      ivs: set?.ivs,
    });
    return mon.stats.spe * (toId(set?.item ?? '') === 'choicescarf' ? 1.5 : 1);
  } catch {
    return 0;
  }
}

export function speedError(ctx: SolveContext, key: string, candidate: SpreadCandidate): number {
  let violations = 0;
  for (const order of ctx.speedByMon.get(key) ?? []) {
    const firstKey = keyOf(order.firstSide, order.firstSpecies);
    const firstSpread = firstKey === key ? candidate : spreadFor(ctx, order.firstSide, order.firstSpecies);
    const secondKey = keyOf(order.secondSide, order.secondSpecies);
    const secondSpread = secondKey === key ? candidate : spreadFor(ctx, order.secondSide, order.secondSpecies);
    if (effectiveSpeed(ctx, order.firstSide, order.firstSpecies, firstSpread) <
      effectiveSpeed(ctx, order.secondSide, order.secondSpecies, secondSpread)) {
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
  return evDistance + (rung.nature === prior.nature ? 0 : 64);
}
