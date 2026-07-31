import { getSpeciesUsageSet, type SmogonUsageStats, type UsageProbability, type UsageSpread } from './smogon-stats';
import { getSpeciesSetAssumption, type SetAssumption, type SetSpreadAssumption, type SmogonSetAssumptions } from './smogon-sets';
import type { OpponentTeamInfo, PokemonEvs, PokemonEvsInfo, PokemonFieldInfo, PokemonMoveInfo, RevealedPokemonInfo } from '../types';

export const EMPTY_EVS: PokemonEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

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

export function unknownEvs(): PokemonEvsInfo {
  return { value: { ...EMPTY_EVS }, source: 'unknown' };
}

export function guessedEvs(value: PokemonEvs, probability?: number, sourceDetail?: string): PokemonEvsInfo {
  return { value, source: 'guessed', probability, sourceDetail };
}

export function manualEvs(value: PokemonEvs): PokemonEvsInfo {
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

function normalizeEvsField(
  evs: PokemonEvsInfo | undefined,
  fallback: UsageSpread | undefined,
  setFallback?: SetSpreadAssumption,
): PokemonEvsInfo {
  if (evs && evs.source !== 'unknown') return evs;
  if (!fallback && setFallback?.evs) return guessedEvs(setFallback.evs, undefined, setFallback.sourceDetail);
  if (!fallback?.evs) return evs ?? unknownEvs();
  return guessedEvs(fallback.evs, fallback.probability, fallback.sourceDetail);
}

function normalizeNatureField(
  nature: PokemonFieldInfo | undefined,
  fallback: UsageSpread | undefined,
  setFallback?: SetSpreadAssumption,
): PokemonFieldInfo | undefined {
  if (nature && nature.source !== 'unknown' && nature.value) return nature;
  if (!fallback && setFallback?.nature) return guessedField(setFallback.nature, undefined, setFallback.sourceDetail);
  if (!fallback?.nature) return nature;
  return guessedField(fallback.nature, fallback.probability, fallback.sourceDetail);
}

/**
 * Dedup key for move fills: "Hidden Power" and "Hidden Power Grass" describe
 * the same slot — a guessed typed variant must not join a revealed generic
 * one (G12).
 */
function moveDedupKey(name: string): string {
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return id.startsWith('hiddenpower') ? 'hiddenpower' : id;
}

function fillUsageMoves(
  knownMoves: PokemonMoveInfo[],
  fallbackMoves: UsageProbability[],
): PokemonMoveInfo[] {
  const result = [...knownMoves];

  for (const move of fallbackMoves) {
    if (result.length >= 4) break;
    if (!result.some(entry => moveDedupKey(entry.name) === moveDedupKey(move.value))) {
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
    if (!result.some(entry => moveDedupKey(entry.name) === moveDedupKey(move.value))) {
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
    evs: normalizeEvsField(pokemon.evs, usageSet?.spread, smogonSet?.spread),
    nature: normalizeNatureField(pokemon.nature, usageSet?.spread, smogonSet?.spread),
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
