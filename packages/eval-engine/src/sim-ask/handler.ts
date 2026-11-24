import { AskLeak } from './guard.ts';
import { viewGuarded } from './isolated.ts';

// A handler that needs more than the facade offers yields `{ ok: false }`, never a guess.

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
