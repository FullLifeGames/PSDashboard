import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = '.smogon-cache';

interface CacheEntry {
  status: number;
  /** Parsed JSON payload for ok responses; absent for cached misses. */
  payload?: unknown;
}

/**
 * Disk-caching fetch for the calibration harness's Smogon lever
 * (EVAL_CALIBRATION_SMOGON): the first run pins every data.pkmn.cc payload
 * under .smogon-cache/ (gitignored), so paired engine runs and later
 * reruns see IDENTICAL usage/set data with zero network. Misses are cached
 * too — a format file that 404s must 404 for BOTH engines, or the paired
 * comparison silently diverges.
 *
 * Only the surface the Smogon consumers touch is implemented (ok, status,
 * json) — fetchSmogonUsageStats, fetchSmogonSetAssumptions, and
 * @pkmn/smogon's Smogon class never read headers or bodies as streams.
 */
export function diskCachedSmogonFetcher(): typeof fetch {
  mkdirSync(CACHE_DIR, { recursive: true });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const key = `${url.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.json`;
    const path = join(CACHE_DIR, key);
    let entry: CacheEntry | null = null;
    if (existsSync(path)) {
      entry = JSON.parse(readFileSync(path, 'utf-8')) as CacheEntry;
    } else {
      try {
        const response = await fetch(url);
        entry = response.ok
          ? { status: response.status, payload: await response.json() }
          : { status: response.status };
      } catch {
        // Network failure pins as a miss — deterministic beats lucky.
        entry = { status: 599 };
      }
      writeFileSync(path, JSON.stringify(entry));
    }
    const ok = entry.status >= 200 && entry.status < 300 && 'payload' in entry;
    return {
      ok,
      status: entry.status,
      json: async () => {
        if (!ok) throw new Error(`cached miss for ${url} (${entry.status})`);
        return entry.payload;
      },
    } as unknown as Response;
  }) as typeof fetch;
}
