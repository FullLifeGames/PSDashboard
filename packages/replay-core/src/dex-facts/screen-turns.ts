import { toId } from '../ids.ts';
import type { RulesDex } from '../rules-dex.ts';

/** The turns a condition lasts, read from the Dex's `durationCallback`: Light Clay makes screens last 8, not 5. */
export interface ConditionTurns {
  readonly plain: number;
  /** The turns each item gives; an item that leaves the answer alone is absent. */
  readonly byItem: ReadonlyMap<string, number>;
}

type DurationCallback = (this: unknown, ...args: unknown[]) => unknown;
type DexMove = ReturnType<RulesDex['moves']['get']>;

const memo = new WeakMap<object, Map<string, ConditionTurns | null>>();

function settingMove(dex: RulesDex, id: string): { move: DexMove; side: boolean } | null {
  for (const move of dex.moves.all()) {
    if (!move.exists || move.gen > dex.gen) continue;
    const side = move.sideCondition ?? move.self?.sideCondition;
    if (side && toId(side) === id) return { move, side: true };
    const field = move.pseudoWeather ?? move.weather ?? move.terrain;
    if (field && toId(field) === id) return { move, side: false };
  }
  return null;
}

const sourceHolding = (held: string) => ({
  item: held,
  hasItem: (item: string | string[]) => [item].flat().some(entry => toId(entry) === held),
  hasAbility: () => false,
});

/** The turns for a source with no item and the items that change them; null when unknown (never guessed). */
export function conditionTurns(dex: RulesDex, conditionId: string): ConditionTurns | null {
  let table = memo.get(dex);
  if (!table) memo.set(dex, table = new Map());
  const id = toId(conditionId);
  if (!table.has(id)) table.set(id, read(dex, id));
  return table.get(id)!;
}

/** Whether an ability's start leaves a weather or terrain up for good (before Gen 6: duration 0); true when unknown. */
export function startsForGood(dex: RulesDex, conditionId: string, abilityId: string): boolean {
  const handler = (dex.conditions.get(conditionId) as unknown as { onFieldStart?: (this: unknown, ...args: unknown[]) => unknown }).onFieldStart;
  if (typeof handler !== 'function') return false;
  const effectState: { duration?: number } = { duration: 5 };
  const effect = dex.abilities.get(abilityId);
  try {
    handler.call({ gen: dex.gen, effectState, add: () => undefined }, {}, {}, effect);
    return effectState.duration === 0;
  } catch {
    return true;
  }
}

function read(dex: RulesDex, id: string): ConditionTurns | null {
  const setter = settingMove(dex, id);
  if (!setter) return null;
  const callback = (dex.conditions.get(id) as unknown as { durationCallback?: DurationCallback }).durationCallback;
  if (typeof callback !== 'function') return null;
  const ask = (held: string): unknown => {
    const source = sourceHolding(held);
    return setter.side
      ? callback.call({ dex }, source, source, setter.move)
      : callback.call({ dex }, source, setter.move);
  };
  try {
    const plain = ask('');
    if (typeof plain !== 'number') return null;
    const byItem = new Map<string, number>();
    for (const item of dex.items.all()) {
      if (!item.exists || item.gen > dex.gen) continue;
      const turns = ask(item.id);
      if (typeof turns !== 'number') return null;
      if (turns !== plain) byItem.set(item.id, turns);
    }
    return { plain, byItem };
  } catch {
    return null;
  }
}

/** The causes of `Pokemon.ignoringItem`: an ability, a volatile and a field condition. */
// oracle: packages/replay-core/test/screen-turns-sweep.spec.ts
// eslint-disable-next-line names/no-new-dex-name -- reviewed: the three causes of Pokemon.ignoringItem, held to the simulator by the sweep named above
export const ITEM_BLOCKERS = { ability: ['klutz'], volatile: ['embargo'], field: ['magicroom'] } as const;
