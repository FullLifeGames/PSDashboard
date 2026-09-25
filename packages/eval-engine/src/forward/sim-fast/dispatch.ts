/**
 * Round 59 (T91), lever dispatch: the pre-check (round 58 prototype
 * 'mirror', docs/perf/probes/2026-09-24-r58/patch/dispatch-mirror.ts).
 * runEvent asks every Pokemon, side and the field whether anyone handles an
 * event; almost never does anyone. The pre-check walks exactly the control
 * flow of findEventHandlers, but each "does this effect carry on<Event>?" is
 * one map lookup per (dex, event, effect id). When nobody can answer it
 * returns what runEvent returns for an empty handler list; when someone
 * might, the original runs untouched (order, ties, PRNG).
 *
 * Attached per battle as its own runEvent (the prototype stays the sim's,
 * so battles of package users stay untouched); a copy carries it along. It
 * steps aside when the battle's runEvent is no longer this function (review
 * round 58: compare against the attached function), when discovery or
 * getters are not the prototype's, at event depth 8, with onEffect, and for
 * array targets. Assumes nobody writes on* handlers onto dex effects at
 * runtime; the guard spec greps for that.
 */
import type { Battle } from '@pkmn/sim';
import { simFastCounters, simFastFlags } from './state.ts';

const ON = 1;
const ALLY = 2;
const FOE = 4;
const ANY = 8;
const SOURCE = 16;
const ALL = ON | ALLY | FOE | ANY | SOURCE;
const UNPREFIXED = new Set(['BeforeTurn', 'Update', 'Weather', 'WeatherChange', 'TerrainChange']);
const DISCOVERY = ['findEventHandlers', 'findPokemonEventHandlers', 'findSideEventHandlers', 'findFieldEventHandlers',
  'findBattleEventHandlers', 'getCallback'] as const;

type Bag = Record<string, unknown>;
interface Getter { getByID(id: string): Bag }
interface MonView extends Bag {
  status: string; volatiles: Bag; ability: string; item: string; baseSpecies: Bag; side: SideView; position: number; isActive: boolean;
}
interface SideView extends Bag {
  n: number; allySide: SideView | null; active: (MonView | null)[]; pokemon: MonView[]; sideConditions: Bag; slotConditions: Bag[];
}
interface BattleView extends Bag {
  dex: { conditions: Getter; abilities: Getter; items: Getter };
  sides: (SideView | null)[];
  field: Bag & { pseudoWeather: Bag; weather: string; terrain: string };
  format: Bag;
  events: Bag | null;
  eventDepth: number;
  modify(value: number, numerator: number): number;
}
type RunEvent = (this: BattleView, eventid: string, target?: unknown, source?: unknown, sourceEffect?: unknown,
  relayVar?: unknown, onEffect?: boolean, fastExit?: boolean) => unknown;

interface Originals {
  runEvent: RunEvent;
  discovery: unknown[];
  getStatus: unknown; getAbility: unknown; getItem: unknown;
  getWeather: unknown; getTerrain: unknown;
  pokemon: object;
  side: object;
}
interface EventTable { cond: Map<string, number>; ability: Map<string, number>; item: Map<string, number>; obj: Map<object, number> }

let originals: Originals | null = null;
let tables = new WeakMap<object, Map<string, EventTable>>();
let probe: 'no-abilities' | null = null;

/** Test hook (the counter-check): a pre-check blind to abilities must break the identity spec. */
export function setDispatchProbe(mode: 'no-abilities' | null): void {
  probe = mode;
  tables = new WeakMap();
}

const isKind = (value: unknown, proto: object): boolean =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === proto;

function capture(battle: BattleView): Originals {
  const battleProto = Object.getPrototypeOf(battle) as Bag;
  const firstSide = battle.sides[0]!;
  const pokemonProto = Object.getPrototypeOf(firstSide.pokemon[0]) as Bag;
  const fieldProto = Object.getPrototypeOf(battle.field) as Bag;
  return {
    runEvent: battleProto.runEvent as RunEvent,
    discovery: DISCOVERY.map(name => battleProto[name]),
    getStatus: pokemonProto.getStatus, getAbility: pokemonProto.getAbility, getItem: pokemonProto.getItem,
    getWeather: fieldProto.getWeather, getTerrain: fieldProto.getTerrain,
    pokemon: pokemonProto,
    side: Object.getPrototypeOf(firstSide) as object,
  };
}

