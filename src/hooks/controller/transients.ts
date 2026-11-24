import { useCallback, useRef, useState } from 'react';
import type { BranchSlotChoice, EvalResult } from '@fulllifegames/eval-engine';
import type { LeadSelection } from '../useDeviation';

export interface PlayOutState {
  active: boolean;
  executed: number;
  turns: number;
  startTurn: number;
  prevAuto: boolean;
  stopping?: { text: string; navigated: boolean } | null;
}

export interface PendingConfirm {
  message: string;
  proceed: () => void;
}

/**
 * Per-position interaction state that dies with the previous replay: the play-out run, its notice, draft choices, the inline confirm.
 * User navigation while the engine plays must STOP the run (the loop only advances while the pointer sits on the live tip);
 * internal navigations (tip-follow, the finish's move to the frame's turn) keep it alive.
 */
export function useTransients(replayId: string | undefined) {
  const playOutRef = useRef<{ active: boolean; stopping?: { navigated: boolean } | null } | null>(null);
  const stopPlayOutRef = useRef<((opts?: { navigated?: boolean }) => void) | null>(null);

  const [playOut, setPlayOut] = useState<PlayOutState | null>(null);
  const [playOutNotice, setPlayOutNotice] = useState<{ text: string; watchTurn: number } | null>(null);
  const playOutProcessedRef = useRef<EvalResult | null>(null);
  /** The lead picker's complete selection while the turn 0 view shows it (null otherwise): "Let it play out" starts from the leads on screen. */
  const leadPicksRef = useRef<LeadSelection | null>(null);
  const setLeadPicks = useCallback((picks: LeadSelection | null) => { leadPicksRef.current = picks; }, []);
  /**
   * "Fast play-out": every evaluation of a run uses the depth-1 matrix instead of the Auto line. A session option, never stored; it
   * survives a replay change.
   */
  const [fastPlayOut, setFastPlayOut] = useState(false);

  /**
   * Draft choices for positions WITHOUT the live sim: executed via requestDeviation → rebuild → executeTurn; cleared on every navigation (a
   * draft belongs to one position).
   */
  const [draftChoices, setDraftChoices] = useState<{ p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }>({ p1: [], p2: [] });
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // The transient interaction state dies with the previous replay: render-phase adjustment on the replay id (the react-hooks gate forbids
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
      stopPlayOutRef.current?.({ navigated: true });
    }
  }, []);
  const clearDraftChoices = useCallback(() => {
    setDraftChoices({ p1: [], p2: [] });
  }, []);

  return {
    playOutRef, stopPlayOutRef, playOut, setPlayOut, playOutNotice, setPlayOutNotice,
    playOutProcessedRef, leadPicksRef, setLeadPicks, fastPlayOut, setFastPlayOut, draftChoices, setDraftChoices, pendingConfirm, setPendingConfirm,
    interruptPlayOut, clearDraftChoices,
  };
}

export type Transients = ReturnType<typeof useTransients>;
