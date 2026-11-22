import type { Battle } from '@pkmn/sim';
import type { SecondaryEntry } from './types.ts';

/**
 * Round 82 (forced dice), decision D1: the watch. The simulator announces some dice by a hook right before the draw
 * (`Accuracy`, `ModifyCritRatio`) and hides the rest inside script calls (the damage roll inside `randomizer`, the Gen 1 crit
 * inside `getDamage`). The watch is a set of own-property wrappers on one battle that note both and change nothing: each
 * wrapper calls the saved original with the same arguments and returns its value. It lives for the natural copy's turn and
 * the real turn; `uninstall()` puts the saved property descriptors back, so the battle is the one it was (own keys, stable
 * serialization, the speed layer's pre-check). Round 86 (T299): a wrapper keeps the enumerability of the property it replaces,
 * so an inherited script call stays hidden from key walks, and called on any object but the watched battle it only passes
 * the call on; a copy of a battle under watch (a forced switch's snapshot) therefore notes nothing into this watch, and the
 * tree's scripted PRNGs rely on that.
 *
 * Not `battle.onEvent` listeners: a listener joins the speed sort and can draw a tie shuffle of its own, and not
 * `forceRandomChance`: it shifts later draws (docs/adr/0002).
 */

/** The hook that ran right before the next draw. */
export interface ArmedHook {
  kind: 'accuracy' | 'crit';
  /** The slot of the hook's target (accuracy only). */
  targetSlot?: string;
}

/**
 * The entries `ModifySecondaries` returned for one target, handed out one per `random(100)` draw of the `secondaries` call
 * (Gens 3 and up). A nested hit (the effect itself) can run its own hooks between two draws, so the queue stands apart from
 * the armed hook; the watch drops it when the `secondaries` call ends.
 */
export interface SecondaryQueue {
  targetSlot: string | undefined;
  entries: readonly SecondaryEntry[];
  next: number;
}

/**
 * What the watch saw of a move at the damage step and in `ModifySecondaries`, for the report's reasons (a die that was never
 * drawn): how many secondary entries the move still carried when it dealt damage (an ability can strip them before), whether
 * the simulator marked it as stripped (`hasSheerForce`, a flag of the move), and the slots whose entries a hook removed.
 */
export interface MoveSight {
  secondaries: number;
  stripped: boolean;
  removedFor: string[];
}

/**
 * The allies a handler asked for with `adjacentAllies()` under the effect that was running (Healer loops over them and draws once
 * for each one that has a status). The end-of-turn die of such a handler is named by the ally it is about: the first draw takes the
 * first ally with a status, the next draw the next one.
 */
export interface AllyList {
  holder: unknown;
  effectId: string | undefined;
  allies: readonly { getSlot(): string; status: string }[];
  /** The allies with a status when the first draw came, in order. */
  pending: readonly { getSlot(): string }[] | null;
  used: number;
}

export interface BattleWatch {
  readonly battle: Battle;
  /** Round 89 (#137): the user and the move id `getRandomTarget` in flight was called with, or null. */
  aim: { slot: string; moveId: string } | null;
  /** Round 89 (#137): the slot the `dragIn` in flight drags a body out of, or null. */
  dragged: { slot: string } | null;
  /** The allies of the last `adjacentAllies()` call, or null. */
  allies: AllyList | null;
  /** One entry per move id that dealt damage or met the secondary hook in the watched turn. */
  readonly moves: Map<string, MoveSight>;
  /** The secondary entries still to be drawn for the target of the last `ModifySecondaries`, or null. */
  secondaries: SecondaryQueue | null;
  /** The secondary entries of Gens 1 and 2 already named (the script draws without a hook, one per entry in order). */
  readonly taken: WeakSet<object>;
  /** The last hook since the previous draw, or null. The caller settles it after each draw. */
  armed: ArmedHook | null;
  /** The wrapped script calls in flight, outermost first. */
  readonly scopes: readonly string[];
  /** The innermost wrapped script call, or null. */
  scope(): string | null;
  /** A draw happened: no hook stands armed for the next one. */
  settle(): void;
  /** Puts every wrapped property back. Idempotent. */
  uninstall(): void;
}

