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
  const score = (p1 - p2) / normalizer;
  return Math.max(-1, Math.min(1, score));
}
