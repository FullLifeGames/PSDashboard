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
  /** Per net boost stage on an active Pokémon (boosts vanish on switch). */
  boostPerStage: 4,
  /** Per hazard layer lying on a side. */
  hazards: { stealthrock: 12, spikes: 6, toxicspikes: 5, stickyweb: 8 } as Record<string, number>,
  /** Per active screen (Reflect / Light Screen / Aurora Veil). */
  screen: 5,
  tailwind: 8,
  /** Awarded to the side whose remaining Pokémon are slower while Trick Room is up. */
  trickRoom: 10,
  /** Steepness of the tanh score mapping (a one-mon lead in a 6v6 ≈ ±0.4). */
  scale: 2.5,
  /** Weight of the aggregated 1v1 matchup term (full dominance ≈ 0.6 mons). */
  matchup: 120,
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

function sideScore(side: Side): number {
  let score = 0;
  for (const pokemon of side.pokemon) score += pokemonScore(pokemon);
  for (const active of side.active) {
    if (!active || active.fainted) continue;
    for (const stage of Object.values(active.boosts)) score += stage * EVAL_WEIGHTS.boostPerStage;
  }
  for (const [id, weight] of Object.entries(EVAL_WEIGHTS.hazards)) {
    const condition = side.sideConditions[id];
    if (condition) score -= weight * (condition.layers ?? 1);
  }
  for (const id of SCREENS) {
    if (side.sideConditions[id]) score += EVAL_WEIGHTS.screen;
  }
  if (side.sideConditions['tailwind']) score += EVAL_WEIGHTS.tailwind;
  return score;
}

/**
 * Best expected damage (as a fraction of the defender's max HP) among the
 * attacker's actual moves — standard damage formula with STAB and the type
 * chart, no rolls. Status and fixed-damage moves are invisible to this proxy.
 */
function bestMoveFraction(attacker: Pokemon, defender: Pokemon, battle: Battle): number {
  let best = 0;
  for (const slot of attacker.moveSlots) {
    const move = battle.dex.moves.get(slot.id);
    if (!move.exists || move.category === 'Status' || !move.basePower) continue;
    if (!battle.dex.getImmunity(move.type, defender.types)) continue;
    const typeMult = Math.pow(2, battle.dex.getEffectiveness(move.type, defender.types));
    const stab = attacker.types.includes(move.type) ? 1.5 : 1;
    const [atk, def] = move.category === 'Physical'
      ? [attacker.storedStats.atk, defender.storedStats.def]
      : [attacker.storedStats.spa, defender.storedStats.spd];
    const damage = (((2 * attacker.level / 5 + 2) * move.basePower * atk / def) / 50 + 2) * stab * typeMult;
    best = Math.max(best, damage / defender.maxhp);
  }
  return best;
}

/**
 * Aggregated 1v1 threat estimate in [-1, +1] from p1's perspective: for every
 * living pair, whoever KOs first (against current HP) wins the pair, speed
 * breaking ties; pairs are weighted by both sides' HP fractions.
 */
function matchupScore(battle: Battle): number {
  const living = (index: 0 | 1) =>
    battle.sides[index].pokemon.filter(pokemon => !pokemon.fainted && pokemon.hp > 0);
  const p1Living = living(0);
  const p2Living = living(1);
  if (p1Living.length === 0 || p2Living.length === 0) return 0;

  let sum = 0;
  for (const a of p1Living) {
    for (const b of p2Living) {
      const fracA = bestMoveFraction(a, b, battle);
      const fracB = bestMoveFraction(b, a, battle);
      const turnsA = fracA > 0 ? Math.ceil(b.hp / b.maxhp / fracA) : Infinity;
      const turnsB = fracB > 0 ? Math.ceil(a.hp / a.maxhp / fracB) : Infinity;
      let sign = 0;
      if (turnsA < turnsB) sign = 1;
      else if (turnsB < turnsA) sign = -1;
      else if (turnsA !== Infinity) {
        sign = Math.sign(a.storedStats.spe - b.storedStats.spe);
      }
      sum += sign * (a.hp / a.maxhp) * (b.hp / b.maxhp);
    }
  }
  return sum / (p1Living.length * p2Living.length);
}

/** Static positional eval from p1's perspective in [-1, +1]; ±1 for ended battles. */
export function evaluatePosition(battle: Battle): number {
  if (battle.ended) {
    if (!battle.winner) return 0;
    if (battle.winner === battle.sides[0].name) return 1;
    return -1;
  }

  let p1 = sideScore(battle.sides[0]);
  let p2 = sideScore(battle.sides[1]);

  if (battle.field.pseudoWeather['trickroom']) {
    if (averageSpeed(battle.sides[0]) <= averageSpeed(battle.sides[1])) p1 += EVAL_WEIGHTS.trickRoom;
    else p2 += EVAL_WEIGHTS.trickRoom;
  }

  const teamSize = Math.max(battle.sides[0].pokemon.length, battle.sides[1].pokemon.length, 1);
  const normalizer = teamSize * (EVAL_WEIGHTS.alive + EVAL_WEIGHTS.hp);
  const diff = (p1 - p2) + matchupScore(battle) * EVAL_WEIGHTS.matchup;
  return Math.tanh((diff / normalizer) * EVAL_WEIGHTS.scale);
}
