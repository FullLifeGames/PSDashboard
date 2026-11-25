import { useEffect, useRef } from 'react';
import { parseReplayUrl } from '../lib/replay-fetcher';

/** `?replay=<id>&turn=<n>` is read once at start and lands once; a turn outside the replay clamps to its range. */

/** A whole number as written in the address; anything else (empty, `7.5`, `7x`) names no turn. */
export function parseRequestedTurn(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const turn = Number(value);
  return Number.isSafeInteger(turn) ? turn : null;
}

export interface RequestedTurnInputs {
  requestedReplay: string | null;
  /** `?turn=` as `parseRequestedTurn` read it at start (null when a share link or a held game owns the view). */
  requestedTurn: number | null;
  replayId: string | null;
  maxTurn: number;
  landOnTurn: (turn: number) => void;
}

/** Lands on the requested turn once: the first replay that opens ends the request, so later loads never move it. */
export function useRequestedTurn({ requestedReplay, requestedTurn, replayId, maxTurn, landOnTurn }: RequestedTurnInputs): void {
  const spentRef = useRef(false);
  useEffect(() => {
    if (spentRef.current || requestedTurn === null || requestedReplay === null || replayId === null) return;
    spentRef.current = true;
    if (parseReplayUrl(requestedReplay) !== replayId.toLowerCase()) return;
    landOnTurn(Math.min(Math.max(1, requestedTurn), Math.max(1, maxTurn)));
  }, [requestedReplay, requestedTurn, replayId, maxTurn, landOnTurn]);
}
