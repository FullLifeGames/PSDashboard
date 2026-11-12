import type { Battle, Pokemon } from '@pkmn/sim';
import { methodsOf, readsOfEntries, type Consumer, type ReadSet } from '../dex-facts/state-readers.ts';
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

/** One own field of an object by its class: '' where the field is left out. */
function fieldKey(owner: Owner, name: string, value: unknown, reads: ReadSet, consumer: Consumer, withHp = false): string {
  if (owner === 'pokemon' && name === 'boosts' && consumer === 'hit') return `boosts=${stagesKey(value, reads)}`;
  switch (classOf(owner, name, consumer)) {
    case 'normalized':
      return withHp ? `${name}=${valueKey(value)}` : '';
    case 'inert':
      return '';
    case 'read':
      return reads.has(name) ? `${name}=${owner === 'pokemon' && PREDICATES[name] ? PREDICATES[name](value) : valueKey(value)}` : '';
    case 'effect':
      return `${name}:${effectsOf(owner, name, value, reads, consumer)}`;
    default:
      return `${name}=${valueKey(value)}`;
  }
}

/** The effect states a field holds: a body's state objects, a side's conditions, a slot's, the field's. */
function effectsOf(owner: Owner, name: string, value: unknown, reads: ReadSet, consumer: Consumer): string {
  if (name === 'volatiles' || name === 'sideConditions' || name === 'pseudoWeather') return statesKey(value, reads, consumer, false);
  if (name === 'slotConditions') return (value as unknown[]).map(slot => statesKey(slot, reads, consumer, true)).join('|');
  if (name === 'weatherState' || name === 'terrainState') return stateKey(value, reads, consumer, false);
  return stateKey(value, reads, consumer, owner === 'pokemon');
}

/** The own fields of an object that hold data (a game mod puts methods on the instance: they follow the format, which the key carries), sorted. */
const ownNames = (object: Record<string, unknown>): string[] => Object.getOwnPropertyNames(object).filter(name => typeof object[name] !== 'function').sort();

/** The key of one body: its own fields by class, and the state of its effects; `withHp` keys the HP too (a benched body, which no copy sets). */
export function bodyStateKey(pokemon: Pokemon, reads: ReadSet, consumer: Consumer, withHp = false): string {
  const body = pokemon as unknown as Record<string, unknown>;
  let key = '';
  for (const name of ownNames(body)) key += `${fieldKey('pokemon', name, body[name], reads, consumer, withHp)}~`;
  return key;
}

/** The key of everything on a board but its bodies: the field and its effects, each side's own fields and conditions, the battle's own fields. */
export function boardStateKey(battle: Battle, reads: ReadSet, consumer: Consumer): string {
  const parts: string[] = [battle.format.id];
  const field = battle.field as unknown as Record<string, unknown>;
  for (const name of ownNames(field)) parts.push(fieldKey('field', name, field[name], reads, consumer));
  for (const side of battle.sides) {
    const own = side as unknown as Record<string, unknown>;
    parts.push(ownNames(own).map(name => fieldKey('side', name, own[name], reads, consumer)).join('~'));
  }
  const own = battle as unknown as Record<string, unknown>;
  parts.push(ownNames(own).map(name => fieldKey('battle', name, own[name], reads, consumer)).join('~'));
  return parts.join('|');
}

/** The Dex entries standing on a body: its ability, its item, its status and its volatiles (the conditions the Dex resolves). */
function entriesOfBody(battle: Battle, pokemon: Pokemon): object[] {
  const { dex } = battle;
  return [
    dex.abilities.getByID(pokemon.ability), dex.items.getByID(pokemon.item), dex.conditions.get(pokemon.status),
    ...Object.keys(pokemon.volatiles).map(id => dex.conditions.get(id)),
  ];
}

/** The Dex entries standing on the field and the sides: the weather, the terrain, the room effects, the side and slot conditions. */
function entriesOfBoard(battle: Battle): object[] {
  const { dex, field } = battle;
  const ids = [field.weather, field.terrain, ...Object.keys(field.pseudoWeather)];
  for (const side of battle.sides) ids.push(...Object.keys(side.sideConditions), ...side.slotConditions.flatMap(slot => Object.keys(slot)));
  return ids.map(id => dex.conditions.get(id));
}

/**
 * The properties the handlers of everything on a board read for a consumer: the entries on the field, the sides and every
 * active body, and the move of a hit. `extra` names bodies that stand off the field (the benched attacker of a hit); the result is
 * cached by what it is made of, so a reader asks it once per pair at most.
 */
export function readsFactory(battle: Battle, consumer: Consumer): (extra: readonly Pokemon[], moveId?: string) => ReadSet {
  const methods = methodsOf(battle);
  const { dex } = battle;
  const actives = battle.sides.flatMap(side => side.active.filter((pokemon): pokemon is Pokemon => !!pokemon));
  const base = readsOfEntries(dex, [...entriesOfBoard(battle), ...actives.flatMap(pokemon => entriesOfBody(battle, pokemon))], consumer, methods);
  const parts = new Map<string, ReadSet>();
  const answers = new Map<string, ReadSet>();
  const cached = (key: string, make: () => Iterable<object>): ReadSet => {
    let found = parts.get(key);
    if (!found) parts.set(key, found = readsOfEntries(dex, make(), consumer, methods));
    return found;
  };
  return (extra, moveId) => {
    const outside = extra.filter(pokemon => !actives.includes(pokemon));
    if (outside.length === 0 && !moveId) return base;
    const key = `${moveId ?? ''}|${outside.map(pokemon => `${pokemon.side.id}${pokemon.position}`).join(',')}`;
    let answer = answers.get(key);
    if (!answer) {
      const union = new Set(base);
      if (moveId) for (const field of cached(`move:${moveId}`, () => [dex.moves.getByID(moveId as never)])) union.add(field);
      for (const pokemon of outside) for (const field of cached(`body:${pokemon.side.id}${pokemon.position}`, () => entriesOfBody(battle, pokemon))) union.add(field);
      answers.set(key, answer = union);
    }
    return answer;
  };
}

/** For tests: what the handlers of everything on a board read for a consumer (every active, the move of a hit). */
export function boardReads(battle: Battle, consumer: Consumer, moveId?: string): ReadSet {
  return readsFactory(battle, consumer)([], moveId);
}
