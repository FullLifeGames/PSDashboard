import type { Battle } from '@pkmn/sim';
import { serializeBattleStable } from '../forward/serialize.ts';

// Read through `globalThis.process`: the browser bundle never touches `process`.

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

export class AskLeak extends Error {
  constructor(message = 'a question to the simulator changed the live battle') {
    super(message);
    this.name = 'AskLeak';
  }
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'function' ? 'fn' : inner));

/** What one question could leave behind: the stable serialization, event bookkeeping and the Dex entries read. */
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

export function guarded<T>(live: Battle, extras: readonly unknown[], ask: () => T): T {
  if (!askCheckOn()) return ask();
  const before = fingerprint(live, extras);
  const answer = ask();
  if (fingerprint(live, extras) !== before) throw new AskLeak();
  return answer;
}
