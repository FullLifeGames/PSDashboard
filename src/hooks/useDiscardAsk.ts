import { useCallback, useState } from 'react';

/** `request` discards at once while no turn was played, else asks; `playedTurns` is `turnEntryCount`. */
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
