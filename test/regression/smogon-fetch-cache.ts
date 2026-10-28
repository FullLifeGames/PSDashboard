import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
 * Parallel calibration slices (scripts/run-calibration.mjs) share this
 * directory, so an entry is published atomically and a half-written file
 * reads as absent; two slices pinning the same URL at once write the same
 * payload.
 */

/** A complete cached entry, or null when the file is absent or still being written by a sibling process. */
function readEntry(path: string): CacheEntry | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CacheEntry;
  } catch {
    return null;
  }
}

/** Write to a temp file and rename it into place, so no reader ever sees a partial entry. */
function writeEntry(path: string, entry: CacheEntry): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(entry));
  try {
    renameSync(temp, path);
  } catch {
    // A sibling published the same entry first; theirs is complete.
    try {
      unlinkSync(temp);
    } catch {
      // Best effort.
    }
  }
}
export function diskCachedSmogonFetcher(): typeof fetch {
  mkdirSync(CACHE_DIR, { recursive: true });
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const key = `${url.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.json`;
    const path = join(CACHE_DIR, key);
    let entry = readEntry(path);
    if (!entry) {
      try {
        const response = await fetch(url);
        entry = response.ok
          ? { status: response.status, payload: await response.json() }
          : { status: response.status };
      } catch {
        // Network failure pins as a miss — deterministic beats lucky.
        entry = { status: 599 };
      }
      writeEntry(path, entry);
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
