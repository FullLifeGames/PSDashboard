import { useCallback, useState } from 'react';

/** `ask(what, run)` runs at once and returns false when nothing is unsaved, else holds the action and returns true. */
export function useLeaveAsk(unsaved: (() => boolean) | undefined, active = true) {
  const [held, setHeld] = useState<{ message: string; run: () => void } | null>(null);
  if (!active && held) setHeld(null);
  const ask = useCallback((what: string, run: () => void): boolean => {
    if (!unsaved?.()) {
      run();
      return false;
    }
    setHeld({ message: `The open variation is not saved. ${what} closes it.`, run });
    return true;
  }, [unsaved]);
  const question = held && {
    message: held.message,
    proceed: () => { setHeld(null); held.run(); },
    cancel: () => setHeld(null),
  };
  return { ask, question };
}
