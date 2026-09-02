/**
 * Pure lookups over fetched usage statistics: no network, no cache. The
 * team builder, the hidden-power resolver, and the team-info enrichment
 * read usage through these; smogon-stats.ts fetches and re-exports them.
 */
import type { PokemonFieldInfo, PokemonMoveInfo } from '../types';
import type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability } from './stats-types';
import { toId } from '../ids';

export function sourceDetail(format: string, month: string): string {
  return `Smogon ${format} ${month}`;
}

export function getSpeciesUsageStats(
  species: string,
  usageStats?: SmogonUsageStats | null,
): PokemonUsageStats | undefined {
  if (!usageStats) return undefined;
  return usageStats.pokemon[toId(species)] ??
    Object.values(usageStats.pokemon).find(entry => toId(entry.species) === toId(species));
}

export function getSpeciesUsageSet(
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  ruledOut?: { abilities?: string[]; items?: string[] },
  /** Usage-move candidates to expose (coherence vetoes refill from the tail). */
  moveCount = 4,
): SpeciesUsageSet | null {
  const stats = getSpeciesUsageStats(species, usageStats);
  if (!stats || !usageStats) return null;

  // Protocol evidence can DISPROVE the top usage pick (a Clefable that takes
  // Stealth Rock damage is not Magic Guard) — fall to the next candidate.
  const firstAllowed = (entries: UsageProbability[], excluded?: string[]) =>
    entries.find(entry => !(excluded ?? []).includes(toId(entry.value)));

  return {
    ability: firstAllowed(stats.abilities, ruledOut?.abilities),
    item: firstAllowed(stats.items, ruledOut?.items),
    moves: stats.moves.slice(0, moveCount),
    spread: stats.spreads[0],
    sourceDetail: sourceDetail(usageStats.format, usageStats.month),
  };
}

/**
 * The next usage-plausible item candidates for a sensitivity probe: up to
 * two items from the species' usage list that differ from the current guess
 * and are not disproven by protocol evidence. Empty when the species has no
 * usage entry — with no plausible alternatives there is nothing to probe.
 */
export function alternativeItems(
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  currentGuess: string,
  ruledOut?: { items?: string[] },
): string[] {
  const stats = getSpeciesUsageStats(species, usageStats);
  if (!stats) return [];
  const excluded = new Set((ruledOut?.items ?? []).map(toId));
  return stats.items
    .filter(entry => entry.value && toId(entry.value) !== toId(currentGuess) && !excluded.has(toId(entry.value)))
    .slice(0, 2)
    .map(entry => entry.value);
}

export function guessedFieldFromUsage(guess: UsageProbability | undefined): PokemonFieldInfo | null {
  if (!guess?.value) return null;
  return {
    value: guess.value,
    source: 'guessed',
    probability: guess.probability,
    sourceDetail: guess.sourceDetail,
  };
}

export function fillUsageMoves(
  species: string,
  knownMoves: PokemonMoveInfo[],
  usageStats?: SmogonUsageStats | null,
): PokemonMoveInfo[] {
  const set = getSpeciesUsageStats(species, usageStats);
  if (!set) return knownMoves;

  const result = [...knownMoves];
  for (const move of set.moves) {
    if (result.length >= 4) break;
    if (!result.some(known => toId(known.name) === toId(move.value))) {
      result.push({
        name: move.value,
        source: 'guessed',
        probability: move.probability,
        sourceDetail: move.sourceDetail,
      });
    }
  }
  return result;
}
