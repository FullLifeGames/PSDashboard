import type { Battle, Pokemon, Side } from '@pkmn/sim';

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
} as const;

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
   * Win-condition value of standing boosts: per side, Σ over living mons
   * with a positive offensive stage of (coverageBoosted − coverageUnboosted)
   * × hpFraction, where coverage = fraction of the opponent's living team
   * the mon beats 1v1. A boost only counts for the pairs it FLIPS — +2 into
   * a wall that still counters prices at zero. Captured for the fit
   * harness; weight 0 keeps it runtime-inert until a fit adopts it.
   */
  sweep: number;
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
  sweep: 0,
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

function averageSpeed(side: Side): number {
  const living = side.pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  if (living.length === 0) return 0;
  return living.reduce((sum, pokemon) => sum + pokemon.storedStats.spe, 0) / living.length;
}

/**
 * Victim-aware hazard cost for the side the hazards lie on, capped at
 * `hazardCap`. Exported for direct testing.
 */
export function hazardCost(side: Side, battle: Battle): number {
  const hasRocks = !!side.sideConditions['stealthrock'];
  const spikesLayers = Math.min(side.sideConditions['spikes']?.layers ?? 0, 3);
  const hasToxicSpikes = !!side.sideConditions['toxicspikes'];
  const hasWeb = !!side.sideConditions['stickyweb'];
  if (!hasRocks && !spikesLayers && !hasToxicSpikes && !hasWeb) return 0;

  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  const gravityActive = !!battle.field.pseudoWeather['gravity'];
  let cost = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') continue;
    // The sim's own grounding (Gravity, Iron Ball, Magnet Rise, Air Balloon,
    // Roost, …). One correction: the sim ignores an INACTIVE mon's ability,
    // but hazard pricing is about future ENTRIES — where Levitate applies —
    // so benched Levitate mons stay priced as airborne (unless Gravity).
    const grounded = !!pokemon.isGrounded() &&
      !(!pokemon.isActive && !gravityActive && pokemon.ability === 'levitate');
    let fraction = 0;
    if (hasRocks) {
      fraction += 0.125 * Math.pow(2, battle.dex.getEffectiveness('Rock', pokemon.types));
    }
    if (grounded) {
      if (spikesLayers) fraction += [0, 1 / 8, 1 / 6, 1 / 4][spikesLayers];
      // Dex-typed Toxic Spikes immunity (Poison/Steel via the type chart).
      if (hasToxicSpikes && battle.dex.getImmunity('psn', pokemon.types)) {
        fraction += 0.06; // priced as a slice of the psn/tox status cost
      }
      if (hasWeb) fraction += 0.04;
    }
    cost += bodyWeight * fraction * EVAL_WEIGHTS.hazardEntries;
  }
  return Math.min(cost, EVAL_WEIGHTS.hazardCap);
}

function sideFeatureValues(side: Side, battle: Battle) {
  const bodyWeight = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp;
  let bodies = 0;
  let boosts = 0;
  let choiceMismatch = 0;
  let screens = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    bodies += ((EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp)) / bodyWeight) *
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
    // Raw value carries the cap; the entries weight scales back to points.
    hazards: hazardCost(side, battle) / EVAL_WEIGHTS.hazardEntries,
    tailwind: side.sideConditions['tailwind'] ? 1 : 0,
  };
}

