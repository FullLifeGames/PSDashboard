/**
 * Round 59 (T91), lever clone: the generated parts of the copy (round 58
 * prototype v2, docs/perf/probes/2026-09-24-r58/patch/clone.ts). One shell
 * constructor and one filler per own-key list keep every copy of one shape
 * in one hidden class with its fields in-object; the fast ActiveMove copier
 * does the same per move id. Pokemon's two per-instance arrow closures
 * (getHealth, getFullDetails) are rebuilt from the sim's own source and
 * bound to the copy.
 */

export type Obj = Record<string, unknown>;
export type CopyValue = (value: unknown, x: Ctx) => unknown;

/** What one copy works with: the new objects, the classes it recognizes, the ActiveMove mode. */
export interface Ctx {
  battle: Obj;
  field: Obj;
  sides: Obj[];
  mons: Obj[][];
  /** Queued actions and the move in flight copy deep; every other ActiveMove at the top level. */
  deep: boolean;
  kinds: { battle: object; field: object; side: object; pokemon: object };
  shared: ReadonlySet<object>;
}

type Filler = (d: Obj, s: Obj, x: Ctx, cv: CopyValue, h: unknown) => void;
export interface Plan { keys: string[]; Shell: new () => Obj; fill: Filler }
export type PlanTag = 'battle' | 'field' | 'side' | 'pokemon';

const quote = (key: string): string => JSON.stringify(key);
const plans: Record<PlanTag, Plan[]> = { battle: [], field: [], side: [], pokemon: [] };

/** Same own keys in the same order, compared without allocating. */
export function sameKeys(obj: Obj, keys: readonly string[]): boolean {
  let i = 0;
  for (const key in obj) {
    if (keys[i] !== key) return false;
    i++;
  }
  return i === keys.length;
}

/** Plan for the object's own key list; `special` maps a key to generated code. */
export function planFor(tag: PlanTag, obj: Obj, proto: object, special: Readonly<Record<string, string>>): Plan {
  const list = plans[tag];
  for (const plan of list) {
    if (sameKeys(obj, plan.keys)) return plan;
  }
  const keys = Object.keys(obj);
  const shell = new Function(keys.map(key => `this[${quote(key)}]=undefined;`).join('\n'));
  shell.prototype = proto;
  const body = keys.map(key => special[key] !== undefined
    ? `d[${quote(key)}]=${special[key]};`
    : `t=s[${quote(key)}]; d[${quote(key)}]=(typeof t==='object'&&t!==null)?cv(t,x):t;`).join('\n');
  const fill = new Function('d', 's', 'x', 'cv', 'h', `let t;\n${body}`) as Filler;
  const plan: Plan = { keys, Shell: shell as unknown as new () => Obj, fill };
  list.push(plan);
  return plan;
}

interface MovePlan { keys: string[]; Made: new (s: Obj, x: Ctx, sh: CopyValue) => Obj }
const movePlans = new Map<string, MovePlan[]>();

/** ActiveMove at the top level: every own key through `sh` (nested plain data stays shared). */
export function copyActiveMoveFast(move: Obj, proto: object, x: Ctx, sh: CopyValue): Obj {
  const id = String(move.id);
  let list = movePlans.get(id);
  if (!list) {
    list = [];
    movePlans.set(id, list);
  }
  for (const plan of list) {
    if (sameKeys(move, plan.keys)) return new plan.Made(move, x, sh);
  }
  const keys = Object.keys(move);
  const made = new Function('s', 'x', 'sh', keys.map(key => `this[${quote(key)}]=sh(s[${quote(key)}],x);`).join(''));
  made.prototype = proto;
  const plan: MovePlan = { keys, Made: made as unknown as MovePlan['Made'] };
  list.push(plan);
  return new plan.Made(move, x, sh);
}

export const POKEMON_SPECIAL: Readonly<Record<string, string>> = {
  getFullDetails: 'h[0]', getHealth: 'h[1]', moveSlots: 'h[2]', baseMoveSlots: 'h[3]',
  side: 'x.sides[s.side.n]', battle: 'x.battle', set: 's.set', baseSpecies: 's.baseSpecies', species: 's.species',
};
export const SIDE_SPECIAL: Readonly<Record<string, string>> = {
  battle: 'x.battle', team: 's.team', pokemon: 'x.mons[s.n]',
  foe: 's.foe ? x.sides[s.foe.n] : s.foe', allySide: 's.allySide ? x.sides[s.allySide.n] : s.allySide',
};
export const FIELD_SPECIAL: Readonly<Record<string, string>> = { battle: 'x.battle' };
export const BATTLE_SPECIAL: Readonly<Record<string, string>> = {
  field: 'x.field', sides: 'x.sides', queue: 'h.queue', actions: 'h.actions', prng: 'h.prng', log: 'h.log',
  inputLog: 'h.inputLog', messageLog: 'h.messageLog', dex: 's.dex', format: 's.format', ruleTable: 's.ruleTable',
  activeMove: 'h.activeMove',
};

type ClosureFactory = (this: Obj) => unknown[];
/** Any whitespace after `()`: the minified bundle prints `()=>{`. */
const CLOSURE_SHAPE = /^\(\)\s*=>/;
let closureFactory: ClosureFactory | null = null;

/** Rebuilds [getFullDetails, getHealth] from the source Pokemon's own closures. */
export function compileClosures(source: Obj): ClosureFactory {
  const details = String(source.getFullDetails);
  const health = String(source.getHealth);
  if (!CLOSURE_SHAPE.test(details) || !CLOSURE_SHAPE.test(health)) {
    throw new Error('sim-fast clone: the Pokemon closures changed shape');
  }
  return new Function(`return function () { return [${details}, ${health}]; };`)() as ClosureFactory;
}

/** [getFullDetails, getHealth] bound to `target`, compiled once per process. */
export function closuresFor(target: Obj, source: Obj): unknown[] {
  closureFactory ??= compileClosures(source);
  return closureFactory.call(target);
}

export function forgetClosures(): void {
  closureFactory = null;
}
