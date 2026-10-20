import type { ActiveMove, Battle, Move as DexMove, Pokemon } from '@pkmn/sim';
import { askCheckOn, AskLeak, guarded } from './guard.ts';
import { callHandler } from './handler.ts';
import { bodyInView, isolated } from './isolated.ts';

/**
 * Round 70, round 72 (T239): whether a protector stops a hit, asked from the protector's own handler.
 */

type HitHandler = (this: unknown, target: unknown, source: unknown, move: unknown) => unknown;

/** The answers of `protectorStops` per target and source body of a reader battle: protector, attack and its target at use. */
const stopsAsked = new WeakMap<Pokemon, WeakMap<Pokemon, Map<string, boolean>>>();

/**
 * Whether the protector's condition stops `attack` from `source` on `target`: the simulator's own onTryHit, run through
 * `callHandler` on copy-on-write views of the battle, both bodies and the attack, so it writes nothing the live battle can see,
 * whatever it does to them. The protector sets a side condition (Wide Guard) or a volatile on its user (Protect and its kin, gate of
 * 13.10. 20:26, 3a). The handler returns nothing for a hit it lets through and the simulator's NOT_FAIL for a hit it stops. A handler
 * that needs more than the views offer stops nothing. The caller sets the attack's target at use. The shields that punish a contact
 * hit (King's Shield, Obstruct, Silk Trap, Baneful Bunker, Burning Bulwark, Spiky Shield) do it in this same handler; on the views the
 * punishment lands in the views (test/protect-ask.spec.ts plays every protector of the Dex against every class of attack). The reader
 * battle of a position is never mutated and an option list asks the same hit once per option: one answer per body pair, protector and
 * attack (a first ask on views costs about seven times the old stand-in). With the development check on, a hit is asked again, so a
 * caller that mutated the battle after its first question fails loudly.
 */
export function protectorStops(battle: Battle, protector: DexMove, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const condition = protector.sideCondition || protector.volatileStatus;
  const handler = condition ? (battle.dex.conditions.get(condition) as { onTryHit?: unknown }).onTryHit : undefined;
  if (typeof handler !== 'function') return false;
  let bySource = stopsAsked.get(target);
  if (!bySource) stopsAsked.set(target, bySource = new WeakMap());
  let asked = bySource.get(source);
  if (!asked) bySource.set(source, asked = new Map());
  const key = `${protector.id}|${attack.id}|${attack.target}|${Object.keys(attack.flags).join('+')}`;
  const known = asked.get(key);
  if (known !== undefined && !askCheckOn()) return known;
  const view = isolated(battle);
  const answered = guarded(battle, [protector, attack], () =>
    callHandler(handler as HitHandler, view, [bodyInView(view, target), bodyInView(view, source), isolated(attack)]));
  const answer = answered.ok && answered.value !== undefined;
  if (known !== undefined && known !== answer) throw new AskLeak();
  asked.set(key, answer);
  return answer;
}
