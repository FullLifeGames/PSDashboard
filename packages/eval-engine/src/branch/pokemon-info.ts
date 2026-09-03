import { Dex } from '@pkmn/sim';
import type { PokemonStatTable, SimPokemon, SimPokemonInfo, SimSide } from './types.ts';

function statTableWithDefaults(
  value: Partial<PokemonStatTable> | undefined,
  fallback: PokemonStatTable,
): PokemonStatTable {
  return {
    hp: value?.hp ?? fallback.hp,
    atk: value?.atk ?? fallback.atk,
    def: value?.def ?? fallback.def,
    spa: value?.spa ?? fallback.spa,
    spd: value?.spd ?? fallback.spd,
    spe: value?.spe ?? fallback.spe,
  };
}

const DEFAULT_EVS: PokemonStatTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const DEFAULT_IVS: PokemonStatTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** Display names, not sim ids: @smogon/calc matches abilities/items by
 *  display name ('Technician'), so ids ('technician') silently disable
 *  every ability/item damage modifier (B6). */
function displayFields(pokemon: SimPokemon): Pick<SimPokemonInfo, 'ability' | 'item' | 'moves'> {
  return {
    moves: pokemon.moveSlots.map(move => ({
      name: move.move,
      type: Dex.moves.get(move.id || move.move)?.type || '',
    })),
    ability: pokemon.ability ? (Dex.abilities.get(pokemon.ability)?.name || pokemon.ability) : '',
    item: pokemon.item ? (Dex.items.get(pokemon.item)?.name || pokemon.item) : '',
  };
}

function storedStats(pokemon: SimPokemon): SimPokemonInfo['stats'] {
  return {
    atk: pokemon.storedStats?.atk || 0,
    def: pokemon.storedStats?.def || 0,
    spa: pokemon.storedStats?.spa || 0,
    spd: pokemon.storedStats?.spd || 0,
    spe: pokemon.storedStats?.spe || 0,
  };
}

function setFields(pokemon: SimPokemon): Pick<SimPokemonInfo, 'nature' | 'evs' | 'ivs' | 'gender' | 'teraType' | 'level' | 'types'> {
  return {
    nature: pokemon.set.nature || 'Hardy',
    evs: statTableWithDefaults(pokemon.set.evs, DEFAULT_EVS),
    ivs: statTableWithDefaults(pokemon.set.ivs, DEFAULT_IVS),
    gender: pokemon.gender || pokemon.set.gender || '',
    teraType: pokemon.terastallized || '',
    level: pokemon.level || 100,
    types: pokemon.types ? [...pokemon.types] : [],
  };
}

export function makePokemonInfo(
  pokemon: SimPokemon,
  isActive = pokemon.isActive,
  activeSlot: number | null = null,
): SimPokemonInfo {
  const { moves, ability, item } = displayFields(pokemon);
  const { nature, evs, ivs, gender, teraType, level, types } = setFields(pokemon);
  return {
    name: pokemon.name,
    species: pokemon.species.name,
    hp: pokemon.hp,
    maxhp: pokemon.maxhp,
    hpPercent: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
    status: pokemon.status || '',
    fainted: pokemon.fainted,
    isActive,
    activeSlot,
    moves,
    ability,
    item,
    stats: storedStats(pokemon),
    nature,
    evs,
    ivs,
    gender,
    teraType,
    boosts: { ...pokemon.boosts },
    level,
    types,
  };
}

export function extractPokemonInfo(side: SimSide): SimPokemonInfo[] {
  return side.pokemon.map(pokemon => {
    const activeSlot = side.active.findIndex(active => active === pokemon);
    return makePokemonInfo(pokemon, pokemon.isActive, activeSlot >= 0 ? activeSlot : null);
  });
}

