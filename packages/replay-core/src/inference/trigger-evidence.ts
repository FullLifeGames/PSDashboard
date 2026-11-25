import { dexOf } from '../rules-dex.ts';
import { Protocol } from '@pkmn/protocol';
import { type InferrerState } from './inferrer-state.ts';
import { possibleAbilities, ruleOutUnknown } from './item-evidence.ts';
import { arg, keyOf, namesEffect, ofIdent, type LogLine } from './log-line.ts';
import { newItemTriggerWatch, teamSizeOf, watchItemTriggers, type ItemTriggerWatch } from './item-triggers.ts';
import { toId } from '../ids.ts';
import { terrainConditions } from '../dex-facts/index.ts';
import { newFieldItemWatch, watchFieldItems, type FieldItemWatch } from './field-item-triggers.ts';

// Design: EVALUATION.md "Rule-outs".

type ItemHandler = (this: never, ...args: never[]) => unknown;

// Air Balloon shows as its holder enters, unless Gravity is up or the item is ignored.
interface EntryCheck {
  ident: string;
  balloon: boolean;
  booster: boolean;
}

export interface TriggerWatch {
  gravity: boolean;
  magicRoom: boolean;
  weather: string;
  terrain: string;
  slots: Map<string, string>;
  fainted: Set<string>;
  teamSize: number;
  embargoed: Set<string>;
  commanding: Set<string>;
  /** Neutralizing Gas anywhere in the log: abilities may be off, so no Booster Energy is judged. */
  neutralized: boolean;
  entries: Map<string, EntryCheck>;
  /** Drops waiting for their Eject Pack line; `moved` once a move followed the drop. */
  drops: Map<string, { moved: boolean }>;
  items: ItemTriggerWatch;
  field: FieldItemWatch;
}

function newWatch(state: InferrerState): TriggerWatch {
  return {
    gravity: false, magicRoom: false, weather: '', terrain: '', slots: new Map(), fainted: new Set(), teamSize: teamSizeOf(state, state.opponentSide),
    embargoed: new Set(), commanding: new Set(), neutralized: state.lines.some(line => namesEffect(line, 'Neutralizing Gas')),
    entries: new Map(), drops: new Map(), items: newItemTriggerWatch(state), field: newFieldItemWatch(),
  };
}

function inGen(state: InferrerState, itemId: string): boolean {
  const item = dexOf(state).items.get(itemId);
  return item.exists && item.gen <= state.gen;
}

function spendsWith(onUpdate: ItemHandler, ability: string, watch: TriggerWatch): boolean {
  let used = false;
  const named = (name: string | string[], id: string) => [name].flat().map(toId).includes(id);
  const holder = {
    transformed: false, hasAbility: (name: string | string[]) => named(name, ability),
    useItem: () => { used = true; return true; }, addVolatile: () => true,
  };
  const context = {
    effectState: { started: true },
    field: { isWeather: (name: string | string[]) => named(name, watch.weather), isTerrain: (name: string | string[]) => named(name, watch.terrain) },
  };
  try {
    onUpdate.call(context as never, holder as never);
  } catch {
    return false;
  }
  return used;
}

// Booster Energy spends itself at entry (Gen 9) for every ability the holder may have, outside its weather or terrain.
function boosterSpends(state: InferrerState, ident: string, watch: TriggerWatch): boolean {
  if (watch.neutralized || watch.magicRoom || !inGen(state, 'boosterenergy')) return false;
  const { onUpdate } = dexOf(state).items.get('boosterenergy') as { onUpdate?: ItemHandler };
  const abilities = possibleAbilities(state, ident);
  return !!onUpdate && !!abilities && abilities.size > 0 && [...abilities].every(ability => spendsWith(onUpdate, ability, watch));
}

function onEntry(state: InferrerState, watch: TriggerWatch, line: LogLine, key: string) {
  const ident = arg(line, 1);
  const position = ident.slice(0, 3);
  const before = watch.slots.get(position);
  if (before) watch.drops.delete(before);
  watch.slots.set(position, key);
  if (line.cmd === 'replace') return;
  watch.entries.set(key, {
    ident,
    balloon: inGen(state, 'airballoon') && !watch.gravity && !watch.magicRoom,
    booster: boosterSpends(state, ident, watch),
  });
}

function closeEntries(state: InferrerState, watch: TriggerWatch) {
  for (const [key, entry] of watch.entries) {
    const klutz = possibleAbilities(state, entry.ident);
    if (entry.balloon && klutz && !klutz.has('klutz')) ruleOutUnknown(state, key, 'airballoon');
    if (entry.booster) ruleOutUnknown(state, key, 'boosterenergy');
  }
  watch.entries.clear();
}

