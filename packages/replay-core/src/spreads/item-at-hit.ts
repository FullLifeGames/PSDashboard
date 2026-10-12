import type { SpreadCandidate } from './ladder.ts';

/** The item rows of a Dex (the Dex of the replay's generation). */
export interface ItemDex {
  items: { get(id: string): { exists: boolean; name: string } };
}

/**
 * A body holding the item it held at the hit (round 69, T191, spec decision 9). The client's item is the truth when the log has
 * shown one; an item the log took away (used up, knocked off, stolen, swapped for nothing) is gone; an item the log never showed
 * stays what the body carries, the candidate's before the set's. Items read by Dex id, so the log's id and the calculator's name
 * meet. An observation without the fields (a cache older than T191) keeps the body.
 */
export function withItemAtHit(
  dex: ItemDex, body: SpreadCandidate, setItem: string | undefined, shown: string | undefined, changed: boolean | undefined,
): SpreadCandidate {
  if (shown === undefined) return body;
  const carried = body.item ?? setItem ?? '';
  let item = carried;
  if (shown) {
    const row = dex.items.get(shown);
    if (row.exists) item = row.name;
  } else if (changed) {
    item = '';
  }
  return item === carried ? body : { ...body, item };
}
