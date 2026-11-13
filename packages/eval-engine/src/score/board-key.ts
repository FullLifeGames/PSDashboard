import type { Battle, Pokemon } from '@pkmn/sim';
import { methodsOf, readsOfEntries, type Consumer, type Methods, type ReadSet } from '../dex-facts/state-readers.ts';
import { BOARD_FIELDS, type FieldClass, type Owner } from './board-key-table.ts';

export { BOARD_FIELDS };
export type { Consumer, FieldClass, ReadSet };

/**
 * Round 89 (#149, step A8): the key of a board for the memos that play it (the hit cost of score/contact.ts, the end of the
 * turn of score/residuals.ts). A memo may answer for a board only when the board's own play would give the answer, so the key
 * must carry everything the play reads and may leave out only what it sets before it plays or never reads. The rule, for both
 * memos and both game types:
 *
 * - Every own field of `Pokemon`, `Side`, `Field` and `Battle` has a class per consumer (score/board-key-table.ts, held to the
 *   simulator by test/board-key-census.spec.ts). A field the table does not name is keyed.
 * - The turn-varying fields (`activeTurns`, `lastMove`, the clocks of an effect, a Substitute's HP, the toxic stage) are `read`
 *   fields: they enter the key only when a handler of an entry on the board reads them in an event the consumer fires
 *   (dex-facts/state-readers.ts scans the Dex). On a board without Stakeout the turns a foe has stood are not part of the key.
 * - `hp` is set by the consumer's copy before it plays (score/contact-play.ts, score/residuals.ts), so it is not keyed.
 * - `effectOrder` is dropped: the simulator compares it only between handlers of the SwitchIn and RedirectTarget events, which
 *   a played hit and a played end of the turn do not fire (held by the event census).
 */

type EffectState = Record<string, unknown>;

/**
 * The key is written into one list of pieces and joined once, so that a body's key costs one allocation of its text and none for
 * the parts between (a field's part is its name, a sign, its value, a separator). The list is the module's own: a key is made
 * to the end before the next one starts, and the entry points empty it first.
 */
type Piece = string | number | boolean;
let out: Piece[] = [];

/** A body, a side or a Dex object into the pieces by its place or its id; false for anything else. */
function referenceInto(object: Record<string, unknown>): boolean {
  if (object.pokemon !== undefined && object.sideConditions !== undefined) out.push('side:', String(object.id));
  else if (object.side !== undefined && object.species !== undefined) out.push('@', (object.side as { id: string }).id, String(object.position), ':', (object.species as { id: string }).id);
  else if (typeof object.effectType === 'string' && typeof object.id === 'string') out.push('#', object.id);
  else return false;
  return true;
}

/** A value into the pieces: a body or a side by its place, a Dex object by its id, anything else by its content. */
function valueInto(value: unknown, depth: number): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') {
    if (typeof value !== 'function') out.push(typeof value === 'symbol' ? String(value) : value as Piece);
    return;
  }
  if (depth > 3) { out.push('~'); return; }
  const object = value as Record<string, unknown>;
  if (Array.isArray(value)) {
    out.push('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) out.push(',');
      valueInto(value[index], depth + 1);
    }
    out.push(']');
    return;
  }
  if (referenceInto(object)) return;
  // A back-reference to the battle (a battle queue holds one) is the whole battle again: its log, its PRNG, its rule table. No rule reads those through a field.
  out.push('{');
  let first = true;
  for (const name of sortedKeys(object)) {
    if (name === 'battle') continue;
    if (!first) out.push(';');
    first = false;
    out.push(name, '=');
    valueInto(object[name], depth + 1);
  }
  out.push('}');
}

/** A value as a string, on a list of its own. */
function valueText(value: unknown): string {
  const saved = out;
  out = [];
  valueInto(value, 0);
  const text = out.join('');
  out = saved;
  return text;
}

/** An object's own names in order; a short list needs no sort. */
function sortedKeys(object: object): string[] {
  const keys = Object.keys(object);
  if (keys.length > 1) keys.sort();
  return keys;
}

/** The fields of one effect's state that the play reads (the state's own fields, read when a handler on the board names them), sorted. */
function stateInto(state: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): void {
  if (!state || typeof state !== 'object') return;
  const fields = state as EffectState;
  for (const name of sortedKeys(fields)) {
    const value = fields[name];
    if (name === 'target' || name === 'effectOrder' || typeof value === 'function') continue;
    // The end of the turn sets the clocks of the volatiles and of the field's and the sides' conditions to lasting; the others it reads as they stand.
    if (consumer === 'residual' && name === 'duration') {
      if (keepClock) { out.push(name, '='); valueInto(value, 0); out.push(';'); }
      continue;
    }
    if (name === 'id' || reads.has(name)) { out.push(name, '='); valueInto(value, 0); out.push(';'); }
  }
}

