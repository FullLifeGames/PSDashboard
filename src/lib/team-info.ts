import { getSpeciesUsageSet, type SmogonUsageStats, type UsageProbability } from './smogon-stats';
import { getSpeciesSetAssumption, type SetAssumption, type SmogonSetAssumptions } from './smogon-sets';
import type { OpponentTeamInfo, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo } from '../types';

export function unknownField(): PokemonFieldInfo {
  return { value: '', source: 'unknown' };
}

export function revealedField(value: string): PokemonFieldInfo {
  return { value, source: 'revealed' };
}

export function guessedField(value: string, probability?: number, sourceDetail?: string): PokemonFieldInfo {
  return { value, source: 'guessed', probability, sourceDetail };
}

export function manualField(value: string): PokemonFieldInfo {
  return { value, source: 'manual' };
}

export function manualMove(name: string): PokemonMoveInfo {
  return { name, source: 'manual' };
}

function guessedMove(move: UsageProbability): PokemonMoveInfo {
  return {
    name: move.value,
    source: 'guessed',
    probability: move.probability,
    sourceDetail: move.sourceDetail,
  };
}

function guessedMoveFromSet(move: SetAssumption): PokemonMoveInfo {
  return {
    name: move.value,
    source: 'guessed',
    sourceDetail: move.sourceDetail,
  };
}

function normalizeItemField(
  item: PokemonFieldInfo,
  fallback: UsageProbability | undefined,
  setFallback?: SetAssumption,
): PokemonFieldInfo {
  if (item.value && item.value !== '(has item)') return item;
  if (!fallback && setFallback) return guessedField(setFallback.value, undefined, setFallback.sourceDetail);
  if (!fallback) return item;
  return guessedField(fallback.value, fallback.probability, fallback.sourceDetail);
}

function normalizeAbilityField(
  ability: PokemonFieldInfo,
  fallback: UsageProbability | undefined,
  setFallback?: SetAssumption,
): PokemonFieldInfo {
  if (ability.value) return ability;
  if (!fallback && setFallback) return guessedField(setFallback.value, undefined, setFallback.sourceDetail);
  if (!fallback) return ability;
  return guessedField(fallback.value, fallback.probability, fallback.sourceDetail);
}

function fillUsageMoves(
  knownMoves: PokemonMoveInfo[],
  fallbackMoves: UsageProbability[],
): PokemonMoveInfo[] {
  const result = [...knownMoves];

  for (const move of fallbackMoves) {
    if (result.length >= 4) break;
    if (!result.some(entry => entry.name.toLowerCase() === move.value.toLowerCase())) {
      result.push(guessedMove(move));
    }
  }

  return result;
}

function fillSetMoves(
  knownMoves: PokemonMoveInfo[],
  fallbackMoves: SetAssumption[],
): PokemonMoveInfo[] {
  const result = [...knownMoves];

  for (const move of fallbackMoves) {
    if (result.length >= 4) break;
    if (!result.some(entry => entry.name.toLowerCase() === move.value.toLowerCase())) {
      result.push(guessedMoveFromSet(move));
    }
  }

  return result;
}

export function enrichPokemonInfo(
  pokemon: RevealedPokemonInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
): RevealedPokemonInfo {
  const usageSet = getSpeciesUsageSet(usageStats, pokemon.species);
  const smogonSet = getSpeciesSetAssumption(setAssumptions, pokemon.species);
  const usageFilledMoves = usageSet ? fillUsageMoves(pokemon.moves, usageSet.moves) : pokemon.moves;

  return {
    ...pokemon,
    ability: normalizeAbilityField(pokemon.ability, usageSet?.ability, smogonSet?.ability),
    item: normalizeItemField(pokemon.item, usageSet?.item, smogonSet?.item),
    moves: smogonSet ? fillSetMoves(usageFilledMoves, smogonSet.moves) : usageFilledMoves,
  };
}

export function enrichTeamInfo(
  teamInfo: OpponentTeamInfo,
  usageStats?: SmogonUsageStats | null,
  setAssumptions?: SmogonSetAssumptions | null,
): OpponentTeamInfo {
  return {
    pokemon: teamInfo.pokemon.map(pokemon => enrichPokemonInfo(pokemon, usageStats, setAssumptions)),
  };
}
