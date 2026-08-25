import type { Battle, Pokemon, Side } from '@pkmn/sim';
import { effectiveSpeed, movesFirst } from './speed';
import type { EntryUnanswered, UnansweredProfile } from './types';

/**
 * All tuning in one place. Values are points on an arbitrary scale; the final
 * score is normalized to [-1, +1]. Tactics (KO ranges, speed order) come from
 * the search, not from here — this stays positional.
 */
export const EVAL_WEIGHTS = {
  /** Flat value of a living Pokémon (bodies matter most). */
  alive: 100,
  /** Value of a full health bar, scaled by the current HP fraction. */
  hp: 100,
  /** Multipliers applied to a statused Pokémon's (alive + hp) contribution. */
  status: { brn: 0.85, par: 0.85, psn: 0.9, tox: 0.7, slp: 0.8, frz: 0.75 } as Record<string, number>,
  /**
   * Per boost stage on an active Pokémon (boosts vanish on switch): base
   * points × the diminishing schedule. Offensive stages (atk/spa/spe) carry
   * games; defensive stages read at half weight. Shape follows poke-engine's
   * field-tested curve — the payoff of a setup turn must live in the STATIC
   * eval, deeper search cannot see past its horizon.
   */
  boostStage: { offensive: 12, defensive: 6 },
  /** Cumulative stage multipliers (index = |stage|): +2 is twice +1, the tail flattens. */
  boostSchedule: [0, 1.0, 2.0, 2.5, 3.0, 3.15, 3.3],
  /**
   * Boosts on a statused sweeper sit on a timer — Toxic outruns recovery, so
   * the accumulated stages are worth half (the anti-setup Toxic becomes a
   * rankable line); psn/brn erode slower.
   */
  boostStatusDiscount: { tox: 0.5, psn: 0.8, brn: 0.8 } as Record<string, number>,
  /**
   * Hazards are priced by their VICTIMS, not per layer: each living Pokémon
   * on the suffering side contributes its body weight × the entry-damage
   * fraction the type chart actually assigns it (a 4x-rock Volcarona bleeds
   * 50% per entry, a Lucario 6%) × the expected future entries. A flat layer
   * weight recommended switching out of a rocks turn against rock-weak teams.
   */
  hazardEntries: 0.75,
  /** Per-side clamp on the hazard term (≈ 0.6 mons) so stacking cannot outweigh bodies. */
  hazardCap: 120,
  /** Per active screen (Reflect / Light Screen / Aurora Veil). */
  screen: 5,
  tailwind: 8,
  /** Awarded to the side whose remaining Pokémon are slower while Trick Room is up. */
  trickRoom: 10,
  /** Steepness of the tanh score mapping (a one-mon lead in a 6v6 ≈ ±0.4). */
  scale: 2.5,
  /** Weight of the aggregated 1v1 matchup term (full dominance ≈ 0.6 mons). */
  matchup: 120,
  /**
   * Extra weight on active-vs-active pairs in the matchup term: the mons on
   * the field apply the pressure, the bench only threatens to. Also what
   * makes lead choices visible at depth 1 — every leads cell shares the same
   * teams; only the actives differ.
   */
  activePair: 1.5,
  /**
   * Uncovered-threat term: MAX-based per enemy, unlike the sum-based matchup.
   * An enemy that NO remaining teammate trades favorably against is a
   * wincon-in-waiting — the sum dilutes that into an average, so losing the
   * sole answer (Rhydon vs Salazzle) read as cheap. Weighted per uncovered
   * enemy by its remaining HP.
   */
  coverage: 40,
  /**
   * A Choice item on a status-heavy moveset is a liability, not a boost —
   * the holder can never run its actual game plan again (the anti-setup
   * Trick). Scaled by the holder's status-move fraction: 4 attacks → 0.
   */
  choiceMismatch: 40,
  /**
   * Early-game damp on the matchup FEATURE VALUE: at zero faints the term
   * reads at damp × matchup, scaling linearly to full weight at ≥1/3 of all
   * bodies fainted. 1.0 = off. A phase multiplier folded into the raw value
   * like the other non-independent modifiers — NOT independently fittable
   * (it rescales a feature the fit already prices). Grid-tested 2026-08-09
   * at 1.0/0.75/0.5 through the calibration sweep; see the calibration
   * header for the recorded outcome.
   */
  matchupEarlyDamp: 1.0,
  /**
   * Fraction of a removal option's NET board-state relief that counts:
   * removal costs a tempo turn and can be punished, so the option is worth
   * half its exercise value. See hazardRemovalEquity — the net is
   * move-aware (Defog also destroys the side's OWN hazards on the
   * opponent's board; a net-negative option is never exercised and counts
   * zero). Folded into the raw hazard value — a non-independent modifier,
   * not fittable. Motivating case: draft T14, where switching into the
   * 4x-rock-weak Defog Talonflame read as walking deeper into the hazard
   * cost on the very turn that sets up the removal.
   */
  hazardRemovalDiscount: 0.5,
  /**
   * Alive-share multiplier for a STRANDED bench mon — one whose HP cannot
   * survive re-entering through its own side's hazards while the side has
   * no living removal carrier. Its hp share prices at effHp (0 by
   * definition of stranded); the remaining alive share is fodder/absorber
   * value. Hand weight, calibration-gated 2026-08-15 (spec: horizon
   * family ④; the depth-2 switch that strands a piece banked a phantom
   * body — 653785 t19, 655336 t23/t24).
   */
  strandedAlive: 0.5,
} as const;

