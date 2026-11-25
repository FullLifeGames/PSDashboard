import { toId } from '../ids.ts';
import type { RulesDex } from '../rules-dex.ts';

const DAMAGE_HOOKS = ['onModifyAtk', 'onModifySpA', 'onBasePower', 'onModifyDamage'] as const;

const cache = new WeakMap<RulesDex, Set<string>>();

/** The ids of the items that raise the holder's damage: every item the simulator gives a damage hook; no list here. */
export function boostItemIds(dex: RulesDex): ReadonlySet<string> {
  let ids = cache.get(dex);
  if (!ids) {
    ids = new Set(dex.items.all()
      .filter(item => DAMAGE_HOOKS.some(hook => typeof (item as unknown as Record<string, unknown>)[hook] === 'function'))
      .map(item => item.id));
    cache.set(dex, ids);
  }
  return ids;
}

export const isBoostItem = (dex: RulesDex, item: string): boolean => boostItemIds(dex).has(toId(item));

/** Whether the Dex requires the item for the species (Ogerpon masks, the orbs, Soul Dew). */
export function requiresItem(dex: RulesDex, species: string, item: string): boolean {
  const entry = dex.species.get(species);
  return [entry.requiredItem, ...(entry.requiredItems ?? [])].some(name => !!name && toId(name) === toId(item));
}

/** Whether the item has an `onModifySpe` hook (Choice Scarf, Iron Ball). */
export function changesSpeed(dex: RulesDex, item: string): boolean {
  const entry = dex.items.get(item);
  return entry.exists && typeof (entry as unknown as Record<string, unknown>).onModifySpe === 'function';
}

/** Whether the Dex's `itemUser` limits the item to other species (Light Ball, Thick Club). */
export function belongsToOthers(dex: RulesDex, species: string, item: string): boolean {
  const users = dex.items.get(item).itemUser;
  return !!users && !users.some(user => toId(user) === toId(species));
}
