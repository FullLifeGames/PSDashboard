import type { Battle } from '@pkmn/sim';

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

export interface BattleWatch {
  readonly battle: Battle;
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

export function watchBattle(battle: Battle): BattleWatch {
  const undo: (() => void)[] = [];
  const scopes: string[] = [];
  const watch: BattleWatch = {
    battle,
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
    return result;
  });

  const scoped = (name: string) => (original: AnyFn): AnyFn => function (this: unknown, ...args: unknown[]) {
    scopes.push(name);
    watch.armed = null;
    try {
      return original.apply(this, args);
    } finally {
      scopes.pop();
    }
  };
  wrap(battle, 'randomizer', scoped('randomizer'));
  const actions = (battle as unknown as { actions: object }).actions;
  for (const name of ACTION_SCOPES) wrap(actions, name, scoped(name));
  return watch;
}