const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);

/** Removal moves that clear ONLY the user's side (pure relief). */
const OWN_SIDE_REMOVAL_MOVES = new Set(['rapidspin', 'mortalspin', 'tidyup']);
/** Removal moves that clear (or swap) BOTH sides — double-edged. */
const BOTH_SIDES_REMOVAL_MOVES = new Set(['defog', 'courtchange']);

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

/**
 * Raw, unweighted feature values (p1-positive differences). The score is the
 * weighted sum through tanh — ONE code path shared by scoring and the WP 7
 * fitting harness, so fitted weights and runtime scores cannot diverge.
 * Multiplicative modifiers are NOT independent features: status and item
 * multipliers fold into `bodies`, the status discount into `boosts`, the
 * offensive/defensive split (2:1) and the cap/entries coupling into their
 * raw values. Only the top-level FEATURE_WEIGHTS are fittable.
 */
export interface EvalFeatures {
  bodies: number;
  boosts: number;
  hazards: number;
  screens: number;
  tailwind: number;
  trickRoom: number;
  matchup: number;
  coverage: number;
  choiceMismatch: number;
  /**
   * Win-condition value of standing boosts, split by HOW the sweep would
   * actually play out. Per side, over living mons with a positive offensive
   * stage, each pair the boost FLIPS (beats 1v1 boosted, loses unboosted)
   * contributes 1/enemies × hpFraction into exactly ONE cell:
   * fast = the sweeper acts first (movesFirst: priority rule, effective
   * speed, Trick Room), ko = the boosted best-move fraction covers the
   * target's current HP. The four cells sum to the old v1 flip value; the
   * fit prices them separately (no guessed factors). Weights 0 keep them
   * runtime-inert until a fit adopts them (round 9 design doc).
   */
  sweepFastKo: number;
  sweepFastChip: number;
  sweepSlowKo: number;
  sweepSlowChip: number;
}

export const FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  bodies: EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp,
  boosts: EVAL_WEIGHTS.boostStage.offensive,
  hazards: EVAL_WEIGHTS.hazardEntries,
  screens: EVAL_WEIGHTS.screen,
  tailwind: EVAL_WEIGHTS.tailwind,
  trickRoom: EVAL_WEIGHTS.trickRoom,
  matchup: EVAL_WEIGHTS.matchup,
  coverage: EVAL_WEIGHTS.coverage,
  choiceMismatch: EVAL_WEIGHTS.choiceMismatch,
  sweepFastKo: 0,
  sweepFastChip: 0,
  sweepSlowKo: 0,
  sweepSlowChip: 0,
};

/**
 * Doubles overrides, corpus-fitted 2026-08-08 (590 doubles/VGC games,
 * cluster-bootstrap significant): speed control and screens carry far more
 * win probability in doubles than the singles hand weights say — tailwind
 * 68±25 vs 8, Trick Room 87±27 vs 10, screens 103±40 vs 5, boosts 27±7 vs
 * 12. The direction matches doubles domain knowledge (speed control decides
 * VGC games); confounding (winning teams get their setup up) likely inflates
 * the magnitudes, so adoption is gated on the calibration buckets like every
 * other weight change. Features consistent with the hand weights (hazards,
 * matchup, coverage) keep them.
 */
export const DOUBLES_FEATURE_WEIGHTS: Record<keyof EvalFeatures, number> = {
  ...FEATURE_WEIGHTS,
  boosts: 27,
  tailwind: 68,
  trickRoom: 87,
};

export const featureWeights = (doubles: boolean): Record<keyof EvalFeatures, number> =>
  (doubles ? DOUBLES_FEATURE_WEIGHTS : FEATURE_WEIGHTS);

function averageSpeed(side: Side, battle: Battle): number {
  const living = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  if (living.length === 0) return 0;
  return living.reduce((sum, pokemon) => sum + effectiveSpeed(pokemon, battle), 0) / living.length;
}

/**
 * Victim-aware hazard cost for the side the hazards lie on, capped at
 * `hazardCap`. Exported for direct testing.
 */
export function hazardCost(side: Side, battle: Battle, exclude?: ReadonlySet<Pokemon>): number {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  let cost = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0 || exclude?.has(pokemon)) continue;
    cost += bodyWeight * hazardEntryFraction(pokemon, side, battle) * EVAL_WEIGHTS.hazardEntries;
  }
  return Math.min(cost, EVAL_WEIGHTS.hazardCap);
}

