import type { Battle, Pokemon } from '@pkmn/sim';
import { methodsOf, readsOfEntries, type Consumer, type Methods, type ReadSet } from '../dex-facts/state-readers.ts';
import { BOARD_FIELDS, type FieldClass, type Owner } from './board-key-table.ts';

export { BOARD_FIELDS };
export type { Consumer, ReadSet };

// The key carries everything the board's own play reads and leaves out only what the consumer sets before it plays.
// `effectOrder` is dropped: the simulator compares it only between SwitchIn and RedirectTarget handlers, unfired here.

type EffectState = Record<string, unknown>;

function valueKey(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return typeof value === 'function' ? '' : String(value);
  if (depth > 3) return '~';
  const object = value as Record<string, unknown>;
  if (Array.isArray(value)) return `[${value.map(entry => valueKey(entry, depth + 1)).join(',')}]`;
  if (object.pokemon !== undefined && object.sideConditions !== undefined) return `side:${String(object.id)}`;
  if (object.side !== undefined && object.species !== undefined) return `@${(object.side as { id: string }).id}${String(object.position)}:${(object.species as { id: string }).id}`;
  if (typeof object.effectType === 'string' && typeof object.id === 'string') return `#${object.id}`;
  // A back-reference to the battle (a queue holds one) is the whole battle again; no rule reads it through a field.
  return `{${Object.keys(object).filter(name => name !== 'battle').sort().map(name => `${name}=${valueKey(object[name], depth + 1)}`).join(';')}}`;
}

function sortedKeys(object: object): string[] {
  const keys = Object.keys(object);
  if (keys.length > 1) keys.sort();
  return keys;
}

function stateKey(state: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): string {
  if (!state || typeof state !== 'object') return '';
  const fields = state as EffectState;
  let key = '';
  for (const name of sortedKeys(fields)) {
    const value = fields[name];
    if (name === 'target' || name === 'effectOrder' || typeof value === 'function') continue;
    // The end of the turn sets clocks of volatiles, field and side conditions to lasting; the rest read as they stand.
    if (consumer === 'residual' && name === 'duration') {
      if (keepClock) key += `${name}=${valueKey(value)};`;
      continue;
    }
    if (name === 'id' || reads.has(name)) key += `${name}=${valueKey(value)};`;
  }
  return key;
}

function statesKey(states: unknown, reads: ReadSet, consumer: Consumer, keepClock: boolean): string {
  if (!states || typeof states !== 'object') return '';
  const byId = states as Record<string, unknown>;
  let key = '';
  for (const id of sortedKeys(byId)) key += `${key ? ',' : ''}${id}{${stateKey(byId[id], reads, consumer, keepClock)}}`;
  return key;
}

const DAMAGE_STAGES = ['atk', 'def', 'spa', 'spd'];

function stagesKey(stages: unknown, reads: ReadSet): string {
  const all = stages as Record<string, number>;
  let key = '';
  for (const stat of sortedKeys(all)) {
    if (DAMAGE_STAGES.includes(stat) || reads.has('boosts')) key += `${key ? '/' : ''}${stat}${all[stat]}`;
  }
  return key;
}

// Every Dex reader of `activeTurns` (Stakeout, Speed Boost, Truant, Taunt) asks only "this turn" or "past the first";
// test/board-key-predicate.spec.ts plays every reader at 1, 4 and 17.
const PREDICATES: Record<string, (value: unknown) => string> = {
  activeTurns: value => (typeof value === 'number' && value > 0 ? '1' : valueKey(value)),
};

type Kind = 'plain' | 'stages' | 'predicate' | 'effect' | 'none';
interface Step { name: string; kind: Kind; prefix: string }

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

