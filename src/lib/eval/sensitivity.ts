/**
 * Item-sensitivity probe plumbing: pure JSON surgery on serialized battle
 * positions (State.serializeBattle output) — no @pkmn/sim imports, so the
 * main-thread sweep can prepare probe positions and hand them to the worker
 * like any other serialized position.
 */

import { toId } from '../ids';

export interface SensitivityTarget {
  species: string;
  /** Usage-plausible alternative items (rule-outs already applied), in order. */
  items: string[];
}

interface SerializedMon {
  set?: { species?: string; item?: string };
  item?: string;
  itemState?: { id?: string };
  volatiles?: Record<string, unknown>;
  isActive?: boolean;
}

interface SerializedBattleShape {
  sides?: { pokemon?: SerializedMon[] }[];
}

export const CHOICE_ITEMS = new Set(['choiceband', 'choicespecs', 'choicescarf']);

const sideIndex = (side: 'p1' | 'p2') => (side === 'p1' ? 0 : 1);

const monSpecies = (mon: SerializedMon): string => mon.set?.species ?? '';

/**
 * The probe combos for one flagged side: opposing guessed-item mons that
 * were INVOLVED in the turn (active, or named by a switch label among the
 * opposing side's played/best labels), round-robin over each mon's
 * alternatives so two involved mons both get probed before a second item
 * does, capped at `cap` combos (each combo costs two pair-evals).
 */
export function selectProbeCombos(
  serialized: string,
  opposing: 'p1' | 'p2',
  targets: SensitivityTarget[],
  opposingLabels: string[],
  cap = 2,
): { species: string; item: string }[] {
  if (targets.length === 0) return [];
  let parsed: SerializedBattleShape;
  try {
    parsed = JSON.parse(serialized) as SerializedBattleShape;
  } catch {
    return [];
  }
  const pokemon = parsed.sides?.[sideIndex(opposing)]?.pokemon ?? [];
  const involved = (species: string): boolean => {
    const mon = pokemon.find(entry => toId(monSpecies(entry)) === toId(species));
    if (!mon) return false;
    if (mon.isActive) return true;
    return opposingLabels.some(label => label.startsWith('→ ') && toId(label.slice(2)) === toId(species));
  };
  const candidates = targets.filter(target => target.items.length > 0 && involved(target.species)).slice(0, 2);
  const combos: { species: string; item: string }[] = [];
  for (let round = 0; combos.length < cap; round++) {
    const before = combos.length;
    for (const target of candidates) {
      if (combos.length >= cap) break;
      const item = target.items[round];
      if (item) combos.push({ species: target.species, item });
    }
    if (combos.length === before) break;
  }
  return combos;
}

/**
 * The serialized position with `species`' held item swapped to `item` —
 * null when the species is not on that side. A removed Choice item also
 * drops the choicelock volatile: the lock only ever existed because the
 * GUESSED item fabricated it.
 */
export function patchSerializedItem(
  serialized: string,
  side: 'p1' | 'p2',
  species: string,
  item: string,
): string | null {
  let parsed: SerializedBattleShape;
  try {
    parsed = JSON.parse(serialized) as SerializedBattleShape;
  } catch {
    return null;
  }
  const pokemon = parsed.sides?.[sideIndex(side)]?.pokemon ?? [];
  const mon = pokemon.find(entry => toId(monSpecies(entry)) === toId(species));
  if (!mon) return null;
  const itemId = toId(item);
  mon.item = itemId;
  if (mon.set) mon.set.item = item;
  if (mon.itemState && typeof mon.itemState === 'object') mon.itemState.id = itemId;
  if (!CHOICE_ITEMS.has(itemId) && mon.volatiles && 'choicelock' in mon.volatiles) {
    delete mon.volatiles['choicelock'];
  }
  return JSON.stringify(parsed);
}
