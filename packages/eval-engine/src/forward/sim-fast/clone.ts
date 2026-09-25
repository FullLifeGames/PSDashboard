/**
 * Round 59 (T91), lever clone: a Battle -> Battle copy for @pkmn/sim 0.10.11,
 * no JSON and no constructor. Phase one allocates a shell for the battle,
 * the field, every side and every Pokemon; phase two fills each shell field
 * by field and remaps back-references through the shells.
 *
 * Value rules: primitives and functions shared; Battle, Field, Side and
 * Pokemon remapped (Pokemon by side.n and position, as the sim's own
 * toRef/fromRef); ActiveMoves copied at the top level with references
 * remapped (queued actions and battle.activeMove deep); plain objects and
 * arrays copied per site; Sets copied; dex data of the classes on the
 * positive list shared; any other class throws, and the caller falls back.
 */
import { PRNG, type Battle } from '@pkmn/sim';
import {
  BATTLE_SPECIAL, FIELD_SPECIAL, POKEMON_SPECIAL, SIDE_SPECIAL, closuresFor, copyActiveMoveFast, forgetClosures, planFor,
  type Ctx, type Obj, type Plan,
} from './clone-plan.ts';

export interface CloneOptions {
  /** Test mode: keep log, input and message history and clone the PRNG (a copy equal to its source). */
  history?: boolean;
}

interface SideSource extends Obj { n: number; pokemon: Obj[] }
interface Source extends Obj {
  dex: Obj;
  format: object;
  ruleTable: object;
  field: Obj;
  sides: SideSource[];
  queue: Obj & { list: unknown };
  actions: Obj;
  activeMove: unknown;
  prng: PRNG;
  log: string[];
  inputLog: string[];
  messageLog: string[];
}
interface Getter { get(name: string): object }
interface DexView { species: Getter; abilities: Getter; items: Getter; conditions: Getter; moves: Getter }

const ObjProto = Object.prototype;
const SetProto = Set.prototype;
const hasOwn = Object.prototype.hasOwnProperty;
const sharedByDex = new WeakMap<object, ReadonlySet<object>>();
let closuresChecked = false;

/** The positive list: dex data a copy shares, read off the battle's own dex (never by class name). */
export function sharedClasses(battle: Battle): ReadonlySet<object> {
  const src = battle as unknown as Source;
  let shared = sharedByDex.get(src.dex);
  if (!shared) {
    const dex = src.dex as unknown as DexView;
    const samples = [src.dex, src.format, src.ruleTable, dex.species.get('Pikachu'), dex.abilities.get('Pressure'),
      dex.items.get('Leftovers'), dex.conditions.get('brn'), dex.moves.get('Tackle')];
    shared = new Set(samples.map(sample => Object.getPrototypeOf(sample) as object));
    sharedByDex.set(src.dex, shared);
  }
  return shared;
}

const isActiveMove = (value: Obj): boolean =>
  hasOwn.call(value, 'hit') && (hasOwn.call(value, 'id') || hasOwn.call(value, 'move'));
const className = (proto: object | null): string =>
  (proto as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'null';

function copyPlain(value: Obj, x: Ctx): Obj {
  for (const key in value) {
    const entry = value[key];
    if (typeof entry === 'object' && entry !== null) value[key] = copyValue(entry, x);
  }
  return value;
}

function copyArray(value: unknown[], x: Ctx): unknown[] {
  const out = value.slice();
  for (let i = 0; i < out.length; i++) {
    const entry = out[i];
    if (typeof entry === 'object' && entry !== null) out[i] = copyValue(entry, x);
  }
  return out;
}

/** Top-level ActiveMove copy: nested plain data shared, arrays, references and sets through the rules. */
const shallowValue = (value: unknown, x: Ctx): unknown =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) !== ObjProto ? copyValue(value, x) : value;

function copyClassed(value: Obj, proto: object | null, x: Ctx): unknown {
  const kinds = x.kinds;
  if (proto === kinds.pokemon) return x.mons[(value.side as Obj).n as number][value.position as number];
  if (proto === kinds.side) return x.sides[value.n as number];
  if (proto === kinds.battle) return x.battle;
  if (proto === kinds.field) return x.field;
  if (proto === SetProto) return new Set(value as unknown as Set<unknown>);
  if (proto !== null && isActiveMove(value)) {
    return x.deep ? copyPlain(Object.assign(Object.create(proto) as Obj, value), x) : copyActiveMoveFast(value, proto, x, shallowValue);
  }
  if (proto !== null && x.shared.has(proto)) return value;
  throw new Error(`sim-fast clone: no rule for class ${className(proto)}`);
}

export function copyValue(value: unknown, x: Ctx): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return copyArray(value, x);
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto === ObjProto) return copyPlain({ ...(value as Obj) }, x);
  return copyClassed(value as Obj, proto, x);
}

interface Plans { battle: Plan; field: Plan; sides: Plan[]; mons: Plan[][] }

