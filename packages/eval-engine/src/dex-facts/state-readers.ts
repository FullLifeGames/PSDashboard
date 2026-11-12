import type { Battle } from '@pkmn/sim';

/**
 * Round 89 (#149, step A8): which fields of the board a Dex entry reads when one of its handlers runs. The memos of the
 * hit cost and of the end of turn (score/contact.ts, score/residuals.ts) key the state their play reads, and the state a
 * play reads is whatever the handlers of the entries on the board name. The names come from the Dex at run time (the
 * source of each handler, `String(fn)`, scanned for the properties it reads), so a move, an ability or an item that a new
 * simulator version adds is read the moment it exists, and no entry is named in our code.
 *
 * A read is a property name after a dot, or in brackets with a string, that is not the left side of an assignment. The
 * entry's own handlers, those of its `condition`, `self`, `secondary` and `secondaries`, and the callbacks that are no
 * handler (`basePowerCallback`) count. A handler for an event the consumer never fires does not count: the consumer
 * names its events (HIT_EVENTS_NEVER: the events a played hit never fires, held by test/board-key-census.spec.ts, which plays
 * every move; RESIDUAL_EVENTS: the events the end of the turn fires, held there too). A handler that calls a method of
 * `Pokemon`, `Side` or `Field` reads what that method reads (the closure over the methods' own sources).
 *
 * The scan errs toward reading too much: a name is a read wherever it appears, whoever owns the property, so a name
 * adds a field to the key and costs a hit, never a wrong answer. test/board-key-readers.spec.ts holds each field to the
 * entries the scan names.
 */

export type Consumer = 'hit' | 'residual';

/** Property names read by the handlers of some entries. */
export type ReadSet = ReadonlySet<string>;

type BattleDex = Battle['dex'];

/**
 * The events a played hit never fires (a move use on the copy of a board, score/contact-play.ts): the choice of the next turn
 * (the disabled moves, the trapped bodies, the lock of a move). The end of the turn does fire: a hit that leaves a status
 * prices it over the played end of the turns (Residual) and the turns the status takes (BeforeMove), so their handlers are read.
 * test/board-key-census.spec.ts plays every damaging move against a sample of abilities and items (every one with
 * `DICE_SWEEPS=full`) and requires that none of these events fired; an event the list does not know is read, so a new
 * simulator event costs hits, never an answer.
 */
export const HIT_EVENTS_NEVER: ReadonlySet<string> = new Set([
  'DisableMove', 'StallMove', 'TrapPokemon', 'MaybeTrapPokemon', 'BeforeTurn', 'LockMove', 'LockMoveAbility',
  'FoeMaybeTrapPokemon', 'AllyMaybeTrapPokemon', 'FlinchChance',
]);

/** The events the played end of the turn fires (`fieldEvent('Residual')` and what a residual handler's damage and heal set off). */
export const RESIDUAL_EVENTS: ReadonlySet<string> = new Set([
  'Residual', 'FieldResidual', 'SideResidual', 'Weather', 'Damage', 'Heal', 'TryHeal', 'Type', 'Update', 'ModifySpecies',
  // eslint-disable-next-line names/no-new-dex-name -- 'Immunity' is the simulator's event of that name (held by board-key-effects.spec.ts), not the ability
  'Immunity',
  'BeforeFaint', 'Faint', 'AfterFaint', 'End',
]);

/** `onResidual`, `onFoeBasePower`, `onSourceModifyDamage`: the event of a handler's key, with and without the prefix that says whose it is. */
const HANDLER = /^on(Ally|Foe|Source|Any|Field|Side|Slot|Self)?([A-Z]\w*)$/;

