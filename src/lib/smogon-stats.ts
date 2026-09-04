import { type SmogonUsageStats, toId } from '@fulllifegames/replay-core';
import { dataPkmnStatsUrl, parseSmogonChaosStats } from './smogon/stats-parse';
import { ouFallbackFormat } from './smogon/format-fallback';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';

export type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability, UsageSpread } from '@fulllifegames/replay-core';
export { parseSmogonChaosStats, parseSpread } from './smogon/stats-parse';
export {
  alternativeItems, fillUsageMoves, getSpeciesUsageSet, getSpeciesUsageStats, guessedFieldFromUsage,
} from '@fulllifegames/replay-core';

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

  const fetcher = withSmogonFallback((options?.fetcher ?? fetch) as SmogonFetch);
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
