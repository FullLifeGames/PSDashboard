/**
 * Round 77 (user gate 28.10.2026, 4a): the engines the Evaluation panel offers. The dashboard's own
 * search is the first; engines contributed to this repository follow (ENGINES.md, "Contribute an
 * engine"); a user's own, added by address in the panel, are kept in this browser.
 */
export interface EngineEntry {
  /** Stable id: results and cache keys carry it. */
  id: string;
  name: string;
  /** The HTTP endpoint that answers the engine protocol; null for the dashboard's own search. */
  url: string | null;
  author?: string;
  homepage?: string;
  source: 'builtin' | 'contributed' | 'added';
}

export const BUILTIN_ENGINE: EngineEntry = { id: 'ps-dashboard', name: 'PS Dashboard', url: null, source: 'builtin' };

/**
 * Engines contributed to this repository: an entry names a hosted endpoint that passes
 * `npx @fulllifegames/eval-engine check-engine <url>`, with its author and a homepage.
 */
export const CONTRIBUTED_ENGINES: EngineEntry[] = [];

export const ADDED_ENGINES_KEY = 'ps-replay-interceptor:engines';
export const SELECTED_ENGINE_KEY = 'ps-replay-interceptor:engine';

export const engineIdForUrl = (url: string) => `url:${url}`;

/** The user's own engines; a broken or missing list is no list. */
export function loadAddedEngines(): EngineEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ADDED_ENGINES_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is { name: string; url: string } =>
        !!entry && typeof entry.name === 'string' && typeof entry.url === 'string')
      .map(entry => ({ id: engineIdForUrl(entry.url), name: entry.name, url: entry.url, source: 'added' as const }));
  } catch {
    return [];
  }
}

export function saveAddedEngines(engines: EngineEntry[]): void {
  try {
    localStorage.setItem(ADDED_ENGINES_KEY, JSON.stringify(engines.map(engine => ({ name: engine.name, url: engine.url }))));
  } catch {
    // Storage blocked: the engines stay for this session.
  }
}

/** An address the panel accepts: http or https, a host, no credentials in it. */
export function engineUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'That is not an address (for example http://localhost:8765/).';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'The address must start with http:// or https://.';
  if (parsed.username || parsed.password) return 'Leave credentials out of the address.';
  return null;
}
