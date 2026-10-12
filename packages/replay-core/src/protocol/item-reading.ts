import type { Pokemon } from '@pkmn/client';
import { toId } from '../ids.ts';
import type { DamageObservation } from '../types.ts';
import type { ClientIdent, ParserState, PendingMove } from './parser-state.ts';

/** The client's marks for an item a Pokémon took from another one (the idiom of inference/hits.ts). */
const ACQUIRED = new Set(['tricked', 'stolen', 'bestowed', 'harvested']);

/** What the client battle holds of a Pokémon's item at one moment (round 69, T191). */
export interface ItemReading {
  /** The item id the log has shown it holding now; '' when it holds none or the log never showed it. */
  item: string;
  /** The item is no longer the one it came in with: used up, knocked off, stolen, swapped, given. */
  changed: boolean;
}

export function readItem(mon: Pokemon): ItemReading {
  return { item: mon.item ?? '', changed: !!mon.lastItem || ACQUIRED.has(mon.itemEffect) };
}

/**
 * The first `-enditem` of a Pokémon inside the pending move, before its own damage line: the item ended while the damage was
 * resolved (a weakening berry, a gem), so the hit counted it. The reading is the client's before the line applies, with the item
 * the line names when the log had not shown it. An item that
 * ends after its holder's damage line (Knock Off, a popped Air Balloon, a Sitrus Berry) is gone only for the next hit.
 */
export function noteItemEnd(state: ParserState, line: string) {
  const { lastMove, battle } = state;
  const ident = line.split('|')[2] ?? '';
  if (!lastMove || lastMove.itemsBefore.has(ident) || lastMove.hits.has(ident)) return;
  // The attacker's item (a gem) counts for every target of the move: it is the first line the move resolves.
  if (ident === lastMove.attacker && lastMove.hits.size > 0) return;
  const mon = battle.getPokemon(ident as ClientIdent);
  if (!mon) return;
  const held = readItem(mon);
  // An item the log shows for the first time on this line is the one the hit counted.
  lastMove.itemsBefore.set(ident, { ...held, item: held.item || toId(line.split('|')[3] ?? '') });
}

/** The four item fields of the observation of a hit: each mon's reading inside the move, else the client's now. */
export function itemFieldsOf(move: PendingMove, attacker: Pokemon, defender: Pokemon, defenderIdent: string): Pick<DamageObservation, 'attackerItem' | 'defenderItem' | 'attackerItemChanged' | 'defenderItemChanged'> {
  const held = move.itemsBefore.get(move.attacker) ?? readItem(attacker);
  const taken = move.itemsBefore.get(defenderIdent) ?? readItem(defender);
  return { attackerItem: held.item, defenderItem: taken.item, attackerItemChanged: held.changed, defenderItemChanged: taken.changed };
}
