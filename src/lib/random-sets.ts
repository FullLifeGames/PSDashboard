import type { withStandIns } from '@fulllifegames/replay-core';
import type { SmogonFetch } from './smogon/hosts';

/** The published random-set file of a format whose Dex generates the team; its shape is read off `withStandIns`. */
export type RandomSetFile = NonNullable<Parameters<typeof withStandIns>[4]>;

// data.pkmn.cc/random answers with a redirect to the randbats pages; the second host is the page itself.
const RANDOM_SET_HOSTS = ['https://data.pkmn.cc/random', 'https://pkmn.github.io/randbats/data'] as const;

/** The format's file: null for a 404 or a non-object body; every host unreachable throws, so the next load retries. */
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
