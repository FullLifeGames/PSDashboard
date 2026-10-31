import type { Battle } from '@pkmn/sim';
import type { SecondaryEntry } from './types.ts';

/**
 * Round 82 (forced dice), decision D1: the watch. The simulator announces some dice by a hook right before the draw
 * (`Accuracy`, `ModifyCritRatio`) and hides the rest inside script calls (the damage roll inside `randomizer`, the Gen 1 crit
 * inside `getDamage`). The watch is a set of own-property wrappers on one battle that note both and change nothing: each
 * wrapper calls the saved original with the same arguments and returns its value. It lives for the natural copy's turn and
 * the real turn; `uninstall()` puts the saved property descriptors back, so the battle is the one it was (own keys, stable
 * serialization, the speed layer's pre-check). A battle under watch is never cloned (the clone walks own keys).
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

export interface BattleWatch {
  readonly battle: Battle;
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

export function watchBattle(battle: Battle): BattleWatch {
  const undo: (() => void)[] = [];
  const scopes: string[] = [];
  const watch: BattleWatch = {
    battle,
    moves: new Map<string, MoveSight>(),
    secondaries: null,
    taken: new WeakSet<object>(),
    armed: null,
    scopes,
    scope: () => scopes[scopes.length - 1] ?? null,
    settle() { watch.armed = null; },
    uninstall() {
      for (const restore of undo.splice(0).reverse()) restore();
    },
  };

  const wrap = (owner: object, name: string, make: (original: AnyFn) => AnyFn): void => {
    const original = (owner as Record<string, unknown>)[name];
    if (typeof original !== 'function') return;
    const had = Object.getOwnPropertyDescriptor(owner, name);
    (owner as Record<string, unknown>)[name] = make(original as AnyFn);
    undo.push(() => {
      if (had) Object.defineProperty(owner, name, had);
      else delete (owner as Record<string, unknown>)[name];
    });
  };

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

  const scoped = (name: string) => (original: AnyFn): AnyFn => function (this: unknown, ...args: unknown[]) {
    if (name === 'getDamage' && typeof args[2] === 'object' && args[2]) {
      const move = args[2] as { secondaries?: unknown[]; hasSheerForce?: boolean };
      const sight = sightOf(watch, move);
      sight.secondaries = move.secondaries?.length ?? 0;
      sight.stripped = !!move.hasSheerForce;
    }
    scopes.push(name);
    watch.armed = null;
    try {
      return original.apply(this, args);
    } finally {
      scopes.pop();
      if (name === 'secondaries') watch.secondaries = null;
    }
  };
  wrap(battle, 'randomizer', scoped('randomizer'));
  const actions = (battle as unknown as { actions: object }).actions;
  for (const name of ACTION_SCOPES) wrap(actions, name, scoped(name));
  return watch;
}
