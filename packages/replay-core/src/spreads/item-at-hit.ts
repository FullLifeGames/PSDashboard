import type { SpreadCandidate } from './ladder.ts';

export interface ItemDex {
  items: { get(id: string): { exists: boolean; name: string } };
}

/** The item a body held at the hit: the shown one, none once the log took it away, else the candidate's or set's. */
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
