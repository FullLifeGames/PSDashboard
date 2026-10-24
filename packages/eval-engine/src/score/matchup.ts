import type { Battle, BoostsTable, Pokemon } from '@pkmn/sim';
import { movesFirst } from '../speed.ts';
import { EVAL_WEIGHTS } from './weights.ts';
import { hazardEntryFraction } from './hazards.ts';
import { boostedFraction, livingMons, threatGetter, type MatchupCache, type PairThreat } from './threat.ts';
import { idleHolders, withoutRaises } from './boost-race.ts';
import { healProfile, ppBudget, raceClocks, raceSide, statusResidual, type RaceClocks, type RaceSide } from './races.ts';

/**
 * The aggregated 1v1 terms: every living pair raced on its clocks, the
 * uncovered-threat coverage, and the boost-flip sweep cells.
 */

/**
 * KO-first 1v1 verdict for one pair, same semantics as the matchup term:
 * fewer race-clock turns to KO wins (raceClocks: heal-PP absorption, action
 * economy, PP budgets), priority then speed break ties.
 */
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

/**
 * The mon without its boosts (round 64, T125): a view of the body on no
 * stages at all, every other read and write going to the view (the idiom of
 * onStages in move-facts.ts). Resetting only Attack and Special Attack kept a
 * Calm Mind's Special Defense in the foe's race, a Dragon Dance's Speed in
 * the move order and an Iron Defense under Body Press.
 */
const unboosted = (pokemon: Pokemon): Pokemon => Object.create(pokemon, { boosts: { value: NO_STAGES } }) as Pokemon;

/** One side's sweep cells (see EvalFeatures.sweepFastKo). */
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

/**
 * T248 (round 73): a side the foe moves ahead of and takes down with its best hit never gets to heal, so its heal PP
 * are no wall. One HP point above that hit the race priced the heals as a wall, one point below as a lost race, and a
 * hit taken raised the grade (573756 turn 73, Toxapex 282 to 281 of 303). `foeFrac` is the foe's best hit as a share
 * of the maximum; the side keeps its attack, so the clocks read the pair as the plain race it is.
 */
function unhealedIfBeaten(side: RaceSide, foeFrac: number, foeFirst: () => boolean): RaceSide {
  if (side.healRate <= 0 && side.healAbsorb <= 0) return side;
  if (foeFrac < side.hp || !foeFirst()) return side;
  return { ...side, healRate: 0, healAbsorb: 0 };
}

/**
 * The value of one pair for p1 (round 73, T248): the HP share of the side that wins it, signed for the winner. The pair
 * used to weigh both bodies' shares, so a lost pair counted less the lower the loser's HP and a hit p1 took raised the
 * matchup (and a hit p1 landed on the loser of a won pair lowered it); in a small board the bodies term could not
 * cancel that (gen9vgc-2629703929 turn 13: a 1v1 lost at 88 of 176 HP). The winner's share keeps every step the
 * right way: more HP for the winner, or less for the loser, never moves the pair against the side it helps. A body
 * whose entry hazards would kill it has no HP share and loses its pairs at the foe's share.
 */
function pairValue(sign: number, hpA: number, hpB: number): number {
  return sign > 0 ? hpA : sign < 0 ? -hpB : 0;
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
  // A body that never acts is read on its drops only, as the attacker and as the defender: a hit that reads the target's own
  // stat (Foul Play) would otherwise price the stage of a body that is KO'd before it matters (round 76, 12a, after T258).
  const offence = (mon: Pokemon): Pokemon => (idleBodies.has(mon) ? withoutRaises(mon) : mon);
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
      const fracA = boostedFraction(threatA, offence(a), offence(b));
      const fracB = boostedFraction(threatB, offence(b), offence(a));
      const clocks = raceClocks(
        unhealedIfBeaten(inputs.raceSideOf(a, fracA), fracB, () => movesFirst(b, a, threatB, threatA, battle)),
        unhealedIfBeaten(inputs.raceSideOf(b, fracB), fracA, () => movesFirst(a, b, threatA, threatB, battle)),
      );
      // Answer margins read the race's effective offense: an attacker held
      // by a (now finite) wall keeps its partial answer, a pinned healer
      // stops counting as one.
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
