import { useCallback, useState } from 'react';

/**
 * Round 89 (lane H, #105), H16a (user ruling 13.11.2026): Start and loading a replay (or opening a saved game) ask first when an
 * unsaved variation is open. `ask(what, run)` runs the action when nothing would be lost and returns false; else it holds the action
 * behind the question ("The open variation is not saved. <what> closes it.") and returns true. The question's `proceed` runs the held
 * action, `cancel` drops it. The game itself is saved after every turn, so it needs no question. `active` false (a closed dialog)
 * drops a question that is still open, reconciled in render.
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

export type LeaveQuestion = NonNullable<ReturnType<typeof useLeaveAsk>['question']>;
