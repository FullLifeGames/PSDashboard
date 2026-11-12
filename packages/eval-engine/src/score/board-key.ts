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
const CLOCKS = ['duration', 'time', 'startTime'];

/** A value as a string: a body or a side by its place, a Dex object by its id, anything else by its content. */
function valueKey(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return typeof value === 'function' ? '' : String(value);
  if (depth > 3) return '~';
  const object = value as Record<string, unknown>;
  if (Array.isArray(value)) return `[${value.map(entry => valueKey(entry, depth + 1)).join(',')}]`;
  if (object.pokemon !== undefined && object.sideConditions !== undefined) return `side:${String(object.id)}`;
  if (object.side !== undefined && object.species !== undefined) return `@${(object.side as { id: string }).id}${String(object.position)}:${(object.species as { id: string }).id}`;
  if (typeof object.effectType === 'string' && typeof object.id === 'string') return `#${object.id}`;
  // A back-reference to the battle (a battle queue holds one) is the whole battle again: its log, its PRNG, its rule table. No rule reads those through a field.
  return `{${Object.keys(object).filter(name => name !== 'battle').sort().map(name => `${name}=${valueKey(object[name], depth + 1)}`).join(';')}}`;
}

/** The fields of one effect's state that the play reads (the state's own fields, read when a handler on the board names them), sorted. */
function stateKey(state: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): string {
  if (!state || typeof state !== 'object') return '';
  const fields = state as EffectState;
  let key = '';
  for (const name of Object.keys(fields).sort()) {
    if (name === 'target' || name === 'effectOrder' || typeof fields[name] === 'function') continue;
    const isClock = CLOCKS.includes(name);
    // The end of the turn sets the clocks of the volatiles and of the field's and the sides' conditions to lasting; the others it reads as they stand.
    if (consumer === 'residual' && name === 'duration' && keepClock) { key += `${name}=${valueKey(fields[name])};`; continue; }
    if (isClock && consumer === 'residual' && name === 'duration') continue;
    if (name === 'id' || reads.has(name)) key += `${name}=${valueKey(fields[name])};`;
  }
  return key;
}

/** A set of effects by id: `volatiles`, `sideConditions`, `pseudoWeather`, one slot's conditions. */
function statesKey(states: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): string {
  if (!states || typeof states !== 'object') return '';
  const byId = states as Record<string, unknown>;
  return Object.keys(byId).sort().map(id => `${id}{${stateKey(byId[id], reads, consumer, keepClock)}}`).join(',');
}

const classOf = (owner: Owner, name: string, consumer: Consumer): FieldClass =>
  BOARD_FIELDS[owner][name]?.[consumer === 'hit' ? 0 : 1] ?? 'key';

/** The stages the damage formula reads of the two bodies (their raised and lowered stats); the others (Speed, accuracy, evasion) are read by a few handlers. */
const DAMAGE_STAGES = ['atk', 'def', 'spa', 'spd'];

/** A body's stages for the hit: the damage stages always, the others where a handler on the board reads `boosts` (Gyro Ball, Power Trip and the like). */
function stagesKey(stages: unknown, reads: ReadSet): string {
  const all = stages as Record<string, number>;
  return Object.keys(all).sort().filter(stat => DAMAGE_STAGES.includes(stat) || reads.has('boosts')).map(stat => `${stat}${all[stat]}`).join('/');
}

/**
 * The own fields whose readers in the Dex all test them against zero: they are keyed as that predicate. The turns a body has
 * stood (`activeTurns`) is read by Stakeout, Mountaineer, Rebound, Speed Boost, Slow Start, Truant, Electrify, Taunt, Octolock and
 * a partial trap, each as "a foe that came in this turn", "past the first turn". test/board-key-predicate.spec.ts plays every
 * reader the scan names at 1, 4 and 17 in every rule set and requires equal plays and keys.
 */
const PREDICATES: Record<string, (value: unknown) => string> = {
  activeTurns: value => (typeof value === 'number' && value > 0 ? '1' : valueKey(value)),
};

/** How one own field enters a key: a plain value, the stages of a body, a value read as a predicate, the state of an effect, or not at all. */
type Kind = 'plain' | 'stages' | 'predicate' | 'effect' | 'none';
interface Step { name: string; kind: Kind }

/** The step of one own field by its class: what a board that names it reads, and nothing for a field the key leaves out. */
function stepOf(owner: Owner, name: string, reads: ReadSet, consumer: Consumer, withHp: boolean): Step {
  const kind = ((): Kind => {
    if (owner === 'pokemon' && name === 'boosts' && consumer === 'hit') return 'stages';
    switch (classOf(owner, name, consumer)) {
      case 'normalized': return withHp ? 'plain' : 'none';
      case 'inert': return 'none';
      case 'read': return reads.has(name) ? (owner === 'pokemon' && PREDICATES[name] ? 'predicate' : 'plain') : 'none';
      case 'effect': return 'effect';
      default: return 'plain';
    }
  })();
  return { name, kind };
}

