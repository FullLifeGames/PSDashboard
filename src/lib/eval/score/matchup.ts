import type { Battle, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed';
import { EVAL_WEIGHTS } from './weights';
import { hazardEntryFraction } from './hazards';
import { boostedFraction, livingMons, threatGetter, type MatchupCache, type PairThreat } from './threat';
import { healProfile, ppBudget, raceClocks, raceSide, statusResidual, type RaceClocks, type RaceSide } from './races';

/**
 * The aggregated 1v1 terms: every living pair raced on its clocks, the
 * uncovered-threat coverage, and the boost-flip sweep cells.
 */

/**
 * KO-first 1v1 verdict for one pair, same semantics as the matchup term:
 * fewer race-clock turns to KO wins (raceClocks: heal-PP absorption, action
 * economy, PP budgets), priority then speed break ties. The optional
 * override substitutes the attacker's offensive stages (the sweep feature
 * asks "who would this mon beat WITHOUT its boosts?").
 */
function beatsPair(
  a: Pokemon,
  b: Pokemon,
  threatA: PairThreat,
  threatB: PairThreat,
  battle: Battle,
  aBoosts?: { atk: number; spa: number },
): boolean {
  const { turnsA, turnsB } = raceClocks(
    raceSide(a, a.hp / a.maxhp, boostedFraction(threatA, a, b, aBoosts), battle),
    raceSide(b, b.hp / b.maxhp, boostedFraction(threatB, b, a), battle),
  );
  if (turnsA < turnsB) return true;
  if (turnsB < turnsA || turnsA === Infinity) return false;
  return movesFirst(a, b, threatA, threatB, battle);
}

interface SweepCells { fastKo: number; fastChip: number; slowKo: number; slowChip: number }

/** One side's sweep cells (see EvalFeatures.sweepFastKo). */
export function sweepCells(
  sideIndex: 0 | 1,
  battle: Battle,
  threat: (attacker: Pokemon, defender: Pokemon) => PairThreat,
): SweepCells {
  const mine = livingMons(battle, sideIndex);
  const theirs = livingMons(battle, 1 - sideIndex);
  const cells: SweepCells = { fastKo: 0, fastChip: 0, slowKo: 0, slowChip: 0 };
  if (theirs.length === 0) return cells;
  for (const a of mine) {
    if ((a.boosts.atk ?? 0) <= 0 && (a.boosts.spa ?? 0) <= 0) continue;
    for (const b of theirs) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      if (!beatsPair(a, b, threatA, threatB, battle) ||
        beatsPair(a, b, threatA, threatB, battle, { atk: 0, spa: 0 })) {
        continue;
      }
      const weight = (1 / theirs.length) * (a.hp / a.maxhp);
      const fast = movesFirst(a, b, threatA, threatB, battle);
      const ko = boostedFraction(threatA, a, b) >= b.hp / b.maxhp;
      if (fast && ko) cells.fastKo += weight;
      else if (fast) cells.fastChip += weight;
      else if (ko) cells.slowKo += weight;
      else cells.slowChip += weight;
    }
  }
  return cells;
}

/** Per-mon race inputs memoized for one matchupTerms call — loop-invariant across pairs. */
interface RaceInputs {
  /** Hazard-adjusted arrival HP of a benched mon, live HP of an active one. */
  effHp: (pokemon: Pokemon) => number;
  raceSideOf: (pokemon: Pokemon, frac: number) => RaceSide;
}

function raceInputs(battle: Battle): RaceInputs {
  // Wincon-vs-hazards interaction: a BENCHED mon fights through its entry
  // damage — its pressure is weighed by the HP it would actually arrive
  // with (Boots/Magic Guard/airborne mons pay nothing via
  // hazardEntryFraction). Actives are already on the field. A mon whose
  // entry would kill it contributes nothing — hazards can fully disable a
  // benched sweeper, which the additive hazards term alone never saw.
  const effHpMemo = new Map<Pokemon, number>();
  const effHp = (pokemon: Pokemon): number => {
    let value = effHpMemo.get(pokemon);
    if (value === undefined) {
      const hp = pokemon.hp / pokemon.maxhp;
      value = pokemon.isActive
        ? hp
        : Math.max(0, hp - hazardEntryFraction(pokemon, pokemon.side, battle));
      effHpMemo.set(pokemon, value);
    }
    return value;
  };

  // Race-side PP inputs memoized per mon — loop-invariant across pairs.
  const profiles = new Map<Pokemon, { rate: number; absorb: number }>();
  const profileOf = (pokemon: Pokemon): { rate: number; absorb: number } => {
    let value = profiles.get(pokemon);
    if (value === undefined) {
      value = healProfile(pokemon, battle);
      profiles.set(pokemon, value);
    }
    return value;
  };
  const budgets = new Map<Pokemon, number>();
  const budgetOf = (pokemon: Pokemon): number => {
    let value = budgets.get(pokemon);
    if (value === undefined) {
      value = ppBudget(pokemon);
      budgets.set(pokemon, value);
    }
    return value;
  };
  const raceSideOf = (pokemon: Pokemon, frac: number): RaceSide => ({
    hp: effHp(pokemon), frac, residual: statusResidual(pokemon),
    healRate: profileOf(pokemon).rate, healAbsorb: profileOf(pokemon).absorb, ppBudget: budgetOf(pokemon),
  });
  return { effHp, raceSideOf };
}

