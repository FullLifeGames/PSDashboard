import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { effectiveSpeed } from '../speed.ts';
import { EVAL_WEIGHTS, type EvalFeatures } from './weights.ts';
import { hazardCost, hazardRemovalEquity, strandedMons } from './hazards.ts';
import { liveTypes, livingOf, threatGetter, type MatchupCache } from './threat.ts';
import { matchupTerms, sweepCells } from './matchup.ts';
import { fieldPairCells } from './field-pair.ts';
import { boostBiteValue, removalFormat, stageValue } from './boost-bite.ts';
import { residualReader } from './residuals.ts';
import { hitReader } from './contact.ts';
import { statusRight } from './status-factor.ts';

/**
 * The raw feature vector: per-side bodies, boosts, hazards, screens,
 * tailwind, and the Choice mismatch, then the p1-positive differences with
 * the matchup, coverage, and sweep terms.
 */

const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);

const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

const NO_PAIR = { focus: 0, redirect: 0 };

/**
 * Residual items are beyond-horizon drips (Black Sludge erodes 1/8 a turn —
 * exactly what kills a Cosmic Power wincon after a Trick): price them like
 * status, as a body-value multiplier. Tactical items (Choice damage, Eviolite
 * bulk) stay in the threat proxy instead.
 */
function itemMultiplier(pokemon: Pokemon): number {
  const item = pokemon.item;
  if (item === 'blacksludge') return liveTypes(pokemon).includes('Poison') ? 1.03 : 0.9;
  if (item === 'stickybarb') return 0.9;
  if (item === 'leftovers') return 1.03;
  return 1;
}

function averageSpeed(side: Side, battle: Battle): number {
  const living = livingOf(side);
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
  return (bodyFraction(pokemon, stranded) *
    (EVAL_WEIGHTS.status[pokemon.status] ?? 1)) * itemMultiplier(pokemon);
}

/** The body's share of the (alive + hp) weight before the status and the item. */
function bodyFraction(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  const bodyValue = stranded.has(pokemon)
    ? EVAL_WEIGHTS.alive * EVAL_WEIGHTS.strandedAlive
    : EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp);
  return bodyValue / bodyWeight;
}

/**
 * statusFix of one body: what the flat status multiplier took off wrongly,
 * (the right multiplier of its ability minus the applied one) times its share
 * before the status. 0 for a healthy body and for an ability that changes
 * nothing.
 */
function statusFixOf(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>, twin: string): number {
  const applied = EVAL_WEIGHTS.status[pokemon.status];
  if (applied === undefined) return 0;
  const right = statusRight(twin, pokemon.ability, pokemon.status, applied);
  return right === applied ? 0 : (right - applied) * bodyFraction(pokemon, stranded) * itemMultiplier(pokemon);
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
    for (const [stat, stage] of Object.entries(active.boosts)) {
      if (stage) boosts += stageValue(active, stat, stage);
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

function sideFeatureValues(side: Side, battle: Battle, twin: string | null) {
  const stranded = strandedMons(side, battle);
  let bodies = 0;
  let choiceMismatch = 0;
  let statusFix = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    bodies += bodyShare(pokemon, stranded);
    choiceMismatch += choiceMismatchOf(pokemon, battle);
    if (twin) statusFix += statusFixOf(pokemon, stranded, twin);
  }
  const boosts = activeBoostValue(side);
  const screens = screenCount(side);
  return {
    bodies,
    boosts,
    choiceMismatch,
    statusFix,
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

/** The share of fainted mons of both sides, inline (importing search.ts here would cycle); the same count as battleFaintedFraction. */
export function faintedFractionOf(battle: Battle): number {
  let fainted = 0;
  let total = 0;
  for (const side of battle.sides) {
    for (const pokemon of side.pokemon) {
      total += 1;
      if (pokemon.fainted || pokemon.hp <= 0) fainted += 1;
    }
  }
  return total > 0 ? fainted / total : 0;
}

/**
 * The feature vector of a position. With a weight table, a feature of the
 * round-69 columns (the field pair, boostsBiting, statusFix) whose weight is 0 stays 0
 * instead of being read: the score multiplies it by 0 either way, and the
 * leaf does not pay for a column no fit has priced. Without a table (the
 * capture, the fit, the tests) every column is read.
 */
export function evalFeatures(battle: Battle, cache?: MatchupCache, weights?: Readonly<Record<keyof EvalFeatures, number>>): EvalFeatures {
  const wants = (key: keyof EvalFeatures): boolean => !weights || weights[key] !== 0;
  const twin = wants('statusFix') ? removalFormat(battle) : null;
  const p1 = sideFeatureValues(battle.sides[0], battle, twin);
  const p2 = sideFeatureValues(battle.sides[1], battle, twin);
  let trickRoom = 0;
  if (battle.field.pseudoWeather['trickroom']) {
    trickRoom = averageSpeed(battle.sides[0], battle) <= averageSpeed(battle.sides[1], battle) ? 1 : -1;
  }
  const terms = matchupTerms(battle, cache);
  const threat = threatGetter(battle, cache);
  // The end of the turn is played (once, when a race asks for it) only for a board with a standing stage (score/residuals.ts).
  const residuals = residualReader(battle);
  // The hits of the pairs are played (once per pair of the process, score/contact.ts) only where a race asks for one.
  const hits = hitReader(battle);
  const faintedFraction = faintedFractionOf(battle);
  const damp = EVAL_WEIGHTS.matchupEarlyDamp;
  const matchupPhase = damp + (1 - damp) * Math.min(1, faintedFraction * 3);
  const p1Cells = sweepCells(0, battle, threat);
  const p2Cells = sweepCells(1, battle, threat);
  const pairs = wants('pairFocus') || wants('pairRedirect');
  const p1Pair = pairs ? fieldPairCells(0, battle, threat) : NO_PAIR;
  const p2Pair = pairs ? fieldPairCells(1, battle, threat) : NO_PAIR;
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
    pairFocus: p1Pair.focus - p2Pair.focus,
    pairRedirect: p1Pair.redirect - p2Pair.redirect,
    boostsBiting: wants('boostsBiting')
      ? boostBiteValue(battle.sides[0], 0, battle, threat, residuals, hits) - boostBiteValue(battle.sides[1], 1, battle, threat, residuals, hits)
      : 0,
    statusFix: p1.statusFix - p2.statusFix,
  };
}
