import { Dex } from '@pkmn/sim';
import type { InferrerState } from './inferrer-state.ts';
import { keyOf, possibleAbilities, ruleOutUnknown } from './item-evidence.ts';
import { toId } from '../ids.ts';

/**
 * Items the protocol rules out by a trigger it shows without the item's line
 * (round 67, T130, decision 18). The round-64 census counted the guesses the
 * simulator consumed where the game showed nothing: Air Balloon 207, Booster
 * Energy 183 and Eject Pack 164 of 562 singles rows. Each fact runs through
 * @pkmn/sim in trigger-evidence.spec.ts:
 *  - Air Balloon announces itself as its holder enters (onStart), unless
 *    Gravity is up or the item is ignored (Magic Room, a possible Klutz);
 *  - Booster Energy is spent at entry by an ability its own handler names,
 *    outside the weather or terrain that ability reads (gen 9);
 *  - Eject Pack switches its holder out after any drop but Parting Shot's, at
 *    the latest in the residual phase after the next move, while a teammate
 *    can come in (gens 8 and 9).
 * Only items still unknown and never swapped are ruled out, and a team that
 * may hold an Illusion user is not judged (ruleOutUnknown, item-evidence.ts).
 */

type ItemHandler = (this: never, ...args: never[]) => unknown;

/** An entry waiting for its Air Balloon announcement or its Booster Energy line. */
interface EntryCheck {
  ident: string;
  balloon: boolean;
  booster: boolean;
}

export interface TriggerWatch {
  gravity: boolean;
  magicRoom: boolean;
  /** The weather and the terrain as ids, '' for none. */
  weather: string;
  terrain: string;
  /** The opponent Pokémon on each field position ("p2a"), and the fainted ones. */
  slots: Map<string, string>;
  fainted: Set<string>;
  /** How many Pokémon the opponent brought (`|teamsize|`, else the preview, else every one the log brings in). */
  teamSize: number;
  embargoed: Set<string>;
  commanding: Set<string>;
  /** Neutralizing Gas anywhere in the log: abilities may be off, so no Booster Energy is judged. */
  neutralized: boolean;
  entries: Map<string, EntryCheck>;
  /** Drops waiting for their Eject Pack line; `moved` once a move followed the drop. */
  drops: Map<string, { moved: boolean }>;
}

const TERRAINS = new Set(['electricterrain', 'grassyterrain', 'mistyterrain', 'psychicterrain']);

/** The team an Eject Pack could switch to: the brought count the log prints last (VGC brings 4 of 6), else the preview, else the entries. */
function teamSizeOf(state: InferrerState): number {
  const side = state.opponentSide;
  const sizes = state.lines.filter(line => line.startsWith(`|teamsize|${side}|`)).map(line => Number(line.split('|')[3]));
  if (sizes.length > 0 && sizes[sizes.length - 1] > 0) return sizes[sizes.length - 1];
  const preview = state.lines.filter(line => line.startsWith(`|poke|${side}|`)).length;
  if (preview > 0) return preview;
  return new Set(state.lines
    .filter(line => line.startsWith(`|switch|${side}`) || line.startsWith(`|drag|${side}`))
    .map(line => keyOf(line.split('|')[2] ?? ''))).size;
}

function newWatch(state: InferrerState): TriggerWatch {
  return {
    gravity: false, magicRoom: false, weather: '', terrain: '', slots: new Map(), fainted: new Set(), teamSize: teamSizeOf(state),
    embargoed: new Set(), commanding: new Set(), neutralized: state.lines.some(line => line.includes('Neutralizing Gas')),
    entries: new Map(), drops: new Map(),
  };
}

/** The item exists in the replay's generation. */
function inGen(state: InferrerState, itemId: string): boolean {
  const item = Dex.forGen(state.gen).items.get(itemId);
  return item.exists && item.gen <= state.gen;
}

/** Whether Booster Energy's own handler spends the item for a holder with this ability on this field. */
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

/** Every ability the Pokémon may have makes Booster Energy spend itself at entry, so a holder shows the line. */
function boosterSpends(state: InferrerState, ident: string, watch: TriggerWatch): boolean {
  if (watch.neutralized || watch.magicRoom || !inGen(state, 'boosterenergy')) return false;
  const { onUpdate } = Dex.forGen(state.gen).items.get('boosterenergy') as { onUpdate?: ItemHandler };
  const abilities = possibleAbilities(state, ident);
  return !!onUpdate && !!abilities && abilities.size > 0 && [...abilities].every(ability => spendsWith(onUpdate, ability, watch));
}

/** A Pokémon entered a position: whoever stood there left (its drop judges nothing), and the newcomer's entry opens. */
function onEntry(state: InferrerState, watch: TriggerWatch, parts: string[], key: string) {
  const position = (parts[2] ?? '').slice(0, 3);
  const before = watch.slots.get(position);
  if (before) watch.drops.delete(before);
  watch.slots.set(position, key);
  if (parts[1] === 'replace') return;
  watch.entries.set(key, {
    ident: parts[2] ?? '',
    balloon: inGen(state, 'airballoon') && !watch.gravity && !watch.magicRoom,
    booster: boosterSpends(state, parts[2] ?? '', watch),
  });
}

/** The entries' window closes at the next move or turn: an entry still without its line rules the item out. */
function closeEntries(state: InferrerState, watch: TriggerWatch) {
  for (const [key, entry] of watch.entries) {
    const klutz = possibleAbilities(state, entry.ident);
    if (entry.balloon && klutz && !klutz.has('klutz')) ruleOutUnknown(state, key, 'airballoon');
    if (entry.booster) ruleOutUnknown(state, key, 'boosterenergy');
  }
  watch.entries.clear();
}