/**
 * The entry-damage fraction THIS mon pays to switch into its side's
 * hazards — the shared per-mon term behind hazardCost and the matchup
 * entry discount. 0 for Heavy-Duty Boots and Magic Guard; ground-bound
 * hazards use the sim's grounding (with the bench-Levitate correction:
 * the sim ignores an INACTIVE mon's ability, but entry pricing is about
 * the moment it becomes active); Toxic Spikes immunity is dex-typed.
 */
export function hazardEntryFraction(pokemon: Pokemon, side: Side, battle: Battle): number {
  const hasRocks = !!side.sideConditions['stealthrock'];
  const spikesLayers = Math.min(side.sideConditions['spikes']?.layers ?? 0, 3);
  const hasToxicSpikes = !!side.sideConditions['toxicspikes'];
  const hasWeb = !!side.sideConditions['stickyweb'];
  if (!hasRocks && !spikesLayers && !hasToxicSpikes && !hasWeb) return 0;
  if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') return 0;

  const gravityActive = !!battle.field.pseudoWeather['gravity'];
  const grounded = !!pokemon.isGrounded() &&
    !(!pokemon.isActive && !gravityActive && pokemon.ability === 'levitate');
  let fraction = 0;
  if (hasRocks) {
    fraction += 0.125 * Math.pow(2, battle.dex.getEffectiveness('Rock', pokemon.types));
  }
  if (grounded) {
    if (spikesLayers) fraction += [0, 1 / 8, 1 / 6, 1 / 4][spikesLayers];
    if (hasToxicSpikes && battle.dex.getImmunity('psn', pokemon.types)) {
      fraction += 0.06; // priced as a slice of the psn/tox status cost
    }
    if (hasWeb) fraction += 0.04;
  }
  return fraction;
}

/**
 * Living BENCHED mons that cannot survive re-entry through their own side's
 * hazards (hp fraction ≤ hazardEntryFraction — Boots, Magic Guard, the
 * bench-Levitate correction, and typed immunities all inherit from that
 * shared term). Empty while the side keeps a living removal carrier: a
 * piece that can wait for removal is not finished, and removal's own
 * option value is already priced by hazardRemovalEquity. Exported for
 * direct testing.
 */
export function strandedMons(side: Side, battle: Battle): Set<Pokemon> {
  const stranded = new Set<Pokemon>();
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      if (OWN_SIDE_REMOVAL_MOVES.has(slot.id) || BOTH_SIDES_REMOVAL_MOVES.has(slot.id)) {
        return stranded;
      }
    }
  }
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0 || pokemon.isActive) continue;
    const fraction = hazardEntryFraction(pokemon, side, battle);
    if (fraction > 0 && pokemon.hp / pokemon.maxhp <= fraction) stranded.add(pokemon);
  }
  return stranded;
}

/**
 * The OPTION VALUE a side's living hazard removers hold over the board
 * state: the best net hazard-cost change any of them could buy by clicking
 * their removal move, floored at zero (a net-negative option — Defog that
 * would also destroy the side's own more-valuable hazards on the opponent's
 * board — is simply never exercised), then tempo-discounted. Own-side-only
 * moves (Rapid Spin, Mortal Spin, Tidy Up) net the side's full relief;
 * both-sides moves (Defog, Court Change) net relief MINUS the side's own
 * hazards' worth over there. Exported for direct testing.
 */
export function hazardRemovalEquity(side: Side, battle: Battle): number {
  const own = hazardCost(side, battle);
  if (own <= 0) return 0;
  let best = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    for (const slot of usableSlots(pokemon)) {
      if (OWN_SIDE_REMOVAL_MOVES.has(slot.id)) {
        best = Math.max(best, own);
      } else if (BOTH_SIDES_REMOVAL_MOVES.has(slot.id)) {
        best = Math.max(best, own - hazardCost(side.foe, battle));
      }
    }
  }
  return Math.max(0, best) * EVAL_WEIGHTS.hazardRemovalDiscount;
}

function sideFeatureValues(side: Side, battle: Battle) {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  const stranded = strandedMons(side, battle);
  let bodies = 0;
  let boosts = 0;
  let choiceMismatch = 0;
  let screens = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    // A stranded piece keeps only its damped alive share: its hp share
    // prices at effHp (0 by definition of stranded), and it leaves
    // hazardCost below — the entry that finishes it is charged here at
    // certainty, never twice.
    const bodyValue = stranded.has(pokemon)
      ? EVAL_WEIGHTS.alive * EVAL_WEIGHTS.strandedAlive
      : EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp);
    bodies += (bodyValue / bodyWeight) *
      (EVAL_WEIGHTS.status[pokemon.status] ?? 1) * itemMultiplier(pokemon);
    if (CHOICE_ITEMS.has(pokemon.item) && pokemon.moveSlots.length > 0) {
      const statusMoves = pokemon.moveSlots
        .filter(slot => battle.dex.moves.get(slot.id).category === 'Status').length;
      choiceMismatch += statusMoves / pokemon.moveSlots.length;
    }
  }
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
  for (const id of SCREENS) {
    if (side.sideConditions[id]) screens += 1;
  }
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

