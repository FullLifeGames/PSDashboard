import type { Battle } from '@pkmn/sim';
import { idsOfStrings, lex, readsOfCode } from './handler-source.ts';

/** The consumer whose memo key the reads feed: score/contact.ts (hit) and score/residuals.ts (residual). */

export type Consumer = 'hit' | 'residual';

export type ReadSet = ReadonlySet<string>;

type BattleDex = Battle['dex'];

/** Events a played hit never fires; an unknown event counts as read, so a new one costs hits, never an answer. */
// test/board-key-census.spec.ts plays every damaging move and requires that none of these fired.
export const HIT_EVENTS_NEVER: ReadonlySet<string> = new Set([
  'DisableMove', 'StallMove', 'TrapPokemon', 'MaybeTrapPokemon', 'BeforeTurn', 'LockMove', 'LockMoveAbility',
  'FoeMaybeTrapPokemon', 'AllyMaybeTrapPokemon', 'FlinchChance',
]);

export const RESIDUAL_EVENTS: ReadonlySet<string> = new Set([
  'Residual', 'FieldResidual', 'SideResidual', 'Weather', 'Damage', 'Heal', 'TryHeal', 'Type', 'Update', 'ModifySpecies',
  // eslint-disable-next-line names/no-new-dex-name -- 'Immunity' is the simulator's event of that name (held by board-key-effects.spec.ts), not the ability
  'Immunity',
  'BeforeFaint', 'Faint', 'AfterFaint', 'End',
]);

const HANDLER = /^on(Ally|Foe|Source|Any|Field|Side|Slot|Self)?([A-Z]\w*)$/;

const SUB_EFFECTS = ['condition', 'self', 'secondary', 'secondaries'] as const;
const CREATES = ['volatileStatus', 'sideCondition', 'slotCondition', 'status', 'weather', 'terrain', 'pseudoWeather'] as const;

export interface EntryReads { fields: ReadSet; names: ReadonlySet<string> }

export type Methods = ReadonlyMap<string, ReadSet>;

export const tokensOf = (source: string): Set<string> => readsOfCode(lex(source).code);

// A key that is no handler is a callback the move path calls: the hit reads it, the end of the turn does not.
function fires(key: string, consumer: Consumer): boolean {
  const match = HANDLER.exec(key);
  if (!match) return consumer === 'hit';
  const [, , event] = match;
  const whole = key.slice(2);
  if (/(Order|Priority|SubOrder)$/.test(key)) return false;
  if (consumer === 'hit') return !HIT_EVENTS_NEVER.has(event) && !HIT_EVENTS_NEVER.has(whole);
  return RESIDUAL_EVENTS.has(event) || RESIDUAL_EVENTS.has(whole);
}

function collect(entry: Record<string, unknown>, consumer: Consumer, depth: number, out: { code: string; ids: Set<string>; names: Set<string> }): void {
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (typeof value === 'function') {
      if (fires(key, consumer)) {
        const lexed = lex(String(value));
        out.code += `${lexed.code}\n`;
        for (const id of idsOfStrings(lexed.strings)) out.ids.add(id);
      }
    } else if (typeof value === 'string' && (CREATES as readonly string[]).includes(key)) {
      out.names.add(value.toLowerCase().replace(/[^a-z0-9]/g, ''));
    } else if (depth < 3 && value && typeof value === 'object' && (SUB_EFFECTS as readonly string[]).includes(key)) {
      for (const part of Array.isArray(value) ? value : [value]) if (part && typeof part === 'object') collect(part as Record<string, unknown>, consumer, depth + 1, out);
    }
  }
}

const scans = { hit: new WeakMap<object, EntryReads>(), residual: new WeakMap<object, EntryReads>() };

export function entryReads(entry: object, consumer: Consumer, methods: Methods): EntryReads {
  let found = scans[consumer].get(entry);
  if (found) return found;
  const out = { code: '', ids: new Set<string>(), names: new Set<string>() };
  collect(entry as Record<string, unknown>, consumer, 0, out);
  const fields = readsOfCode(out.code);
  const names = new Set(out.names);
  for (const id of out.ids) names.add(id);
  // A build writes `volatiles['substitute']` as `volatiles.substitute`: a property that is a condition id counts too.
  for (const field of fields) names.add(field);
  for (const token of [...fields]) for (const read of methods.get(token) ?? []) fields.add(read);
  found = { fields, names };
  scans[consumer].set(entry, found);
  return found;
}

const methodTables = new WeakMap<object, Methods>();

function closeOver(direct: ReadonlyMap<string, ReadonlySet<string>>): { reads: Map<string, Set<string>>; reach: Map<string, Set<string>> } {
  const reads = new Map<string, Set<string>>();
  const reach = new Map<string, Set<string>>();
  for (const name of direct.keys()) {
    const seen = new Set<string>([name]);
    const found = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const next = queue.pop()!;
      for (const token of direct.get(next) ?? []) {
        found.add(token);
        if (direct.has(token) && !seen.has(token)) { seen.add(token); queue.push(token); }
      }
    }
    reads.set(name, found);
    reach.set(name, seen);
  }
  return { reads, reach };
}

// A Battle method that reaches getCallback runs handlers the scan reads on their own, so its reads stay out.
const DISPATCH = 'getCallback';

/** The reads of Pokemon, Side and Field methods and of the Battle methods that never reach the dispatch. */
// With the dispatching ones (runEvent, damage, heal) every board would read the whole battle.
export function methodsOf(battle: Battle): Methods {
  const side = battle.sides[0];
  const body = side.pokemon[0] ?? side.active[0];
  const prototypes = [body, side, battle.field].map(instance => Object.getPrototypeOf(instance ?? {}) as object);
  const known = methodTables.get(prototypes[0]);
  if (known) return known;
  const direct = new Map<string, Set<string>>();
  const add = (proto: object, replace: boolean): string[] => {
    const names: string[] = [];
    for (const name of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (name === 'constructor' || typeof descriptor?.value !== 'function' || (!replace && direct.has(name))) continue;
      direct.set(name, tokensOf(String(descriptor.value)));
      names.push(name);
    }
    return names;
  };
  for (const proto of prototypes) add(proto, true);
  const ofBattle = add(Object.getPrototypeOf(battle) as object, false);
  const dispatching = closeOver(direct).reach;
  for (const name of ofBattle) {
    if (name === DISPATCH || dispatching.get(name)?.has(DISPATCH)) direct.delete(name);
  }
  const closed = closeOver(direct).reads;
  methodTables.set(prototypes[0], closed);
  return closed;
}

export function readsOfEntries(dex: BattleDex, entries: Iterable<object | null | undefined>, consumer: Consumer, methods: Methods): Set<string> {
  const reads = new Set<string>();
  const seen = new Set<object>();
  const named = new Set<string>();
  const queue: object[] = [];
  for (const entry of entries) if (entry) queue.push(entry);
  while (queue.length > 0) {
    const entry = queue.pop()!;
    if (seen.has(entry)) continue;
    seen.add(entry);
    const found = entryReads(entry, consumer, methods);
    for (const field of found.fields) reads.add(field);
    for (const id of found.names) {
      if (named.has(id)) continue;
      named.add(id);
      const condition = dex.conditions.get(id);
      if (condition?.exists) queue.push(condition);
    }
  }
  return reads;
}
