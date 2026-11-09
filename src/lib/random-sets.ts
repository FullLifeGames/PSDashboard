import { simFormats, withStandIns } from '@fulllifegames/replay-core';
import type { SmogonFetch } from './smogon/hosts';

/**
 * Round 89 (lane B, #117): the published random-set file of a format whose Dex entry generates the team (Random Battle, Hackmons Cup).
 * Its shape is the one `withStandIns` reads (replay-core's `RandomSetFile`, read off the function so the two cannot drift), and a
 * game that shows fewer bodies than its `|teamsize|` fills the rest from it. The file is not a Smogon analysis file: the hosts differ.
 */
export type RandomSetFile = NonNullable<Parameters<typeof withStandIns>[4]>;

/**
 * Whether the format's Dex entry generates the team: such a game has no stats file and, from round 89, a random-set file. The one rule
 * of replay-core's `withStandIns` (a spec compares the two over every format the Dex knows), read from the Dex, never from a name.
 */
export function generatesTeam(formatId: string): boolean {
  const format = simFormats().get(formatId);
  return format.exists && !!format.team;
}

/** data.pkmn.cc/random answers with a redirect to the randbats pages; the second host is the page itself. */
const RANDOM_SET_HOSTS = ['https://data.pkmn.cc/random', 'https://pkmn.github.io/randbats/data'] as const;

/**
 * The format's file: null for a 404 (the format has none), the first host that answers otherwise; every host unreachable throws, so
 * the caller can report a failure and the next load retries. A body that is no object (an error page) reads as no file.
 */
export async function fetchRandomSets(formatId: string, fetcher: SmogonFetch): Promise<RandomSetFile | null> {
  let failure: unknown = null;
  for (const host of RANDOM_SET_HOSTS) {
    try {
      const response = await fetcher(`${host}/${formatId}.json`);
      if (response.status === 404) return null;
      if (response.ok === false) throw new Error(`Random sets unavailable: ${response.status}`);
      const file: unknown = await response.json();
      return file && typeof file === 'object' && !Array.isArray(file) ? file as RandomSetFile : null;
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? failure : new Error('Random sets unreachable');
}