/** HP- and boost-independent threat estimate of one attacker→defender direction. */
export interface PairThreat {
  /** Best expected physical-move damage as a fraction of the defender's max HP. */
  physical: number;
  /** Best expected special-move damage as a fraction of the defender's max HP. */
  special: number;
  /** The attacker carries a usable damaging priority move. */
  priority: boolean;
  /**
   * Accuracy (0–1, 1 = never misses) of the category-max move (round 14).
   * The narrative race weighs its rates by these — a 70% Hurricane is no
   * full-hit clock (648453 t13) — while the SCORE path never reads them:
   * matchup and coverage stay on the raw fractions. Optional so hand-built
   * threats in tests keep working; consumers default to 1.
   */
  physicalAcc?: number;
  specialAcc?: number;
}

/**
 * Memo for the HP-independent part of the matchup term. One cache spans one
 * search: the memoized threat depends only on species/level/set properties,
 * which are constant across every forked position of the same battle.
 */
export type MatchupCache = Map<string, PairThreat>;

export function createMatchupCache(): MatchupCache {
  return new Map();
}

/** The move a Choice item has locked this Pokémon into, if any. */
function lockedMoveId(pokemon: Pokemon): string | null {
  const locked = pokemon.volatiles['choicelock'] as { move?: string } | undefined;
  return locked?.move ?? null;
}

/**
 * Move slots with PP left to click. PP is read LIVE from the sim state and
 * never derived from dex base PP: pools differ across rule sets (Showdown
 * effectively always runs maxed PP Ups; Pokémon Champions runs different
 * counts), and the replay's PP bookkeeping is the only ground truth. A slot
 * without a pp field stays usable (defensive default). A fully drained mon
 * can still Struggle in reality, but its chip is no sustained threat — it
 * prices as threatless (573756: the Struggle-locked Toxapex kept pricing as
 * a full wall while it recoiled itself out).
 */
function usableSlots(pokemon: Pokemon) {
  return pokemon.moveSlots.filter(slot => (slot.pp ?? 1) > 0);
}

