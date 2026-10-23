import type { RulesDex } from '@fulllifegames/replay-core';

/**
 * Round 68 (T186, decision 6): Struggle in Gens 2 to 4 is typeless in the simulator (its own onModifyMove sets the type to
 * '???' when it is used), so a type-boost item of Normal (Silk Scarf, Pink Bow) adds nothing to it. @smogon/calc 0.12 hands
 * those items to Struggle by name. The engine sends the calc the body as its move finds it: without the item, when the
 * item's own onBasePower boosts a Normal move and not a typeless one. Both facts are asked from the simulator's handlers on
 * stand-ins (no move or item list): the move's onModifyMove on the active move, the item's hit handlers on the move at both types.
 */

type Handler = (this: unknown, ...args: unknown[]) => unknown;

/** Whether the simulator's move, once it has run its own onModifyMove, is a typeless damaging move ('???'). */
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

/** The item handlers that scale a hit by what the move is: all four take (value, user, target, move) (Gen 3's Silk Scarf reads onModifyAtk). */
const HIT_HANDLER = /^on(BasePower|ModifyAtk|ModifySpA|ModifyDamage)$/;

/** Whether one of the item's hit handlers gives a boost to a move of this type, the move otherwise as it stands. */
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

/** The item the calc should see on the attacker for this move: '' for a Normal-type boost item on a move the simulator plays typeless, else the item itself. */
export function itemAtUse(dex: RulesDex, item: string, moveName: string): string {
  if (!item) return item;
  return typelessAtUse(dex, moveName) && boostsType(dex, item, moveName, 'Normal') && !boostsType(dex, item, moveName, '???') ? '' : item;
}