/** Who wins the pair: the faster race clock, then (finite ties) the speed order in either direction. */
function pairSign(
  a: Pokemon,
  b: Pokemon,
  threatA: PairThreat,
  threatB: PairThreat,
  clocks: RaceClocks,
  battle: Battle,
): number {
  const { turnsA, turnsB } = clocks;
  if (turnsA < turnsB) return 1;
  if (turnsB < turnsA) return -1;
  if (turnsA !== Infinity) {
    if (movesFirst(a, b, threatA, threatB, battle)) return 1;
    if (movesFirst(b, a, threatB, threatA, battle)) return -1;
  }
  return 0;
}

/** Coverage: each enemy no remaining teammate trades favorably against, its answer deficit × HP (p1-positive). */
function coverageFrom(
  bestAnswerToP2: Map<Pokemon, number>,
  bestAnswerToP1: Map<Pokemon, number>,
  effHp: (pokemon: Pokemon) => number,
): number {
  let coverage = 0;
  for (const [enemy, margin] of bestAnswerToP2) {
    if (margin < 0) coverage -= Math.min(-margin, 1) * effHp(enemy);
  }
  for (const [enemy, margin] of bestAnswerToP1) {
    if (margin < 0) coverage += Math.min(-margin, 1) * effHp(enemy);
  }
  return coverage;
}

/**
 * Aggregated 1v1 threat terms from p1's perspective. `matchup` in [-1, +1]:
 * for every living pair, whoever's race clock lands first wins the pair
 * (raceClocks: heal-PP absorption, action economy, PP budgets — no infinite
 * walls), speed breaking ties; pairs are weighted by both sides' HP
 * fractions. `coverage` is MAX-based per enemy: each living Pokémon that the
 * other side has NO favorable trade against contributes its answer deficit ×
 * its HP fraction (p1-positive). Exported for direct testing.
 */
export function matchupTerms(battle: Battle, cache?: MatchupCache): { matchup: number; coverage: number } {
  const p1Living = livingMons(battle, 0);
  const p2Living = livingMons(battle, 1);
  if (p1Living.length === 0 || p2Living.length === 0) return { matchup: 0, coverage: 0 };

  const threat = threatGetter(battle, cache);
  const inputs = raceInputs(battle);
  let sum = 0;
  let totalWeight = 0;
  // Per-enemy best answer margins (my best fraction minus theirs).
  const bestAnswerToP2 = new Map<Pokemon, number>(); // p2 mon -> best p1 margin
  const bestAnswerToP1 = new Map<Pokemon, number>(); // p1 mon -> best p2 margin
  for (const a of p1Living) {
    for (const b of p2Living) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      const clocks = raceClocks(
        inputs.raceSideOf(a, boostedFraction(threatA, a, b)),
        inputs.raceSideOf(b, boostedFraction(threatB, b, a)),
      );
      // Answer margins read the race's effective offense: an attacker held
      // by a (now finite) wall keeps its partial answer, a pinned healer
      // stops counting as one.
      bestAnswerToP2.set(b, Math.max(bestAnswerToP2.get(b) ?? -Infinity, clocks.effFracA - clocks.effFracB));
      bestAnswerToP1.set(a, Math.max(bestAnswerToP1.get(a) ?? -Infinity, clocks.effFracB - clocks.effFracA));
      const sign = pairSign(a, b, threatA, threatB, clocks, battle);
      const weight = a.isActive && b.isActive ? EVAL_WEIGHTS.activePair : 1;
      sum += weight * sign * inputs.effHp(a) * inputs.effHp(b);
      totalWeight += weight;
    }
  }
  const coverage = coverageFrom(bestAnswerToP2, bestAnswerToP1, inputs.effHp);
  return { matchup: totalWeight > 0 ? sum / totalWeight : 0, coverage };
}