function directBits(effect: Bag, event: string): number {
  let bits = 0;
  if (effect[`on${event}`] !== undefined) bits |= ON;
  if (effect[`onAlly${event}`] !== undefined) bits |= ALLY;
  if (effect[`onFoe${event}`] !== undefined) bits |= FOE;
  if (effect[`onAny${event}`] !== undefined) bits |= ANY;
  if (effect[`onSource${event}`] !== undefined) bits |= SOURCE;
  // getCallback's SwitchIn -> onStart fallback (battle.mjs:854), counted wide. In 0.10.11
  // no SwitchIn reaches runEvent from gen 5 on (fieldEvent), so this guards future versions.
  if (event === 'SwitchIn' && effect.onStart !== undefined) bits |= ALL;
  return bits;
}

function eventTable(battle: BattleView, event: string): EventTable {
  let perDex = tables.get(battle.dex);
  if (!perDex) {
    perDex = new Map();
    tables.set(battle.dex, perDex);
  }
  let table = perDex.get(event);
  if (!table) {
    table = { cond: new Map(), ability: new Map(), item: new Map(), obj: new Map() };
    perDex.set(event, table);
  }
  return table;
}

function cachedBits(cache: Map<string, number>, getter: Getter, id: string, event: string): number {
  let bits = cache.get(id);
  if (bits === undefined) {
    bits = directBits(getter.getByID(id), event);
    cache.set(id, bits);
  }
  return bits;
}

function objBits(table: EventTable, effect: Bag, event: string): number {
  if (effect.exists === false) return directBits(effect, event); // rebuilt per lookup by the dex: never cached
  let bits = table.obj.get(effect);
  if (bits === undefined) {
    bits = directBits(effect, event);
    table.obj.set(effect, bits);
  }
  return bits;
}

/** findPokemonEventHandlers(pokemon, prefix + event) would find something under this mask. */
function pokemonHas(battle: BattleView, table: EventTable, mon: MonView, event: string, mask: number): boolean {
  const conditions = battle.dex.conditions;
  if (cachedBits(table.cond, conditions, mon.status, event) & mask) return true;
  for (const id in mon.volatiles) if (cachedBits(table.cond, conditions, id, event) & mask) return true;
  if (probe !== 'no-abilities' && cachedBits(table.ability, battle.dex.abilities, mon.ability, event) & mask) return true;
  if (cachedBits(table.item, battle.dex.items, mon.item, event) & mask) return true;
  if (objBits(table, mon.baseSpecies, event) & mask) return true;
  const slot = mon.side.slotConditions[mon.position];
  for (const id in slot) if (cachedBits(table.cond, conditions, id, event) & mask) return true;
  return false;
}

function sideHas(battle: BattleView, table: EventTable, side: SideView, event: string, mask: number): boolean {
  for (const id in side.sideConditions) if (cachedBits(table.cond, battle.dex.conditions, id, event) & mask) return true;
  return false;
}

/** The target and every active that alliesAndSelf() or foes() could reach (a superset of both filters). */
function activeHas(battle: BattleView, table: EventTable, mon: MonView, event: string, prefixed: boolean): boolean {
  if (pokemonHas(battle, table, mon, event, ON)) return true;
  if (!prefixed) return false;
  for (const side of battle.sides) {
    if (!side) return true; // a battle under construction: let the original decide
    const mine = side === mon.side || side === mon.side.allySide;
    for (const active of side.active) {
      if (active && pokemonHas(battle, table, active, event, mine ? ALLY | ANY : FOE | ANY)) return true;
    }
  }
  return false;
}

const sideMask = (mine: boolean, prefixed: boolean): number => (mine ? (prefixed ? ON | ANY : ON) : (prefixed ? FOE | ANY : 0));

