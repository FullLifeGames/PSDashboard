import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { effectiveSpeed } from '../speed';
import { EVAL_WEIGHTS, type EvalFeatures } from './weights';
import { hazardCost, hazardRemovalEquity, strandedMons } from './hazards';
import { threatGetter, type MatchupCache } from './threat';
import { matchupTerms, sweepCells } from './matchup';

/**
 * The raw feature vector: per-side bodies, boosts, hazards, screens,
 * tailwind, and the Choice mismatch, then the p1-positive differences with
 * the matchup, coverage, and sweep terms.
 */

const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);

const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

/**
 * Residual items are beyond-horizon drips (Black Sludge erodes 1/8 a turn —
 * exactly what kills a Cosmic Power wincon after a Trick): price them like
 * status, as a body-value multiplier. Tactical items (Choice damage, Eviolite
 * bulk) stay in the threat proxy instead.
 */
function itemMultiplier(pokemon: Pokemon): number {
  const item = pokemon.item;
  if (item === 'blacksludge') return pokemon.types.includes('Poison') ? 1.03 : 0.9;
  if (item === 'stickybarb') return 0.9;
  if (item === 'leftovers') return 1.03;
  return 1;
}

function averageSpeed(side: Side, battle: Battle): number {
  const living = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  if (living.length === 0) return 0;
  return living.reduce((sum, pokemon) => sum + effectiveSpeed(pokemon, battle), 0) / living.length;
}

/**
 * A living body's share of the (alive + hp) weight, status and item folded
 * in. A stranded piece keeps only its damped alive share: its hp share
 * prices at effHp (0 by definition of stranded), and it leaves hazardCost
 * — the entry that finishes it is charged here at certainty, never twice.
 */
function bodyShare(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  const bodyValue = stranded.has(pokemon)
    ? EVAL_WEIGHTS.alive * EVAL_WEIGHTS.strandedAlive
    : EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp);
  return (bodyValue / bodyWeight) *
    (EVAL_WEIGHTS.status[pokemon.status] ?? 1) * itemMultiplier(pokemon);
}

/** The Choice-item liability: the holder's status-move fraction (0 without a Choice item). */
function choiceMismatchOf(pokemon: Pokemon, battle: Battle): number {
  if (!(CHOICE_ITEMS.has(pokemon.item) && pokemon.moveSlots.length > 0)) return 0;
  const statusMoves = pokemon.moveSlots
    .filter(slot => battle.dex.moves.get(slot.id).category === 'Status').length;
  return statusMoves / pokemon.moveSlots.length;
}

/** Standing boost stages on the side's actives, weighted and status-discounted. */
function activeBoostValue(side: Side): number {
  let boosts = 0;
  for (const active of side.active) {
    if (!active || active.fainted) continue;
    const statusDiscount = EVAL_WEIGHTS.boostStatusDiscount[active.status] ?? 1;
    for (const [stat, stage] of Object.entries(active.boosts)) {
      if (!stage) continue;
      // Defensive stages read at half the offensive weight (12 vs 6).
      const statWeight = stat === 'atk' || stat === 'spa' || stat === 'spe' ? 1 : 0.5;
      const magnitude = EVAL_WEIGHTS.boostSchedule[Math.min(Math.abs(stage), 6)];
      boosts += Math.sign(stage) * statWeight * magnitude * statusDiscount;
    }
  }
  return boosts;
}

function screenCount(side: Side): number {
  let screens = 0;
  for (const id of SCREENS) {
    if (side.sideConditions[id]) screens += 1;
  }
  return screens;
}

function sideFeatureValues(side: Side, battle: Battle) {
  const stranded = strandedMons(side, battle);
  let bodies = 0;
  let choiceMismatch = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    bodies += bodyShare(pokemon, stranded);
    choiceMismatch += choiceMismatchOf(pokemon, battle);
  }
  const boosts = activeBoostValue(side);
  const screens = screenCount(side);
  return {
    bodies,
    boosts,
    choiceMismatch,
    screens,
    // Raw value carries the cap and the removal option; the entries weight
    // scales back to points.
    // Stranded mons leave the victim term (their fatal entry is priced in
    // bodies at certainty); equity is only nonzero when a removal carrier
    // lives, and then `stranded` is empty — the two never overlap.
    hazards: (hazardCost(side, battle, stranded) - hazardRemovalEquity(side, battle)) / EVAL_WEIGHTS.hazardEntries,
    tailwind: side.sideConditions['tailwind'] ? 1 : 0,
  };
}

export function evalFeatures(battle: Battle, cache?: MatchupCache): EvalFeatures {
  const p1 = sideFeatureValues(battle.sides[0], battle);
  const p2 = sideFeatureValues(battle.sides[1], battle);
  let trickRoom = 0;
  if (battle.field.pseudoWeather['trickroom']) {
    trickRoom = averageSpeed(battle.sides[0], battle) <= averageSpeed(battle.sides[1], battle) ? 1 : -1;
  }
  const terms = matchupTerms(battle, cache);
  const threat = threatGetter(battle, cache);
  // Fainted-body fraction, inline (importing search.ts here would cycle).
  let faintedBodies = 0;
  let totalBodies = 0;
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      totalBodies += 1;
      if (pokemon.fainted || pokemon.hp <= 0) faintedBodies += 1;
    }
  }
  const faintedFraction = totalBodies > 0 ? faintedBodies / totalBodies : 0;
  const damp = EVAL_WEIGHTS.matchupEarlyDamp;
  const matchupPhase = damp + (1 - damp) * Math.min(1, faintedFraction * 3);
  const p1Cells = sweepCells(0, battle, threat);
  const p2Cells = sweepCells(1, battle, threat);
  return {
    bodies: p1.bodies - p2.bodies,
    boosts: p1.boosts - p2.boosts,
    hazards: p2.hazards - p1.hazards, // hazards on THEIR side favor p1
    screens: p1.screens - p2.screens,
    tailwind: p1.tailwind - p2.tailwind,
    trickRoom,
    matchup: terms.matchup * matchupPhase,
    coverage: terms.coverage,
    choiceMismatch: p2.choiceMismatch - p1.choiceMismatch,
    sweepFastKo: p1Cells.fastKo - p2Cells.fastKo,
    sweepFastChip: p1Cells.fastChip - p2Cells.fastChip,
    sweepSlowKo: p1Cells.slowKo - p2Cells.slowKo,
    sweepSlowChip: p1Cells.slowChip - p2Cells.slowChip,
  };
}
