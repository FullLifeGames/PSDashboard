import { useCallback, useMemo, useRef, useState } from 'react';
import { useReplay } from '../useReplay';
import { useEmbedHost } from '../useEmbedHost';
import { useBranch } from '../useBranch';
import type { BranchHistoryEntry, BranchSimState } from '../useBranch';
import { useEvaluation } from '../useEvaluation';
import { useSmogonUsageStats } from '../useSmogonUsageStats';
import { useSmogonSetAssumptions } from '../useSmogonSetAssumptions';
import { useSharedBranch } from '../useSharedBranch';
import { useTeamKnowledge } from '../useTeamKnowledge';
import type { TeamKnowledge } from '../useTeamKnowledge';
import {
  type OpponentTeamInfo, type ReplayData, type TurnSnapshot, getReplayBringCount, getReplayGameType,
  getReplayGeneration, replayBringOnly,
} from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';

interface PendingBranchRefresh {
  p1Info: OpponentTeamInfo;
  p2Info: OpponentTeamInfo;
  history: BranchHistoryEntry[];
  p1Choices: (BranchSlotChoice | null)[];
  p2Choices: (BranchSlotChoice | null)[];
}

function useReplaySurface() {
  const { loading, error, replayData, snapshots, observations, speedOrders, hpEvidence, opponentInfo, p1Info, loadReplay, loadReplayFile } = useReplay();
  const { embed, requestedReplay } = useEmbedHost({ loadReplay, loadReplayFile });
  // Canonical link of whatever is loaded — mirrored into the loader input,
  // whichever path (typed URL, file, share link, embed message) loaded it.
  const loadedReplayUrl = replayData
    ? `https://replay.pokemonshowdown.com/${replayData.id}${replayData.viewpoint === 'p2' ? '?p2' : ''}`
    : null;
  return {
    loading, error, replayData, snapshots, observations, speedOrders, hpEvidence,
    opponentInfo, p1Info, loadReplay, loadReplayFile, embed, requestedReplay, loadedReplayUrl,
  };
}

function useSmogonBundle(replayData: ReplayData | null, p1Info: OpponentTeamInfo | null, opponentInfo: OpponentTeamInfo | null) {
  const usageStats = useSmogonUsageStats(replayData?.formatid);
  const revealedSpecies = useMemo(() => {
    const p1 = p1Info?.pokemon.map(pokemon => pokemon.species) ?? [];
    const p2 = opponentInfo?.pokemon.map(pokemon => pokemon.species) ?? [];
    return [...new Set([...p1, ...p2])];
  }, [p1Info, opponentInfo]);
  const setAssumptions = useSmogonSetAssumptions(replayData?.formatid, revealedSpecies);
  return { usageStats, setAssumptions };
}

/** Edited team knowledge changes the sim's inputs — refresh a live branch
 *  with the same history and pending choices. */
function useTeamRefreshQueue(
  history: BranchHistoryEntry[],
  simState: BranchSimState | null,
  branchWindowOpenRef: React.RefObject<boolean>,
) {
  const [pendingBranchRefresh, setPendingBranchRefresh] = useState<PendingBranchRefresh | null>(null);
  const handleTeamsEdited = useCallback((next: { p1: OpponentTeamInfo; p2: OpponentTeamInfo }) => {
    if (branchWindowOpenRef.current || simState) {
      setPendingBranchRefresh({
        p1Info: next.p1,
        p2Info: next.p2,
        history: [...history],
        p1Choices: [...(simState?.p1Choices ?? [])],
        p2Choices: [...(simState?.p2Choices ?? [])],
      });
    }
  }, [history, simState, branchWindowOpenRef]);
  const clearRefreshRequest = useCallback(() => setPendingBranchRefresh(null), []);
  return { pendingBranchRefresh, setPendingBranchRefresh, handleTeamsEdited, clearRefreshRequest };
}