function sidesHave(battle: BattleView, table: EventTable, target: SideView, event: string, prefixed: boolean, bubbleDown: boolean): boolean {
  for (const side of battle.sides) {
    if (!side) return true;
    const mask = sideMask(side === target || side === target.allySide, prefixed);
    if (bubbleDown) {
      for (const active of side.active) {
        if (!active) return true; // the original would throw here; let it
        if (mask !== 0 && pokemonHas(battle, table, active, event, mask)) return true;
      }
    }
    if ((side.n < 2 || !side.allySide) && mask !== 0 && sideHas(battle, table, side, event, mask)) return true;
  }
  return false;
}

function fieldHas(battle: BattleView, table: EventTable, event: string): boolean {
  const field = battle.field;
  const conditions = battle.dex.conditions;
  for (const id in field.pseudoWeather) if (cachedBits(table.cond, conditions, id, event) & ON) return true;
  if (cachedBits(table.cond, conditions, field.weather, event) & ON) return true;
  if (cachedBits(table.cond, conditions, field.terrain, event) & ON) return true;
  if (objBits(table, battle.format, event) & ON) return true;
  return !!battle.events && battle.events[`on${event}`] !== undefined;
}

/** True when the original findEventHandlers(target, event, source) could find a handler. */
function anyHandler(battle: BattleView, o: Originals, target: unknown, event: string, source: MonView | null): boolean {
  const table = eventTable(battle, event);
  const prefixed = !UNPREFIXED.has(event);
  let holder = target;
  if (isKind(holder, o.pokemon)) {
    const mon = holder as MonView;
    if (mon.isActive || source?.isActive) {
      if (activeHas(battle, table, mon, event, prefixed)) return true;
      holder = mon.side;
    }
  }
  if (source && prefixed && pokemonHas(battle, table, source, event, SOURCE)) return true;
  if (isKind(holder, o.side) && sidesHave(battle, table, holder as SideView, event, prefixed, isKind(target, o.side))) return true;
  return fieldHas(battle, table, event);
}

/** The battle runs the prototype's discovery and getters, and its runEvent is still this function. */
function stock(battle: BattleView, o: Originals): boolean {
  if (battle.runEvent !== runEventFast) return false;
  for (let i = 0; i < DISCOVERY.length; i++) if (battle[DISCOVERY[i]] !== o.discovery[i]) return false;
  if (battle.field.getWeather !== o.getWeather || battle.field.getTerrain !== o.getTerrain) return false;
  const first = battle.sides[0]?.pokemon[0];
  return !first || (first.getStatus === o.getStatus && first.getAbility === o.getAbility && first.getItem === o.getItem);
}

function runEventFast(this: BattleView, eventid: string, target?: unknown, source?: unknown, sourceEffect?: unknown,
  relayVar?: unknown, onEffect?: boolean, fastExit?: boolean): unknown {
  const o = originals!;
  if (!simFastFlags.dispatch) return o.runEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
  simFastCounters.dispatchCalls++;
  const sourceMon = isKind(source, o.pokemon) ? (source as MonView) : null;
  if (this.eventDepth >= 8 || onEffect || Array.isArray(target) || !stock(this, o) ||
    anyHandler(this, o, target ?? this, eventid, sourceMon)) {
    return o.runEvent.call(this, eventid, target, source, sourceEffect, relayVar, onEffect, fastExit);
  }
  simFastCounters.dispatchAnswered++;
  // What runEvent returns for an empty handler list (battle.mjs runEvent: relayVar, true, modify(v, 1)).
  if (relayVar === undefined || relayVar === null) return true;
  if (typeof relayVar === 'number' && relayVar === Math.abs(Math.floor(relayVar))) return this.modify(relayVar, 1);
  return relayVar;
}

/** Attaches the pre-check as the battle's own runEvent, unless a format or mod script already owns one. */
export function attachDispatch(battle: Battle): void {
  const view = battle as unknown as BattleView;
  if (view.runEvent === runEventFast) return;
  if (Object.hasOwn(view, 'runEvent') || !view.sides[0]?.pokemon[0]) return;
  originals ??= capture(view);
  view.runEvent = runEventFast;
}