/** A set of effects by id: `volatiles`, `sideConditions`, `pseudoWeather`, one slot's conditions. */
function statesInto(states: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): void {
  if (!states || typeof states !== 'object') return;
  const byId = states as Record<string, unknown>;
  let first = true;
  for (const id of sortedKeys(byId)) {
    if (!first) out.push(',');
    first = false;
    out.push(id, '{');
    stateInto(byId[id], reads, consumer, keepClock);
    out.push('}');
  }
}

/** The stages the damage formula reads of the two bodies (their raised and lowered stats); the others (Speed, accuracy, evasion) are read by a few handlers. */
const DAMAGE_STAGES = ['atk', 'def', 'spa', 'spd'];

/** A body's stages for the hit: the damage stages always, the others where a handler on the board reads `boosts` (Gyro Ball, Power Trip and the like). */
function stagesInto(stages: unknown, reads: ReadSet): void {
  const all = stages as Record<string, number>;
  let first = true;
  for (const stat of sortedKeys(all)) {
    if (!DAMAGE_STAGES.includes(stat) && !reads.has('boosts')) continue;
    if (!first) out.push('/');
    first = false;
    out.push(stat, all[stat]);
  }
}

/**
 * The own fields whose readers in the Dex all test them against zero: they are keyed as that predicate. The turns a body has
 * stood (`activeTurns`) is read by Stakeout, Mountaineer, Rebound, Speed Boost, Slow Start, Truant, Electrify, Taunt, Octolock and
 * a partial trap, each as "a foe that came in this turn", "past the first turn". test/board-key-predicate.spec.ts plays every
 * reader the scan names at 1, 4 and 17 in every rule set and requires equal plays and keys.
 */
const PREDICATES: Record<string, (value: unknown) => string> = {
  activeTurns: value => (typeof value === 'number' && value > 0 ? '1' : valueText(value)),
};

/** How one own field enters a key: a plain value, the stages of a body, a value read as a predicate, the state of an effect, or not at all. */
type Kind = 'plain' | 'stages' | 'predicate' | 'effect' | 'none';
/** A field of a key: its name, how it enters, and the text that opens its part (`name=` or `name:`). */
interface Step { name: string; kind: Kind; prefix: string }

/** The step of one own field by its class: what a board that names it reads, and nothing for a field the key leaves out. */
function stepOf(owner: Owner, name: string, fieldClass: FieldClass, reads: ReadSet, hit: boolean, withHp: boolean): Step {
  const kind = ((): Kind => {
    if (owner === 'pokemon' && name === 'boosts' && hit) return 'stages';
    switch (fieldClass) {
      case 'normalized': return withHp ? 'plain' : 'none';
      case 'inert': return 'none';
      case 'read': return reads.has(name) ? (owner === 'pokemon' && PREDICATES[name] ? 'predicate' : 'plain') : 'none';
      case 'effect': return 'effect';
      default: return 'plain';
    }
  })();
  return { name, kind, prefix: kind === 'effect' ? `${name}:` : `${name}=` };
}

/**
 * What a board's key does with the own fields of one kind of object: the shape is the object's own field names in their order. A
 * shape is found once per process and owner (the names of a body come in the same order from one build to the next, so the
 * shape seen lately answers without a lookup); it holds the sorted names, the class of each for the two consumers, and, per read
 * set, the fields that enter the key (the read set of a composition is shared by every board of it, see `readsFactory`). The
 * key then visits the fields that enter it and no other. `keepEmpty` keeps a place for the fields the key leaves out (the
 * field's parts are joined by their own bars).
 */
interface Shape {
  names: readonly string[];
  sorted: readonly string[];
  classes: (readonly FieldClass[] | undefined)[];
  /** By read set, then by the key's kind (consumer, `withHp`, `keepEmpty`). */
  bySet: WeakMap<ReadSet, (readonly Step[] | undefined)[]>;
}
interface Registry { recent: Shape[]; byNames: Map<string, Shape> }
const registry: Record<Owner, Registry> = {
  pokemon: { recent: [], byNames: new Map() },
  side: { recent: [], byNames: new Map() },
  field: { recent: [], byNames: new Map() },
  battle: { recent: [], byNames: new Map() },
};
const SHAPES_PER_OWNER = 64;
const RECENT = 4;

const sameNames = (shape: Shape, names: readonly string[]): boolean => {
  if (shape.names.length !== names.length) return false;
  for (let index = 0; index < names.length; index++) if (shape.names[index] !== names[index]) return false;
  return true;
};

