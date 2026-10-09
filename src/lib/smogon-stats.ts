import { type SmogonUsageStats, toId } from '@fulllifegames/replay-core';
import { dataPkmnStatsUrl, parseSmogonChaosStats } from './smogon/stats-parse';
import { ouFallbackFormat, vgcYearFormat } from './smogon/format-fallback';
import { fetcherKey } from './smogon/fetcher-key';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';

export type { PokemonUsageStats, SmogonUsageStats, SpeciesUsageSet, UsageProbability, UsageSpread } from '@fulllifegames/replay-core';
export { parseSmogonChaosStats, parseSpread } from './smogon/stats-parse';
export {
  alternativeItems, fillUsageMoves, getSpeciesUsageSet, getSpeciesUsageStats, guessedFieldFromUsage,
} from '@fulllifegames/replay-core';

const usageCache = new Map<string, Promise<SmogonUsageStats | null>>();

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function getSmogonStatsFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou').replace(/^smogtours/, '');
  if (id.includes('nationaldexdoubles')) return 'gen9nationaldexdoubles';
  // VGC: the year-level stats file aggregates all regulations and holds
  // species the Smogon doubles ladder never sees (e.g. Annihilape).
  // Pokémon Champions VGC keeps a year file of its own (round 66, T141):
  // megas, its own item pool and EV scale, another metagame.
  return vgcYearFormat(id) ?? ouFallbackFormat(id);
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

/**
 * Fetches every candidate and merges per species: the format's own file
 * wins, the generation's OU fills species it lacks. A niche format's stats
 * file existing must not blank out guessing for a Pokémon that simply is not
 * played there (e.g. Annihilape missing from doublesou). `answered` is false
 * when a source failed for any reason but a 404 (network, server error): the
 * stats are then what the reachable sources said, not the whole answer.
 */
async function fetchCandidates(
  formatId: string | undefined,
  fetcher: SmogonFetch,
  signal: AbortSignal | undefined,
): Promise<{ stats: SmogonUsageStats | null; answered: boolean }> {
  const results: SmogonUsageStats[] = [];
  let answered = true;
  for (const candidate of buildSmogonStatsUrls(formatId)) {
    try {
      const response = await fetcher(candidate.url, { signal });
      if (!response.ok) {
        // A 404 is an answer (the file is absent); anything else may pass.
        if (response.status !== 404) answered = false;
        continue;
      }
      const payload = await response.json();
      results.push(parseSmogonChaosStats(payload, {
        format: candidate.format,
        month: candidate.month,
      }));
    } catch (error) {
      if (isAbort(error)) throw error;
      answered = false;
    }
  }
  const [primary, ...fallbacks] = results;
  if (!primary) return { stats: null, answered };
  for (const fallback of fallbacks) {
    for (const [id, entry] of Object.entries(fallback.pokemon)) {
      primary.pokemon[id] ??= entry;
    }
  }
  return { stats: primary, answered };
}

export async function fetchSmogonUsageStats(
  formatId: string | undefined,
  options?: { now?: Date; signal?: AbortSignal; fetcher?: typeof fetch },
): Promise<SmogonUsageStats | null> {
  const format = getSmogonStatsFormat(formatId);
  const cacheKey = `${format}:${options?.now?.toISOString() ?? 'latest'}:${fetcherKey(options?.fetcher)}`;
  const cached = usageCache.get(cacheKey);
  if (cached) {
    // Joining a load that another caller aborts is not this caller's answer:
    // the memo has dropped that load by then, so ask again.
    return cached.catch(error => {
      if (isAbort(error) && !options?.signal?.aborted) return fetchSmogonUsageStats(formatId, options);
      throw error;
    });
  }

  const fetcher = withSmogonFallback((options?.fetcher ?? fetch) as SmogonFetch);
  const outcome = fetchCandidates(formatId, fetcher, options?.signal);
  const request = outcome.then(result => result.stats);
  usageCache.set(cacheKey, request);
  // Only an answer is remembered (T68): an abort, a network failure or a
  // server error leaves the memo empty, so the next load asks again; a 404
  // from every source stays (the format has no file).
  const forget = () => {
    if (usageCache.get(cacheKey) === request) usageCache.delete(cacheKey);
  };
  outcome.then(result => {
    if (!result.answered) forget();
  }, forget);
  return request;
}
