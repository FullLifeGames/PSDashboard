import type { Battle } from '@pkmn/sim';
import { dieKey, type SecondaryEntry } from './types.ts';

// The watch wraps hooks and script calls as own properties and changes nothing (docs/adr/0002); uninstall() undoes it.
// No `battle.onEvent` listeners: they join the speed sort and can draw a tie shuffle.

export interface ArmedHook {
  kind: 'accuracy' | 'crit';
  /** The slot of the hook's target (accuracy only). */
  targetSlot?: string;
}

/** The entries `ModifySecondaries` returned for one target, one per `random(100)` draw (Gens 3 and up). */
export interface SecondaryQueue {
  targetSlot: string | undefined;
  entries: readonly SecondaryEntry[];
  next: number;
}

export interface MoveSight {
  secondaries: number;
  stripped: boolean;
  removedFor: string[];
}

/** The allies a handler asked for with `adjacentAllies()`: the first draw names the first, the next draw the next. */
export interface AllyList {
  holder: unknown;
  effectId: string | undefined;
  allies: readonly { getSlot(): string; status: string }[];
  pending: readonly { getSlot(): string }[] | null;
  used: number;
}

export interface BattleWatch {
  readonly battle: Battle;
  aim: { slot: string; moveId: string } | null;
  /** The target the last `getRandomTarget` call of each random-target die key read from its move, drawn or not. */
  readonly aimed: Map<string, string>;
  dragged: { slot: string } | null;
  allies: AllyList | null;
  readonly moves: Map<string, MoveSight>;
  secondaries: SecondaryQueue | null;
  /** The secondary entries of Gens 1 and 2 already named (the script draws without a hook). */
  readonly taken: WeakSet<object>;
  /** The last hook since the previous draw; the caller settles it after each draw. */
  armed: ArmedHook | null;
  readonly scopes: readonly string[];
  scope(): string | null;
  settle(): void;
  /** Puts every wrapped property back; idempotent. */
  uninstall(): void;
}

const ACTION_SCOPES = ['getDamage', 'tryMoveHit', 'hitStepMoveHitLoop', 'secondaries', 'selfDrops'] as const;

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
interface Holder { getSlot?: () => string }
const slotOf = (value: unknown): string | undefined =>
  typeof (value as Holder | null)?.getSlot === 'function' ? (value as { getSlot(): string }).getSlot() : undefined;

// A number the simulator passes for a typeless hit is ignored.
function sightOf(watch: BattleWatch, move: unknown): MoveSight {
  const holder = move as { id?: string } | number | null;
  const id = typeof holder === 'object' && holder?.id ? holder.id : '';
  let sight = watch.moves.get(id);
  if (!sight) watch.moves.set(id, sight = { secondaries: 0, stripped: false, removedFor: [] });
  return sight;
}

function noteSecondaries(watch: BattleWatch, args: unknown[], entries: SecondaryEntry[]): void {
  const targetSlot = slotOf(args[1]);
  watch.secondaries = { targetSlot, entries, next: 0 };
  const given = args[4] as unknown[] | undefined;
  if (targetSlot && given && entries.length < given.length) sightOf(watch, args[3]).removedFor.push(targetSlot);
}

function wrapProperty(undo: (() => void)[], owner: object, name: string, make: (original: AnyFn) => AnyFn): void {
  const original = (owner as Record<string, unknown>)[name];
  if (typeof original !== 'function') return;
  const had = Object.getOwnPropertyDescriptor(owner, name);
  const watched = make(original as AnyFn);
  // A copy that walks the own keys takes the wrapper along: on any object but the watched one it passes the call on.
  const wrapper: AnyFn = function (this: unknown, ...args: unknown[]) {
    return (this === owner ? watched : (original as AnyFn)).apply(this, args);
  };
  // A property the owner inherited stays hidden from key walks: a speed-layer copy carries no wrapper of this watch.
  Object.defineProperty(owner, name, { value: wrapper, enumerable: had?.enumerable ?? false, writable: true, configurable: true });
  undo.push(() => {
    if (had) Object.defineProperty(owner, name, had);
    else delete (owner as Record<string, unknown>)[name];
  });
}