function useFormatMeta(replayData: ReplayData | null, snapshots: TurnSnapshot[]) {
  const replayGen = useMemo(() => replayData ? getReplayGeneration(replayData) : 9, [replayData]);
  /** Bring-limited team preview (VGC 4 of 6, BSS 3 of 6) — null brings all. */
  const bringCount = useMemo(
    () => (replayData ? getReplayBringCount(replayData) : null),
    [replayData],
  );
  /** Per-side bring lists from the protocol (null = bring-all format;
   *  [] on a side = its full selection never entered, that side stays
   *  whole). Shared by every branch, sweep, and preview reconstruction. */
  const bringOnlyLists = useMemo(
    () => (replayData ? replayBringOnly(replayData, snapshots) : null),
    [replayData, snapshots],
  );
  const replayGameType = useMemo(
    () => (replayData ? getReplayGameType(replayData.log) : null),
    [replayData],
  );
  const evalIsDoubles = replayGameType === 'doubles';
  return { replayGen, bringCount, bringOnlyLists, replayGameType, evalIsDoubles };
}

/** One team-source bundle for every acquisition path; deps are the inner
 *  stable values (the Smogon hook objects are fresh per render). */
function useTeamSources(
  knowledge: TeamKnowledge,
  smogon: ReturnType<typeof useSmogonBundle>,
  hpEvidence: ReturnType<typeof useReplay>['hpEvidence'],
) {
  const { teamText, effectiveP1Info, effectiveP2Info, getInferredSpreads } = knowledge;
  const { stats } = smogon.usageStats;
  const { assumptions } = smogon.setAssumptions;
  return useMemo(() => ({
    teamText, effectiveP1Info, effectiveP2Info,
    usageStats: { stats },
    setAssumptions: { assumptions },
    hpEvidence, getInferredSpreads,
  }), [teamText, effectiveP1Info, effectiveP2Info, stats, assumptions, hpEvidence, getInferredSpreads]);
}

/**
 * Foundation layer: the loaded replay, the branch simulator, the evaluation
 * engine handle, Smogon knowledge, team knowledge, and format metadata.
 * Call order matches the pre-split App() exactly.
 */
export function useReplayContext() {
  const replay = useReplaySurface();
  const branch = useBranch();
  const evaluation = useEvaluation();
  const branchWindowOpenRef = useRef(false);
  const smogon = useSmogonBundle(replay.replayData, replay.p1Info, replay.opponentInfo);
  const [animateBranchTurns, setAnimateBranchTurns] = useState(true);
  const { sharedBranch, sharedBranchError, clearSharedBranch } = useSharedBranch();
  const refreshQueue = useTeamRefreshQueue(branch.history, branch.simState, branchWindowOpenRef);
  const knowledge = useTeamKnowledge({
    replayData: replay.replayData, p1Info: replay.p1Info, opponentInfo: replay.opponentInfo,
    observations: replay.observations, speedOrders: replay.speedOrders, hpEvidence: replay.hpEvidence,
    usageStats: smogon.usageStats, setAssumptions: smogon.setAssumptions,
    onTeamsEdited: refreshQueue.handleTeamsEdited,
  });
  const meta = useFormatMeta(replay.replayData, replay.snapshots);
  const teamSources = useTeamSources(knowledge, smogon, replay.hpEvidence);
  const { loadReplay } = replay;
  const handleLoadSharedOriginal = useCallback((replayId: string) => {
    clearSharedBranch();
    void loadReplay(replayId);
  }, [clearSharedBranch, loadReplay]);
  return {
    replay, branch, evaluation, branchWindowOpenRef, smogon,
    animateBranchTurns, setAnimateBranchTurns,
    shared: { sharedBranch, sharedBranchError, clearSharedBranch, handleLoadSharedOriginal },
    refreshQueue, knowledge, meta, teamSources,
  };
}

export type ReplayContext = ReturnType<typeof useReplayContext>;
