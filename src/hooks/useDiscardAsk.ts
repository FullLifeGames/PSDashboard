import { useCallback, useState } from 'react';

/**
 * Round 89 (user ruling 40, FB4a): Discard variation asks first once the variation has a played turn: a play-out of a hundred seconds
 * must not go with one click. `request` discards at once while no turn was played; else it opens the question, whose `proceed` runs
 * the discard and whose `cancel` drops it. `playedTurns` is the variation's turn count (`turnEntryCount`), the same for singles and
 * doubles. A question that stands while the variation goes away by another route closes with it, reconciled in render.
 */
export function useDiscardAsk(playedTurns: number, discard: () => void) {
  const [asking, setAsking] = useState(false);
  if (asking && playedTurns === 0) setAsking(false);
  const request = useCallback(() => {
    if (playedTurns === 0) discard();
    else setAsking(true);
  }, [playedTurns, discard]);
  const question = asking
    ? {
      message: `The variation has ${playedTurns} played turn${playedTurns === 1 ? '' : 's'}. Discarding drops ${playedTurns === 1 ? 'it' : 'them'}.`,
      proceed: () => { setAsking(false); discard(); },
      cancel: () => setAsking(false),
    }
    : null;
  return { request, question };
}
