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
} as const;

const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

function pokemonScore(pokemon: Pokemon): number {
  if (pokemon.fainted || pokemon.hp <= 0) return 0;
  const base = EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp * (pokemon.hp / pokemon.maxhp);
  const statusMultiplier = EVAL_WEIGHTS.status[pokemon.status] ?? 1;
  return base * statusMultiplier;
}

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
  let cost = 0;
  for (const pokemon of side.pokemon) {
    if (pokemon.fainted || pokemon.hp <= 0) continue;
    if (pokemon.item === 'heavydutyboots' || pokemon.ability === 'magicguard') continue;
    const grounded = !pokemon.types.includes('Flying') &&
      pokemon.ability !== 'levitate' && pokemon.item !== 'airballoon';
    let fraction = 0;
    if (hasRocks) {
      fraction += 0.125 * Math.pow(2, battle.dex.getEffectiveness('Rock', pokemon.types));
    }
    if (grounded) {
      if (spikesLayers) fraction += [0, 1 / 8, 1 / 6, 1 / 4][spikesLayers];
      if (hasToxicSpikes && !pokemon.types.includes('Poison') && !pokemon.types.includes('Steel')) {
        fraction += 0.06; // priced as a slice of the psn/tox status cost
      }
      if (hasWeb) fraction += 0.04;
    }
    cost += bodyWeight * fraction * EVAL_WEIGHTS.hazardEntries;
  }
  return Math.min(cost, EVAL_WEIGHTS.hazardCap);
}

function sideScore(side: Side, battle: Battle): number {
  let score = 0;
  for (const pokemon of side.pokemon) score += pokemonScore(pokemon);
  for (const active of side.active) {
    if (!active || active.fainted) continue;
    for (const [stat, stage] of Object.entries(active.boosts)) {
      if (!stage) continue;
      const base = stat === 'atk' || stat === 'spa' || stat === 'spe'
        ? EVAL_WEIGHTS.boostStage.offensive
        : EVAL_WEIGHTS.boostStage.defensive;
      const magnitude = EVAL_WEIGHTS.boostSchedule[Math.min(Math.abs(stage), 6)];
      score += Math.sign(stage) * base * magnitude;
    }
  }
  score -= hazardCost(side, battle);
  for (const id of SCREENS) {
    if (side.sideConditions[id]) score += EVAL_WEIGHTS.screen;
  }
  if (side.sideConditions['tailwind']) score += EVAL_WEIGHTS.tailwind;
  return score;
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

function pairKey(attacker: Pokemon, defender: Pokemon): string {
  return `${attacker.side.id}:${attacker.name}:${attacker.species.id}:${attacker.level}:${attacker.item}:${attacker.ability}>` +
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
  for (const slot of attacker.moveSlots) {
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
 * Aggregated 1v1 threat estimate in [-1, +1] from p1's perspective: for every
 * living pair, whoever KOs first (against current HP) wins the pair, speed
 * breaking ties; pairs are weighted by both sides' HP fractions.
 */
function matchupScore(battle: Battle, cache?: MatchupCache): number {
  const living = (index: 0 | 1) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const p1Living = living(0);
  const p2Living = living(1);
  if (p1Living.length === 0 || p2Living.length === 0) return 0;

  const threat = (attacker: Pokemon, defender: Pokemon): PairThreat => {
    if (!cache) return pairThreat(attacker, defender, battle);
    const key = pairKey(attacker, defender);
    let value = cache.get(key);
    if (value === undefined) {
      value = pairThreat(attacker, defender, battle);
      cache.set(key, value);
    }
    return value;
  };

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
  for (const a of p1Living) {
    for (const b of p2Living) {
      const threatA = threat(a, b);
      const threatB = threat(b, a);
      const boostedA = boostedFraction(threatA, a, b);
      const boostedB = boostedFraction(threatB, b, a);
      // A defender that can heal ~50% per turn walls anything short of a 2HKO.
      const fracA = boostedA <= 0.5 && heals(b) ? 0 : boostedA;
      const fracB = boostedB <= 0.5 && heals(a) ? 0 : boostedB;
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
  return totalWeight > 0 ? sum / totalWeight : 0;
}

/** Static positional eval from p1's perspective in [-1, +1]; ±1 for ended battles. */
export function evaluatePosition(battle: Battle, cache?: MatchupCache): number {
  if (battle.ended) {
    if (!battle.winner) return 0;
    if (battle.winner === battle.sides[0].name) return 1;
    return -1;
  }

  let p1 = sideScore(battle.sides[0], battle);
  let p2 = sideScore(battle.sides[1], battle);

  if (battle.field.pseudoWeather['trickroom']) {
    if (averageSpeed(battle.sides[0]) <= averageSpeed(battle.sides[1])) p1 += EVAL_WEIGHTS.trickRoom;
    else p2 += EVAL_WEIGHTS.trickRoom;
  }

  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  const normalizer = teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);
  const diff = (p1 - p2) + matchupScore(battle, cache) * EVAL_WEIGHTS.matchup;
  return Math.tanh((diff / normalizer) * EVAL_WEIGHTS.scale);
}
