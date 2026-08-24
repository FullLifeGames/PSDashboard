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

export function effectiveSpeed(pokemon: Pokemon, battle: Battle): number {
  let speed = pokemon.storedStats.spe * stageMultiplier(pokemon.boosts.spe);
  const ability = pokemon.ability;
  const item = pokemon.item;
  if (pokemon.status === 'par' && ability !== 'quickfeet') speed *= battle.gen >= 7 ? 0.5 : 0.25;
  if (pokemon.status && ability === 'quickfeet') speed *= 1.5;
  if (pokemon.side.sideConditions['tailwind']) speed *= 2;
  if (item === 'choicescarf') speed *= 1.5;
  if (item === 'ironball') speed *= 0.5;
  if (ability === 'unburden' && !item) speed *= 2;
  const weather = battle.field.weather;
  if (ability === 'swiftswim' && (weather === 'raindance' || weather === 'primordialsea')) speed *= 2;
  if (ability === 'chlorophyll' && (weather === 'sunnyday' || weather === 'desolateland')) speed *= 2;
  if (ability === 'sandrush' && weather === 'sandstorm') speed *= 2;
  if (ability === 'slushrush' && (weather === 'hail' || weather === 'snow')) speed *= 2;
  if (ability === 'surgesurfer' && battle.field.terrain === 'electricterrain') speed *= 2;
  return speed;
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
