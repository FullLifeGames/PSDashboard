import type { PokemonFieldInfo, PokemonMoveInfo } from '../types';
import type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability } from './smogon/stats-types';
import { dataPkmnStatsUrl, parseSmogonChaosStats, sourceDetail } from './smogon/stats-parse';
import { toId } from './ids';
import { ouFallbackFormat } from './smogon/format-fallback';

export type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability, UsageSpread } from './smogon/stats-types';
export { parseSmogonChaosStats, parseSpread } from './smogon/stats-parse';

const usageCache = new Map<string, Promise<SmogonUsageStats | null>>();

export function getSmogonStatsFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou').replace(/^smogtours/, '');
  if (id.includes('nationaldexdoubles')) return 'gen9nationaldexdoubles';
  // VGC: the year-level stats file aggregates all regulations and holds
  // species the Smogon doubles ladder never sees (e.g. Annihilape).
  const vgcYear = id.match(/vgc(\d{4})/);
  if (vgcYear) return `${id.match(/^gen\d+/)?.[0] ?? 'gen9'}vgc${vgcYear[1]}`;
  return ouFallbackFormat(id);
}

/**
 * Only the data.pkmn.cc mirror sends CORS headers — the historical
 * www.smogon.com fallback months could never succeed in a browser and only
 * produced 16+ console errors per load (B14), so they are gone.
 *
 * Formats without a stats file (custom rulesets, niche metas) fall back to
 * the generation's OU so the app still has usage-based assumptions.
 */
export function buildSmogonStatsUrls(
  formatId: string | undefined,
): { month: string; format: string; url: string }[] {
  const format = getSmogonStatsFormat(formatId);
  const candidates = [format];
  const gen = format.match(/^gen\d+/)?.[0];
  if (gen) {
    // Per-species merge fallbacks (fetchSmogonUsageStats): a format's file
    // existing does not mean it lists every Pokémon — VGC fills from the
    // doubles ladder, everything from the gen's OU, and OU-banned species
    // (draft leagues, VGC) from Ubers.
    if (format.includes('vgc')) candidates.push(`${gen}doublesou`);
    candidates.push(`${gen}ou`, `${gen}ubers`);
  }
  return [...new Set(candidates)].map(candidate => ({
    month: 'latest',
    format: candidate,
    url: dataPkmnStatsUrl(candidate),
  }));
}

export async function fetchSmogonUsageStats(
  formatId: string | undefined,
  options?: { now?: Date; signal?: AbortSignal; fetcher?: typeof fetch },
): Promise<SmogonUsageStats | null> {
  const format = getSmogonStatsFormat(formatId);
  const cacheKey = `${format}:${options?.now?.toISOString() ?? 'latest'}`;
  const cached = usageCache.get(cacheKey);
  if (cached) return cached;

  const fetcher = options?.fetcher ?? fetch;
  const request = (async () => {
    // Fetch every candidate and merge per species: the format's own file
    // wins, the generation's OU fills species it lacks. A niche format's
    // stats file existing must not blank out guessing for a Pokémon that
    // simply is not played there (e.g. Annihilape missing from doublesou).
    const results: SmogonUsageStats[] = [];
    for (const candidate of buildSmogonStatsUrls(formatId)) {
      try {
        const response = await fetcher(candidate.url, { signal: options?.signal });
        if (!response.ok) continue;
        const payload = await response.json();
        results.push(parseSmogonChaosStats(payload, {
          format: candidate.format,
          month: candidate.month,
        }));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
      }
    }
    const [primary, ...fallbacks] = results;
    if (!primary) return null;
    for (const fallback of fallbacks) {
      for (const [id, entry] of Object.entries(fallback.pokemon)) {
        primary.pokemon[id] ??= entry;
      }
    }
    return primary;
  })();

  usageCache.set(cacheKey, request);
  return request;
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
