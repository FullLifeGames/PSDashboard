import { useCallback, useRef, useState } from 'react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';

export interface PlayOutState {
  active: boolean;
  executed: number;
  turns: number;
  startTurn: number;
  prevAuto: boolean;
}

export interface PendingConfirm {
  message: string;
  proceed: () => void;
}

/**
 * Per-position interaction state that dies with the previous replay:
 * the play-out run, its notice, draft choices, and the inline confirm.
 *
 * Mirrors for the play-out state and its stop: user navigation while the
 * engine plays must STOP the run — the loop only advances while the
 * pointer sits on the live tip, so a silent stall with "Engine is
 * playing…" frozen was the alternative. Internal navigations (tip-follow,
 * the finish's return to the start turn) keep the run alive.
 */
export function useTransients(replayId: string | undefined) {
  const playOutRef = useRef<{ active: boolean } | null>(null);
  const stopPlayOutRef = useRef<((opts?: { returnToStart?: boolean }) => void) | null>(null);

  // ── "Let it play out": the engine plays BOTH sides' top choice from the
  // current position until the game ends, the user stops, or the safety cap
  // trips. Each executed turn is a normal history entry — navigable,
  // evaluable, truncatable like anything else; Stop keeps what was played.
  const [playOut, setPlayOut] = useState<PlayOutState | null>(null);
  /** Why the last play-out ended + where watching it starts (panel notice). */
  const [playOutNotice, setPlayOutNotice] = useState<{ text: string; watchTurn: number } | null>(null);
  const playOutProcessedRef = useRef<EvalResult | null>(null);

  /**
   * Draft choices for positions WITHOUT the live sim (variant B pickers):
   * collected here, executed via requestDeviation → rebuild → executeTurn.
   * Cleared on every navigation — a draft belongs to one position.
   */
  const [draftChoices, setDraftChoices] = useState<{ p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }>({ p1: [], p2: [] });
  /** Inline confirm for main-line deviations that would replace the variation. */
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // The transient interaction state dies with the previous replay —
  // render-phase adjustment on the replay id (the react-hooks gate forbids
  // plain setState resets inside the load-sync effect).
  const [transientsReplayId, setTransientsReplayId] = useState(replayId);
  if (transientsReplayId !== replayId) {
    setTransientsReplayId(replayId);
    setDraftChoices({ p1: [], p2: [] });
    setPendingConfirm(null);
    setPlayOut(null);
    setPlayOutNotice(null);
  }

  const interruptPlayOut = useCallback(() => {
    if (playOutRef.current?.active) {
      stopPlayOutRef.current?.({ returnToStart: false });
    }
  }, []);
  const clearDraftChoices = useCallback(() => {
    setDraftChoices({ p1: [], p2: [] });
  }, []);

  return {
    playOutRef, stopPlayOutRef, playOut, setPlayOut, playOutNotice, setPlayOutNotice,
    playOutProcessedRef, draftChoices, setDraftChoices, pendingConfirm, setPendingConfirm,
    interruptPlayOut, clearDraftChoices,
  };
}

export type Transients = ReturnType<typeof useTransients>;
