import { useEffect, useRef } from 'react';
import { parseReplayUrl } from '../lib/replay-fetcher';

/**
 * Round 89 (lane L): `?replay=<id>&turn=<n>` opens a replay on a turn, so a gate question that names a game and a turn can be
 * a link. The address is read once, at start (`useEmbedHost`), and the turn is landed once, when the replay the address named has
 * opened: through `landOnTurn`, the selection the evaluation column's graph makes (the pointer, the frame's seek, the analysis turn),
 * with the guard that waits for a frame that loads from the network. The address is not rewritten when the user moves on: it
 * describes how the link opened, as `?replay=` does. A turn outside the replay clamps to its range; the lead view (turn 0) is not
 * a turn of the address. Singles and doubles read the same address; the range comes from the loaded snapshots.
 */

/** A whole number as written in the address; anything else (empty, `7.5`, `7x`) names no turn. */
export function parseRequestedTurn(value: string | null): number | null {
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const turn = Number(value);
  return Number.isSafeInteger(turn) ? turn : null;
}

export interface RequestedTurnInputs {
  /** `?replay=` as the address held it at start. */
  requestedReplay: string | null;
  /** `?turn=` as `parseRequestedTurn` read it at start (null when a share link or a held game owns the view). */
  requestedTurn: number | null;
  /** The id of the replay data that is open, if any. */
  replayId: string | null;
  /** The slider's last turn of the open replay (the end position counts, as it does on the slider). */
  maxTurn: number;
  landOnTurn: (turn: number) => void;
}

/**
 * Lands on the requested turn once. The turn belongs to the replay the link named: the first replay that opens ends the
 * request, so a file or a host message that opens first, or a replay the user loads later, is never moved.
 */
export function useRequestedTurn({ requestedReplay, requestedTurn, replayId, maxTurn, landOnTurn }: RequestedTurnInputs): void {
  const spentRef = useRef(false);
  useEffect(() => {
    if (spentRef.current || requestedTurn === null || requestedReplay === null || replayId === null) return;
    spentRef.current = true;
    if (parseReplayUrl(requestedReplay) !== replayId.toLowerCase()) return;
    landOnTurn(Math.min(Math.max(1, requestedTurn), Math.max(1, maxTurn)));
  }, [requestedReplay, requestedTurn, replayId, maxTurn, landOnTurn]);
}
