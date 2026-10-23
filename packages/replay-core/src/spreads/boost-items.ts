import { toId } from '../ids.ts';
import type { RulesDex } from '../rules-dex.ts';

/** The simulator's damage hooks of an item: the attacker's Attack or Special Attack, the move's power, the final damage. */
const DAMAGE_HOOKS = ['onModifyAtk', 'onModifySpA', 'onBasePower', 'onModifyDamage'] as const;

const cache = new WeakMap<RulesDex, Set<string>>();

/**
 * The ids of the items that raise the holder's damage in the generation (round 69, T26): every item the simulator
 * gives a damage hook (Choice Band, Choice Specs, Life Orb, Muscle Band, the type boosters and the species items).
 * Read from the simulator's Dex, so a new item or a generation's changes need no edit here.
 */
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

/** Whether the named item raises its holder's damage in the generation. */
export const isBoostItem = (dex: RulesDex, item: string): boolean => boostItemIds(dex).has(toId(item));

/** Whether the species cannot be what it is without the item (the Ogerpon masks, the orbs, Soul Dew: the Dex's required items). */
export function requiresItem(dex: RulesDex, species: string, item: string): boolean {
  const entry = dex.species.get(species);
  return [entry.requiredItem, ...(entry.requiredItems ?? [])].some(name => !!name && toId(name) === toId(item));
}