function shapeOf(object: Record<string, unknown>, owner: Owner): Shape {
  const names = Object.getOwnPropertyNames(object);
  const { recent, byNames } = registry[owner];
  for (let index = 0; index < recent.length; index++) {
    if (sameNames(recent[index], names)) {
      const found = recent[index];
      if (index > 0) { recent.splice(index, 1); recent.unshift(found); }
      return found;
    }
  }
  const joined = names.join(',');
  let shape = byNames.get(joined);
  if (!shape) {
    if (byNames.size >= SHAPES_PER_OWNER) byNames.clear();
    byNames.set(joined, shape = { names, sorted: [...names].sort(), classes: [undefined, undefined], bySet: new WeakMap() });
  }
  recent.unshift(shape);
  if (recent.length > RECENT) recent.pop();
  return shape;
}

const classOf = (owner: Owner, name: string, hit: boolean): FieldClass =>
  BOARD_FIELDS[owner][name]?.[hit ? 0 : 1] ?? 'key';

function stepsOf(object: Record<string, unknown>, owner: Owner, reads: ReadSet, consumer: Consumer, withHp: boolean, keepEmpty: boolean): readonly Step[] {
  const shape = shapeOf(object, owner);
  let kinds = shape.bySet.get(reads);
  if (!kinds) shape.bySet.set(reads, kinds = []);
  const hit = consumer === 'hit';
  const slot = (hit ? 0 : 4) + (withHp ? 2 : 0) + (keepEmpty ? 1 : 0);
  let steps = kinds[slot];
  if (!steps) {
    const classes = shape.classes[hit ? 0 : 1] ??= shape.sorted.map(name => classOf(owner, name, hit));
    const all = shape.sorted.map((name, index) => stepOf(owner, name, classes[index], reads, hit, withHp));
    kinds[slot] = steps = keepEmpty ? all : all.filter(step => step.kind !== 'none');
  }
  return steps;
}

/** One own field's part of a key into the pieces, by its step (a step of a field the key leaves out writes nothing). */
function partInto(owner: Owner, step: Step, value: unknown, reads: ReadSet, consumer: Consumer): void {
  out.push(step.prefix);
  switch (step.kind) {
    case 'plain': valueInto(value, 0); break;
    case 'stages': stagesInto(value, reads); break;
    case 'predicate': out.push(PREDICATES[step.name](value)); break;
    case 'effect': effectsInto(owner, step.name, value, reads, consumer); break;
    default: break;
  }
}

/** The effect states a field holds: a body's state objects, a side's conditions, a slot's, the field's. */
function effectsInto(owner: Owner, name: string, value: unknown, reads: ReadSet, consumer: Consumer): void {
  if (name === 'volatiles' || name === 'sideConditions' || name === 'pseudoWeather') statesInto(value, reads, consumer, false);
  else if (name === 'slotConditions') {
    const slots = value as unknown[];
    for (let index = 0; index < slots.length; index++) {
      if (index > 0) out.push('|');
      statesInto(slots[index], reads, consumer, true);
    }
  } else if (name === 'weatherState' || name === 'terrainState') stateInto(value, reads, consumer, false);
  else stateInto(value, reads, consumer, owner === 'pokemon');
}

/** How the parts of an object join: each followed by a tilde (a body), between tildes (a side, the battle), each after a bar (the field). */
type Join = 'after' | 'between' | 'before';

/**
 * The parts of an object's own fields that enter a key, in the order of their names, into the pieces. A game mod puts methods on
 * the instance: they follow the format, which the key carries, so a function is no part. A field the key leaves out adds nothing
 * (`keepEmpty` keeps its place, for the field's parts, which each follow a bar of their own).
 */
function partsInto(object: unknown, owner: Owner, reads: ReadSet, consumer: Consumer, join: Join, withHp = false, keepEmpty = false): void {
  const own = object as Record<string, unknown>;
  const steps = stepsOf(own, owner, reads, consumer, withHp, keepEmpty);
  let first = true;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const value = own[step.name];
    if (typeof value === 'function') continue;
    const empty = step.kind === 'none';
    if (empty && !keepEmpty) continue;
    if (join === 'before') out.push('|');
    else if (join === 'between' && !first) out.push('~');
    first = false;
    if (!empty) partInto(owner, step, value, reads, consumer);
    if (join === 'after') out.push('~');
  }
}

/** The key of one body: its own fields by class, and the state of its effects; `withHp` keys the HP too (a benched body, which no copy sets). */
export function bodyStateKey(pokemon: Pokemon, reads: ReadSet, consumer: Consumer, withHp = false): string {
  // A field that the key leaves out adds nothing, not even a separator: a body that has grown an own field no rule reads (the simulator creates some on an event) keeps its key.
  out.length = 0;
  partsInto(pokemon, 'pokemon', reads, consumer, 'after', withHp);
  return out.join('');
}