export function watchBattle(battle: Battle): BattleWatch {
  const undo: (() => void)[] = [];
  const scopes: string[] = [];
  const watch: BattleWatch = {
    battle,
    aim: null,
    aimed: new Map<string, string>(),
    dragged: null,
    moves: new Map<string, MoveSight>(),
    secondaries: null,
    allies: null,
    taken: new WeakSet<object>(),
    armed: null,
    scopes,
    scope: () => scopes[scopes.length - 1] ?? null,
    settle() { watch.armed = null; },
    uninstall() {
      for (const restore of undo.splice(0).reverse()) restore();
    },
  };

  const wrap = (owner: object, name: string, make: (original: AnyFn) => AnyFn): void => wrapProperty(undo, owner, name, make);

  wrap(battle, 'runEvent', original => function (this: unknown, ...args: unknown[]) {
    const id = args[0];
    // A hook arms the next draw only if nothing ran between; Gen 2 runs ModifyAccuracy between its two Accuracy hooks.
    if (id !== 'Accuracy' && id !== 'ModifyAccuracy') watch.armed = null;
    const result = original.apply(this, args);
    if (id === 'Accuracy' && typeof result === 'number') watch.armed = { kind: 'accuracy', targetSlot: slotOf(args[1]) };
    else if (id === 'ModifyCritRatio') watch.armed = { kind: 'crit' };
    else if (id === 'ModifySecondaries' && Array.isArray(result)) noteSecondaries(watch, args, result as SecondaryEntry[]);
    return result;
  });

  const scoped = (name: string, note?: (args: unknown[]) => () => void) => (original: AnyFn): AnyFn => function (this: unknown, ...args: unknown[]) {
    if (name === 'getDamage' && typeof args[2] === 'object' && args[2]) {
      const move = args[2] as { secondaries?: unknown[]; hasSheerForce?: boolean };
      const sight = sightOf(watch, move);
      sight.secondaries = move.secondaries?.length ?? 0;
      sight.stripped = !!move.hasSheerForce;
    }
    scopes.push(name);
    watch.armed = null;
    const restore = note?.(args);
    try {
      return original.apply(this, args);
    } finally {
      restore?.();
      scopes.pop();
      if (name === 'secondaries') watch.secondaries = null;
    }
  };
  wrap(battle, 'randomizer', scoped('randomizer'));
  const actions = (battle as unknown as { actions: object }).actions;
  for (const name of ACTION_SCOPES) wrap(actions, name, scoped(name));
  watchPicks(watch, wrap, scoped, actions);
  watchAllies(watch, wrap);
  return watch;
}

const moveIdOf = (move: unknown): string => String(typeof move === 'string' ? move : (move as { id?: string } | null)?.id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Each wrapper puts back what it found, so a drag inside a drag's switch-in (Red Card) keeps its slot.
function watchPicks(
  watch: BattleWatch, wrap: (owner: object, name: string, make: (original: AnyFn) => AnyFn) => void,
  scoped: (name: string, note?: (args: unknown[]) => () => void) => (original: AnyFn) => AnyFn, actions: object,
): void {
  wrap(watch.battle, 'getRandomTarget', scoped('getRandomTarget', args => {
    const before = watch.aim;
    const slot = slotOf(args[0]);
    watch.aim = slot === undefined ? null : { slot, moveId: moveIdOf(args[1]) };
    if (watch.aim) watch.aimed.set(dieKey({ ...watch.aim, kind: 'random-target' }), String((args[1] as { target?: string } | null)?.target));
    return () => { watch.aim = before; };
  }));
  wrap(watch.battle, 'getRandomSwitchable', scoped('getRandomSwitchable'));
  wrap(actions, 'dragIn', original => function (this: unknown, ...args: unknown[]) {
    const before = watch.dragged;
    const side = args[0] as { active?: unknown[] } | undefined;
    const slot = slotOf(side?.active?.[args[1] as number]);
    watch.dragged = slot === undefined ? null : { slot };
    try {
      return original.apply(this, args);
    } finally {
      watch.dragged = before;
    }
  });
}

function watchAllies(watch: BattleWatch, wrap: (owner: object, name: string, make: (original: AnyFn) => AnyFn) => void): void {
  for (const body of watch.battle.sides.flatMap(side => side.pokemon)) {
    wrap(body, 'adjacentAllies', original => function (this: unknown, ...args: unknown[]) {
      const allies = original.apply(this, args) as AllyList['allies'];
      watch.allies = { holder: this, effectId: (watch.battle.effect as { id?: string } | undefined)?.id, allies, pending: null, used: 0 };
      return allies;
    });
  }
}
