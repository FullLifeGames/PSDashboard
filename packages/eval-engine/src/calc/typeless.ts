import type { RulesDex } from '@fulllifegames/replay-core';

// Struggle in Gens 2 to 4 is typeless in the simulator (onModifyMove sets '???'): a Normal type-boost item adds none.

type Handler = (this: unknown, ...args: unknown[]) => unknown;

function typelessAtUse(dex: RulesDex, moveName: string): boolean {
  const move = dex.getActiveMove(moveName);
  const modify = (move as { onModifyMove?: unknown }).onModifyMove;
  if (!move.exists || move.category === 'Status' || typeof modify !== 'function') return false;
  try {
    (modify as Handler).call(undefined, move, { species: dex.species.get('pikachu') }, null);
  } catch {
    return false;
  }
  return (move.type as string) === '???';
}

// Item handlers that scale a hit take (value, user, target, move); Gen 3's Silk Scarf reads onModifyAtk.
const HIT_HANDLER = /^on(BasePower|ModifyAtk|ModifySpA|ModifyDamage)$/;

function boostsType(dex: RulesDex, itemName: string, moveName: string, type: string): boolean {
  const item = dex.items.get(itemName) as unknown as Record<string, unknown>;
  const move = { ...dex.getActiveMove(moveName), type };
  return Object.keys(item).filter(key => HIT_HANDLER.test(key) && typeof item[key] === 'function').some(key => {
    try {
      return !!(item[key] as Handler).call({ chainModify: (modifier: unknown) => modifier }, 100, null, null, move);
    } catch {
      return false;
    }
  });
}

/** The item the calc sees: '' for a Normal-type boost item on a move the simulator plays typeless. */
export function itemAtUse(dex: RulesDex, item: string, moveName: string): string {
  if (!item) return item;
  return typelessAtUse(dex, moveName) && boostsType(dex, item, moveName, 'Normal') && !boostsType(dex, item, moveName, '???') ? '' : item;
}
