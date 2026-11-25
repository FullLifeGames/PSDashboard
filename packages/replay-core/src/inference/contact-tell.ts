import { Battle } from '@pkmn/sim';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { toId } from '../ids.ts';
import { guessedField, itemSetValue } from '../team-info.ts';
import { itemClauseLimit } from '../team/inferred-items.ts';
import type { RevealedPokemonInfo } from '../types.ts';
import type { InferrerState } from './inferrer-state.ts';

export interface ItemTell {
  id: string;
  name: string;
  detail: string;
}

/** Whether a move makes contact with `heldItem`: its `onModifyMove`, then `checkMoveMakesContact`; doubt is no. */
export function contactLands(dex: RulesDex, moveName: string, heldItem: string): boolean {
  const holder = { hasItem: (item: string | string[]) => [item].flat().map(toId).includes(heldItem), addVolatile: () => false };
  try {
    const move = dex.getActiveMove(moveName);
    const item = dex.items.get(heldItem) as { onModifyMove?: (this: never, ...args: never[]) => void };
    item.onModifyMove?.call({} as never, move as never, holder as never, null as never);
    return Battle.prototype.checkMoveMakesContact.call({} as never, move, holder as never, holder as never);
  } catch {
    return false;
  }
}

const breakers = new WeakMap<RulesDex, Map<string, string[]>>();

export function contactBreakers(dex: RulesDex, moveName: string): string[] {
  const byMove = breakers.get(dex) ?? new Map<string, string[]>();
  breakers.set(dex, byMove);
  let found = byMove.get(moveName);
  if (!found) {
    found = !contactLands(dex, moveName, '') ? [] : dex.items.all()
      .filter(item => item.exists && item.gen <= dex.gen && !item.isNonstandard && !contactLands(dex, moveName, item.id)).map(item => item.id);
    byMove.set(moveName, found);
  }
  return found;
}

export function noteItemTell(state: InferrerState, info: RevealedPokemonInfo, tell: ItemTell) {
  (state.itemTells ??= new Map()).set(info, tell);
}

export function noteContactTell(state: InferrerState, info: RevealedPokemonInfo, moveName: string) {
  const dex = dexOf(state);
  const [id, ...others] = contactBreakers(dex, moveName);
  if (id && others.length === 0) noteItemTell(state, info, { id, name: dex.items.get(id).name, detail: 'A shown Rocky Helmet did not damage it on contact' });
}


export function applyItemTells(state: InferrerState, log: string) {
  if (!state.itemTells) return;
  const limit = itemClauseLimit(log);
  const held = new Map<string, number>();
  const take = (id: string) => held.set(id, (held.get(id) ?? 0) + 1);
  for (const info of state.pokemonMap.values()) if (itemSetValue(info.item.value)) take(toId(itemSetValue(info.item.value)));
  for (const [info, tell] of state.itemTells) {
    if (itemSetValue(info.item.value) || info.ruledOut?.items.includes(tell.id) || (limit !== undefined && (held.get(tell.id) ?? 0) >= limit)) continue;
    info.item = guessedField(tell.name, undefined, tell.detail);
    take(tell.id);
  }
}
