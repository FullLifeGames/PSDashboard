import type { Battle, Pokemon } from '@pkmn/sim';

/**
 * Effective speed for move-order decisions: stored speed through the stage
 * multiplier, then the modifiers a replay can actually witness — paralysis
 * (gen-dependent, Quick Feet overrides), Tailwind, Choice Scarf, Iron Ball,
 * Unburden (readable only as "ability present + item slot empty"), and the
 * weather/terrain speed abilities. Deliberately NOT modeled: Cloud Nine/Air
 * Lock suppression, Protosynthesis/Quark Drive, Slow Start, Lagging
 * Tail/Full Incense (move-order, not speed), Quick Powder.
 */
const stageMultiplier = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));

/** Paralysis (gen-dependent) and Quick Feet, applied in that order. */
function applyStatusSpeed(speed: number, pokemon: Pokemon, battle: Battle): number {
  let value = speed;
  const ability = pokemon.ability;
  if (pokemon.status === 'par' && ability !== 'quickfeet') value *= battle.gen >= 7 ? 0.5 : 0.25;
  if (pokemon.status && ability === 'quickfeet') value *= 1.5;
  return value;
}

/** Tailwind, Choice Scarf, Iron Ball, and Unburden, applied in that order. */
function applyFieldAndItemSpeed(speed: number, pokemon: Pokemon): number {
  let value = speed;
  const ability = pokemon.ability;
  const item = pokemon.item;
  if (pokemon.side.sideConditions['tailwind']) value *= 2;
  if (item === 'choicescarf') value *= 1.5;
  if (item === 'ironball') value *= 0.5;
  if (ability === 'unburden' && !item) value *= 2;
  return value;
}

/** The weather and terrain speed abilities, applied in that order. */
function applyWeatherSpeed(speed: number, pokemon: Pokemon, battle: Battle): number {
  let value = speed;
  const ability = pokemon.ability;
  const weather = battle.field.weather;
  if (ability === 'swiftswim' && (weather === 'raindance' || weather === 'primordialsea')) value *= 2;
  if (ability === 'chlorophyll' && (weather === 'sunnyday' || weather === 'desolateland')) value *= 2;
  if (ability === 'sandrush' && weather === 'sandstorm') value *= 2;
  if (ability === 'slushrush' && (weather === 'hail' || weather === 'snow')) value *= 2;
  if (ability === 'surgesurfer' && battle.field.terrain === 'electricterrain') value *= 2;
  return value;
}

export function effectiveSpeed(pokemon: Pokemon, battle: Battle): number {
  let speed = pokemon.storedStats.spe * stageMultiplier(pokemon.boosts.spe);
  speed = applyStatusSpeed(speed, pokemon, battle);
  speed = applyFieldAndItemSpeed(speed, pokemon);
  return applyWeatherSpeed(speed, pokemon, battle);
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
  const speedA = effectiveSpeed(a, battle);
  const speedB = effectiveSpeed(b, battle);
  return battle.field.pseudoWeather['trickroom'] ? speedB > speedA : speedA > speedB;
}