function allocate(src: Source, x: Ctx): Plans {
  const battle = planFor('battle', src, x.kinds.battle, BATTLE_SPECIAL);
  x.battle = new battle.Shell();
  const field = planFor('field', src.field, x.kinds.field, FIELD_SPECIAL);
  x.field = new field.Shell();
  const sides: Plan[] = [];
  const mons: Plan[][] = [];
  for (const side of src.sides) {
    const sidePlan = planFor('side', side, x.kinds.side, SIDE_SPECIAL);
    sides.push(sidePlan);
    x.sides.push(new sidePlan.Shell());
    const monPlans: Plan[] = [];
    const shells: Obj[] = [];
    for (const pokemon of side.pokemon) {
      const plan = planFor('pokemon', pokemon, x.kinds.pokemon, POKEMON_SPECIAL);
      monPlans.push(plan);
      shells.push(new plan.Shell());
    }
    mons.push(monPlans);
    x.mons.push(shells);
  }
  return { battle, field, sides, mons };
}

/** Move slots keep their identity: a base slot that is a move slot stays the same object. */
function moveSlotsInto(parts: unknown[], pokemon: Obj, x: Ctx): void {
  const slots = pokemon.moveSlots as unknown[];
  const base = pokemon.baseMoveSlots as unknown[];
  const copies = new Array<unknown>(slots.length);
  for (let i = 0; i < slots.length; i++) copies[i] = copyValue(slots[i], x);
  const baseCopies = new Array<unknown>(base.length);
  for (let j = 0; j < base.length; j++) {
    const slot = base[j];
    const k = j < slots.length && slots[j] === slot ? j : slots.indexOf(slot);
    baseCopies[j] = k >= 0 ? copies[k] : copyValue(slot, x);
  }
  parts[2] = copies;
  parts[3] = baseCopies;
}

function fillSides(src: Source, x: Ctx, plans: Plans): void {
  for (let i = 0; i < src.sides.length; i++) {
    const side = src.sides[i];
    for (let j = 0; j < side.pokemon.length; j++) {
      const copy = x.mons[i][j];
      const parts = closuresFor(copy, side.pokemon[j]);
      moveSlotsInto(parts, side.pokemon[j], x);
      plans.mons[i][j].fill(copy, side.pokemon[j], x, copyValue, parts);
    }
    plans.sides[i].fill(x.sides[i], side, x, copyValue, null);
  }
}

function shellOf(proto: object): Obj {
  return Object.create(proto) as Obj;
}

/** Queue, actions and the move in flight (deep), PRNG and history for the battle's filler. */
function battleParts(src: Source, x: Ctx, history: boolean): Obj {
  x.deep = true;
  const queue = shellOf(Object.getPrototypeOf(src.queue) as object);
  for (const key of Object.keys(src.queue)) {
    queue[key] = key === 'battle' ? x.battle : key === 'list' ? copyValue(src.queue.list, x) : src.queue[key];
  }
  const activeMove = copyValue(src.activeMove, x);
  x.deep = false;
  const actions = shellOf(Object.getPrototypeOf(src.actions) as object);
  for (const key of Object.keys(src.actions)) actions[key] = key === 'battle' ? x.battle : src.actions[key];
  return {
    queue, actions, activeMove,
    prng: history ? new PRNG(src.prng.getSeed(), src.prng.startingSeed) : null,
    log: history ? src.log.slice() : [],
    inputLog: history ? src.inputLog.slice() : [],
    messageLog: history ? src.messageLog.slice() : [],
  };
}

/** First copy per process: the rebuilt closures answer as the originals do (spec, decision 3). */
function checkClosures(src: Source, x: Ctx): void {
  if (closuresChecked) return;
  for (let i = 0; i < src.sides.length; i++) {
    src.sides[i].pokemon.forEach((original, j) => {
      const copy = x.mons[i][j];
      for (const name of ['getHealth', 'getFullDetails']) {
        const mine = JSON.stringify((copy[name] as () => unknown).call(copy));
        const theirs = JSON.stringify((original[name] as () => unknown).call(original));
        if (mine !== theirs) throw new Error(`sim-fast clone: the rebuilt ${name} answers differently`);
      }
    });
  }
  closuresChecked = true;
}

export function cloneBattle(source: Battle, options: CloneOptions = {}): Battle {
  const src = source as unknown as Source;
  const firstSide = src.sides[0];
  const x: Ctx = {
    battle: {}, field: {}, sides: [], mons: [], deep: false,
    kinds: {
      battle: Object.getPrototypeOf(src) as object, field: Object.getPrototypeOf(src.field) as object,
      side: Object.getPrototypeOf(firstSide) as object, pokemon: Object.getPrototypeOf(firstSide.pokemon[0]) as object,
    },
    shared: sharedClasses(source),
  };
  const plans = allocate(src, x);
  fillSides(src, x, plans);
  plans.field.fill(x.field, src.field, x, copyValue, null);
  plans.battle.fill(x.battle, src, x, copyValue, battleParts(src, x, options.history === true));
  if (options.history !== true) {
    x.battle.sentLogPos = 0;
    x.battle.lastMoveLine = -1;
  }
  checkClosures(src, x);
  return x.battle as unknown as Battle;
}

/** Test hook: forget the compiled closures and their check (a spec compiles its own). */
export function resetClosuresForTests(): void {
  forgetClosures();
  closuresChecked = false;
}
