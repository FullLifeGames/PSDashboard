import type { Battle, BoostsTable, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { EVAL_WEIGHTS } from './weights.ts';
import { hazardEntryFraction } from './hazards.ts';
import { boostedFraction, livingMons, threatGetter, type MatchupCache, type PairThreat } from './threat.ts';
import { idleHolders, withoutRaises } from './boost-race.ts';
import { healProfile, ppBudget, raceClocks, raceSide, statusResidual, type RaceClocks, type RaceSide } from './races.ts';

function beatsPair(
  a: Pokemon,
  b: Pokemon,
  threatA: PairThreat,
  threatB: PairThreat,
  battle: Battle,
): boolean {
  const { turnsA, turnsB } = raceClocks(
    raceSide(a, a.hp / a.maxhp, boostedFraction(threatA, a, b), battle),
    raceSide(b, b.hp / b.maxhp, boostedFraction(threatB, b, a), battle),
  );
  if (turnsA < turnsB) return true;
  if (turnsB < turnsA || turnsA === Infinity) return false;
  return movesFirst(a, b, threatA, threatB, battle);
}

interface SweepCells { fastKo: number; fastChip: number; slowKo: number; slowChip: number }

const NO_STAGES: Readonly<BoostsTable> = Object.freeze({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 });

// No stages at all: resetting only Attack and Special Attack would keep a Calm Mind's Special Defense in the race.
const unboosted = (pokemon: Pokemon): Pokemon => Object.create(pokemon, { boosts: { value: NO_STAGES } }) as Pokemon;

export function sweepCells(
  sideIndex: 0 | 1,
  battle: Battle,
  threat: (attacker: Pokemon, defender: Pokemon) => PairThreat,
  idle: ReadonlySet<Pokemon>,
): SweepCells {
  const mine = livingMons(battle, sideIndex);
  const theirs = livingMons(battle, 1 - sideIndex);
  const cells: SweepCells = { fastKo: 0, fastChip: 0, slowKo: 0, slowChip: 0 };
  if (theirs.length === 0) return cells;
  for (const a of mine) {
    if ((a.boosts.atk ?? 0) <= 0 && (a.boosts.spa ?? 0) <= 0) continue;
    if (idle.has(a)) continue;
    for (const b of theirs) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      if (!beatsPair(a, b, threatA, threatB, battle) ||
        beatsPair(unboosted(a), b, threatA, threatB, battle)) {
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

interface RaceInputs {
  /** Hazard-adjusted arrival HP of a benched mon, live HP of an active one. */
  effHp: (pokemon: Pokemon) => number;
  raceSideOf: (pokemon: Pokemon, frac: number) => RaceSide;
}

function raceInputs(battle: Battle): RaceInputs {
  // A benched mon is weighed by the HP it arrives with; one whose entry would kill it contributes nothing.
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

// A side the foe moves ahead of and takes down with its best hit never gets to heal: its heal PP are no wall.
function unhealedIfBeaten(side: RaceSide, foeFrac: number, foeFirst: () => boolean): RaceSide {
  if (side.healRate <= 0 && side.healAbsorb <= 0) return side;
  if (foeFrac < side.hp || !foeFirst()) return side;
  return { ...side, healRate: 0, healAbsorb: 0 };
}

// The winner's HP share alone, signed: weighing both shares let a lost pair count less the lower the loser's HP.
function pairValue(sign: number, hpA: number, hpB: number): number {
  return sign > 0 ? hpA : sign < 0 ? -hpB : 0;
}

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

/** `matchup` is in [-1, +1], pairs weighted by both HP fractions; `coverage` is max-based per enemy (deficit × HP). */
export function matchupTerms(
  battle: Battle,
  cache?: MatchupCache,
  idle: ReadonlySet<Pokemon> | undefined = undefined,
): { matchup: number; coverage: number } {
  const p1Living = livingMons(battle, 0);
  const p2Living = livingMons(battle, 1);
  if (p1Living.length === 0 || p2Living.length === 0) return { matchup: 0, coverage: 0 };

  const threat = threatGetter(battle, cache);
  const idleBodies = idle ?? idleHolders(battle, threat);
  // A body that never acts is read on its drops only: Foul Play would price the target's stage.
  const offence = (mon: Pokemon): Pokemon => (idleBodies.has(mon) ? withoutRaises(mon) : mon);
  const inputs = raceInputs(battle);
  let sum = 0;
  let totalWeight = 0;
  const bestAnswerToP2 = new Map<Pokemon, number>();
  const bestAnswerToP1 = new Map<Pokemon, number>();
  for (const a of p1Living) {
    for (const b of p2Living) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      const fracA = boostedFraction(threatA, offence(a), offence(b));
      const fracB = boostedFraction(threatB, offence(b), offence(a));
      const clocks = raceClocks(
        unhealedIfBeaten(inputs.raceSideOf(a, fracA), fracB, () => movesFirst(b, a, threatB, threatA, battle)),
        unhealedIfBeaten(inputs.raceSideOf(b, fracB), fracA, () => movesFirst(a, b, threatA, threatB, battle)),
      );
      // Answer margins read the race's effective offense: a pinned healer stops counting as one.
      bestAnswerToP2.set(b, Math.max(bestAnswerToP2.get(b) ?? -Infinity, clocks.effFracA - clocks.effFracB));
      bestAnswerToP1.set(a, Math.max(bestAnswerToP1.get(a) ?? -Infinity, clocks.effFracB - clocks.effFracA));
      const sign = pairSign(a, b, threatA, threatB, clocks, battle);
      const weight = a.isActive && b.isActive ? EVAL_WEIGHTS.activePair : 1;
      sum += weight * pairValue(sign, inputs.effHp(a), inputs.effHp(b));
      totalWeight += weight;
    }
  }
  const coverage = coverageFrom(bestAnswerToP2, bestAnswerToP1, inputs.effHp);
  return { matchup: totalWeight > 0 ? sum / totalWeight : 0, coverage };
}
