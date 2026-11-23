// The bank's replay fetch: retries a network error, a server error or a rate limit; a client error returns at once. A replay that never
// arrives comes back as its status (0 for a network error); the harness logs it as `skipping <id>: HTTP <status>`, which run-calibration.mjs counts.

export type FetchOutcome<T> = { replay: T } | { status: number };

export interface FetchOptions {
  attempts?: number;
  /** The pause before attempt 2, 3, ... in milliseconds; the last entry repeats. */
  pauses?: number[];
  fetcher?: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** A status that a later attempt can heal: a rate limit or a server error. */
const transient = (status: number) => status === 429 || status >= 500;

export async function fetchBankReplay<T>(id: string, { attempts = 4, pauses = [2000, 5000, 10000], fetcher = fetch }: FetchOptions = {}): Promise<FetchOutcome<T>> {
  let status = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await pause(pauses[Math.min(attempt - 1, pauses.length - 1)] ?? 0);
    try {
      const response = await fetcher(`https://replay.pokemonshowdown.com/${id}.json`);
      if (response.ok) return { replay: await response.json() as T };
      status = response.status;
      if (!transient(status)) return { status };
    } catch {
      // The network failed, or the body broke off while it was read: try again.
      status = 0;
    }
  }
  return { status };
}