/** A drop on an opponent Pokémon that an Eject Pack would answer. */
function onDrop(state: InferrerState, watch: TriggerWatch, parts: string[], key: string) {
  if (!(Number(parts[4]) > 0) || !inGen(state, 'ejectpack') || watch.drops.has(key)) return;
  if (toId(state.pendingMove?.moveName ?? '') === 'partingshot') return;
  if (watch.magicRoom || watch.embargoed.has(key) || watch.commanding.has(key)) return;
  if (possibleAbilities(state, parts[2] ?? '')?.has('klutz') !== false) return;
  watch.drops.set(key, { moved: false });
}

/** The residual phase after a move: a holder still on the field with a teammate to come in would have left by now. */
function closeDrops(state: InferrerState, watch: TriggerWatch) {
  const active = new Set(watch.slots.values());
  const bench = watch.teamSize - active.size - watch.fainted.size > 0;
  for (const [key, drop] of watch.drops) {
    if (!drop.moved) continue;
    watch.drops.delete(key);
    if (bench && active.has(key) && !watch.magicRoom && !watch.embargoed.has(key)) ruleOutUnknown(state, key, 'ejectpack');
  }
}

/** Gravity, Magic Room, the terrain and the weather the triggers read. */
function onField(watch: TriggerWatch, parts: string[]) {
  const id = toId((parts[2] ?? '').replace(/^move: /, ''));
  const on = parts[1] !== '-fieldend';
  if (parts[1] === '-weather') watch.weather = id === 'none' ? '' : id;
  else if (id === 'gravity') watch.gravity = on;
  else if (id === 'magicroom') watch.magicRoom = on;
  else if (TERRAINS.has(id)) watch.terrain = on ? id : (watch.terrain === id ? '' : watch.terrain);
  // A field change inside an entry's window: the Booster Energy reading is no longer clean.
  for (const entry of watch.entries.values()) entry.booster = false;
}

/** The item lines that answer a waiting entry or drop. */
function onItemLine(watch: TriggerWatch, parts: string[], key: string) {
  const item = toId(parts[3] ?? '');
  const entry = watch.entries.get(key);
  if (entry && parts[1] === '-item' && item === 'airballoon') entry.balloon = false;
  if (entry && parts[1] === '-enditem' && item === 'boosterenergy') entry.booster = false;
  if (parts[1] === '-enditem' && item === 'ejectpack') watch.drops.delete(key);
}

/** Ally Switch: the Pokémon leaves its position for the numbered one and the one there takes its place. */
function onSwap(watch: TriggerWatch, parts: string[]) {
  const from = (parts[2] ?? '').slice(0, 3);
  const to = `${from.slice(0, 2)}${'abcd'[Number(parts[3])] ?? ''}`;
  const moved = watch.slots.get(from);
  if (!moved || to === from) return;
  const other = watch.slots.get(to);
  watch.slots.set(to, moved);
  if (other) watch.slots.set(from, other);
  else watch.slots.delete(from);
}

function onCondition(watch: TriggerWatch, parts: string[], line: string, key: string) {
  if (/Embargo/.test(line)) watch.embargoed[parts[1] === '-start' ? 'add' : 'delete'](key);
}

function onFaint(watch: TriggerWatch, key: string) {
  watch.fainted.add(key);
  watch.entries.delete(key);
  watch.drops.delete(key);
  for (const [slot, holder] of watch.slots) if (holder === key) watch.slots.delete(slot);
}

/** Lines about an opponent Pokémon. */
function onOpponentLine(state: InferrerState, watch: TriggerWatch, parts: string[], line: string, key: string) {
  const tag = parts[1];
  if (tag === 'switch' || tag === 'drag' || tag === 'replace') onEntry(state, watch, parts, key);
  else if (tag === '-unboost') onDrop(state, watch, parts, key);
  else if (tag === '-item' || tag === '-enditem') onItemLine(watch, parts, key);
  else if (tag === 'faint') onFaint(watch, key);
  else if (tag === 'swap') onSwap(watch, parts);
  else if (tag === '-start' || tag === '-end') onCondition(watch, parts, line, key);
}

/** The windows' clock: a move or a turn closes the entries, a residual phase after a move closes the drops. */
function notePhase(state: InferrerState, watch: TriggerWatch, tag: string) {
  if (tag === 'move' || tag === 'turn') closeEntries(state, watch);
  if (tag === 'move') for (const drop of watch.drops.values()) drop.moved = true;
  if (tag === 'upkeep') closeDrops(state, watch);
}

/** Commander puts both Pokémon out of reach of a switch: no Eject Pack is judged for them. */
function noteCommander(watch: TriggerWatch, parts: string[], line: string) {
  if (!line.includes('ability: Commander')) return;
  for (const ident of [parts[2], line.match(/\[of\]\s*(p[1-4][a-d]?:\s*[^|]+)/)?.[1]]) if (ident) watch.commanding.add(keyOf(ident));
}

/**
 * The line handler: the field the triggers read, the windows they open, and
 * at their close the items whose line never came.
 */
export function watchTriggerEvidence(state: InferrerState, line: string) {
  const watch = (state.triggerWatch ??= newWatch(state));
  const parts = line.split('|');
  const tag = parts[1] ?? '';
  notePhase(state, watch, tag);
  if (tag === '-weather' || tag === '-fieldstart' || tag === '-fieldend') onField(watch, parts);
  noteCommander(watch, parts, line);
  const key = keyOf(parts[2] ?? '');
  if (key.startsWith(state.opponentSide)) onOpponentLine(state, watch, parts, line, key);
}
