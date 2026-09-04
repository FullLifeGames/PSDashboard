/**
 * Where the Smogon data files live. data.pkmn.cc is @pkmn/smogon's
 * documented address and answers with a 301 to the GitHub Pages mirror
 * since 2026-09-03; browsers follow it, but a redirecting domain is one
 * more thing that can break. The wrapper tries the hosts in order.
 */
const SMOGON_DATA_HOSTS = ['https://data.pkmn.cc', 'https://pkmn.github.io/smogon/data'] as const;

export type SmogonFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The data path below any Smogon data host ("/stats/gen8ou.json"), double slashes collapsed; null for foreign URLs. */
export function smogonDataPath(url: string): string | null {
  for (const host of SMOGON_DATA_HOSTS) {
    if (url.startsWith(host)) return url.slice(host.length).replace(/\/{2,}/g, '/');
  }
  return null;
}

/**
 * Tries the Smogon data hosts in order for a Smogon data URL: a network
 * failure or a status outside 2xx other than 404 moves on to the next
 * host; a 404 is an answer (the file is absent on the canonical data) and
 * returns as is. Foreign URLs pass through untouched. @pkmn/smogon builds
 * its URLs with a double slash ("https://data.pkmn.cc//sets/…"), so the
 * path is normalized before any host is tried. A response without an
 * `ok` field (a test fake that only offers `json()`) counts as success.
 */
export function withSmogonFallback(fetcher: SmogonFetch): SmogonFetch {
  return async (input, init) => {
    const path = smogonDataPath(input);
    if (path === null) return fetcher(input, init);
    let lastError: unknown = null;
    let lastResponse: Response | null = null;
    for (const host of SMOGON_DATA_HOSTS) {
      try {
        const response = await fetcher(`${host}${path}`, init);
        if (response.ok === undefined || response.ok || response.status === 404) return response;
        lastResponse = response;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    if (lastResponse) return lastResponse;
    throw lastError instanceof Error ? lastError : new Error(`Smogon data unreachable: ${path}`);
  };
}
