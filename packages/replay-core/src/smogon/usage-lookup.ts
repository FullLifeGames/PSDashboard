import type { PokemonFieldInfo, PokemonMoveInfo } from '../types.ts';
import type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability } from './stats-types.ts';
import { dexOf, formatRules, type RulesDex } from '../rules-dex.ts';
import { toId } from '../ids.ts';

/** The source label of the usage statistics of one format and month. */
export function sourceDetail(format: string, month: string): string {
  return `Smogon ${format} ${month}`;
}

function ownUsageStats(species: string, usageStats: SmogonUsageStats): PokemonUsageStats | undefined {
  return usageStats.pokemon[toId(species)] ??
    Object.values(usageStats.pokemon).find(entry => toId(entry.species) === toId(species));
}

function battleAlikeBase(dex: RulesDex, species: string): string | null {
  const forme = dex.species.get(species);
  if (!forme.exists || forme.baseSpecies === forme.name) return null;
  const base = dex.species.get(forme.baseSpecies);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return base.exists && same(forme.types, base.types) && same(forme.baseStats, base.baseStats) &&
    same(forme.abilities, base.abilities) ? base.name : null;
}

/** The species' usage entry; a forme the usage files do not list reads its battle-alike base species. */
export function getSpeciesUsageStats(
  species: string,
  usageStats?: SmogonUsageStats | null,
): PokemonUsageStats | undefined {
  if (!usageStats) return undefined;
  const own = ownUsageStats(species, usageStats);
  if (own) return own;
  const base = battleAlikeBase(dexOf(formatRules(usageStats.format)), species);
  return base ? ownUsageStats(base, usageStats) : undefined;
}

/** The top usage pick per slot for a species, skipping what protocol evidence ruled out; null without a usage entry. */
export function getSpeciesUsageSet(
  usageStats: SmogonUsageStats | null | undefined,
  species: string,
  ruledOut?: { abilities?: string[]; items?: string[] },
  moveCount = 4,
): SpeciesUsageSet | null {
  const stats = getSpeciesUsageStats(species, usageStats);
  if (!stats || !usageStats) return null;

  // Protocol evidence can disprove the top pick (Stealth Rock damage rules out Magic Guard): fall to the next.
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

/** Up to two usage items that differ from the current guess and that evidence did not rule out; empty without usage. */
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

/** The guessed field info of a usage pick; null without a value. */
export function guessedFieldFromUsage(guess: UsageProbability | undefined): PokemonFieldInfo | null {
  if (!guess?.value) return null;
  return {
    value: guess.value,
    source: 'guessed',
    probability: guess.probability,
    sourceDetail: guess.sourceDetail,
  };
}

/** Fills the known moves up to four with the species' top usage moves, marked guessed. */
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
