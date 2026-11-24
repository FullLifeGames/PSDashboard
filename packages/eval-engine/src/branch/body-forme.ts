import { toId } from '@fulllifegames/replay-core';
import type { SimBattle } from './types.ts';

type FormeDex = SimBattle['dex'];

/** A species' family: its id and its origins' ids (the Dex's `battleOnly` chain); one body when families meet. */
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

// An ability-made forme (Greninja-Ash) ties to its base species if the origin differs only in abilities:
// the sim logs it by its base species; a forme needing an item or move, or other stats or types, is another body.
function originShownAsBase(dex: FormeDex, forme: ReturnType<FormeDex['species']['get']>, origin: ReturnType<FormeDex['species']['get']>): string | undefined {
  if (!origin.exists || origin.baseSpecies === origin.name || !forme.requiredAbility) return undefined;
  if (!Object.values(origin.abilities).includes(forme.requiredAbility)) return undefined;
  const base = dex.species.get(origin.baseSpecies);
  if (!base.exists || JSON.stringify(base.abilities) === JSON.stringify(origin.abilities)) return undefined;
  const same = JSON.stringify(base.baseStats) === JSON.stringify(origin.baseStats) && base.types.join() === origin.types.join();
  return same ? base.name : undefined;
}

export function sameBodyForme(dex: FormeDex, a: string | undefined, b: string | undefined): boolean {
  const left = formeFamily(dex, a);
  if (left.size === 0) return false;
  for (const id of formeFamily(dex, b)) if (left.has(id)) return true;
  return false;
}
