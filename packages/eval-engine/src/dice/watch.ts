import type { Battle } from '@pkmn/sim';
import type { SecondaryEntry } from './types.ts';

/**
 * The watch: own-property wrappers on one battle that note the dice the simulator announces by a hook (`Accuracy`, `ModifyCritRatio`) or
 * hides in script calls (the damage roll in `randomizer`, the Gen 1 crit in `getDamage`) and change nothing (docs/adr/0002).
 * `uninstall()` restores the property descriptors. A wrapper keeps the enumerability of the property it replaces and, called on any
 * object but the watched battle, only passes the call on: a copy of a battle under watch notes nothing into it, which the tree's
 * scripted PRNGs rely on. Not `battle.onEvent` listeners (they join the speed sort and can draw a tie shuffle) and not
 * `forceRandomChance` (it shifts later draws).
 */

/** The hook that ran right before the next draw. */
export interface ArmedHook {
  kind: 'accuracy' | 'crit';
  /** The slot of the hook's target (accuracy only). */
  targetSlot?: string;
}

/**
 * The entries `ModifySecondaries` returned for one target, one per `random(100)` draw of the `secondaries` call (Gens 3 and up);
 * it stands apart from the armed hook because a nested hit runs hooks between two draws.
 */
export interface SecondaryQueue {
  targetSlot: string | undefined;
  entries: readonly SecondaryEntry[];
  next: number;
}

/**
 * What the watch saw of a move at the damage step and in `ModifySecondaries`: the entries it still carried (an ability can strip
 * them), `hasSheerForce`, and the slots whose entries a hook removed.
 */
export interface MoveSight {
  secondaries: number;
  stripped: boolean;
  removedFor: string[];
}

/** The allies a handler asked for with `adjacentAllies()` (Healer draws once per ally with a status); the first draw names the first such ally, the next draw the next. */
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
  /** The user and the move id `getRandomTarget` in flight was called with, or null. */
  aim: { slot: string; moveId: string } | null;
  /** The slot the `dragIn` in flight drags a body out of, or null. */
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
  readonly scopes: readonly string[];
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

/** The sight of a move object; a number the simulator passes for a typeless hit is ignored. */
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

function wrapProperty(undo: (() => void)[], owner: object, name: string, make: (original: AnyFn) => AnyFn): void {
  const original = (owner as Record<string, unknown>)[name];
  if (typeof original !== 'function') return;
  const had = Object.getOwnPropertyDescriptor(owner, name);
  const watched = make(original as AnyFn);
  // A copy of a watched battle that walks the own keys takes the wrapper of an own property along (the mods override some script
  // calls as own properties). Called on any object but the watched one, the wrapper only passes the call on.
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
 * The two calls that sample a body keep their arguments for the draw: `getRandomTarget(user, move)` runs before the move is in flight;
 * `dragIn(side, position)` hands the bench to `getRandomSwitchable`, whose call is the scope of the draw (a draw in the switch-in that
 * follows is not the drag's). Each wrapper puts back what it found, so a drag inside a drag's switch-in (Red Card) keeps its slot.
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
