import type { RulesDex } from '@fulllifegames/replay-core';

/**
 * Struggle in Gens 2 to 4 is typeless in the simulator (its onModifyMove sets the type to '???'), so a Normal type-boost item (Silk Scarf,
 * Pink Bow) adds nothing, while @smogon/calc 0.12 hands it over by name. Both facts come from the simulator's handlers on stand-ins.
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

/** The item handlers that scale a hit by the move: all four take (value, user, target, move); Gen 3's Silk Scarf reads onModifyAtk. */
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

/** The item the calc sees on the attacker: '' for a Normal-type boost item on a move the simulator plays typeless, else the item. */
export function itemAtUse(dex: RulesDex, item: string, moveName: string): string {
  if (!item) return item;
  return typelessAtUse(dex, moveName) && boostsType(dex, item, moveName, 'Normal') && !boostsType(dex, item, moveName, '???') ? '' : item;
}
