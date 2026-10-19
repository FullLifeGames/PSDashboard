import type { Battle } from '@pkmn/sim';
import { AskLeak, askCheckOn, fingerprint } from './guard.ts';

/**
 * Round 72 (T239): a copy-on-write view of a live object, for a stand-in that must hand a Dex handler a live body
 * without letting the handler write it. Reads fall through to the live object; every write (a property, an index, a
 * length, a delete, a nested object, an array) lands in an overlay of the view, so the handler sees its own writes and
 * the live object never changes. A Map, a Set, a Date or anything else with internal slots cannot be copied on write:
 * the view refuses it, and the first touch throws `NeedsMore`, which `callHandler` turns into the typed answer.
 * The battle's Dex is the exception: game data every copy shares, whose caches are Maps. It passes through, and the
 * development check fingerprints the Dex entries a question reads. Objects the handler creates are its own and pass
 * back unwrapped. The development check (guard.ts) fingerprints the live battle around every `callHandler` on a view.
 */

export class NeedsMore extends Error {
  constructor(what: string) {
    super(`a view cannot copy ${what} on write`);
    this.name = 'NeedsMore';
  }
}

/** The live battle behind a view, for the development check. */
const rootOf = new WeakMap<object, Battle>();

const REFUSED = new Set(['[object Map]', '[object Set]', '[object WeakMap]', '[object WeakSet]', '[object Date]', '[object RegExp]', '[object Promise]']);
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

const DELETED = Symbol('deleted');
type Key = string | symbol;

/** The refusal in place of a value that cannot be copied on write. */
function refusal(what: string): object {
  const fail = (): never => { throw new NeedsMore(what); };
  return new Proxy({}, { get: fail, set: fail, has: fail, deleteProperty: fail, ownKeys: fail, defineProperty: fail, getOwnPropertyDescriptor: fail });
}

/** What one view changed on one live object, and what of the live object still shows. */
class Overlay {
  readonly writes = new Map<Key, unknown>();
  readonly isArray: boolean;
  /** An array's length as the view sees it, and the length below which the live elements still show. */
  length: number;
  floor: number;

  readonly target: object;

  constructor(target: object) {
    this.target = target;
    this.isArray = Array.isArray(target);
    this.length = this.isArray ? (target as unknown[]).length : 0;
    this.floor = this.length;
  }

  private indexOf(key: Key): number {
    return this.isArray && typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
  }

  /** An array index the view has cut off or truncated away. */
  hidden(key: Key): boolean {
    const at = this.indexOf(key);
    return at >= 0 && (at >= this.length || (at >= this.floor && !this.writes.has(key)));
  }

  own(key: Key): boolean {
    if (this.writes.has(key)) return this.writes.get(key) !== DELETED;
    return !this.hidden(key) && Object.prototype.hasOwnProperty.call(this.target, key);
  }

  write(key: Key, value: unknown): boolean {
    if (this.isArray && key === 'length') {
      const next = Number(value);
      if (next < this.length) {
        for (const held of [...this.writes.keys()]) if (this.indexOf(held) >= next) this.writes.delete(held);
        this.floor = Math.min(this.floor, next);
      }
      this.length = next;
      return true;
    }
    this.writes.set(key, value);
    const at = this.indexOf(key);
    if (at >= this.length) this.length = at + 1;
    return true;
  }

  /** The live keys in their order, then the keys the view added. */
  keys(): Key[] {
    const keys = new Set<Key>();
    for (const key of Reflect.ownKeys(this.target)) if (!this.hidden(key) && this.writes.get(key) !== DELETED) keys.add(key);
    for (const [key, held] of this.writes) if (held !== DELETED) keys.add(key);
    if (this.isArray) keys.add('length');
    return [...keys];
  }
}

/** The proxy of one live object over its overlay; `wrap` hands nested objects the same treatment. */
function proxyOf(state: Overlay, wrap: (value: unknown) => unknown): object {
  const { target } = state;
  const view: object = new Proxy(state.isArray ? [] : {}, {
    get(_shadow, key, receiver) {
      if (state.isArray && key === 'length') return state.length;
      if (state.writes.has(key)) {
        const held = state.writes.get(key);
        return held === DELETED ? undefined : held;
      }
      if (state.hidden(key)) return undefined;
      const found = Reflect.get(target, key, receiver) as unknown;
      return typeof found === 'function' ? found : wrap(found);
    },
    set: (_shadow, key, value) => state.write(key, value),
    has: (_shadow, key) => (state.isArray && key === 'length') || state.own(key) || (!state.writes.has(key) && !state.hidden(key) && Reflect.has(target, key)),
    deleteProperty(_shadow, key) {
      if (state.own(key)) state.writes.set(key, DELETED);
      return true;
    },
    defineProperty: (_shadow, key, descriptor) => state.write(key, 'value' in descriptor ? descriptor.value : undefined),
    ownKeys: () => state.keys(),
    getOwnPropertyDescriptor(_shadow, key) {
      if (state.isArray && key === 'length') return { value: state.length, writable: true, enumerable: false, configurable: false };
      if (!state.own(key)) return undefined;
      const written = state.writes.has(key);
      const value = written ? state.writes.get(key) : wrap(Reflect.get(target, key, view));
      return { value, writable: true, enumerable: written || (Reflect.getOwnPropertyDescriptor(target, key)?.enumerable ?? true), configurable: true };
    },
    getPrototypeOf: () => Object.getPrototypeOf(target) as object | null,
  });
  return view;
}

/** A fresh copy-on-write view of `live`; every nested object comes back wrapped, once per view. */
export function isolated<T extends object>(live: T): T {
  const shared = (live as { dex?: object }).dex;
  const wrappers = new WeakMap<object, object>();
  const ours = new WeakSet<object>();

  function wrap(value: unknown): unknown {
    if (!isObject(value) || ours.has(value) || value === shared) return value;
    const known = wrappers.get(value);
    if (known) return known;
    const tag = Object.prototype.toString.call(value);
    if (REFUSED.has(tag) || ArrayBuffer.isView(value)) return refusal(tag);
    const view = proxyOf(new Overlay(value), wrap);
    ours.add(view);
    wrappers.set(value, view);
    return view;
  }

  const root = wrap(live) as T;
  if ('sides' in live && 'prng' in live) rootOf.set(root, live as unknown as Battle);
  return root;
}

/** With the check on, runs the call and throws `AskLeak` when the live battle behind the view moved. */
export function viewGuarded<T>(facade: object, call: () => T): T {
  const root = askCheckOn() ? rootOf.get(facade) : undefined;
  if (!root) return call();
  const before = fingerprint(root);
  const answer = call();
  if (fingerprint(root) !== before) throw new AskLeak();
  return answer;
}
