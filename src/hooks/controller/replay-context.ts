import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReplay } from '../useReplay';
import { useEmbedHost } from '../useEmbedHost';
import { useOpenAddress } from '../useOpenAddress';
import { useBranch } from '../useBranch';
import { useGameState, useNewGameAt } from '../useNewGame';
import type { NewGameRecord } from '../../lib/new-game/record';
import type { BranchHistoryEntry, BranchSimState } from '../useBranch';
import { useEvaluation } from '../useEvaluation';
import { useSmogonUsageStats } from '../useSmogonUsageStats';
import { useSmogonSetAssumptions } from '../useSmogonSetAssumptions';
import { useSharedBranch } from '../useSharedBranch';
import { useTeamKnowledge } from '../useTeamKnowledge';
import type { TeamKnowledge } from '../useTeamKnowledge';
import { usePinnedTeams } from '../usePinnedTeams';
import { useEngineChoice } from '../useEngineChoice';
import { setEngineGameFormat } from '../../lib/eval/engine-setting';
import { useReplayWorker } from '../useReplayWorker';
import { usePositionSource } from '../usePositionSource';
import { replayBench } from '../../lib/bench';
import {
  type OpponentTeamInfo, type ReplayData, type TurnSnapshot, getReplayBringCount, getReplayGameType,
  getReplayGeneration, replayBringList, replayBringOnly,
} from '@fulllifegames/replay-core';
import { BRING_WORLD_CAP, bringWorlds, type BranchSlotChoice } from '@fulllifegames/eval-engine';
import type { SmogonUsageStats } from '../../lib/smogon-stats';

interface PendingBranchRefresh {
  p1Info: OpponentTeamInfo;
  p2Info: OpponentTeamInfo;
  history: BranchHistoryEntry[];
  p1Choices: (BranchSlotChoice | null)[];
  p2Choices: (BranchSlotChoice | null)[];
}

function useReplaySurface() {
  const {
    loading, error, replayData, snapshots, observations, speedOrders, hpEvidence, opponentInfo, p1Info, itemJudge, loadReplay, loadReplayFile,
    openGame, extendGame, byLink,
  } = useReplay();
  const { embed, requestedReplay, requestedTurn, requestedGame } = useEmbedHost({ loadReplay, loadReplayFile });
  const loadedReplayUrl = replayData
    ? `https://replay.pokemonshowdown.com/${replayData.id}${replayData.viewpoint === 'p2' ? '?p2' : ''}`
    : null;
  return {
    loading, error, replayData, snapshots, observations, speedOrders, hpEvidence,
    opponentInfo, p1Info, itemJudge, loadReplay, loadReplayFile, openGame, extendGame, embed, requestedReplay, requestedTurn, requestedGame, loadedReplayUrl, byLink,
  };
}

function useSmogonBundle(replayData: ReplayData | null, p1Info: OpponentTeamInfo | null, opponentInfo: OpponentTeamInfo | null) {
  const usageStats = useSmogonUsageStats(replayData?.formatid, replayData);
  const revealedSpecies = useMemo(() => {
    const p1 = p1Info?.pokemon.map(pokemon => pokemon.species) ?? [];
    const p2 = opponentInfo?.pokemon.map(pokemon => pokemon.species) ?? [];
    return [...new Set([...p1, ...p2])];
  }, [p1Info, opponentInfo]);
  const setAssumptions = useSmogonSetAssumptions(replayData?.formatid, revealedSpecies);
  return { usageStats, setAssumptions };
}

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

