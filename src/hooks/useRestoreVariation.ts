import { useCallback } from 'react';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { PinnedTeams } from '../lib/eval-acquire';
import type { BranchHistoryEntry } from './useBranch';
import { executeRebuild, type RebuildContext } from './useDeviation';

type Choices = { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] };

export interface SavedVariation {
  startTurn: number;
  history: BranchHistoryEntry[];
  prefill: Choices;
  pinnedTeams: PinnedTeams | null;
}

/**
 * Round 77 (user gate 28.10.2026, 3a): a saved variation rebuilds from its start turn with its history and
 * pending choices, through the rebuild every deviation takes (a turn-0 variation re-seeds its leads from its
 * lead entry). The pinned teams ride along explicitly: a pin set just before has not reached this render's
 * team sources yet.
 */
export function useRestoreVariation(inputs: Omit<RebuildContext, 'bringOnly' | 'landPointer' | 'replayData'> & {
  replayData: RebuildContext['replayData'] | null;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  setViewTurn: (turn: number) => void;
  setViewLine: (line: 'main' | 'variation') => void;
}) {
  const {
    replayData, snapshots, observations, sources, bringOnlyLists, session, branch, acquireRuntime, branchWindowOpenRef,
    setBranchDivergence, setViewTurn, setViewLine,
  } = inputs;
  return useCallback(async (saved: SavedVariation) => {
    if (!replayData || session.isPreparing()) return;
    await executeRebuild({
      replayData, snapshots, observations,
      sources: saved.pinnedTeams ? { ...sources, pinnedTeams: saved.pinnedTeams } : sources,
      bringOnly: saved.startTurn > 0 ? bringOnlyLists ?? undefined : undefined,
      session, branch, acquireRuntime, branchWindowOpenRef, setBranchDivergence,
      landPointer: turn => {
        setViewTurn(turn);
        setViewLine('main');
      },
    }, saved.startTurn, saved.history, saved.prefill);
  }, [
    replayData, snapshots, observations, sources, bringOnlyLists, session, branch, acquireRuntime, branchWindowOpenRef,
    setBranchDivergence, setViewTurn, setViewLine,
  ]);
}
