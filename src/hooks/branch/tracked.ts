import { useCallback, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { BranchRefs, BranchHistoryEntry } from './shared';

/**
 * State with a ref that holds its latest value: a caller that acts right after an async write (a new game's promotion, round 89,
 * #105) reads the ref where the render's copy is stale. Every write goes through the setter, a function update included.
 */
export function useTrackedState<T>(initial: T): [T, Dispatch<SetStateAction<T>>, RefObject<T>] {
  const [value, setValue] = useState<T>(initial);
  const ref = useRef<T>(initial);
  const set = useCallback((next: SetStateAction<T>) => {
    ref.current = typeof next === 'function' ? (next as (previous: T) => T)(ref.current) : next;
    setValue(ref.current);
  }, []);
  return [value, set, ref];
}

interface TrackedHandles {
  historyRef: RefObject<BranchHistoryEntry[]>;
  startTurnRef: RefObject<number | null>;
  setHistory: Dispatch<SetStateAction<BranchHistoryEntry[]>>;
  setVariationStartTurn: Dispatch<SetStateAction<number | null>>;
  setStartSerialized: Dispatch<SetStateAction<string | null>>;
}

/**
 * What a new game reads and does at the branch (round 89, #105): the history, the runtime's log with the length it had when the
 * branch started or was last rebased, the start turn, the stream, and `rebaseAtTip`: the live runtime stays and becomes the
 * start of a new branch at `startTurn` with no entry of its own (the turns it played joined the game's main line), the state
 * `requestDeviation(null)` leaves at a turn, so the tip is live.
 */
export function useNewGameAccess(refs: BranchRefs, handles: TrackedHandles) {
  const { logRef, startLogLengthRef, battleStreamRef } = refs;
  const { historyRef, startTurnRef, setHistory, setVariationStartTurn, setStartSerialized } = handles;
  const getHistory = useCallback(() => historyRef.current, [historyRef]);
  const getLog = useCallback(() => ({ log: logRef.current, since: startLogLengthRef.current }), [logRef, startLogLengthRef]);
  const getStartTurn = useCallback(() => startTurnRef.current, [startTurnRef]);
  const getStream = useCallback(() => battleStreamRef.current, [battleStreamRef]);
  const rebaseAtTip = useCallback((startTurn: number, startPosition: string | null) => {
    setHistory([]);
    setVariationStartTurn(startTurn);
    setStartSerialized(startPosition);
    startLogLengthRef.current = logRef.current.length;
  }, [setHistory, setVariationStartTurn, setStartSerialized, startLogLengthRef, logRef]);
  return { getHistory, getLog, getStartTurn, getStream, rebaseAtTip };
}

/** A lead start is the first turn of a new game's main line: the game takes it in as soon as the start resolves (round 89, #105). */
export function useLeadPromotion<Start extends (...args: never[]) => Promise<{ endedNotice: string | null } | void>>(
  start: Start, afterTurnRef?: RefObject<(() => Promise<void>) | null>,
): Start {
  return useCallback(async (...args: Parameters<Start>) => {
    const outcome = await start(...args);
    const options = (args as unknown[])[6] as { leadOverride?: unknown } | undefined;
    if (options?.leadOverride && !outcome?.endedNotice) await afterTurnRef?.current?.();
    return outcome;
  }, [start, afterTurnRef]) as unknown as Start;
}
