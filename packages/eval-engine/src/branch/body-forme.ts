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
    for (const origin of [entry.battleOnly].flat()) {
      if (!origin) continue;
      queue.push(origin);
      const shownAs = originShownAsBase(dex, entry, dex.species.get(origin));
      if (shownAs) queue.push(shownAs);
    }
  }
  return family;
}

/**
 * Round 89 (#118): a forme an ability makes in battle (Greninja-Ash by Battle Bond) from an origin that carries that ability and differs
 * from its base species in nothing but the ability list (Greninja-Bond: the base species' stats and types, Battle Bond alone). The simulator
 * shows such an origin to the log by its base species ("Greninja"), so the body on the bench holds the base species while the log asks for
 * the forme, and the base species stands for the origin. A forme that needs an item or a move, an origin with other stats or types
 * (Darmanitan-Galar-Zen, Ogerpon-Wellspring-Tera, Urshifu-Rapid-Strike-Gmax, Necrozma-Ultra) or with the base species' abilities
 * (Mimikyu-Totem) is another body than the base species and does not tie.
 */
function originShownAsBase(dex: FormeDex, forme: ReturnType<FormeDex['species']['get']>, origin: ReturnType<FormeDex['species']['get']>): string | undefined {
  if (!origin.exists || origin.baseSpecies === origin.name || !forme.requiredAbility) return undefined;
  if (!Object.values(origin.abilities).includes(forme.requiredAbility)) return undefined;
  const base = dex.species.get(origin.baseSpecies);
  if (!base.exists || JSON.stringify(base.abilities) === JSON.stringify(origin.abilities)) return undefined;
  const same = JSON.stringify(base.baseStats) === JSON.stringify(origin.baseStats) && base.types.join() === origin.types.join();
  return same ? base.name : undefined;
}

/** Whether two species names (or ids) are one body: equal ids, or families that meet. */
export function sameBodyForme(dex: FormeDex, a: string | undefined, b: string | undefined): boolean {
  const left = formeFamily(dex, a);
  if (left.size === 0) return false;
  for (const id of formeFamily(dex, b)) if (left.has(id)) return true;
  return false;
}
