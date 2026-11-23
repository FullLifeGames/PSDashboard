import { Protocol } from '@pkmn/protocol';
import { dexOf, type RulesDex } from '../rules-dex.ts';
import { terrainConditions } from '../dex-facts/index.ts';
import { ITEM_BLOCKERS } from '../dex-facts/screen-turns.ts';
import { toId } from '../ids.ts';
import type { InferrerState } from './inferrer-state.ts';
import { possibleAbilities, ruleOutUnknown } from './item-evidence.ts';
import { arg, keyOf, type LogLine } from './log-line.ts';
import type { TriggerWatch } from './trigger-evidence.ts';

/**
 * The items that fire when the field changes (terrain seeds, Room Service), ruled out by a trigger the log shows without their line; the
 * rules are in EVALUATION.md, "Rule-outs".
 */

type ItemHandler = (this: never, ...args: never[]) => unknown;
type Trigger = 'start' | 'terrain' | 'pseudo';
type FieldItem = { id: string; exists: boolean; gen: number } & Partial<Record<'onStart' | 'onTerrainChange' | 'onAnyPseudoWeatherChange', ItemHandler>>;

const HANDLER = { start: 'onStart', terrain: 'onTerrainChange', pseudo: 'onAnyPseudoWeatherChange' } as const;

const candidates = new WeakMap<RulesDex, FieldItem[]>();

/** The Dex items that read the field when it changes (the sweep holds this list to the Dex of every generation and mod). */
function fieldItems(dex: RulesDex): FieldItem[] {
  let items = candidates.get(dex);
  if (!items) {
    items = dex.items.all().map(item => item as unknown as FieldItem).filter(item => !!item.onTerrainChange || !!item.onAnyPseudoWeatherChange);
    candidates.set(dex, items);
  }
  return items;
}

export const fieldItemIds = (dex: RulesDex): string[] => fieldItems(dex).map(item => item.id);

export interface FieldItemWatch {
  /** The pseudo-weathers standing (Trick Room, Gravity, Magic Room, ...): field conditions that are neither weather nor terrain. */
  pseudo: Set<string>;
  /** The items each opponent Pokémon would have used at a trigger of the window that is open, by side and nickname. */
  pending: Map<string, Set<string>>;
}

export function newFieldItemWatch(): FieldItemWatch {
  return { pseudo: new Set(), pending: new Map() };
}

function uses(handler: ItemHandler | undefined, terrain: string, pseudo: ReadonlySet<string>): boolean {
  if (!handler) return false;
  let used = false;
  const names = (name: string | string[]) => [name].flat().map(toId);
  const holder = { ignoringItem: () => false, useItem: () => { used = true; return true; } };
  const context = {
    effectState: { target: holder },
    field: {
      isTerrain: (name: string | string[]) => names(name).includes(terrain),
      getPseudoWeather: (name: string | string[]) => (names(name).some(id => pseudo.has(id)) ? { id: names(name)[0] } : null),
    },
  };
  try {
    handler.call(context as never, holder as never);
  } catch {
    return false;
  }
  return used;
}

/** A trigger passed with these holders on the field: each holder the gates let through and an item's handler would use opens a check. */
function open(state: InferrerState, watch: TriggerWatch, trigger: Trigger, keys: Iterable<string>) {
  const items = fieldItems(dexOf(state));
  for (const key of keys) {
    // The gates the simulator reads at the trigger (`ignoringItem`: Magic Room, Embargo; Klutz is judged at the close).
    if (watch.magicRoom || watch.embargoed.has(key)) continue;
    for (const item of items) {
      if (!item.exists || item.gen > state.gen || !uses(item[HANDLER[trigger]], watch.terrain, watch.field.pseudo)) continue;
      const waiting = watch.field.pending.get(key) ?? new Set<string>();
      waiting.add(item.id);
      watch.field.pending.set(key, waiting);
    }
  }
}

/** The window closes at the next move or turn: a holder still without its item's line has not that item. */
function close(state: InferrerState, watch: TriggerWatch) {
  for (const [key, ids] of watch.field.pending) {
    const abilities = possibleAbilities(state, key);
    // A Pokémon that may have Klutz is not judged (Neutralizing Gas turns Klutz off, and the rule stays out of that case on purpose).
    if (abilities && !ITEM_BLOCKERS.ability.some(blocker => abilities.has(blocker))) for (const id of ids) ruleOutUnknown(state, key, id);
  }
  watch.field.pending.clear();
}

/** A field condition starts or ends. A terrain start is read from `watch.terrain`, which trigger-evidence.ts has updated for this line. */
function onField(state: InferrerState, watch: TriggerWatch, line: LogLine) {
  const dex = dexOf(state);
  const effect = Protocol.parseEffect(arg(line, 1));
  const id = toId(effect.name);
  if (line.cmd === '-fieldactivate') {
    // Ion Deluge and Fairy Lock announce themselves as an activation; Perish Song and Pay Day do not change a pseudo-weather.
    if (dex.moves.get(effect.name).pseudoWeather) open(state, watch, 'pseudo', new Set(watch.slots.values()));
    return;
  }
  if (terrainConditions(dex).has(id)) {
    if (line.cmd === '-fieldstart') open(state, watch, 'terrain', new Set(watch.slots.values()));
    return;
  }
  if (line.cmd === '-fieldend') {
    watch.field.pseudo.delete(id);
    return;
  }
  watch.field.pseudo.add(id);
  open(state, watch, 'pseudo', new Set(watch.slots.values()));
}

/** The line handler of the items; trigger-evidence.ts calls it after it has read the line for the gates (`magicRoom`, `embargoed`, `terrain`, `slots`). */
export function watchFieldItems(state: InferrerState, watch: TriggerWatch, line: LogLine) {
  const tag = line.cmd;
  if (tag === 'move' || tag === 'turn') close(state, watch);
  if (tag === '-fieldstart' || tag === '-fieldend' || tag === '-fieldactivate') {
    onField(state, watch, line);
    return;
  }
  const key = keyOf(arg(line, 1));
  if (!key.startsWith(state.opponentSide)) return;
  if (tag === 'switch' || tag === 'drag') open(state, watch, 'start', [key]);
  else if (tag === '-enditem') watch.field.pending.get(key)?.delete(toId(arg(line, 2)));
  else if (tag === 'faint') watch.field.pending.delete(key);
}
