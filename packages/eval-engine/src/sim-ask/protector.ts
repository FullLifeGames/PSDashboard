import type { ActiveMove, Battle, Move as DexMove, Pokemon } from '@pkmn/sim';
import { shieldsFromHits, shieldsSide } from '../dex-facts/protect.ts';
import { askCheckOn, AskLeak, guarded } from './guard.ts';
import { callHandler } from './handler.ts';
import { bodyInView, isolated } from './isolated.ts';

type HitHandler = (this: unknown, target: unknown, source: unknown, move: unknown) => unknown;

const stopsAsked = new WeakMap<Pokemon, WeakMap<Pokemon, Map<string, boolean>>>();

// Shared by every board where `findEventHandlers(source, 'HitProtect', target)` finds none: the Protect family only
// reads the attack. A board with one (Unseen Fist in Champions, Piercing Drill) asks on its own bodies.
const sharedStops = new WeakMap<object, Map<string, boolean>>();

const freshAttacks = new WeakMap<object, Map<string, { move: ActiveMove; size: number }>>();

const hitProtectFree = new WeakMap<Pokemon, WeakMap<Pokemon, boolean>>();

const sameData = (one: unknown, other: unknown): boolean => {
  if (one === other) return true;
  if (typeof one !== 'object' || typeof other !== 'object' || one === null || other === null) return false;
  const keys = Object.keys(one);
  return keys.length === Object.keys(other).length && keys.every(key => sameData((one as Record<string, unknown>)[key], (other as Record<string, unknown>)[key]));
};

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

function sharedOf(dex: object): Map<string, boolean> {
  let held = sharedStops.get(dex);
  if (!held) sharedStops.set(dex, held = new Map());
  return held;
}

function askedOn(source: Pokemon, target: Pokemon): Map<string, boolean> {
  let bySource = stopsAsked.get(target);
  if (!bySource) stopsAsked.set(target, bySource = new WeakMap());
  let held = bySource.get(source);
  if (!held) bySource.set(source, held = new Map());
  return held;
}

const sharesAnswers = (battle: Battle, protector: DexMove, source: Pokemon, target: Pokemon): boolean =>
  (shieldsFromHits(battle.dex, protector) || shieldsSide(battle.dex, protector)) && freeOfHitProtect(battle, source, target);

function askBoard(battle: Battle, protector: DexMove, handler: HitHandler, attack: ActiveMove, source: Pokemon, target: Pokemon): boolean {
  const view = isolated(battle);
  const answered = guarded(battle, [protector, attack], () =>
    callHandler(handler, view, [bodyInView(view, target), bodyInView(view, source), isolated(attack)]));
  return answered.ok && answered.value !== undefined;
}

/** Whether the protector's onTryHit stops `attack` from `source`; runs on views, so nothing reaches the live battle. */
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