function useFormatMeta(replayData: ReplayData | null, snapshots: TurnSnapshot[], usageStats: SmogonUsageStats | null, game: NewGameRecord | null) {
  const replayGen = useMemo(() => replayData ? getReplayGeneration(replayData) : 9, [replayData]);
  const bringCount = useMemo(
    () => (replayData ? getReplayBringCount(replayData) : null),
    [replayData],
  );
  /** The worlds of a game where a side brought more bodies than it fielded, heaviest first; null for any other game. */
  const bringWorldsOfGame = useMemo(() => {
    const list = replayData && !game ? replayBringList(replayData, snapshots, usageStats) : null;
    if (!list || (list.p1.open === 0 && list.p2.open === 0)) return null;
    return bringWorlds(list, BRING_WORLD_CAP);
  }, [replayData, snapshots, usageStats, game]);
  const gameLists = useMemo(() => {
    const lead = game?.entries[0]?.leadChoices;
    return lead?.bring ? { p1: lead.p1, p2: lead.p2 } : null;
  }, [game]);
  /** The bring lists the rebuild pins, from the protocol; null for a bring-all format. */
  const bringOnlyLists = useMemo(() => {
    if (bringWorldsOfGame) {
      const { p1, p2, guessed } = bringWorldsOfGame[0];
      return { p1, p2, guessed };
    }
    if (game) return gameLists;
    return replayData ? replayBringOnly(replayData, snapshots) : null;
  }, [replayData, snapshots, bringWorldsOfGame, game, gameLists]);
  /** The bench per side: fielded bodies plus a short side's guesses; null when no side has a list. */
  const bench = useMemo(
    () => (replayData ? replayBench(replayData, snapshots, bringWorldsOfGame?.[0] ?? gameLists ?? undefined) : null),
    [replayData, snapshots, bringWorldsOfGame, gameLists],
  );
  const replayGameType = useMemo(
    () => (replayData ? getReplayGameType(replayData.log) : null),
    [replayData],
  );
  const evalIsDoubles = replayGameType === 'doubles';
  return { replayGen, bringCount, bringOnlyLists, bringWorlds: bringWorldsOfGame, bench, replayGameType, evalIsDoubles };
}

function useTeamSources(
  knowledge: PinnedKnowledge,
  smogon: ReturnType<typeof useSmogonBundle>,
  hpEvidence: ReturnType<typeof useReplay>['hpEvidence'],
) {
  const { teamText, effectiveP1Info, effectiveP2Info, getInferredSpreads, pinnedTeams } = knowledge;
  const { stats } = smogon.usageStats;
  const { assumptions } = smogon.setAssumptions;
  return useMemo(() => ({
    teamText, effectiveP1Info, effectiveP2Info,
    usageStats: { stats },
    setAssumptions: { assumptions },
    hpEvidence, getInferredSpreads, pinnedTeams,
  }), [teamText, effectiveP1Info, effectiveP2Info, stats, assumptions, hpEvidence, getInferredSpreads, pinnedTeams]);
}

function withPinnedTeams(knowledge: TeamKnowledge, pins: ReturnType<typeof usePinnedTeams>) {
  return {
    ...knowledge,
    setsFingerprint: pins.marker ? `${knowledge.setsFingerprint}|pin:${pins.marker}` : knowledge.setsFingerprint,
    pinnedTeams: pins.teams,
    setPinnedTeams: pins.setTeams,
  };
}

type PinnedKnowledge = ReturnType<typeof withPinnedTeams>;

function useLoadsThatEndTheGame(replay: ReturnType<typeof useReplaySurface>, setRecord: (record: null) => void) {
  const { loadReplay: loadRaw, loadReplayFile: loadFileRaw } = replay;
  const loadReplay = useCallback(async (urlOrId: string) => {
    const result = await loadRaw(urlOrId);
    if (result.data) setRecord(null);
    return result;
  }, [loadRaw, setRecord]);
  const loadReplayFile = useCallback(async (content: string, fileName?: string) => {
    const result = await loadFileRaw(content, fileName);
    if (result.data) setRecord(null);
    return result;
  }, [loadFileRaw, setRecord]);
  return { loadReplay, loadReplayFile };
}

