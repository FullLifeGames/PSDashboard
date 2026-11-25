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

/** A saved variation rebuilds from its start turn like any deviation; the pinned teams ride along explicitly. */
export function useRestoreVariation(inputs: Omit<RebuildContext, 'bringOnly' | 'landPointer' | 'replayData'> & {
  replayData: RebuildContext['replayData'] | null;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  setViewTurn: (turn: number) => void;
  setViewLine: (line: 'main' | 'variation') => void;
  /** A new game's dice seed: a variation that starts at turn 0 starts the game's own battle again. */
  gameSeed?: string;
}) {
  const {
    replayData, snapshots, observations, sources, bringOnlyLists, session, branch, acquireRuntime, branchWindowOpenRef,
    setBranchDivergence, setViewTurn, setViewLine, gameSeed,
  } = inputs;
  return useCallback(async (saved: SavedVariation) => {
    if (!replayData || session.isPreparing()) return;
    await executeRebuild({
      replayData, snapshots, observations,
      sources: saved.pinnedTeams ? { ...sources, pinnedTeams: saved.pinnedTeams } : sources,
      bringOnly: saved.startTurn > 0 ? bringOnlyLists ?? undefined : undefined,
      session, branch, acquireRuntime, branchWindowOpenRef, setBranchDivergence, seed: gameSeed,
      landPointer: turn => {
        setViewTurn(turn);
        setViewLine('main');
      },
    }, saved.startTurn, saved.history, saved.prefill);
  }, [
    replayData, snapshots, observations, sources, bringOnlyLists, session, branch, acquireRuntime, branchWindowOpenRef,
    setBranchDivergence, setViewTurn, setViewLine, gameSeed,
  ]);
}
