import { toId } from '../ids.ts';
import type { RulesDex } from '../rules-dex.ts';

/**
 * Round 86 (T310): how many turns a condition lasts, read from the Dex's own rule, so the log can name the item that held a
 * screen. Light Clay makes Reflect, Light Screen and Aurora Veil last eight turns instead of five; the log never shows the item,
 * only the start and the end of the screen. The condition's `durationCallback` answers for a source that holds an item, so the
 * reader asks it on a stand-in source for each item of the rule set and keeps the items that change the answer. No item or move
 * name sits in the code: the table is whatever the Dex yields (Generations 1 and 2 give none, Generation 3 gives a plain five
 * with no item, Generations 4 to 9 and the Champions mod give Light Clay), and the sweep `screen-turns-sweep.spec.ts` holds it
 * to a real Pokémon on a real battle in every rule set and both game types.
 */
export interface ConditionTurns {
  /** The turns the condition lasts for a source whose item does not matter. */
  readonly plain: number;
  /** The items that change the turns, with the turns each gives (an item that leaves the answer alone is absent). */
  readonly byItem: ReadonlyMap<string, number>;
}

type DurationCallback = (this: unknown, ...args: unknown[]) => unknown;
type DexMove = ReturnType<RulesDex['moves']['get']>;

const memo = new WeakMap<object, Map<string, ConditionTurns | null>>();

/** The move of the rule set that sets the condition (the callback takes it as its effect). */
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

/** A source of the callback: it holds one item, or none (`held` is ''), and has no ability. */
const sourceHolding = (held: string) => ({
  item: held,
  hasItem: (item: string | string[]) => [item].flat().some(entry => toId(entry) === held),
  hasAbility: () => false,
});

/**
 * The turns of a condition (a side condition, a pseudo weather, a weather or a terrain) for a source with no item, and the
 * items that change them; null when no move of the rule set sets it, when it has no `durationCallback`, or when the callback
 * needs more than an item (it throws on the stand-in: the answer is unknown, never guessed). The call reads no battle, so it
 * costs one pass over the rule set's items per condition, cached per Dex.
 */
export function conditionTurns(dex: RulesDex, conditionId: string): ConditionTurns | null {
  let table = memo.get(dex);
  if (!table) memo.set(dex, table = new Map());
  const id = toId(conditionId);
  if (!table.has(id)) table.set(id, read(dex, id));
  return table.get(id)!;
}

/**
 * Round 88 (T329): whether an ability's start leaves a weather or a terrain standing for good. Before Generation 6 the condition's
 * `onFieldStart` handler sets the duration of a field that an ability starts to 0 (the callback of `conditionTurns` answers five
 * or eight for every source), so a field of an ability's start never ends on its own there. The reader runs the handler on a
 * stand-in battle and reads the duration it leaves; a handler that needs more than that gives true (the answer is unknown, never
 * guessed, so no verdict follows). The sweep `field-evidence-sweep.spec.ts` (S9) holds the answer to the simulator.
 */
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

/**
 * What makes a holder's item count for nothing, so a screen then lasts its plain turns whatever the item is: an ability, a
 * volatile and a field condition of the simulator (`Pokemon.ignoringItem`). The screen reader doubts a rule-out when one of
 * them may stand; the sweep plays every ability, move and condition of every rule set against a Light Clay holder and holds
 * this list to the causes it finds.
 */
// oracle: packages/replay-core/test/screen-turns-sweep.spec.ts
// eslint-disable-next-line names/no-new-dex-name -- reviewed: the three causes of Pokemon.ignoringItem, held to the simulator by the sweep named above
export const ITEM_BLOCKERS = { ability: ['klutz'], volatile: ['embargo'], field: ['magicroom'] } as const;
