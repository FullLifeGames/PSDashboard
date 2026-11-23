import { AskLeak } from './guard.ts';
import { viewGuarded } from './isolated.ts';

// A Dex handler called with a throwaway `this` (a fresh object that reads through to the facade and swallows the log and debug output).
// A handler that needs more than the facade offers throws or reads nothing: the answer is then the typed "needs more", never a guess.

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