/** The key of everything on a board but its bodies: the field and its effects, each side's own fields and conditions, the battle's own fields. */
export function boardStateKey(battle: Battle, reads: ReadSet, consumer: Consumer): string {
  out.length = 0;
  out.push(battle.format.id);
  partsInto(battle.field, 'field', reads, consumer, 'before', false, true);
  for (const side of battle.sides) {
    out.push('|');
    partsInto(side, 'side', reads, consumer, 'between');
  }
  out.push('|');
  partsInto(battle, 'battle', reads, consumer, 'between');
  return out.join('');
}

/** The descriptor of a body's entries: its ability, its item, its status and its volatiles (the conditions the Dex resolves), as tokens. */
const bodyTokens = (pokemon: Pokemon): string => `a${pokemon.ability}|i${pokemon.item}|c${pokemon.status}|${Object.keys(pokemon.volatiles).map(id => `c${id}`).join('|')}`;

/** The tokens of the entries on the field and the sides: the weather, the terrain, the room effects, the side and slot conditions. */
function boardTokens(battle: Battle): string {
  const { field } = battle;
  const ids = [field.weather, field.terrain, ...Object.keys(field.pseudoWeather)];
  for (const side of battle.sides) ids.push(...Object.keys(side.sideConditions), ...side.slotConditions.flatMap(slot => Object.keys(slot)));
  return ids.map(id => `c${id}`).join('|');
}

/** The Dex entries a list of tokens names (`a` ability, `i` item, `c` condition, `m` move), by the Dex of the battle. */
function entriesOf(dex: Battle['dex'], tokens: string): object[] {
  const entries: object[] = [];
  for (const token of tokens.split('|')) {
    if (!token) continue;
    const id = token.slice(1) as never;
    entries.push(token[0] === 'a' ? dex.abilities.getByID(id) : token[0] === 'i' ? dex.items.getByID(id) : token[0] === 'm' ? dex.moves.getByID(id) : dex.conditions.get(id));
  }
  return entries;
}

/**
 * What the scan found for a list of tokens, by Dex and method table: the handlers of the entries do not change within a process, so a
 * composition of the board that has stood once reads its set from here, and every board of it shares the one set (which nothing may change).
 */
const found = new WeakMap<object, WeakMap<Methods, Map<string, ReadSet>>>();
const FOUND_LIMIT = 5_000;

function scanned(dex: Battle['dex'], methods: Methods, consumer: Consumer, tokens: string): ReadSet {
  let byMethods = found.get(dex);
  if (!byMethods) found.set(dex, byMethods = new WeakMap());
  let byTokens = byMethods.get(methods);
  if (!byTokens) byMethods.set(methods, byTokens = new Map());
  const id = `${consumer}#${tokens}`;
  let reads = byTokens.get(id);
  if (!reads) {
    if (byTokens.size >= FOUND_LIMIT) byTokens.clear();
    byTokens.set(id, reads = readsOfEntries(dex, entriesOf(dex, tokens), consumer, methods));
  }
  return reads;
}

/**
 * The properties the handlers of everything on a board read for a consumer: the entries on the field, the sides and every
 * active body, and the move of a hit. `extra` names bodies that stand off the field (the benched attacker of a hit). Nothing is
 * scanned until a reader asks, and the answer is cached by what the board is made of (the tokens of its entries), so a reader asks it
 * once per pair at most and boards of one composition share one answer.
 */
export function readsFactory(battle: Battle, consumer: Consumer): (extra: readonly Pokemon[], moveId?: string) => ReadSet {
  const actives = battle.sides.flatMap(side => side.active.filter((pokemon): pokemon is Pokemon => !!pokemon));
  const answers = new Map<string, ReadSet>();
  let base: string | undefined;
  return (extra, moveId) => {
    const outside = extra.filter(pokemon => !actives.includes(pokemon));
    const key = `${moveId ?? ''}|${outside.map(pokemon => `${pokemon.side.id}${pokemon.position}`).join(',')}`;
    let answer = answers.get(key);
    if (!answer) {
      base ??= [boardTokens(battle), ...actives.map(bodyTokens)].join('|');
      const tokens = [base, moveId ? `m${moveId}` : '', ...outside.map(bodyTokens)].join('|');
      answers.set(key, answer = scanned(battle.dex, methodsOf(battle), consumer, tokens));
    }
    return answer;
  };
}

/** For tests: what the handlers of everything on a board read for a consumer (every active, the move of a hit). */
export function boardReads(battle: Battle, consumer: Consumer, moveId?: string): ReadSet {
  return readsFactory(battle, consumer)([], moveId);
}
