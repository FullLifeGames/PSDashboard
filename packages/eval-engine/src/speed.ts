import type { Battle, Pokemon } from '@pkmn/sim';
import { stageMultiplier } from './stat-stages.ts';

/** Effective speed for move order: `getStat('spe')` rebuilt as a list; Slow Start and Quick Powder are not modeled. */
export function effectiveSpeed(pokemon: Pokemon, battle: Battle): number {
  if (pokemon.isActive) return listSpeed(pokemon, battle);
  // A benched body is read as if on the field (the sim ignores an inactive Pokémon's item and ability from gen 5 on).
  pokemon.isActive = true;
  try {
    return listSpeed(pokemon, battle);
  } finally {
    pokemon.isActive = false;
  }
}

function listSpeed(pokemon: Pokemon, battle: Battle): number {
  // The sim floors the staged stat before any modifier (pokemon.js getStat).
  let speed = Math.floor(pokemon.storedStats.spe * stageMultiplier(pokemon.boosts.spe));
  speed *= abilityFactor(pokemon, battle) * itemFactor(pokemon);
  if (pokemon.side.sideConditions['tailwind']) speed *= 2;
  // Paralysis comes after every other modifier (conditions.js par), Quick Feet cancels it.
  const quickFeet = pokemon.ability === 'quickfeet' && !pokemon.ignoringAbility();
  if (pokemon.status === 'par' && !quickFeet) speed *= battle.gen >= 7 ? 0.5 : 0.25;
  return speed;
}

const DOUBLING = new Map<string, (pokemon: Pokemon, battle: Battle) => boolean>([
  ['swiftswim', pokemon => ['raindance', 'primordialsea'].includes(pokemon.effectiveWeather())],
  ['chlorophyll', pokemon => ['sunnyday', 'desolateland'].includes(pokemon.effectiveWeather())],
  ['sandrush', (_, battle) => battle.field.isWeather('sandstorm')],
  ['slushrush', (_, battle) => battle.field.isWeather(['hail', 'snowscape'])],
  ['surgesurfer', (_, battle) => battle.field.isTerrain('electricterrain')],
  ['unburden', pokemon => !!pokemon.volatiles['unburden'] && !pokemon.item],
]);

function abilityFactor(pokemon: Pokemon, battle: Battle): number {
  const ability = pokemon.ability;
  const doubling = DOUBLING.get(ability);
  let factor = 1;
  if (doubling) factor = doubling(pokemon, battle) ? 2 : 1;
  else if (ability === 'quickfeet') factor = pokemon.status ? 1.5 : 1;
  else if (ability === 'protosynthesis' || ability === 'quarkdrive') factor = pokemon.volatiles[ability]?.bestStat === 'spe' ? 1.5 : 1;
  return factor !== 1 && pokemon.ignoringAbility() ? 1 : factor;
}

function itemFactor(pokemon: Pokemon): number {
  let factor = 1;
  if (pokemon.item === 'choicescarf') factor = pokemon.volatiles['dynamax'] ? 1 : 1.5;
  else if (pokemon.item === 'ironball') factor = 0.5;
  return factor !== 1 && pokemon.ignoringItem() ? 1 : factor;
}

/** Who acts first: priority move, then effective speed (inverted under Trick Room); an exact tie is never first. */
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