/** The script calls of the battle's actions that name a draw (p1-hooks.md, exceptions 1, 3 and 5): absent in a generation that lacks them. */
const ACTION_SCOPES = ['getDamage', 'tryMoveHit', 'hitStepMoveHitLoop', 'secondaries', 'selfDrops'] as const;

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
interface Holder { getSlot?: () => string }
const slotOf = (value: unknown): string | undefined =>
  typeof (value as Holder | null)?.getSlot === 'function' ? (value as { getSlot(): string }).getSlot() : undefined;

/** The sight of a move object (an active move, or a number the simulator passes for a typeless hit: ignored). */
function sightOf(watch: BattleWatch, move: unknown): MoveSight {
  const holder = move as { id?: string } | number | null;
  const id = typeof holder === 'object' && holder?.id ? holder.id : '';
  let sight = watch.moves.get(id);
  if (!sight) watch.moves.set(id, sight = { secondaries: 0, stripped: false, removedFor: [] });
  return sight;
}

/** `ModifySecondaries` ran: its entries wait for the draws, and a hook that returned fewer than it got is noted for the report. */
function noteSecondaries(watch: BattleWatch, args: unknown[], entries: SecondaryEntry[]): void {
  const targetSlot = slotOf(args[1]);
  watch.secondaries = { targetSlot, entries, next: 0 };
  const given = args[4] as unknown[] | undefined;
  if (targetSlot && given && entries.length < given.length) sightOf(watch, args[3]).removedFor.push(targetSlot);
}

/** Puts `make(original)` in the place of an owner's function property and notes how to put the property back. */
function wrapProperty(undo: (() => void)[], owner: object, name: string, make: (original: AnyFn) => AnyFn): void {
  const original = (owner as Record<string, unknown>)[name];
  if (typeof original !== 'function') return;
  const had = Object.getOwnPropertyDescriptor(owner, name);
  const watched = make(original as AnyFn);
  // Round 86 (T299): a copy of a watched battle that walks the own keys takes the wrapper of an own property along (the mods
  // override some script calls as own properties). Called on any object but the watched one, the wrapper only passes the call on.
  const wrapper: AnyFn = function (this: unknown, ...args: unknown[]) {
    return (this === owner ? watched : (original as AnyFn)).apply(this, args);
  };
  // A property the owner inherited stays hidden from key walks: a speed-layer copy then carries no wrapper of this watch.
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
    // A hook arms the next draw only when nothing else ran between the two. Gen 2 runs ModifyAccuracy between its two Accuracy hooks.
    if (id !== 'Accuracy' && id !== 'ModifyAccuracy') watch.armed = null;
    const result = original.apply(this, args);
    // An accuracy that is not a number (`true`: always hits) draws nothing.
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

/** The id of a move argument of the simulator: a name, a Dex move or an active move. */
const moveIdOf = (move: unknown): string => String(typeof move === 'string' ? move : (move as { id?: string } | null)?.id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Round 89 (#137): the two calls that sample a body keep their arguments for the draw. `getRandomTarget(user, move)` runs before the
 * move is in flight; `dragIn(side, position)` hands the bench to `getRandomSwitchable`, whose own call is the scope of the draw
 * (the switch-in that follows runs handlers of its own, and a draw there is not the drag's). Each wrapper puts back what it found,
 * so a drag inside a drag's switch-in (a Red Card holder coming in) keeps its own slot.
 */
function watchPicks(
  watch: BattleWatch, wrap: (owner: object, name: string, make: (original: AnyFn) => AnyFn) => void,
  scoped: (name: string, note?: (args: unknown[]) => () => void) => (original: AnyFn) => AnyFn, actions: object,
): void {
  wrap(watch.battle, 'getRandomTarget', scoped('getRandomTarget', args => {
    const before = watch.aim;
    const slot = slotOf(args[0]);
    watch.aim = slot === undefined ? null : { slot, moveId: moveIdOf(args[1]) };
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

/** A handler that looks at the holder's allies (Healer) draws once for each: the watch remembers what it was given and under which effect. */
function watchAllies(watch: BattleWatch, wrap: (owner: object, name: string, make: (original: AnyFn) => AnyFn) => void): void {
  for (const body of watch.battle.sides.flatMap(side => side.pokemon)) {
    wrap(body, 'adjacentAllies', original => function (this: unknown, ...args: unknown[]) {
      const allies = original.apply(this, args) as AllyList['allies'];
      watch.allies = { holder: this, effectId: (watch.battle.effect as { id?: string } | undefined)?.id, allies, pending: null, used: 0 };
      return allies;
    });
  }
}
