import { type SmogonUsageStats, toId } from '@fulllifegames/replay-core';
import { dataPkmnStatsUrl, parseSmogonChaosStats } from './smogon/stats-parse';
import { nationalDexDoublesFormat, ouFallbackFormat, vgcYearFormat } from './smogon/format-fallback';
import { fetcherKey } from './smogon/fetcher-key';
import { withSmogonFallback, type SmogonFetch } from './smogon/hosts';

export type { SmogonUsageStats } from '@fulllifegames/replay-core';
export { parseSmogonChaosStats, parseSpread } from './smogon/stats-parse';
export { alternativeItems, fillUsageMoves, getSpeciesUsageSet } from '@fulllifegames/replay-core';

const usageCache = new Map<string, Promise<SmogonUsageStats | null>>();

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function getSmogonStatsFormat(formatId: string | undefined): string {
  const id = toId(formatId || 'gen9ou').replace(/^smogtours/, '');
  const nationalDex = nationalDexDoublesFormat(id);
  if (nationalDex) return nationalDex;
  // VGC: the year-level file aggregates all regulations and holds species the doubles ladder never sees (Annihilape).
  return vgcYearFormat(id) ?? ouFallbackFormat(id);
}

/** Only the data.pkmn.cc mirror sends CORS headers, so no www.smogon.com months are tried (they fail in a browser). */
export function buildSmogonStatsUrls(
  formatId: string | undefined,
): { month: string; format: string; url: string }[] {
  const format = getSmogonStatsFormat(formatId);
  const candidates = [format];
  const gen = format.match(/^gen\d+/)?.[0];
  if (gen) {
    // A file does not list every species: VGC fills from the doubles ladder, all from the gen's OU, banned from Ubers.
    if (format.includes('vgc')) candidates.push(`${gen}doublesou`);
    candidates.push(`${gen}ou`, `${gen}ubers`);
  }
  return [...new Set(candidates)].map(candidate => ({
    month: 'latest',
    format: candidate,
    url: dataPkmnStatsUrl(candidate),
  }));
}

// `answered` is false when a source failed for any reason but a 404: the stats are what the reachable sources said.
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
    // A joined load that another caller aborts is not this caller's answer; the memo dropped it, so ask again.
    return cached.catch(error => {
      if (isAbort(error) && !options?.signal?.aborted) return fetchSmogonUsageStats(formatId, options);
      throw error;
    });
  }

  const fetcher = withSmogonFallback((options?.fetcher ?? fetch) as SmogonFetch);
  const outcome = fetchCandidates(formatId, fetcher, options?.signal);
  const request = outcome.then(result => result.stats);
  usageCache.set(cacheKey, request);
  // Only an answer is memoized: an abort or a failure leaves it empty, a 404 from every source stays.
  const forget = () => {
    if (usageCache.get(cacheKey) === request) usageCache.delete(cacheKey);
  };
  outcome.then(result => {
    if (!result.answered) forget();
  }, forget);
  return request;
}