function pairKey(attacker: Pokemon, defender: Pokemon): string {
  // The usable-slot signature keys PP transitions: a move draining to zero
  // mid-search changes the attacker's threat, so it must miss the memo.
  const usable = usableSlots(attacker).map(slot => slot.id).join(',');
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}:${usable}>` +
    `${defender.side.id}:${defender.name}:${defender.species.id}:${defender.level}:${defender.item}:${defender.ability}`;
}

/** Defender abilities that blank (or halve) incoming move types in the proxy. */
const ABILITY_IMMUNITIES: Record<string, string[]> = {
  levitate: ['Ground'],
  flashfire: ['Fire'],
  wellbakedbody: ['Fire'],
  waterabsorb: ['Water'],
  dryskin: ['Water'],
  stormdrain: ['Water'],
  voltabsorb: ['Electric'],
  lightningrod: ['Electric'],
  motordrive: ['Electric'],
  sapsipper: ['Grass'],
  eartheater: ['Ground'],
};

/**
 * Best expected damage (as a fraction of the defender's max HP) among the
 * attacker's actual moves — standard damage formula with STAB, the type
 * chart, and the big item/ability modifiers. Status and fixed-damage moves
 * are invisible to this proxy.
 */
/**
 * Expected damage of one specific move as a fraction of the defender's max
 * HP under the proxy's rules — 0 for status/fixed-damage/immune moves.
 */
export function singleMoveFraction(attacker: Pokemon, defender: Pokemon, moveId: string, battle: Battle): number {
  const move = battle.dex.moves.get(moveId);
  if (!move.exists || move.category === 'Status' || !move.basePower) return 0;
  const blanked = ABILITY_IMMUNITIES[defender.ability] ?? [];
  if (blanked.includes(move.type)) return 0;
  if (!battle.dex.getImmunity(move.type, defender.types)) return 0;
  const typeMult = Math.pow(2, battle.dex.getEffectiveness(move.type, defender.types));
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;

  let offense = 1;
  if (attacker.item === 'lifeorb') offense *= 1.3;
  if (attacker.item === 'choiceband' && move.category === 'Physical') offense *= 1.5;
  if (attacker.item === 'choicespecs' && move.category === 'Special') offense *= 1.5;
  if (defender.ability === 'thickfat' && (move.type === 'Fire' || move.type === 'Ice')) offense *= 0.5;

  let bulk = 1;
  if (defender.item === 'eviolite' && defender.species.nfe) bulk *= 1.5;
  if (defender.item === 'assaultvest' && move.category === 'Special') bulk *= 1.5;

  const [atk, def] = move.category === 'Physical'
    ? [attacker.storedStats.atk, defender.storedStats.def]
    : [attacker.storedStats.spa, defender.storedStats.spd];
  const damage = (((2 * attacker.level / 5 + 2) * move.basePower * atk / def) / 50 + 2) *
    stab * typeMult * offense / bulk;
  return damage / defender.maxhp;
}

export function pairThreat(attacker: Pokemon, defender: Pokemon, battle: Battle): PairThreat {
  let physical = 0;
  let special = 0;
  let physicalAcc = 1;
  let specialAcc = 1;
  let priority = false;
  // A choice-locked attacker only ever clicks its locked move again — a lock
  // into a resisted attack (or a status move) ends its threat outright.
  const locked = lockedMoveId(attacker);
  const usable = usableSlots(attacker);
  const slots = locked ? usable.filter(slot => slot.id === locked) : usable;
  for (const slot of slots) {
    const moveFraction = singleMoveFraction(attacker, defender, slot.id, battle);
    if (moveFraction > 0) {
      const move = battle.dex.moves.get(slot.id);
      const accuracy = move.accuracy === true ? 1 : move.accuracy / 100;
      if (move.category === 'Physical') {
        if (moveFraction > physical) { physical = moveFraction; physicalAcc = accuracy; }
      } else if (moveFraction > special) { special = moveFraction; specialAcc = accuracy; }
      if (move.priority > 0) priority = true;
    }
  }
  return { physical, special, priority, physicalAcc, specialAcc };
}

/** Standard stage multiplier: +1 → 1.5x, −1 → 0.67x. */
const stageMultiplier = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));

/**
 * The memoized threat with the CURRENT boost stages applied. Stages stay
 * outside the memo key on purpose — they change between forked positions of
 * one search while the cached part does not. This is what makes setup moves
 * visible to the matchup term: +2 Atk doubles the pressure on every pair,
 * not just the flat boost weight. The optional override substitutes the
 * attacker's offensive stages (candidate hints price a setup move by the
 * stages it WOULD grant); defender stages always read live.
 */
export function boostedFraction(
  threat: PairThreat,
  attacker: Pokemon,
  defender: Pokemon,
  attackerBoosts?: { atk?: number; spa?: number },
): number {
  const atkStage = attackerBoosts?.atk ?? attacker.boosts.atk;
  const spaStage = attackerBoosts?.spa ?? attacker.boosts.spa;
  const physical = threat.physical * stageMultiplier(atkStage) / stageMultiplier(defender.boosts.def);
  const special = threat.special * stageMultiplier(spaStage) / stageMultiplier(defender.boosts.spd);
  return Math.max(physical, special);
}

/**
 * Fallback per-turn heal fraction for heal-flagged moves whose amount lives
 * in a callback instead of a dex ratio (the Moonlight family's weather
 * scaling, Rest's full-heal-but-sleep, Strength Sap's stat dependence):
 * ~50% is the grounded proxy. Moves with a direct dex ratio price exactly —
 * heal rates differ per move (Recover 1/2, Life Dew 1/4, …).
 */
const HEAL_FRACTION_DEFAULT = 0.5;

/**
 * Per-turn fraction a status burns off its holder (gen7+ residuals; toxic
 * priced at its early ramp). Magic Guard blanks residuals; Poison Heal turns
 * poison into upkeep — priced as merely no residual (the passive regen, like
 * item regen, stays out: second-order next to the race sign).
 */
const STATUS_RESIDUALS: Record<string, number> = { brn: 1 / 16, psn: 1 / 8, tox: 1 / 8 };

function statusResidual(pokemon: Pokemon): number {
  if (pokemon.ability === 'magicguard' || pokemon.ability === 'poisonheal') return 0;
  return STATUS_RESIDUALS[pokemon.status] ?? 0;
}

/**
 * The wall's finite fuel from usable heal moves: the best per-turn heal
 * rate, and the total HP fraction the remaining heal PP can restore
 * (Σ pp × per-move rate).
 */
function healProfile(pokemon: Pokemon, battle: Battle): { rate: number; absorb: number } {
  let rate = 0;
  let absorb = 0;
  for (const slot of usableSlots(pokemon)) {
    const move = battle.dex.moves.get(slot.id);
    if (!move.flags['heal']) continue;
    const fraction = move.heal ? move.heal[0] / move.heal[1] : HEAL_FRACTION_DEFAULT;
    rate = Math.max(rate, fraction);
    absorb += (slot.pp ?? 8) * fraction;
  }
  return { rate, absorb };
}

/**
 * Total usable PP — a coarse ceiling on how many turns of pressure the mon
 * can still produce (heal turns included; the Struggle a drained mon could
 * still click stays out, see usableSlots).
 */
function ppBudget(pokemon: Pokemon): number {
  let pp = 0;
  for (const slot of usableSlots(pokemon)) pp += slot.pp ?? 8;
  return pp;
}

/** One side of a 1v1 race, in HP fractions per turn. */
export interface RaceSide {
  /** Starting HP fraction (the matchup term passes hazard-adjusted entry HP). */
  hp: number;
  /** Best per-turn damage fraction onto the opponent (boost-adjusted). */
  frac: number;
  /** Per-turn status residual burning THIS side. */
  residual: number;
  /** Best per-turn heal fraction among usable heal moves (0 = no healer). */
  healRate: number;
  /** Total HP fraction the remaining heal PP can restore (Σ pp × rate). */
  healAbsorb: number;
  /** Total usable PP: the ceiling on turns of pressure this side can produce. */
  ppBudget: number;
}

export interface RaceClocks {
  /** Turns side A needs to KO side B (Infinity = never lands). */
  turnsA: number;
  turnsB: number;
  /** Offense after the wall's action economy (see below). */
  effFracA: number;
  effFracB: number;
}

/**
 * KO-race clocks for one pair, replacing the old "a healer walls anything
 * short of a 2HKO" pauschal (573756 t134–139: that rule priced a burned,
 * 3-Recover-PP Toxapex as unkillable AND let it heal and chip in the same
 * turn). Three deliberately coarse rules, all fed by live sim state:
 *
 * - Heal PP absorbs as survival: the remaining heal PP restore healAbsorb
 *   bars in total, so a defender soaks hp + healAbsorb before it falls —
 *   pure delay whether or not the wall arithmetic holds. Past the heal
 *   rate the held PP realize only at healRate/incoming efficiency (the
 *   healer heals at a net loss and dies with PP in the tank), so HP
 *   already on the body outprices PP in the tank — healing now beats
 *   holding (round 12).
 * - Action economy: a healer under pressure spends pressure/healRate of its
 *   turns healing and attacks only on the spare ones; under crumbling
 *   pressure (≥ its best heal rate, e.g. a burn tipping a borderline hit
 *   over the sustain) it is pinned — priced as never attacking, since it
 *   loses the pair either way.
 * - The PP budget caps every clock: a win that needs more turns than the
 *   attacker has PP never lands (a full-PP wall still walls — the slow
 *   attacker runs dry first).
 *
 * Residuals alone can finish a race (stall wars end by status), but a side
 * with no damaging move at all never wins one.
 */
export function raceClocks(a: RaceSide, b: RaceSide): RaceClocks {
  const spare = (side: RaceSide, incoming: number): number =>
    side.healRate > 0 && incoming > 0 ? Math.max(0, 1 - incoming / side.healRate) : 1;
  const incomingA = b.frac + a.residual;
  const incomingB = a.frac + b.residual;
  const effFracA = a.frac * spare(a, incomingA);
  const effFracB = b.frac * spare(b, incomingB);
  const clock = (attacker: RaceSide, effFrac: number, defender: RaceSide, incoming: number): number => {
    if (attacker.frac <= 0) return Infinity;
    const pressure = effFrac + defender.residual;
    if (pressure <= 0) return Infinity;
    // Held heal PP realize only at the pin efficiency (round 12): past the
    // heal rate the healer heals at a net loss and dies with PP in the
    // tank, so a bar held in PP is worth healRate/incoming of a bar on the
    // body — which is what makes healing NOW beat holding (655336 t26:
    // Slack Off must price over a free-turn Protect even in a lost race;
    // before this, hp + absorb was conserved by the heal click and a heal
    // turn priced at ~0).
    const absorb = defender.healRate > 0 && incoming > defender.healRate
      ? defender.healAbsorb * (defender.healRate / incoming)
      : defender.healAbsorb;
    // The epsilon keeps float noise (0.1 − 0.45/0.5 ≠ exactly 0.02) from
    // pushing an exact division over the next whole turn.
    const turns = Math.ceil((defender.hp + absorb) / pressure - 1e-9);
    return turns > attacker.ppBudget ? Infinity : turns;
  };
  return {
    turnsA: clock(a, effFracA, b, incomingB),
    turnsB: clock(b, effFracB, a, incomingA),
    effFracA,
    effFracB,
  };
}

/** Assembles one Pokémon's race side from live battle state. */
function raceSide(
  pokemon: Pokemon,
  hp: number,
  frac: number,
  battle: Battle,
): RaceSide {
  const heal = healProfile(pokemon, battle);
  return {
    hp,
    frac,
    residual: statusResidual(pokemon),
    healRate: heal.rate,
    healAbsorb: heal.absorb,
    ppBudget: ppBudget(pokemon),
  };
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
/** Memoizing accessor for pairThreat over one search's MatchupCache. */
function threatGetter(battle: Battle, cache?: MatchupCache) {
  return (attacker: Pokemon, defender: Pokemon): PairThreat => {
    if (!cache) return pairThreat(attacker, defender, battle);
    const key = pairKey(attacker, defender);
    let value = cache.get(key);
    if (value === undefined) {
      value = pairThreat(attacker, defender, battle);
      cache.set(key, value);
    }
    return value;
  };
}

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
function sweepCells(
  sideIndex: 0 | 1,
  battle: Battle,
  threat: (attacker: Pokemon, defender: Pokemon) => PairThreat,
): SweepCells {
  const living = (index: number) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const mine = living(sideIndex);
  const theirs = living(1 - sideIndex);
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

export function matchupTerms(battle: Battle, cache?: MatchupCache): { matchup: number; coverage: number } {
  const living = (index: 0 | 1) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const p1Living = living(0);
  const p2Living = living(1);
  if (p1Living.length === 0 || p2Living.length === 0) return { matchup: 0, coverage: 0 };

  const threat = threatGetter(battle, cache);

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

  let sum = 0;
  let totalWeight = 0;
  // Per-enemy best answer margins (my best fraction minus theirs).
  const bestAnswerToP2 = new Map<Pokemon, number>(); // p2 mon -> best p1 margin
  const bestAnswerToP1 = new Map<Pokemon, number>(); // p1 mon -> best p2 margin
  for (const a of p1Living) {
    for (const b of p2Living) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      const { turnsA, turnsB, effFracA, effFracB } = raceClocks(
        {
          hp: effHp(a), frac: boostedFraction(threatA, a, b), residual: statusResidual(a),
          healRate: profileOf(a).rate, healAbsorb: profileOf(a).absorb, ppBudget: budgetOf(a),
        },
        {
          hp: effHp(b), frac: boostedFraction(threatB, b, a), residual: statusResidual(b),
          healRate: profileOf(b).rate, healAbsorb: profileOf(b).absorb, ppBudget: budgetOf(b),
        },
      );
      // Answer margins read the race's effective offense: an attacker held
      // by a (now finite) wall keeps its partial answer, a pinned healer
      // stops counting as one.
      bestAnswerToP2.set(b, Math.max(bestAnswerToP2.get(b) ?? -Infinity, effFracA - effFracB));
      bestAnswerToP1.set(a, Math.max(bestAnswerToP1.get(a) ?? -Infinity, effFracB - effFracA));
      let sign = 0;
      if (turnsA < turnsB) sign = 1;
      else if (turnsB < turnsA) sign = -1;
      else if (turnsA !== Infinity) {
        if (movesFirst(a, b, threatA, threatB, battle)) sign = 1;
        else if (movesFirst(b, a, threatB, threatA, battle)) sign = -1;
      }
      const weight = a.isActive && b.isActive ? EVAL_WEIGHTS.activePair : 1;
      sum += weight * sign * effHp(a) * effHp(b);
      totalWeight += weight;
    }
  }
  let coverage = 0;
  for (const [enemy, margin] of bestAnswerToP2) {
    if (margin < 0) coverage -= Math.min(-margin, 1) * effHp(enemy);
  }
  for (const [enemy, margin] of bestAnswerToP1) {
    if (margin < 0) coverage += Math.min(-margin, 1) * effHp(enemy);
  }
  return { matchup: totalWeight > 0 ? sum / totalWeight : 0, coverage };
}

/**
 * Moves that flinch-lock a full-hit answer on the user's first field turn:
 * the fresh entry the profile narrates gets one free chip the standing
 * defender cannot answer (648453 t13: Lopunny's Fake Out into Tornadus-T).
 */
const FIRST_TURN_FLINCH_MOVES = new Set(['fakeout']);

/**
 * Living mons the OTHER side has no live answer to (round 13): the mon
 * beats EVERY living enemy's KO-race pair (strictly fewer turns, or a
 * finite tie taken on effective speed — a wall that merely holds the pair
 * is answer enough). A benched enemy answers by SWITCHING IN, so its race
 * runs from entry-tolled HP: the hazard-adjusted arrival the matchup term
 * prices, minus one free hit from the standing mon (the switch-in economy
 * behind the expert's no-switch-ins principle — 648453 t13: Weavile "wins"
 * the standing pair against Lopunny but not the entry, so any successful
 * switch into Lopunny — a U-turn included — turns profit and the opponent
 * can only sacrifice into it). Root-level narrative input; never part of
 * the score.
 *
 * Round 14 refinements, all profile-local (the score path never changes):
 * - Rates are EXPECTED rates (fraction × the max-move's accuracy) — a 70%
 *   Hurricane is no full-hit one-turn clock. The entry toll weighs the
 *   same way.
 * - A first-turn flinch move (Fake Out) chips the standing active for free
 *   before the race starts — the fresh entry's move the defender cannot
 *   answer.
 * - The SWITCH-IN stage: a mon every benched enemy loses the entry race to
 *   while a standing active still holds the pair is carried per side in the
 *   entry lists — the expert's literal "no remaining switch-ins" state
 *   (648453 t13, Lopunny vs the standing Tornadus-T). Only meaningful while
 *   the other side still has a bench, so a 1v1 endgame never enters it.
 */
export function unansweredMons(battle: Battle, cache?: MatchupCache): UnansweredProfile {
  const living = (index: 0 | 1) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const p1Living = living(0);
  const p2Living = living(1);
  if (p1Living.length === 0 || p2Living.length === 0) return { p1: [], p2: [] };

  const threat = threatGetter(battle, cache);
  const profiles = new Map<Pokemon, { rate: number; absorb: number }>();
  const budgets = new Map<Pokemon, number>();
  // Expected per-turn rate: the boost-adjusted fraction weighed by the
  // category-max move's accuracy (round 14) — the profile's races run on
  // what a turn is worth, not on the best case.
  const expectedRate = (threatOut: PairThreat, attacker: Pokemon, defender: Pokemon): number => {
    const physical = threatOut.physical * (threatOut.physicalAcc ?? 1) *
      stageMultiplier(attacker.boosts.atk) / stageMultiplier(defender.boosts.def);
    const special = threatOut.special * (threatOut.specialAcc ?? 1) *
      stageMultiplier(attacker.boosts.spa) / stageMultiplier(defender.boosts.spd);
    return Math.max(physical, special);
  };
  const side = (pokemon: Pokemon, threatOut: PairThreat, enemy: Pokemon): RaceSide => {
    let profile = profiles.get(pokemon);
    if (!profile) { profile = healProfile(pokemon, battle); profiles.set(pokemon, profile); }
    let budget = budgets.get(pokemon);
    if (budget === undefined) { budget = ppBudget(pokemon); budgets.set(pokemon, budget); }
    const hp = pokemon.hp / pokemon.maxhp;
    return {
      hp: pokemon.isActive ? hp : Math.max(0, hp - hazardEntryFraction(pokemon, pokemon.side, battle)),
      frac: expectedRate(threatOut, pokemon, enemy),
      residual: statusResidual(pokemon),
      healRate: profile.rate, healAbsorb: profile.absorb, ppBudget: budget,
    };
  };
  // The fresh entry's free chip: a usable first-turn flinch move lands once
  // before the standing defender gets a turn (its own accuracy is sure).
  const flinchChip = (standing: Pokemon, enemy: Pokemon): number => {
    const slot = usableSlots(standing).find(entry => FIRST_TURN_FLINCH_MOVES.has(entry.id));
    if (!slot) return 0;
    return singleMoveFraction(standing, enemy, slot.id, battle) *
      stageMultiplier(standing.boosts.atk) / stageMultiplier(enemy.boosts.def);
  };
  // Does the standing mon beat this enemy? Race verdict as the matchup term
  // weighs it; a benched enemy eats one free hit on the way in, a standing
  // one loses its first turn to the entry's flinch move.
  const beatsEntry = (standing: Pokemon, enemy: Pokemon): boolean => {
    const threatS = threat(standing, enemy);
    const threatE = threat(enemy, standing);
    const sideS = side(standing, threatS, enemy);
    const sideE = side(enemy, threatE, standing);
    if (!enemy.isActive) sideE.hp = Math.max(0, sideE.hp - expectedRate(threatS, standing, enemy));
    else sideE.hp = Math.max(0, sideE.hp - flinchChip(standing, enemy));
    const { turnsA, turnsB } = raceClocks(sideS, sideE);
    if (turnsA < turnsB) return true;
    if (turnsB < turnsA) return false;
    return turnsA !== Infinity && movesFirst(standing, enemy, threatS, threatE, battle);
  };
  const profile = (mine: Pokemon[], theirs: Pokemon[]): { full: string[]; entry: EntryUnanswered[] } => {
    const full: string[] = [];
    const entry: EntryUnanswered[] = [];
    const hasBench = theirs.some(enemy => !enemy.isActive);
    for (const mon of mine) {
      const verdicts = theirs.map(enemy => ({ enemy, beats: beatsEntry(mon, enemy) }));
      if (verdicts.every(verdict => verdict.beats)) { full.push(mon.species.name); continue; }
      if (!hasBench) continue;
      // Switch-in stage: only standing actives hold; every bench answer
      // dies on arrival.
      if (!verdicts.every(verdict => verdict.beats || verdict.enemy.isActive)) continue;
      const holder = verdicts.find(verdict => !verdict.beats)!.enemy;
      entry.push({ species: mon.species.name, heldBy: holder.species.name });
    }
    return { full, entry };
  };
  const p1Profile = profile(p1Living, p2Living);
  const p2Profile = profile(p2Living, p1Living);
  return {
    p1: p1Profile.full, p2: p2Profile.full,
    ...(p1Profile.entry.length > 0 ? { p1Entry: p1Profile.entry } : {}),
    ...(p2Profile.entry.length > 0 ? { p2Entry: p2Profile.entry } : {}),
  };
}

/** Static positional eval from p1's perspective in [-1, +1]; ±1 for ended battles. */
export function evaluatePosition(battle: Battle, cache?: MatchupCache): number {
  if (battle.ended) {
    if (!battle.winner) return 0;
    if (battle.winner === battle.sides[0].name) return 1;
    return -1;
  }

  const features = evalFeatures(battle, cache);
  const weights = featureWeights(battle.gameType === 'doubles');
  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  const normalizer = teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);
  let diff = 0;
  for (const key of Object.keys(weights) as (keyof EvalFeatures)[]) {
    diff += weights[key] * features[key];
  }
  return Math.tanh((diff / normalizer) * EVAL_WEIGHTS.scale);
}