/** A property read: `.name` or `['name']`, not followed by an assignment. */
const READ = /\.([A-Za-z_$][\w$]*)(?!\s*(?:=(?!=)|\+\+|--|[-+*/%|&^]=|\*\*=|<<=|>>=))|\[\s*['"]([\w$]+)['"]\s*\](?!\s*(?:=(?!=)|\+\+|--|[-+*/%|&^]=))/g;
const LITERAL = /(['"`])([a-z][a-z0-9]{2,})\1/g;

const SUB_EFFECTS = ['condition', 'self', 'secondary', 'secondaries'] as const;
const CREATES = ['volatileStatus', 'sideCondition', 'slotCondition', 'status', 'weather', 'terrain', 'pseudoWeather'] as const;

/** What the scan of one entry found: the properties its handlers read, and the ids it names (conditions it can create). */
export interface EntryReads { fields: ReadSet; names: ReadonlySet<string> }

/** The reads of the simulator's own methods on a body, a side and the field: a handler that calls one of them reads what it reads. */
export type Methods = ReadonlyMap<string, ReadSet>;

const tokensOf = (source: string): Set<string> => {
  const found = new Set<string>();
  for (const match of source.matchAll(READ)) found.add(match[1] ?? match[2]);
  return found;
};

/** Whether the consumer fires the event of this handler key (a key that is no handler is a callback the move path calls: the hit reads it, the end of the turn does not). */
function fires(key: string, consumer: Consumer): boolean {
  const match = HANDLER.exec(key);
  if (!match) return consumer === 'hit';
  const [, , event] = match;
  const whole = key.slice(2);
  if (/(Order|Priority|SubOrder)$/.test(key)) return false;
  if (consumer === 'hit') return !HIT_EVENTS_NEVER.has(event) && !HIT_EVENTS_NEVER.has(whole);
  return RESIDUAL_EVENTS.has(event) || RESIDUAL_EVENTS.has(whole);
}

function collect(entry: Record<string, unknown>, consumer: Consumer, depth: number, out: { source: string; names: Set<string> }): void {
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (typeof value === 'function') {
      if (fires(key, consumer)) out.source += `${String(value)}\n`;
    } else if (typeof value === 'string' && (CREATES as readonly string[]).includes(key)) {
      out.names.add(value.toLowerCase().replace(/[^a-z0-9]/g, ''));
    } else if (depth < 3 && value && typeof value === 'object' && (SUB_EFFECTS as readonly string[]).includes(key)) {
      for (const part of Array.isArray(value) ? value : [value]) if (part && typeof part === 'object') collect(part as Record<string, unknown>, consumer, depth + 1, out);
    }
  }
}

const scans = { hit: new WeakMap<object, EntryReads>(), residual: new WeakMap<object, EntryReads>() };

/** The properties the handlers of one Dex entry read for a consumer, and the ids it names; the entry is a move, an ability, an item or a condition. */
export function entryReads(entry: object, consumer: Consumer, methods: Methods): EntryReads {
  let found = scans[consumer].get(entry);
  if (found) return found;
  const out = { source: '', names: new Set<string>() };
  collect(entry as Record<string, unknown>, consumer, 0, out);
  const fields = tokensOf(out.source);
  const names = new Set(out.names);
  for (const match of out.source.matchAll(LITERAL)) names.add(match[2]);
  // A call of a method of the body, the side or the field reads what the method reads (transitively: the methods are in the table closed already).
  for (const token of [...fields]) for (const read of methods.get(token) ?? []) fields.add(read);
  found = { fields, names };
  scans[consumer].set(entry, found);
  return found;
}

const methodTables = new WeakMap<object, Methods>();

/**
 * The reads of the methods of the simulator's `Pokemon`, `Side` and `Field`, closed over their calls of each other: found from
 * the prototypes of instances of the battle (a clone of the speed layer carries the same sources).
 */
export function methodsOf(battle: Battle): Methods {
  const side = battle.sides[0];
  const body = side.pokemon[0] ?? side.active[0];
  const prototypes = [body, side, battle.field].map(instance => Object.getPrototypeOf(instance ?? {}) as object);
  const known = methodTables.get(prototypes[0]);
  if (known) return known;
  const direct = new Map<string, Set<string>>();
  for (const proto of prototypes) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (name !== 'constructor' && typeof descriptor?.value === 'function') direct.set(name, tokensOf(String(descriptor.value)));
    }
  }
  const closed = new Map<string, Set<string>>();
  for (const name of direct.keys()) {
    const seen = new Set<string>([name]);
    const reads = new Set<string>();
    const queue = [name];
    while (queue.length > 0) {
      const next = queue.pop()!;
      for (const token of direct.get(next) ?? []) {
        reads.add(token);
        if (direct.has(token) && !seen.has(token)) { seen.add(token); queue.push(token); }
      }
    }
    closed.set(name, reads);
  }
  methodTables.set(prototypes[0], closed);
  return closed;
}

/**
 * Everything the handlers of some entries read for a consumer, with the conditions they can create (the ids their data and their
 * sources name, resolved by the Dex's own resolver) and what those read in turn.
 */
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
