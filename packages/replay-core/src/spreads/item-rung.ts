import { dexOfCalc } from '../rules-dex.ts';
import { toId } from '../ids.ts';
import { belongsToOthers, changesSpeed, isBoostItem, requiresItem } from './boost-items.ts';
import { keyOf, setOf, type SolveContext } from './fit.ts';

/**
 * Round 89 (#75 step 2): the items the solver may swap in for a mon whose knockouts no spread of its set reaches. The build guessed the mon's item
 * (no log line, sheet or edit showed it); a usage-listed item that raises the damage of the hit may be the one it really held. What may enter:
 *  - the species' usage-listed items the log does not refute (the knowledge map's `itemOffers`, in usage order: a revealed other item, a Knock Off,
 *    an eaten berry and a Leftovers line made the mon's item known and so end the search; two different moves under a Choice item, a missing Life Orb
 *    recoil and the other item rules of the inferrer are already out of the list);
 *  - items the simulator gives a damage hook (`isBoostItem`: the Dex says which items boost which hit, no name is listed here), that belong to the
 *    species (`itemUser`) and that no other Pokémon of the team is known to hold when the format has an Item Clause (a limit of N lets N Pokémon hold one;
 *    a Custom Game has no clause).
 * Nothing is offered when the guessed item is a boost item itself (round 69's drop reads it), an item the species needs (a Mega Stone), a Choice Scarf
 * a move order decided, or an item that changes Speed while the mon has move orders (the orders priced the guessed item's Speed).
 */
export function itemOffers(ctx: SolveContext, key: string, hasSpeedObs: boolean): string[] {
  const [side, species] = key.split(':') as ['p1' | 'p2', string];
  const set = setOf(ctx, side, species);
  const know = ctx.knowledge.get(key) ?? (set ? ctx.knowledge.get(keyOf(side, set.species)) : undefined);
  if (!set || !know || know.itemKnown || !know.itemOffers?.length || ctx.scarf.has(key)) return [];
  const dex = dexOfCalc(ctx.gen);
  if (set.item && (isBoostItem(dex, set.item) || requiresItem(dex, set.species, set.item) || (hasSpeedObs && changesSpeed(dex, set.item)))) return [];
  const held = heldBy(ctx, side, set.species);
  return know.itemOffers.filter(name => {
    const id = toId(name);
    return id !== toId(set.item ?? '') && isBoostItem(dex, name) && !belongsToOthers(dex, set.species, name) &&
      (know.itemLimit === undefined || (held.get(id) ?? 0) < know.itemLimit);
  });
}

/** How many teammates are known to hold each item: the build's known items, and a boost item the solver gave another mon of the side. */
function heldBy(ctx: SolveContext, side: 'p1' | 'p2', species: string): Map<string, number> {
  const held = new Map<string, number>();
  for (const mate of ctx.sets[side]) {
    if (toId(mate.species) === toId(species)) continue;
    const mateKey = keyOf(side, mate.species);
    const solved = ctx.solved.get(mateKey);
    const item = solved?.itemReason === 'boost' ? solved.item : ctx.knowledge.get(mateKey)?.itemKnown ? mate.item : '';
    if (item) held.set(toId(item), (held.get(toId(item)) ?? 0) + 1);
  }
  return held;
}
