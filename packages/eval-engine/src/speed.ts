import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Speeds asked while one static evaluation runs. The battle holds still
 * there and the static asks the same body once per pairing (getStat runs
 * the sim's event chain each time); outside an evaluation nothing is kept,
 * because a battle that moves on must be asked again.
 */
let evaluationSpeeds: WeakMap<Pokemon, number> | null = null;

export function withEvaluationSpeeds<T>(run: () => T): T {
  if (evaluationSpeeds) return run();
  evaluationSpeeds = new WeakMap();
  try {
    return run();
  } finally {
    evaluationSpeeds = null;
  }
}

/**
 * Effective speed for move-order decisions, from the simulator (round 60,
 * T95): getStat('spe') applies the stat stage and every ModifySpe handler
 * the sim runs (paralysis per generation, Choice Scarf, Iron Ball, Tailwind,
 * Unburden once the item went, the weather and terrain abilities,
 * Protosynthesis, Quark Drive, Slow Start, Quick Feet). The hand list it
 * replaces checked 'snow' where the sim writes 'snowscape' and doubled every
 * Unburden holder without an item. Trick Room stays with movesFirst
 * (getActionSpeed would invert it).
 */
export function effectiveSpeed(pokemon: Pokemon): number {
  const known = evaluationSpeeds?.get(pokemon);
  if (known !== undefined) return known;
  const speed = askSimSpeed(pokemon);
  evaluationSpeeds?.set(pokemon, speed);
  return speed;
}

/**
 * The sim finds no handlers for an inactive Pokémon (battle.js
 * findEventHandlers) and ignores its item and ability from gen 5 on
 * (pokemon.js ignoringItem, ignoringAbility). The static compares benched
 * bodies as if they stood on the field, so a benched body is asked with
 * isActive set for this call only.
 */
function askSimSpeed(pokemon: Pokemon): number {
  if (pokemon.isActive) return pokemon.getStat('spe');
  pokemon.isActive = true;
  try {
    return pokemon.getStat('spe');
  } finally {
    pokemon.isActive = false;
  }
}

/**
 * Who acts first in a pairing: a usable priority move outranks speed (the
 * beatsPair rule), then effective speed compares — inverted under Trick
 * Room. An exact tie is never "first" (speed tie = coin flip; keeps the
 * strict > of the old tie-break).
 */
export function movesFirst(
  a: Pokemon,
  b: Pokemon,
  threatA: { priority: boolean },
  threatB: { priority: boolean },
  battle: Battle,
): boolean {
  if (threatA.priority !== threatB.priority) return threatA.priority;
  const speedA = effectiveSpeed(a);
  const speedB = effectiveSpeed(b);
  return battle.field.pseudoWeather['trickroom'] ? speedB > speedA : speedA > speedB;
}
