import type { Battle } from '@pkmn/sim';
import { serializeBattleStable } from '../forward/serialize.ts';

/**
 * Round 72 (T239): the development check of the module that asks the simulator. A question to the simulator runs on a
 * copy (AGENTS.md); the check proves the live battle came out of the question as it went in. It costs milliseconds (a
 * whole serialization twice), so it is off in the app and the bank and on in specs (`setAskCheck(true)`) and under
 * `EVAL_ASK_CHECK=1` in a Node run, the way `EVAL_SIM_FAST` is read: through `globalThis.process`, so the browser
 * bundle never touches `process`.
 */

interface ProcessLike { env?: Record<string, string | undefined> }

let override: boolean | null = null;

/** Switches the check for this realm; `null` hands it back to the environment. */
export function setAskCheck(on: boolean | null): void {
  override = on;
}

export function askCheckOn(): boolean {
  if (override !== null) return override;
  return (globalThis as { process?: ProcessLike }).process?.env?.EVAL_ASK_CHECK === '1';
}

/** The live battle changed during a question. */
export class AskLeak extends Error {
  constructor(message = 'a question to the simulator changed the live battle') {
    super(message);
    this.name = 'AskLeak';
  }
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'function' ? 'fn' : inner));

/**
 * Everything one question could leave behind: the whole stable serialization (sides, bodies, field, queue, log, dice),
 * the event bookkeeping, and the JSON of the Dex entries the question read.
 */
export function fingerprint(battle: Battle, extras: readonly unknown[] = []): string {
  return JSON.stringify({
    state: serializeBattleStable(battle),
    log: battle.log.length,
    seed: battle.prng.getSeed(),
    effectOrder: battle.effectOrder,
    eventDepth: battle.eventDepth,
    eventId: (battle.event as { id?: string } | undefined)?.id ?? null,
    extras: extras.map(stable),
  });
}

/** Runs the question; with the check on, throws `AskLeak` when the live battle's fingerprint moved. */
export function guarded<T>(live: Battle, extras: readonly unknown[], ask: () => T): T {
  if (!askCheckOn()) return ask();
  const before = fingerprint(live, extras);
  const answer = ask();
  if (fingerprint(live, extras) !== before) throw new AskLeak();
  return answer;
}