/**
 * What a board's key does with the own fields of one kind of object: which fields enter it, in the order of their names. The
 * decision follows the object's own field names, the owner, the consumer and the read set, so it is made once for each
 * shape and read set (the read set of a composition is shared by every board of it, see `readsFactory`) and the key then visits
 * the fields that enter it and no other. `keepEmpty` keeps a place for the fields the key leaves out (the field's parts are joined by their own bars).
 */
interface Shape { names: readonly string[]; steps: readonly Step[] }
const shapes = new WeakMap<ReadSet, Map<string, { last: Shape | undefined; byNames: Map<string, Shape> }>>();
const SHAPES_PER_KIND = 64;

function stepsOf(object: Record<string, unknown>, owner: Owner, reads: ReadSet, consumer: Consumer, withHp: boolean, keepEmpty = false): readonly Step[] {
  const names = Object.getOwnPropertyNames(object);
  let kinds = shapes.get(reads);
  if (!kinds) shapes.set(reads, kinds = new Map());
  const kindId = `${owner}${consumer}${withHp ? 'h' : ''}${keepEmpty ? 'e' : ''}`;
  let bucket = kinds.get(kindId);
  if (!bucket) kinds.set(kindId, bucket = { last: undefined, byNames: new Map() });
  const last = bucket.last;
  // The names of a body come in the same order from one build to the next: the last shape answers without a lookup.
  if (last && last.names.length === names.length && last.names.every((name, index) => name === names[index])) return last.steps;
  const joined = names.join(',');
  let shape = bucket.byNames.get(joined);
  if (!shape) {
    if (bucket.byNames.size >= SHAPES_PER_KIND) bucket.byNames.clear();
    const steps = [...names].sort().map(name => stepOf(owner, name, reads, consumer, withHp));
    bucket.byNames.set(joined, shape = { names, steps: keepEmpty ? steps : steps.filter(step => step.kind !== 'none') });
  }
  bucket.last = shape;
  return shape.steps;
}

/** One own field's part of a key, by its step: '' where the key leaves the field out. */
function partOf(owner: Owner, step: Step, value: unknown, reads: ReadSet, consumer: Consumer): string {
  switch (step.kind) {
    case 'plain': return `${step.name}=${valueKey(value)}`;
    case 'stages': return `boosts=${stagesKey(value, reads)}`;
    case 'predicate': return `${step.name}=${PREDICATES[step.name](value)}`;
    case 'effect': return `${step.name}:${effectsOf(owner, step.name, value, reads, consumer)}`;
    default: return '';
  }
}

/** The effect states a field holds: a body's state objects, a side's conditions, a slot's, the field's. */
function effectsOf(owner: Owner, name: string, value: unknown, reads: ReadSet, consumer: Consumer): string {
  if (name === 'volatiles' || name === 'sideConditions' || name === 'pseudoWeather') return statesKey(value, reads, consumer, false);
  if (name === 'slotConditions') return (value as unknown[]).map(slot => statesKey(slot, reads, consumer, true)).join('|');
  if (name === 'weatherState' || name === 'terrainState') return stateKey(value, reads, consumer, false);
  return stateKey(value, reads, consumer, owner === 'pokemon');
}

/** The parts of an object's own fields that enter a key, in the order of their names. */
function partsOf(object: unknown, owner: Owner, reads: ReadSet, consumer: Consumer, withHp = false, keepEmpty = false): string[] {
  const own = object as Record<string, unknown>;
  const parts: string[] = [];
  for (const step of stepsOf(own, owner, reads, consumer, withHp, keepEmpty)) {
    const value = own[step.name];
    // A game mod puts methods on the instance: they follow the format, which the key carries.
    if (typeof value === 'function') continue;
    const part = partOf(owner, step, value, reads, consumer);
    if (part || keepEmpty) parts.push(part);
  }
  return parts;
}

/** The key of one body: its own fields by class, and the state of its effects; `withHp` keys the HP too (a benched body, which no copy sets). */
export function bodyStateKey(pokemon: Pokemon, reads: ReadSet, consumer: Consumer, withHp = false): string {
  // A field that the key leaves out adds nothing, not even a separator: a body that has grown an own field no rule reads (the simulator creates some on an event) keeps its key.
  let key = '';
  for (const part of partsOf(pokemon, 'pokemon', reads, consumer, withHp)) key += `${part}~`;
  return key;
}

/** The key of everything on a board but its bodies: the field and its effects, each side's own fields and conditions, the battle's own fields. */
export function boardStateKey(battle: Battle, reads: ReadSet, consumer: Consumer): string {
  const parts: string[] = [battle.format.id];
  parts.push(...partsOf(battle.field, 'field', reads, consumer, false, true));
  for (const side of battle.sides) parts.push(partsOf(side, 'side', reads, consumer).join('~'));
  parts.push(partsOf(battle, 'battle', reads, consumer).join('~'));
  return parts.join('|');
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
