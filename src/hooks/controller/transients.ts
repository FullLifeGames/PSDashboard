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

/** User navigation while the engine plays stops the run; internal navigations (tip-follow, finish) keep it alive. */
export function useTransients(replayId: string | undefined) {
  const playOutRef = useRef<{ active: boolean; stopping?: { navigated: boolean } | null } | null>(null);
  const stopPlayOutRef = useRef<((opts?: { navigated?: boolean }) => void) | null>(null);

  const [playOut, setPlayOut] = useState<PlayOutState | null>(null);
  const [playOutNotice, setPlayOutNotice] = useState<{ text: string; watchTurn: number } | null>(null);
  const playOutProcessedRef = useRef<EvalResult | null>(null);
  const leadPicksRef = useRef<LeadSelection | null>(null);
  const setLeadPicks = useCallback((picks: LeadSelection | null) => { leadPicksRef.current = picks; }, []);
  /** Session option, never stored; it survives a replay change. */
  const [fastPlayOut, setFastPlayOut] = useState(false);

  /** Draft choices for positions without the live sim; cleared on every navigation. */
  const [draftChoices, setDraftChoices] = useState<{ p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }>({ p1: [], p2: [] });
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

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