// Eject Pack answers any drop but Parting Shot's (Gens 8 and 9).
function onDrop(state: InferrerState, watch: TriggerWatch, line: LogLine, key: string) {
  if (!(Number(arg(line, 3)) > 0) || !inGen(state, 'ejectpack') || watch.drops.has(key)) return;
  if (toId(state.pendingMove?.moveName ?? '') === 'partingshot') return;
  if (watch.magicRoom || watch.embargoed.has(key) || watch.commanding.has(key)) return;
  if (possibleAbilities(state, arg(line, 1))?.has('klutz') !== false) return;
  watch.drops.set(key, { moved: false });
}

function closeDrops(state: InferrerState, watch: TriggerWatch) {
  const active = new Set(watch.slots.values());
  const bench = watch.teamSize - active.size - watch.fainted.size > 0;
  for (const [key, drop] of watch.drops) {
    if (!drop.moved) continue;
    watch.drops.delete(key);
    if (bench && active.has(key) && !watch.magicRoom && !watch.embargoed.has(key)) ruleOutUnknown(state, key, 'ejectpack');
  }
}

const fieldOf = (watch: TriggerWatch) => `${watch.weather}|${watch.terrain}|${watch.gravity}|${watch.magicRoom}`;

function onField(state: InferrerState, watch: TriggerWatch, line: LogLine) {
  const id = toId(Protocol.parseEffect(arg(line, 1)).name);
  const on = line.cmd !== '-fieldend';
  const before = fieldOf(watch);
  if (line.cmd === '-weather') watch.weather = id === 'none' ? '' : id;
  else if (id === 'gravity') watch.gravity = on;
  else if (id === 'magicroom') watch.magicRoom = on;
  else if (terrainConditions(dexOf(state)).has(id)) watch.terrain = on ? id : (watch.terrain === id ? '' : watch.terrain);
  // A field change inside an entry's window spoils the Booster Energy reading; a lasting weather's upkeep does not.
  if (fieldOf(watch) !== before) for (const entry of watch.entries.values()) entry.booster = false;
}

function onItemLine(watch: TriggerWatch, line: LogLine, key: string) {
  const item = toId(arg(line, 2));
  const entry = watch.entries.get(key);
  if (entry && line.cmd === '-item' && item === 'airballoon') entry.balloon = false;
  if (entry && line.cmd === '-enditem' && item === 'boosterenergy') entry.booster = false;
  if (line.cmd === '-enditem' && item === 'ejectpack') watch.drops.delete(key);
}

function onSwap(watch: TriggerWatch, line: LogLine) {
  const from = arg(line, 1).slice(0, 3);
  const to = `${from.slice(0, 2)}${'abcd'[Number(arg(line, 2))] ?? ''}`;
  const moved = watch.slots.get(from);
  if (!moved || to === from) return;
  const other = watch.slots.get(to);
  watch.slots.set(to, moved);
  if (other) watch.slots.set(from, other);
  else watch.slots.delete(from);
}

function onCondition(watch: TriggerWatch, line: LogLine, key: string) {
  if (Protocol.parseEffect(arg(line, 2)).name === 'Embargo') watch.embargoed[line.cmd === '-start' ? 'add' : 'delete'](key);
}

function onFaint(watch: TriggerWatch, key: string) {
  watch.fainted.add(key);
  watch.entries.delete(key);
  watch.drops.delete(key);
  for (const [slot, holder] of watch.slots) if (holder === key) watch.slots.delete(slot);
}

function onOpponentLine(state: InferrerState, watch: TriggerWatch, line: LogLine, key: string) {
  const tag = line.cmd;
  if (tag === 'switch' || tag === 'drag' || tag === 'replace') onEntry(state, watch, line, key);
  else if (tag === '-unboost') onDrop(state, watch, line, key);
  else if (tag === '-item' || tag === '-enditem') onItemLine(watch, line, key);
  else if (tag === 'faint') onFaint(watch, key);
  else if (tag === 'swap') onSwap(watch, line);
  else if (tag === '-start' || tag === '-end') onCondition(watch, line, key);
}

function notePhase(state: InferrerState, watch: TriggerWatch, tag: string) {
  if (tag === 'move' || tag === 'turn') closeEntries(state, watch);
  if (tag === 'move') for (const drop of watch.drops.values()) drop.moved = true;
  if (tag === 'upkeep') closeDrops(state, watch);
}

// Commander puts both Pokémon out of reach of a switch: no Eject Pack is judged for them.
function noteCommander(watch: TriggerWatch, line: LogLine) {
  if (!namesEffect(line, 'Commander')) return;
  for (const ident of [arg(line, 1), ofIdent(line)]) if (ident) watch.commanding.add(keyOf(ident));
}

export function watchTriggerEvidence(state: InferrerState, line: LogLine) {
  const watch = (state.triggerWatch ??= newWatch(state));
  const tag = line.cmd;
  notePhase(state, watch, tag);
  if (tag === '-weather' || tag === '-fieldstart' || tag === '-fieldend') onField(state, watch, line);
  noteCommander(watch, line);
  const key = keyOf(arg(line, 1));
  if (key.startsWith(state.opponentSide)) onOpponentLine(state, watch, line, key);
  watchItemTriggers(state, watch.items, watch, line);
  watchFieldItems(state, watch, line);
}
