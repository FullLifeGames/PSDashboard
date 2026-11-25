import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { effectiveSpeed } from '../speed.ts';
import { EVAL_WEIGHTS, type EvalFeatures } from './weights.ts';
import { hazardCost, hazardRemovalEquity, strandedMons } from './hazards.ts';
import { liveTypes, livingOf, threatGetter, type MatchupCache } from './threat.ts';
import { idleHolders } from './boost-race.ts';
import { matchupTerms, sweepCells } from './matchup.ts';
import { fieldPairCells } from './field-pair.ts';
import { boostBiteValue, removalFormat, stageValue } from './boost-bite.ts';
import { stageStands } from './switch-out.ts';
import { residualReader } from './residuals.ts';
import { hitReader } from './contact.ts';
import { statusRight } from './status-factor.ts';
import { choiceItems, standingScreens } from '@fulllifegames/replay-core';

const NO_PAIR = { focus: 0, redirect: 0 };

// Residual items are drips beyond the search horizon: priced like status, as a body-value multiplier.
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

// A stranded body keeps only its damped alive share and leaves hazardCost: the entry that finishes it is charged here.
function bodyShare(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>): number {
  return (bodyFraction(pokemon, stranded) *
    (EVAL_WEIGHTS.status[pokemon.status] ?? 1)) * itemMultiplier(pokemon);
}

function bodyFraction(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  const bodyValue = stranded.has(pokemon)
    ? EVAL_WEIGHTS.alive * EVAL_WEIGHTS.strandedAlive
    : EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp);
  return bodyValue / bodyWeight;
}

function statusFixOf(pokemon: Pokemon, stranded: ReadonlySet<Pokemon>, twin: string): number {
  const applied = EVAL_WEIGHTS.status[pokemon.status];
  if (applied === undefined) return 0;
  const right = statusRight(twin, pokemon.ability, pokemon.status, applied);
  return right === applied ? 0 : (right - applied) * bodyFraction(pokemon, stranded) * itemMultiplier(pokemon);
}

function choiceMismatchOf(pokemon: Pokemon, battle: Battle): number {
  if (!(choiceItems(battle.dex).has(pokemon.item) && pokemon.moveSlots.length > 0)) return 0;
  const statusMoves = pokemon.moveSlots
    .filter(slot => battle.dex.moves.get(slot.id).category === 'Status').length;
  return statusMoves / pokemon.moveSlots.length;
}

// A body that never acts (`idle`) gets no value for raised stages; its drops stay, so losing HP never gains by a drop.
// A drop stands only while the holder cannot switch out (score/switch-out.ts). Doubles OU reads this term, others 0.
function activeBoostValue(side: Side, idle: ReadonlySet<Pokemon>, battle: Battle): number {
  let boosts = 0;
  for (const active of side.active) {
    if (!active || active.fainted) continue;
    const never = idle.has(active);
    for (const [stat, stage] of Object.entries(active.boosts)) {
      if (stage && !(never && stage > 0) && stageStands(battle, active, stage)) boosts += stageValue(active, stat, stage);
    }
  }
  return boosts;
}

function screenCount(side: Side): number {
  return standingScreens(side).length;
}

function sideFeatureValues(side: Side, battle: Battle, twin: string | null, idle: ReadonlySet<Pokemon>) {
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
  const boosts = activeBoostValue(side, idle, battle);
  const screens = screenCount(side);
  return {
    bodies,
    boosts,
    choiceMismatch,
    statusFix,
    screens,
    // The raw value carries the cap and the removal option; the entries weight scales it back to points.
    hazards: (hazardCost(side, battle, stranded) - hazardRemovalEquity(side, battle)) / EVAL_WEIGHTS.hazardEntries,
    tailwind: side.sideConditions['tailwind'] ? 1 : 0,
  };
}

/** Inline because importing search.ts here would cycle; the same count as battleFaintedFraction. */
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

/** With a weight table a column of weight 0 stays 0 unread; without one (capture, fit, tests) every column is read. */
export function evalFeatures(battle: Battle, cache?: MatchupCache, weights?: Readonly<Record<keyof EvalFeatures, number>>): EvalFeatures {
  const wants = (key: keyof EvalFeatures): boolean => !weights || weights[key] !== 0;
  const twin = wants('statusFix') ? removalFormat(battle) : null;
  const threat = threatGetter(battle, cache);
  const idle = idleHolders(battle, threat);
  const p1 = sideFeatureValues(battle.sides[0], battle, twin, idle);
  const p2 = sideFeatureValues(battle.sides[1], battle, twin, idle);
  let trickRoom = 0;
  if (battle.field.pseudoWeather['trickroom']) {
    trickRoom = averageSpeed(battle.sides[0], battle) <= averageSpeed(battle.sides[1], battle) ? 1 : -1;
  }
  const terms = matchupTerms(battle, cache, idle);
  const residuals = residualReader(battle);
  const hits = hitReader(battle);
  const faintedFraction = faintedFractionOf(battle);
  const damp = EVAL_WEIGHTS.matchupEarlyDamp;
  const matchupPhase = damp + (1 - damp) * Math.min(1, faintedFraction * 3);
  const p1Cells = sweepCells(0, battle, threat, idle);
  const p2Cells = sweepCells(1, battle, threat, idle);
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
      ? boostBiteValue(battle.sides[0], 0, battle, threat, residuals, hits, idle) - boostBiteValue(battle.sides[1], 1, battle, threat, residuals, hits, idle)
      : 0,
    statusFix: p1.statusFix - p2.statusFix,
  };
}
