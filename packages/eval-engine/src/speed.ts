import type { Battle, Pokemon } from '@pkmn/sim';
import { stageMultiplier } from './stat-stages.ts';

/**
 * Effective speed for move-order decisions: the sim's getStat('spe') rebuilt
 * as a list, because asking the sim directly cost the static 15 to 22 %
 * (round 60, T95 time gate). speed-oracle.spec.ts checks every rule and every
 * body of the committed bank positions against getStat (at most 1 apart).
 * The list reads the sim's own state where the sim decides: suppressed
 * abilities and items (ignoringAbility, ignoringItem: Neutralizing Gas,
 * Klutz), the weather a holder feels (effectiveWeather: Utility Umbrella,
 * Air Lock), the Unburden, Protosynthesis and Quark Drive volatiles.
 * Deliberately not modeled: Slow Start, Lagging Tail/Full Incense
 * (move-order, not speed), Quick Powder.
 *
 * A benched body is read as if on the field: the sim ignores the item and
 * ability of an inactive Pokémon from gen 5 on, the static compares benched
 * bodies as if they stood there, so isActive is set for this call only.
 */
export function effectiveSpeed(pokemon: Pokemon, battle: Battle): number {
  if (pokemon.isActive) return listSpeed(pokemon, battle);
  pokemon.isActive = true;
  try {
    return listSpeed(pokemon, battle);
  } finally {
    pokemon.isActive = false;
  }
}

function listSpeed(pokemon: Pokemon, battle: Battle): number {
  const ability = pokemon.ignoringAbility() ? '' : pokemon.ability;
  // The sim floors the staged stat before any modifier (pokemon.js getStat).
  let speed = Math.floor(pokemon.storedStats.spe * stageMultiplier(pokemon.boosts.spe));
  speed *= abilityFactor(pokemon, ability, battle) * itemFactor(pokemon);
  if (pokemon.side.sideConditions['tailwind']) speed *= 2;
  // Paralysis comes after every other modifier (conditions.js par), Quick Feet cancels it.
  if (pokemon.status === 'par' && ability !== 'quickfeet') speed *= battle.gen >= 7 ? 0.5 : 0.25;
  return speed;
}

/** The doubling speed abilities, each under the condition its sim handler checks. */
const DOUBLING = new Map<string, (pokemon: Pokemon, battle: Battle) => boolean>([
  ['swiftswim', pokemon => ['raindance', 'primordialsea'].includes(pokemon.effectiveWeather())],
  ['chlorophyll', pokemon => ['sunnyday', 'desolateland'].includes(pokemon.effectiveWeather())],
  ['sandrush', (_, battle) => battle.field.isWeather('sandstorm')],
  ['slushrush', (_, battle) => battle.field.isWeather(['hail', 'snowscape'])],
  ['surgesurfer', (_, battle) => battle.field.isTerrain('electricterrain')],
  ['unburden', pokemon => !!pokemon.volatiles['unburden'] && !pokemon.item],
]);

function abilityFactor(pokemon: Pokemon, ability: string, battle: Battle): number {
  if (DOUBLING.get(ability)?.(pokemon, battle)) return 2;
  if (ability === 'quickfeet' && pokemon.status) return 1.5;
  const paradox = ability === 'protosynthesis' || ability === 'quarkdrive';
  return paradox && pokemon.volatiles[ability]?.bestStat === 'spe' ? 1.5 : 1;
}

/** Choice Scarf (not while Dynamaxed) and Iron Ball, unless the sim ignores the item. */
function itemFactor(pokemon: Pokemon): number {
  if (pokemon.ignoringItem()) return 1;
  if (pokemon.item === 'choicescarf') return pokemon.volatiles['dynamax'] ? 1 : 1.5;
  if (pokemon.item === 'ironball') return 0.5;
  return 1;
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
