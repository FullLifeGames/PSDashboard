import { toId } from '@fulllifegames/replay-core';
import type { SimBattle } from './types.ts';

/** The battle's own Dex (`battle.dex`): the resolver of generation and mod, never the global one. */
type FormeDex = SimBattle['dex'];

/**
 * Round 88 (#103): the one rule for "is this the same body in another forme". A forme that exists only in battle (Ogerpon-Teal-Tera,
 * Terapagos-Stellar, a Mega, a Primal, Zygarde-Complete, Castform-Sunny) carries its origin as the Dex's `battleOnly` (a species name or a
 * list of them). A species' family is its own id and the ids of its origins, followed up the chain; two species are one body when their
 * families meet. Every site that once cut a suffix list off a species id (`tera`, `stellar`, `terastal`) asks here instead, with the
 * Dex of the battle it reads.
 */
export function formeFamily(dex: FormeDex, species: string | undefined): ReadonlySet<string> {
  const family = new Set<string>();
  const queue = [species ?? ''];
  while (queue.length > 0) {
    const raw = queue.pop()!;
    const id = toId(raw);
    // An empty id (a name without Latin letters) is no key: it would tie every such species together.
    if (id === '' || family.has(id)) continue;
    family.add(id);
    const entry = dex.species.get(raw);
    if (!entry.exists) continue;
    family.add(entry.id);
    for (const origin of [entry.battleOnly].flat()) if (origin) queue.push(origin);
  }
  return family;
}

/** Whether two species names (or ids) are one body: equal ids, or families that meet. */
export function sameBodyForme(dex: FormeDex, a: string | undefined, b: string | undefined): boolean {
  const left = formeFamily(dex, a);
  if (left.size === 0) return false;
  for (const id of formeFamily(dex, b)) if (left.has(id)) return true;
  return false;
}
