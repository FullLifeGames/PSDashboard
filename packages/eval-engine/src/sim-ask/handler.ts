import { AskLeak } from './guard.ts';
import { viewGuarded } from './isolated.ts';

/**
 * Round 72 (T239): a Dex handler called with a throwaway `this`. The handlers of the simulator run as methods of the
 * battle; the engine asks one for a single fact (a move's target at use, whether a protector stops a hit) on a
 * stand-in. The `this` is a fresh object that reads through to the facade and swallows the log and the debug
 * output. A handler that needs more than the facade offers throws or reads nothing there: the answer is then the
 * typed "needs more", never a guess, and the caller keeps what it had. With the development check on, a facade
 * made by `isolated(battle)` is fingerprinted around the call.
 */

export type HandlerResult<T> = { ok: true; value: T } | { ok: false };

const noop = (): undefined => undefined;

export function callHandler<T = unknown>(
  handler: (this: never, ...args: never[]) => T, facade: object, args: readonly unknown[],
): HandlerResult<T> {
  const self = Object.create(facade, { add: { value: noop }, debug: { value: noop } }) as never;
  return viewGuarded(facade, () => {
    try {
      return { ok: true, value: (handler as (this: never, ...a: unknown[]) => T).call(self, ...args) };
    } catch (error) {
      if (error instanceof AskLeak) throw error;
      return { ok: false };
    }
  });
}
