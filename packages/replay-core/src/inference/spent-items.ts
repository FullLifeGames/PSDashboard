import type { RulesDex } from '../rules-dex.ts';

type ItemHandler = (this: never, ...args: never[]) => unknown;
export type SelfItem = { onAfterMoveSecondarySelf?: ItemHandler };

const ownMoveItems = new WeakMap<RulesDex, string[]>();

/** Whether the item's own `onAfterMoveSecondarySelf` spends it after its holder's move; a throw reads as no. */
export function spendsAfterOwnMove(dex: RulesDex, itemId: string, moveName: string): boolean {
  const handler = (dex.items.get(itemId) as unknown as SelfItem).onAfterMoveSecondarySelf;
  if (!handler) return false;
  let spent = false;
  const spend = () => { spent = true; return true; };
  const holder = { useItem: spend, eatItem: spend, baseMaxhp: 100, forceSwitchFlag: false };
  try {
    handler.call({ dex } as never, holder as never, {} as never, dex.getActiveMove(moveName) as never);
  } catch {
    return false;
  }
  return spent;
}

/** The ids of the items in the Dex's generation whose own move spends them for some damaging move. */
export function spentAfterOwnMove(dex: RulesDex): string[] {
  let ids = ownMoveItems.get(dex);
  if (!ids) {
    const moves = dex.moves.all().filter(move => move.exists && move.category !== 'Status');
    const items = dex.items.all().filter(item => item.exists && item.gen <= dex.gen && !!(item as unknown as SelfItem).onAfterMoveSecondarySelf);
    ids = items.filter(item => moves.some(move => spendsAfterOwnMove(dex, item.id, move.name))).map(item => item.id);
    ownMoveItems.set(dex, ids);
  }
  return ids;
}
