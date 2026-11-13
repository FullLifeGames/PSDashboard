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
  const { embed, requestedReplay, requestedGame } = useEmbedHost({ loadReplay, loadReplayFile });
  // Canonical link of whatever is loaded — mirrored into the loader input,
  // whichever path (typed URL, file, share link, embed message) loaded it.
  const loadedReplayUrl = replayData
    ? `https://replay.pokemonshowdown.com/${replayData.id}${replayData.viewpoint === 'p2' ? '?p2' : ''}`
    : null;
  return {
    loading, error, replayData, snapshots, observations, speedOrders, hpEvidence,
    opponentInfo, p1Info, itemJudge, loadReplay, loadReplayFile, openGame, extendGame, embed, requestedReplay, requestedGame, loadedReplayUrl, byLink,
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

function useFormatMeta(replayData: ReplayData | null, snapshots: TurnSnapshot[], usageStats: SmogonUsageStats | null, game: NewGameRecord | null) {
  const replayGen = useMemo(() => replayData ? getReplayGeneration(replayData) : 9, [replayData]);
  /** Bring-limited team preview (VGC 4 of 6, BSS 3 of 6) — null brings all. */
  const bringCount = useMemo(
    () => (replayData ? getReplayBringCount(replayData) : null),
    [replayData],
  );
  /** Round 89 (#124): the worlds of a game where a side brought more bodies than it fielded, the heaviest first (the guesses come
   *  from the side's team preview, weighted by the format's usage counts). Null for every other game: a bring-all format and a game
   *  whose sides both fielded their whole selection (one pinned world) read through `replayBringOnly` as before. The weights follow
   *  the statistics when they arrive, so the memo reads them. */
  const bringWorldsOfGame = useMemo(() => {
    // Round 89 (#105): a new game's log holds the bodies fielded so far only; its lists are the lead entry's, below.
    const list = replayData && !game ? replayBringList(replayData, snapshots, usageStats) : null;
    if (!list || (list.p1.open === 0 && list.p2.open === 0)) return null;
    return bringWorlds(list, BRING_WORLD_CAP);
  }, [replayData, snapshots, usageStats, game]);
  /** A new game's brought selection: the lead entry's lists when the lead pick carried the bring (VGC 4 of 6), else none. */
  const gameLists = useMemo(() => {
    const lead = game?.entries[0]?.leadChoices;
    return lead?.bring ? { p1: lead.p1, p2: lead.p2 } : null;
  }, [game]);
  /** The bring lists the rebuild pins, from the protocol: null for a bring-all format. A game with a short side plays its heaviest
   *  world: the fielded bodies plus the guesses, which `guessed` counts at the end of each list (round 89, #124; before it, a
   *  short side left both teams at six, ADR 0010). Shared by every branch, sweep, and preview reconstruction. */
  const bringOnlyLists = useMemo(() => {
    if (bringWorldsOfGame) {
      const { p1, p2, guessed } = bringWorldsOfGame[0];
      return { p1, p2, guessed };
    }
    if (game) return gameLists;
    return replayData ? replayBringOnly(replayData, snapshots) : null;
  }, [replayData, snapshots, bringWorldsOfGame, game, gameLists]);
  /** Round 88 (T314, #55): the bench the user sees, per side: the bodies the side fielded, and for a short side the heaviest
   *  world's guess besides (round 89). Null when no side has a list. */
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

/** One team-source bundle for every acquisition path; deps are the inner
 *  stable values (the Smogon hook objects are fresh per render). */
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

/**
 * The team knowledge with the reproduction's pin (round 77): the pinned teams for the build, and the pin's
 * marker in the sets fingerprint every store and cache keys on.
 */
function withPinnedTeams(knowledge: TeamKnowledge, pins: ReturnType<typeof usePinnedTeams>) {
  return {
    ...knowledge,
    setsFingerprint: pins.marker ? `${knowledge.setsFingerprint}|pin:${pins.marker}` : knowledge.setsFingerprint,
    pinnedTeams: pins.teams,
    setPinnedTeams: pins.setTeams,
  };
}

type PinnedKnowledge = ReturnType<typeof withPinnedTeams>;

/** A replay loaded after a game ends the game (a failed load leaves it as it was). */
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

/**
 * Foundation layer: the loaded replay, the branch simulator, the evaluation
 * engine handle, Smogon knowledge, team knowledge, and format metadata.
 * Call order matches the pre-split App() exactly.
 */
export function useReplayContext() {
  const replayWorker = useReplayWorker();
  const replay = useReplaySurface();
  // Round 88 (T314, #55): the branch filters its bench by the bring lists, so the format meta is read before it. Round 89 (#124):
  // the worlds of a short side weigh by the usage statistics, so the Smogon bundle is read first.
  const smogon = useSmogonBundle(replay.replayData, replay.p1Info, replay.opponentInfo);
  const gameState = useGameState(replay.replayData?.id ?? null);
  const meta = useFormatMeta(replay.replayData, replay.snapshots, smogon.usageStats.stats, gameState.record);
  /** Set by the new-game hook below: the branch calls it after every finished turn and every lead start (round 89, #105). */
  const afterTurnRef = useRef<(() => Promise<void>) | null>(null);
  const branch = useBranch(meta.bench, afterTurnRef);
  const evaluation = useEvaluation();
  // Round 77: another engine's results never mix with the own engine's on screen.
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
  const { sharedBranch, sharedBranchError, clearSharedBranch } = useSharedBranch();
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
  // Every exact position (Evaluate, the sweep, the dwell, a branch start)
  // comes from one source: the store, else the replay worker.
  const positions = usePositionSource({
    replayData: replay.replayData, snapshots: replay.snapshots, observations: replay.observations,
    sources: teamSources, setsFingerprint: knowledge.setsFingerprint, bringOnlyLists: meta.bringOnlyLists, bringWorlds: meta.bringWorlds,
    smogonPending: smogon.usageStats.loading || smogon.setAssumptions.loading, replayWorker,
    gameRecord: gameState.record,
  });
  const { newGame, landRef } = useNewGameAt({ state: gameState, replay, branch, positions, afterTurnRef });
  const { loadReplay, loadReplayFile } = useLoadsThatEndTheGame(replay, gameState.setRecord);
  // Round 89 (#105, H4c): the address names what is open, and a game it names opens at start.
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
    shared: { sharedBranch, sharedBranchError, clearSharedBranch, handleLoadSharedOriginal },
    refreshQueue, knowledge, meta, teamSources, positions,
  };
}

export type ReplayContext = ReturnType<typeof useReplayContext>;
