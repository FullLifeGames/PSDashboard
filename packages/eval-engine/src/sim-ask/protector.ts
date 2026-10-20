import type { ActiveMove, Battle, Move as DexMove, Pokemon } from '@pkmn/sim';
import { shieldsFromHits, shieldsSide } from '../dex-facts/protect.ts';
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
 * Round 72 (T256, step 7d): the answers every board shares, per Dex. The handlers of the Protect family (shieldsFromHits and
 * shieldsSide of dex-facts/protect.ts) read the attack (its flags, target, category, priority, Z and Max power) and ask the
 * simulator whether a HitProtect handler of the field lets the hit through (`checkMoveBypassesProtect`); what they do to the
 * bodies (the punishments of King's Shield and its kin, the lockedmove counter) is a write and never changes the return. So the
 * answer for a protector and an attack is the same on every board where `findEventHandlers(source, 'HitProtect', target)` finds
 * no handler, which is the call `runEvent` makes. A board with such a handler (Unseen Fist in the Champions mod, Piercing Drill)
 * keeps the question on its own bodies. A first ask on views costs about 60 us, and a search asks fresh bodies every position.
 * test/protector-memo.spec.ts plays every protector against boards that differ in everything else a handler could read.
 */
const sharedStops = new WeakMap<object, Map<string, boolean>>();

/** A fresh active move per Dex and id, and its number of properties: what a plain attack looks like. */
const freshAttacks = new WeakMap<object, Map<string, { move: ActiveMove; size: number }>>();

/** The HitProtect handlers found per attacker and defender of a reader battle: whether there are none. */
const hitProtectFree = new WeakMap<Pokemon, WeakMap<Pokemon, boolean>>();

const sameData = (one: unknown, other: unknown): boolean => {
  if (one === other) return true;
  if (typeof one !== 'object' || typeof other !== 'object' || one === null || other === null) return false;
  const keys = Object.keys(one);
  return keys.length === Object.keys(other).length && keys.every(key => sameData((one as Record<string, unknown>)[key], (other as Record<string, unknown>)[key]));
};

/**
 * The attack is what the Dex hands out for its id, apart from its target at use: no property a caller edited, so its id and
 * target name it. An edited attack (a priority, a flag, a category) is asked on its own bodies.
 */
function isPlainAttack(dex: Battle['dex'], attack: ActiveMove): boolean {
  let byId = freshAttacks.get(dex);
  if (!byId) freshAttacks.set(dex, byId = new Map());
  let fresh = byId.get(attack.id);
  if (!fresh) {
    const move = dex.getActiveMove(attack.id);
    byId.set(attack.id, fresh = { move, size: Object.keys(move).length });
  }
  const keys = Object.keys(attack);
  if (keys.length !== fresh.size) return false;
  const reference = fresh.move as unknown as Record<string, unknown>;
  const held = attack as unknown as Record<string, unknown>;
  return keys.every(key => key === 'target' || sameData(held[key], reference[key]));
}

/** No HitProtect handler reaches this hit: the simulator's own discovery, asked once per attacker and defender of the battle. */
function freeOfHitProtect(battle: Battle, source: Pokemon, target: Pokemon): boolean {
  let byTarget = hitProtectFree.get(source);
  if (!byTarget) hitProtectFree.set(source, byTarget = new WeakMap());
  const read = () => battle.findEventHandlers(source, 'HitProtect', target).length === 0;
  const known = byTarget.get(target);
  if (known === undefined) {
    const free = read();
    byTarget.set(target, free);
    return free;
  }
  if (askCheckOn() && read() !== known) throw new AskLeak('a battle changed after its HitProtect handlers were asked');
  return known;
}

/** The answers every board shares, of one Dex. */
function sharedOf(dex: object): Map<string, boolean> {
  let held = sharedStops.get(dex);
  if (!held) sharedStops.set(dex, held = new Map());
  return held;
}

/** The answers asked on this attacker and defender of a reader battle. */
function askedOn(source: Pokemon, target: Pokemon): Map<string, boolean> {
  let bySource = stopsAsked.get(target);
  if (!bySource) stopsAsked.set(target, bySource = new WeakMap());
  let held = bySource.get(source);
  if (!held) bySource.set(source, held = new Map());
  return held;
}

/** Whether the answer for this protector and attack is the same on every board of the Dex that has no HitProtect handler reaching the hit. */
const sharesAnswers = (battle: Battle, protector: DexMove, source: Pokemon, target: Pokemon): boolean =>
  (shieldsFromHits(battle.dex, protector) || shieldsSide(battle.dex, protector)) && freeOfHitProtect(battle, source, target);

/** The handler on copy-on-write views of the battle, both bodies and the attack. A handler that needs more than the views offer stops nothing. */
function askBoard(battle: Battle, protector: DexMove, handler: HitHandler, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const view = isolated(battle);
  const answered = guarded(battle, [protector, attack], () =>
    callHandler(handler, view, [bodyInView(view, target), bodyInView(view, source), isolated(attack)]));
  return answered.ok && answered.value !== undefined;
}

/**
 * Whether the protector's condition stops `attack` from `source` on `target`: the simulator's own onTryHit, run through
 * `callHandler` on copy-on-write views of the battle, both bodies and the attack, so it writes nothing the live battle can see,
 * whatever it does to them. The protector sets a side condition (Wide Guard) or a volatile on its user (Protect and its kin, gate of
 * 13.10. 20:26, 3a). The handler returns nothing for a hit it lets through and the simulator's NOT_FAIL for a hit it stops. A handler
 * that needs more than the views offer stops nothing. The caller sets the attack's target at use. The shields that punish a contact
 * hit (King's Shield, Obstruct, Silk Trap, Baneful Bunker, Burning Bulwark, Spiky Shield) do it in this same handler; on the views the
 * punishment lands in the views (test/protect-ask.spec.ts plays every protector of the Dex against every class of attack). The reader
 * battle of a position is never mutated and an option list asks the same hit once per option: one answer per body pair, protector
 * and attack, and for the Protect family one answer per Dex where no HitProtect handler reaches the hit (`sharedStops`). With the
 * development check on, a hit is asked again, so a caller that mutated the battle after its first question, or a shared answer
 * a board contradicts, fails loudly.
 */
export function protectorStops(battle: Battle, protector: DexMove, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const condition = protector.sideCondition || protector.volatileStatus;
  const handler = condition ? (battle.dex.conditions.get(condition) as { onTryHit?: unknown }).onTryHit : undefined;
  if (typeof handler !== 'function') return false;
  if (!isPlainAttack(battle.dex, attack)) return askBoard(battle, protector, handler as HitHandler, attack, source, target);
  const key = `${protector.id}|${attack.id}|${attack.target}`;
  const check = askCheckOn();
  const shares = sharesAnswers(battle, protector, source, target);
  const everywhere = sharedOf(battle.dex);
  const shared = shares ? everywhere.get(key) : undefined;
  if (shared !== undefined && !check) return shared;
  const asked = askedOn(source, target);
  const known = asked.get(key);
  if (known !== undefined && !check) return known;
  const answer = askBoard(battle, protector, handler as HitHandler, attack, source, target);
  if ([known, shared].some(held => held !== undefined && held !== answer)) throw new AskLeak();
  asked.set(key, answer);
  if (shares) everywhere.set(key, answer);
  return answer;
}