export function evalFeatures(battle: Battle, cache?: MatchupCache): EvalFeatures {
  const p1 = sideFeatureValues(battle.sides[0], battle);
  const p2 = sideFeatureValues(battle.sides[1], battle);
  let trickRoom = 0;
  if (battle.field.pseudoWeather['trickroom']) {
    trickRoom = averageSpeed(battle.sides[0]) <= averageSpeed(battle.sides[1]) ? 1 : -1;
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
    sweep: sweepValue(0, battle, threat) - sweepValue(1, battle, threat),
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

function pairKey(attacker: Pokemon, defender: Pokemon): string {
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}:${lockedMoveId(attacker) ?? ''}>` +
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
  let priority = false;
  // A choice-locked attacker only ever clicks its locked move again — a lock
  // into a resisted attack (or a status move) ends its threat outright.
  const locked = lockedMoveId(attacker);
  const slots = locked ? attacker.moveSlots.filter(slot => slot.id === locked) : attacker.moveSlots;
  for (const slot of slots) {
    const moveFraction = singleMoveFraction(attacker, defender, slot.id, battle);
    if (moveFraction > 0) {
      const move = battle.dex.moves.get(slot.id);
      if (move.category === 'Physical') physical = Math.max(physical, moveFraction);
      else special = Math.max(special, moveFraction);
      if (move.priority > 0) priority = true;
    }
  }
  return { physical, special, priority };
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
 * Aggregated 1v1 threat terms from p1's perspective. `matchup` in [-1, +1]:
 * for every living pair, whoever KOs first (against current HP) wins the
 * pair, speed breaking ties; pairs are weighted by both sides' HP fractions.
 * `coverage` is MAX-based per enemy: each living Pokémon that the other side
 * has NO favorable trade against contributes its answer deficit × its HP
 * fraction (p1-positive). Exported for direct testing.
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
 * fewer turns to KO wins, priority then speed break ties, a ~50%-per-turn
 * healer walls anything short of a 2HKO. The optional override substitutes
 * the attacker's offensive stages (the sweep feature asks "who would this
 * mon beat WITHOUT its boosts?").
 */
function beatsPair(
  a: Pokemon,
  b: Pokemon,
  threatA: PairThreat,
  threatB: PairThreat,
  aHeals: boolean,
  bHeals: boolean,
  aBoosts?: { atk: number; spa: number },
): boolean {
  const boostedA = boostedFraction(threatA, a, b, aBoosts);
  const boostedB = boostedFraction(threatB, b, a);
  const fracA = boostedA <= 0.5 && bHeals ? 0 : boostedA;
  const fracB = boostedB <= 0.5 && aHeals ? 0 : boostedB;
  const turnsA = fracA > 0 ? Math.ceil(b.hp / b.maxhp / fracA) : Infinity;
  const turnsB = fracB > 0 ? Math.ceil(a.hp / a.maxhp / fracB) : Infinity;
  if (turnsA < turnsB) return true;
  if (turnsB < turnsA || turnsA === Infinity) return false;
  if (threatA.priority !== threatB.priority) return threatA.priority;
  return a.storedStats.spe * stageMultiplier(a.boosts.spe) >
    b.storedStats.spe * stageMultiplier(b.boosts.spe);
}

/** One side's sweep value (see EvalFeatures.sweep). */
function sweepValue(
  sideIndex: 0 | 1,
  battle: Battle,
  threat: (attacker: Pokemon, defender: Pokemon) => PairThreat,
): number {
  const living = (index: number) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const mine = living(sideIndex);
  const theirs = living(1 - sideIndex);
  if (theirs.length === 0) return 0;
  const heals = (pokemon: Pokemon): boolean =>
    pokemon.moveSlots.some(slot => !!battle.dex.moves.get(slot.id).flags['heal']);
  let value = 0;
  for (const a of mine) {
    if ((a.boosts.atk ?? 0) <= 0 && (a.boosts.spa ?? 0) <= 0) continue;
    const aHeals = heals(a);
    let flipped = 0;
    for (const b of theirs) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      const bHeals = heals(b);
      if (beatsPair(a, b, threatA, threatB, aHeals, bHeals) &&
        !beatsPair(a, b, threatA, threatB, aHeals, bHeals, { atk: 0, spa: 0 })) {
        flipped += 1;
      }
    }
    value += (flipped / theirs.length) * (a.hp / a.maxhp);
  }
  return value;
}

export function matchupTerms(battle: Battle, cache?: MatchupCache): { matchup: number; coverage: number } {
  const living = (index: 0 | 1) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const p1Living = living(0);
  const p2Living = living(1);
  if (p1Living.length === 0 || p2Living.length === 0) return { matchup: 0, coverage: 0 };

  const threat = threatGetter(battle, cache);

  const healers = new Map<Pokemon, boolean>();
  const heals = (pokemon: Pokemon): boolean => {
    let value = healers.get(pokemon);
    if (value === undefined) {
      value = pokemon.moveSlots.some(slot => !!battle.dex.moves.get(slot.id).flags['heal']);
      healers.set(pokemon, value);
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
      const boostedA = boostedFraction(threatA, a, b);
      const boostedB = boostedFraction(threatB, b, a);
      // A defender that can heal ~50% per turn walls anything short of a 2HKO.
      const fracA = boostedA <= 0.5 && heals(b) ? 0 : boostedA;
      const fracB = boostedB <= 0.5 && heals(a) ? 0 : boostedB;
      bestAnswerToP2.set(b, Math.max(bestAnswerToP2.get(b) ?? -Infinity, fracA - fracB));
      bestAnswerToP1.set(a, Math.max(bestAnswerToP1.get(a) ?? -Infinity, fracB - fracA));
      const turnsA = fracA > 0 ? Math.ceil(b.hp / b.maxhp / fracA) : Infinity;
      const turnsB = fracB > 0 ? Math.ceil(a.hp / a.maxhp / fracB) : Infinity;
      let sign = 0;
      if (turnsA < turnsB) sign = 1;
      else if (turnsB < turnsA) sign = -1;
      else if (turnsA !== Infinity) {
        if (threatA.priority !== threatB.priority) sign = threatA.priority ? 1 : -1;
        else {
          sign = Math.sign(a.storedStats.spe * stageMultiplier(a.boosts.spe) -
            b.storedStats.spe * stageMultiplier(b.boosts.spe));
        }
      }
      const weight = a.isActive && b.isActive ? EVAL_WEIGHTS.activePair : 1;
      sum += weight * sign * (a.hp / a.maxhp) * (b.hp / b.maxhp);
      totalWeight += weight;
    }
  }
  let coverage = 0;
  for (const [enemy, margin] of bestAnswerToP2) {
    if (margin < 0) coverage -= Math.min(-margin, 1) * (enemy.hp / enemy.maxhp);
  }
  for (const [enemy, margin] of bestAnswerToP1) {
    if (margin < 0) coverage += Math.min(-margin, 1) * (enemy.hp / enemy.maxhp);
  }
  return { matchup: totalWeight > 0 ? sum / totalWeight : 0, coverage };
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