export function useReplayContext() {
  const replayWorker = useReplayWorker();
  const replay = useReplaySurface();
  // Read first: the branch filters its bench by the bring lists, whose worlds weigh by the usage statistics.
  const smogon = useSmogonBundle(replay.replayData, replay.p1Info, replay.opponentInfo);
  const gameState = useGameState(replay.replayData?.id ?? null);
  const meta = useFormatMeta(replay.replayData, replay.snapshots, smogon.usageStats.stats, gameState.record);
  /** Set by the new-game hook below; the branch calls it after every finished turn and lead start. */
  const afterTurnRef = useRef<(() => Promise<void>) | null>(null);
  const branch = useBranch(meta.bench, afterTurnRef);
  const evaluation = useEvaluation();
  const engines = useEngineChoice(() => {
    evaluation.cancel();
    evaluation.reset();
    evaluation.clearGraph();
  });
  const replayFormat = replay.replayData?.formatid ?? null;
  useEffect(() => {
    setEngineGameFormat(replayFormat);
  }, [replayFormat]);
  const branchWindowOpenRef = useRef(false);
  const [animateBranchTurns, setAnimateBranchTurns] = useState(true);
  const { sharedBranch, sharedGame, sharedBranchError, clearSharedBranch } = useSharedBranch();
  const refreshQueue = useTeamRefreshQueue(branch.history, branch.simState, branchWindowOpenRef);
  const recordTeams = gameState.record?.teams ?? null;
  const gameTeams = useMemo(() => (recordTeams ? { p1Team: recordTeams.p1, p2Team: recordTeams.p2 } : null), [recordTeams]);
  const pins = usePinnedTeams(replay.replayData?.id ?? null, gameTeams);
  const knowledge = withPinnedTeams(useTeamKnowledge({
    replayData: replay.replayData, p1Info: replay.p1Info, opponentInfo: replay.opponentInfo, itemJudge: replay.itemJudge,
    observations: replay.observations, speedOrders: replay.speedOrders, hpEvidence: replay.hpEvidence,
    usageStats: smogon.usageStats, setAssumptions: smogon.setAssumptions,
    onTeamsEdited: refreshQueue.handleTeamsEdited, replayWorker,
  }), pins);
  const teamSources = useTeamSources(knowledge, smogon, replay.hpEvidence);
  const positions = usePositionSource({
    replayData: replay.replayData, snapshots: replay.snapshots, observations: replay.observations,
    sources: teamSources, setsFingerprint: knowledge.setsFingerprint, bringOnlyLists: meta.bringOnlyLists, bringWorlds: meta.bringWorlds,
    smogonPending: smogon.usageStats.loading || smogon.setAssumptions.loading, replayWorker,
    gameRecord: gameState.record,
  });
  const { newGame, landRef } = useNewGameAt({ state: gameState, replay, branch, positions, afterTurnRef });
  const { loadReplay, loadReplayFile } = useLoadsThatEndTheGame(replay, gameState.setRecord);
  const address = useOpenAddress({
    embed: replay.embed, requestedGame: replay.requestedGame, replayId: replay.replayData?.id ?? null,
    viewpoint: replay.replayData?.viewpoint, byLink: replay.byLink, openRecord: newGame.openRecord,
  });
  const handleLoadSharedOriginal = useCallback((replayId: string) => {
    clearSharedBranch();
    void loadReplay(replayId);
  }, [clearSharedBranch, loadReplay]);
  return {
    replay: { ...replay, loadReplay, loadReplayFile, ...(gameState.record ? { loadedReplayUrl: null } : {}) },
    newGame, landRef, address, branch, evaluation, engines, branchWindowOpenRef, smogon,
    animateBranchTurns, setAnimateBranchTurns,
    shared: { sharedBranch, sharedGame, sharedBranchError, clearSharedBranch, handleLoadSharedOriginal },
    refreshQueue, knowledge, meta, teamSources, positions,
  };
}

export type ReplayContext = ReturnType<typeof useReplayContext>;