interface Shape {
  names: readonly string[];
  sorted: readonly string[];
  classes: (readonly FieldClass[] | undefined)[];
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

function partOf(owner: Owner, step: Step, value: unknown, reads: ReadSet, consumer: Consumer): string {
  switch (step.kind) {
    case 'plain': return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? step.prefix + value : step.prefix + valueKey(value);
    case 'stages': return `${step.prefix}${stagesKey(value, reads)}`;
    case 'predicate': return `${step.prefix}${PREDICATES[step.name](value)}`;
    case 'effect': return `${step.prefix}${effectsOf(owner, step.name, value, reads, consumer)}`;
    default: return '';
  }
}

function effectsOf(owner: Owner, name: string, value: unknown, reads: ReadSet, consumer: Consumer): string {
  if (name === 'volatiles' || name === 'sideConditions' || name === 'pseudoWeather') return statesKey(value, reads, consumer, false);
  if (name === 'slotConditions') return (value as unknown[]).map(slot => statesKey(slot, reads, consumer, true)).join('|');
  if (name === 'weatherState' || name === 'terrainState') return stateKey(value, reads, consumer, false);
  return stateKey(value, reads, consumer, owner === 'pokemon');
}

type Join = 'after' | 'between' | 'before';

// A game mod puts methods on the instance: they follow the format, which the key carries, so functions stay out.
function partsText(object: unknown, owner: Owner, reads: ReadSet, consumer: Consumer, join: Join, withHp = false, keepEmpty = false): string {
  const own = object as Record<string, unknown>;
  const steps = stepsOf(own, owner, reads, consumer, withHp, keepEmpty);
  let text = '';
  let first = true;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const value = own[step.name];
    if (typeof value === 'function') continue;
    const part = partOf(owner, step, value, reads, consumer);
    if (!part && !keepEmpty) continue;
    if (join === 'after') text += `${part}~`;
    else if (join === 'before') text += `|${part}`;
    else { text += first ? part : `~${part}`; first = false; }
  }
  return text;
}

/** `withHp` keys the HP too: a benched body's HP is set by no copy. */
export function bodyStateKey(pokemon: Pokemon, reads: ReadSet, consumer: Consumer, withHp = false): string {
  // A left-out field adds no separator: a body that grew an own field no rule reads keeps its key.
  return partsText(pokemon, 'pokemon', reads, consumer, 'after', withHp);
}

export function boardStateKey(battle: Battle, reads: ReadSet, consumer: Consumer): string {
  let key = battle.format.id + partsText(battle.field, 'field', reads, consumer, 'before', false, true);
  for (const side of battle.sides) key += `|${partsText(side, 'side', reads, consumer, 'between')}`;
  return `${key}|${partsText(battle, 'battle', reads, consumer, 'between')}`;
}

const bodyTokens = (pokemon: Pokemon): string => `a${pokemon.ability}|i${pokemon.item}|c${pokemon.status}|${Object.keys(pokemon.volatiles).map(id => `c${id}`).join('|')}`;

function boardTokens(battle: Battle): string {
  const { field } = battle;
  const ids = [field.weather, field.terrain, ...Object.keys(field.pseudoWeather)];
  for (const side of battle.sides) ids.push(...Object.keys(side.sideConditions), ...side.slotConditions.flatMap(slot => Object.keys(slot)));
  return ids.map(id => `c${id}`).join('|');
}

function entriesOf(dex: Battle['dex'], tokens: string): object[] {
  const entries: object[] = [];
  for (const token of tokens.split('|')) {
    if (!token) continue;
    const id = token.slice(1) as never;
    entries.push(token[0] === 'a' ? dex.abilities.getByID(id) : token[0] === 'i' ? dex.items.getByID(id) : token[0] === 'm' ? dex.moves.getByID(id) : dex.conditions.get(id));
  }
  return entries;
}

// Handlers do not change within a process, so boards of one composition share one ReadSet that nothing may mutate.
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

/** The reads of everything on a board for a consumer, scanned on first ask; `extra` names bodies off the field. */
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

export function boardReads(battle: Battle, consumer: Consumer, moveId?: string): ReadSet {
  return readsFactory(battle, consumer)([], moveId);
}
