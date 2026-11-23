import { useCallback, useState } from 'react';

/**
 * Start and loading a replay (or opening a saved game) ask first when an unsaved variation is open: `ask(what, run)` runs the action
 * when nothing would be lost and returns false, else holds it behind the question and returns true. `proceed` runs the held action,
 * `cancel` drops it. The game itself is saved after every turn. `active` false (a closed dialog) drops an open question, in render.
 */
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
