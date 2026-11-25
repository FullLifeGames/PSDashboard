import type { Pokemon } from '@pkmn/client';
import { toId } from '../ids.ts';
import type { DamageObservation } from '../types.ts';
import type { ClientIdent, ParserState, PendingMove } from './parser-state.ts';

const ACQUIRED = new Set(['tricked', 'stolen', 'bestowed', 'harvested']);

export interface ItemReading {
  /** The item id the log has shown it holding now; '' when it holds none or the log never showed it. */
  item: string;
  /** The item is no longer the one it came in with: used up, knocked off, stolen, swapped, given. */
  changed: boolean;
}

export function readItem(mon: Pokemon): ItemReading {
  return { item: mon.item ?? '', changed: !!mon.lastItem || ACQUIRED.has(mon.itemEffect) };
}

/** The first `-enditem` before the holder's own damage line counts for the hit (berry, gem); a later one, the next. */
export function noteItemEnd(state: ParserState, line: string) {
  const { lastMove, battle } = state;
  const ident = line.split('|')[2] ?? '';
  if (!lastMove || lastMove.itemsBefore.has(ident) || lastMove.hits.has(ident)) return;
  // The attacker's item (a gem) counts for every target of the move: it is the first line the move resolves.
  if (ident === lastMove.attacker && lastMove.hits.size > 0) return;
  const mon = battle.getPokemon(ident as ClientIdent);
  if (!mon) return;
  const held = readItem(mon);
  lastMove.itemsBefore.set(ident, { ...held, item: held.item || toId(line.split('|')[3] ?? '') });
}

export function itemFieldsOf(move: PendingMove, attacker: Pokemon, defender: Pokemon, defenderIdent: string): Pick<DamageObservation, 'attackerItem' | 'defenderItem' | 'attackerItemChanged' | 'defenderItemChanged'> {
  const held = move.itemsBefore.get(move.attacker) ?? readItem(attacker);
  const taken = move.itemsBefore.get(defenderIdent) ?? readItem(defender);
  return { attackerItem: held.item, defenderItem: taken.item, attackerItemChanged: held.changed, defenderItemChanged: taken.changed };
}
