import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useReplay } from './hooks/useReplay';
import { useEmbedHost } from './hooks/useEmbedHost';
import { useBranch } from './hooks/useBranch';
import type { BranchHistoryEntry } from './hooks/useBranch';
import { useSmogonUsageStats } from './hooks/useSmogonUsageStats';
import { useSmogonSetAssumptions } from './hooks/useSmogonSetAssumptions';
import { ReplayLoader } from './components/ReplayLoader';
import { PSReplayFrame } from './components/PSReplayFrame';
import { BranchPanel } from './components/BranchPanel';
import { LeadPanel } from './components/LeadPanel';
import { BranchHistoryPanel } from './components/BranchHistoryPanel';
import { BranchSaveSharePanel } from './components/BranchSaveSharePanel';
import { BattleStatsPanel } from './components/BattleStatsPanel';
import { TeamEditor } from './components/TeamEditor';
import { SetsImportExportPanel } from './components/SetsImportExportPanel';
import { EvalPanel } from './components/EvalPanel';
import { AppTopBar } from './components/AppTopBar';
import { TimelineBar } from './components/TimelineBar';
import { PlayOutBar } from './components/PlayOutBar';
import { ConfirmBanner } from './components/ConfirmBanner';
import { useEvaluation } from './hooks/useEvaluation';
import { buildSetsExport } from './lib/sets-io';
import { manualMove } from './lib/team-info';
import { useTeamKnowledge } from './hooks/useTeamKnowledge';
import type { OpponentTeamInfo } from './types';
import { SharedBranchView } from './components/SharedBranchView';
import { useSharedBranch } from './hooks/useSharedBranch';
import { getReplayBringCount, getReplayGameType, getReplayGeneration, replayBringOnly } from './lib/replay-format';
import { useEvalAcquire } from './hooks/useEvalAcquire';
import { useGameAnalysis } from './hooks/useGameAnalysis';
import { choiceId, type BranchSlotChoice } from './lib/branch-choices';
import type { EvalResult } from './lib/eval/types';
import { parsePlayedActions, parsePlayedActionsDoubles } from './lib/eval/played';
import { useTimeline } from './hooks/useTimeline';
import { useDeviation } from './hooks/useDeviation';
import { useBranchRefresh } from './hooks/useBranchRefresh';
import { usePlayedAtView, usePositionPicker } from './hooks/usePositionPicker';
import { useEngineWalk } from './hooks/useEngineWalk';
import { usePlayOut } from './hooks/usePlayOut';
import { useEvalView } from './hooks/useEvalView';

/** View-side gates for the acquisition hook: whether the dwell rebuild may
 *  arm (main-line position, nothing busy) and whether Smogon data is due. */
function acquireGates(args: {
  liveTip: boolean;
  viewingVariation: boolean;
  atEndPosition: boolean;
  executing: boolean;
  branchPreparing: boolean;
  playOut: { active: boolean } | null;
  evaluation: ReturnType<typeof useEvaluation>;
  usageStats: { loading: boolean };
  setAssumptions: { loading: boolean };
}) {
  const dwellEnabled = !args.liveTip && !args.viewingVariation && !args.atEndPosition
    && !args.executing && !args.branchPreparing && !args.playOut?.active
    && args.evaluation.status !== 'reconstructing' && args.evaluation.status !== 'searching'
    && !args.evaluation.graph.running;
  return { dwellEnabled, smogonPending: args.usageStats.loading || args.setAssumptions.loading };
}

function App() {
  const { loading, error, replayData, snapshots, observations, speedOrders, hpEvidence, opponentInfo, p1Info, loadReplay, loadReplayFile } = useReplay();
  const { embed, requestedReplay } = useEmbedHost({ loadReplay, loadReplayFile });
  const {
    branching, simState, history, executeError, executing,
    variationStartTurn, startSerialized,
    startBranch, setChoice, executeTurn, stopBranch, getBattle,
  } = useBranch();
  const evaluation = useEvaluation();
  const branchWindowOpenRef = useRef(false);
  const usageStats = useSmogonUsageStats(replayData?.formatid);
  const revealedSpecies = useMemo(() => {
    const p1 = p1Info?.pokemon.map(pokemon => pokemon.species) ?? [];
    const p2 = opponentInfo?.pokemon.map(pokemon => pokemon.species) ?? [];
    return [...new Set([...p1, ...p2])];
  }, [p1Info, opponentInfo]);
  const setAssumptions = useSmogonSetAssumptions(replayData?.formatid, revealedSpecies);

  /**
   * Honest divergence notice: guessed sets can make the branch replay
   * DIVERGE from the real game — in the worst case the simulated game ends
   * before the requested turn (GPL T39: three rejected choices, sim winner
   * declared early). Playing recommendations into that dead sim produced
   * baffling errors ("more choices than unfainted Pokémon"); instead the
   * divergence is surfaced and play-outs are refused.
   */
  const [animateBranchTurns, setAnimateBranchTurns] = useState(true);
  const { sharedBranch, sharedBranchError, clearSharedBranch } = useSharedBranch();
  const [pendingBranchRefresh, setPendingBranchRefresh] = useState<{
    p1Info: OpponentTeamInfo;
    p2Info: OpponentTeamInfo;
    history: BranchHistoryEntry[];
    p1Choices: (BranchSlotChoice | null)[];
    p2Choices: (BranchSlotChoice | null)[];
  } | null>(null);

  // Edited team knowledge changes the sim's inputs — refresh a live branch
  // with the same history and pending choices.
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
  }, [history, simState]);
  const {
    teamText, teamPasteStatus, teamPasteError, handleTeamLoad,
    editedP1Info, editedP2Info, setEditedP1Info, setEditedP2Info,
    editorSide, setEditorSide, setsPanelOpen, setSetsPanelOpen,
    effectiveP1Info, effectiveP2Info, statsP1Info, statsP2Info,
    setsFingerprint, replayGenNumber, getInferredSpreads, sensitivityTargetsFor,
    applySetsText, saveTeam,
  } = useTeamKnowledge({
    replayData, p1Info, opponentInfo, observations, speedOrders, hpEvidence,
    usageStats, setAssumptions, onTeamsEdited: handleTeamsEdited,
  });

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

  // Mirrors for the play-out state and its stop: user navigation while the
  // engine plays must STOP the run — the loop only advances while the
  // pointer sits on the live tip, so a silent stall with "Engine is
  // playing…" frozen was the alternative. Internal navigations (tip-follow,
  // the finish's return to the start turn) keep the run alive.
  const playOutRef = useRef<{ active: boolean } | null>(null);
  const stopPlayOutRef = useRef<((opts?: { returnToStart?: boolean }) => void) | null>(null);

  // ── "Let it play out": the engine plays BOTH sides' top choice from the
  // current position until the game ends, the user stops, or the safety cap
  // trips. Each executed turn is a normal history entry — navigable,
  // evaluable, truncatable like anything else; Stop keeps what was played.
  // (Declared up here so render-time deriveds below may read it.)
  const [playOut, setPlayOut] = useState<{ active: boolean; executed: number; turns: number; startTurn: number; prevAuto: boolean } | null>(null);
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
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; proceed: () => void } | null>(null);

  // The transient interaction state dies with the previous replay —
  // render-phase adjustment on the replay id (the react-hooks gate forbids
  // plain setState resets inside the load-sync effect below).
  const [transientsReplayId, setTransientsReplayId] = useState(replayData?.id);
  if (transientsReplayId !== replayData?.id) {
    setTransientsReplayId(replayData?.id);
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

  // ── Unified timeline: one pointer over main line + at most one variation ──
  const {
    viewTurn, viewTurnRef, setViewTurn, viewLine, setViewLine, viewT0,
    navSeek, setNavSeek, variationScores, setVariationScores, resetPointer,
    maxTurn, endSnapshotTurn, atEndPosition, variationSpan, viewingVariation,
    liveSimTurn, liveTip, liveEvalView, evalViewKey, tipTurn, serializedAtView, analyzableTurns,
    navigateTo, handleReplayTurn, handleGraphSelectLine, analysisTurn,
  } = useTimeline({
    replayId: replayData?.id, snapshots, branching, variationStartTurn, history,
    interruptPlayOut, onNavigate: clearDraftChoices,
  });
  const evalResultMatchesView = evaluation.resultTag === null || evaluation.resultTag === evalViewKey;
  const liveEvalStatus: typeof evaluation.status =
    evaluation.status === 'done' && !evalResultMatchesView ? 'stale' : evaluation.status;

  // ----- Position evaluation (singles + doubles) -----
  const replayGameType = useMemo(
    () => (replayData ? getReplayGameType(replayData.log) : null),
    [replayData],
  );
  const evalIsDoubles = replayGameType === 'doubles';

  // One team-source bundle for every acquisition path; deps are the inner
  // stable values (the Smogon hook objects are fresh per render).
  const teamSources = useMemo(() => ({
    teamText, effectiveP1Info, effectiveP2Info,
    usageStats: { stats: usageStats.stats },
    setAssumptions: { assumptions: setAssumptions.assumptions },
    hpEvidence, getInferredSpreads,
  }), [teamText, effectiveP1Info, effectiveP2Info, usageStats.stats, setAssumptions.assumptions, hpEvidence, getInferredSpreads]);

  // Deviation machinery: the rebuild road, the chess-rule requests, the
  // shared preparation session, and the picker draft plumbing.
  const deviationTimeline = useMemo(() => ({
    viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores,
    setViewTurn, setViewLine, liveTip,
  }), [viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores, setViewTurn, setViewLine, liveTip]);
  const deviationBranch = useMemo(() => ({
    startBranch, getBattle, executeTurn, setChoice, history,
  }), [startBranch, getBattle, executeTurn, setChoice, history]);
  const {
    branchDivergence, setBranchDivergence, branchPreparing, branchProgress, branchSession,
    cancelPreparation, session, rebuildAt, requestDeviation, startLeadVariation,
    handleSetChoice, handleExecuteDraft, leadOptions, defaultLeadSelection,
  } = useDeviation({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists, bringCount,
    replayGameType, timeline: deviationTimeline, branch: deviationBranch,
    branchWindowOpenRef, setPendingConfirm, draftChoices, setDraftChoices,
  });
  const clearRefreshRequest = useCallback(() => setPendingBranchRefresh(null), []);
  useBranchRefresh({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists,
    branching, variationStartTurn, startBranch, viewTurn, session, branchWindowOpenRef,
    request: pendingBranchRefresh, clearRequest: clearRefreshRequest,
  });

  const discardVariation = useCallback(() => {
    branchWindowOpenRef.current = false;
    stopBranch();
    setBranchDivergence(null);
    setPendingConfirm(null);
    setPlayOut(null);
    setPlayOutNotice(null);
    setDraftChoices({ p1: [], p2: [] });
    setVariationScores([]);
    setViewLine('main');
    setViewTurn(current => Math.min(current, maxTurn));
  }, [stopBranch, maxTurn, setViewTurn, setViewLine, setVariationScores, setBranchDivergence]);

  // A freshly loaded replay must start clean: slider at turn 1 (B11), no live
  // branch, and no team edits carried over from the previous replay. Host
  // pages can inject replays repeatedly via ps-load-replay, so the previous
  // game's state must never leak into the next one.
  useEffect(() => {
    resetPointer();
    setBranchDivergence(null);
    branchWindowOpenRef.current = false;
    stopBranch();
  }, [replayData?.id, stopBranch, resetPointer, setBranchDivergence]);

  const { dwellEnabled, smogonPending } = acquireGates({
    liveTip, viewingVariation, atEndPosition, executing, branchPreparing,
    playOut, evaluation, usageStats, setAssumptions,
  });
  const {
    acquireBranchPosition, makeReplayAcquire, acquireReplayPosition,
    makeSweepAcquireAll, sweepAlignment, exactAcquiringTurn,
    getExact, exactPositionsVersion,
  } = useEvalAcquire({
    replayData, snapshots, observations, sources: teamSources, setsFingerprint,
    bringOnlyLists, getBattle, viewTurn, dwellEnabled, smogonPending,
  });

  const { positionPicker, pickerSimState } = usePositionPicker({
    replayData, snapshots, sources: teamSources, bringOnlyLists, replayGenNumber,
    liveTip, viewingVariation, serializedAtView, viewTurn, variationStartTurn, startSerialized,
    getExact, exactPositionsVersion, draftChoices,
  });
  const playedAtView = usePlayedAtView({
    viewingVariation, variationSpan, viewTurn, history, snapshots, doubles: evalIsDoubles,
    parseSingles: parsePlayedActions, parseDoubles: parsePlayedActionsDoubles,
  });

  // Evaluation view glue: format switches, Evaluate, sweeps, invalidations,
  // and the think-deeper ladder.
  const {
    evalAvailable, handleEvaluate, handleAnalyzeGame,
    analyzedResult, analyzedSettings, thinkDeeperTarget, handleThinkDeeper,
  } = useEvalView({
    replayData, snapshots, evaluation, replayGameType, evalIsDoubles,
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, serializedAtView,
    liveEvalStatus, analysisTurn, analyzableTurns, branching, executing, branchPreparing,
    playOutActive: playOut?.active ?? false, smogonPending,
    acquire: { acquireBranchPosition, acquireReplayPosition, makeReplayAcquire, makeSweepAcquireAll },
    sources: teamSources, bringOnlyLists, setsFingerprint, sensitivityTargetsFor,
    editedP1Info, editedP2Info, historyLength: history.length, setVariationScores,
  });

  // Engine walk: clicking a line plays the turn out; queued picks follow
  // a rebuild; interludes finish forced replacements.
  const {
    applyEvalChoice, handleExploreChoice, handlePickPair, clearPendingPick,
  } = useEngineWalk({
    simState, liveTip, branching, branchPreparing, executing,
    confirmOpen: pendingConfirm !== null, playOutActive: playOut?.active ?? false,
    evaluation, evalViewKey, getBattle, executeTurn, handleEvaluate, handleSetChoice,
    requestDeviation, setBranchDivergence,
  });

  // "Let it play out": the engine plays both sides from the viewed position.
  const { startPlayOut, stopPlayOut, watchFrom } = usePlayOut({
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    evaluation, evalViewKey, liveEvalStatus, liveTip, viewingVariation, atEndPosition, viewT0,
    viewTurn, variationSpan, tipTurn, navigateTo, setNavSeek, setVariationScores,
    executing, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice,
    rebuildAt, requestDeviation, startLeadVariation, defaultLeadSelection,
  });

  // "What if it had …": a team edit plus the normal branch refresh, with the
  // hypothetical move pre-seeded as that slot's pending choice.
  const handleHypotheticalMove = useCallback((
    side: 'p1' | 'p2',
    activeSlot: number,
    params: { species: string; move: string; replace: string | null },
  ) => {
    const sideInfo = side === 'p1' ? effectiveP1Info : effectiveP2Info;
    if (!sideInfo) return;
    // The hypothetical seeds a pending choice where the sim will stand after
    // the refresh: the live tip, or — with no variation — the viewed turn
    // (the refresh flow rebuilds there). Mid-variation views stay inert; the
    // seeded slot would belong to the tip, not the viewed position.
    if (variationSpan !== null && !liveTip) return;

    const speciesId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const pokemon = sideInfo.pokemon.map(entry => {
      if (speciesId(entry.species) !== speciesId(params.species)) return entry;
      const withoutReplaced = params.replace
        ? entry.moves.filter(move => move.name !== params.replace)
        : entry.moves.slice(0, 3);
      return { ...entry, moves: [...withoutReplaced, manualMove(params.move)].slice(0, 4) };
    });
    const updated = { pokemon };

    const nextP1 = side === 'p1' ? updated : effectiveP1Info;
    const nextP2 = side === 'p2' ? updated : effectiveP2Info;
    if (side === 'p1') setEditedP1Info(updated); else setEditedP2Info(updated);

    const seedChoices = (choices: (BranchSlotChoice | null)[], seedSide: 'p1' | 'p2') => {
      const next = [...choices];
      if (seedSide === side) {
        next[activeSlot] = { kind: 'move', moveId: choiceId(params.move), moveName: params.move };
      }
      return next;
    };

    if (nextP1 && nextP2) {
      setPendingBranchRefresh({
        p1Info: nextP1,
        p2Info: nextP2,
        history: [...history],
        p1Choices: seedChoices((liveTip && simState?.p1Choices) || [], 'p1'),
        p2Choices: seedChoices((liveTip && simState?.p2Choices) || [], 'p2'),
      });
    }
  }, [effectiveP1Info, effectiveP2Info, setEditedP1Info, setEditedP2Info, simState, history, liveTip, variationSpan]);

  const handleExecuteTurn = useCallback(async () => {
    await executeTurn();
  }, [executeTurn]);

  const handleLoadSharedOriginal = useCallback((replayId: string) => {
    clearSharedBranch();
    void loadReplay(replayId);
  }, [clearSharedBranch, loadReplay]);

  // Canonical link of whatever is loaded — mirrored into the loader input,
  // whichever path (typed URL, file, share link, embed message) loaded it.
  const loadedReplayUrl = replayData
    ? `https://replay.pokemonshowdown.com/${replayData.id}${replayData.viewpoint === 'p2' ? '?p2' : ''}`
    : null;

  // Per-turn and game-level analysis (reads, turn card, lead analysis,
  // game report, the feedback harness's window handle).
  const { turnReads, turnAnalysis, leadAnalysisData, gameReport } = useGameAnalysis({
    replayData, snapshots, evaluation, analysisTurn, sweepAlignment, replayGen,
  });


  const simLog = useMemo(() => {
    const raw = simState?.log ?? [];
    if (raw.length === 0) return '';
    // |debug| lines would render as "[DEBUG] …" in the embed's battle log (G13).
    return raw.filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|debug|')).join('\n');
  }, [simState?.log]);
  const latestBranchHistoryEntry = history.length > 0 ? history[history.length - 1] : null;

  const showBranch = branching && simLog.length > 0;
  // Session + branch start, NOT the viewed turn: the pointer moves constantly
  // on the unified timeline, and a viewTurn-keyed reload would remount the
  // sim iframe on every navigation and every executed turn (tip advance).
  const branchReloadKey = `${branchSession}:${variationStartTurn ?? 0}`;

  return (
    <div className="ps-app-root">
      {/* Header (hidden when framed by a host site, and once a replay is
          loaded — on a 1080p screen every row above the pickers counts). */}
      {!embed && !replayData && (
        <div className="ps-app-header" style={{ borderRadius: '0 0 5px 5px' }}>
          <h1>PS Dashboard</h1>
          <span style={{ fontSize: 10, color: '#aabbcc' }}>
            Load a replay · branch off with different moves
          </span>
        </div>
      )}

      {sharedBranchError && !sharedBranch && (
        <div className="ps-panel" role="alert" style={{ marginTop: 8, color: '#f3a6a6', fontSize: 11 }}>
          Unable to open shared branch: {sharedBranchError}
        </div>
      )}

      {sharedBranch && (
        <SharedBranchView
          branch={sharedBranch}
          onLoadOriginal={handleLoadSharedOriginal}
          onClear={clearSharedBranch}
        />
      )}

      {!replayData && !sharedBranch && (embed ? (
        // The host page provides the replay — no loader chrome in embed mode.
        <div className="ps-panel" style={{ marginTop: 8, fontSize: 12, color: '#aebdd0' }}>
          {error ? (
            <span role="alert" style={{ color: '#f3a6a6' }}>{error}</span>
          ) : loading || requestedReplay ? (
            'Loading replay…'
          ) : (
            'Waiting for a replay from the host page…'
          )}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <ReplayLoader
            onLoad={loadReplay}
            onLoadFile={loadReplayFile}
            onTeamLoad={handleTeamLoad}
            loading={loading}
            error={error}
            loadedUrl={loadedReplayUrl}
            teamStatus={teamPasteStatus}
            teamError={teamPasteError}
            showGuide
          />
        </div>
      ))}

      {replayData && !sharedBranch && (
        <div className="ps-main-layout">
          {/* Left column: iframe */}
          <div className="ps-main-left">
            {/* Match info + loader collapsed into one bar */}
            <AppTopBar
              replayData={replayData}
              usageStats={usageStats}
              setAssumptions={setAssumptions}
              branchPreparing={branchPreparing}
              branchProgress={branchProgress}
              showBranch={showBranch}
              simState={simState}
              animateBranchTurns={animateBranchTurns}
              branchDivergence={branchDivergence}
              onCancelPreparation={cancelPreparation}
              onAnimateChange={setAnimateBranchTurns}
              onEditSide={setEditorSide}
              onOpenSets={() => setSetsPanelOpen(true)}
            />

            {/* Single iframe */}
            <div className="ps-iframe-wrap">
              {showBranch && viewingVariation ? (
                <PSReplayFrame
                  key="branch"
                  log={simLog}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  title="Branch Simulation"
                  height={480}
                  seekTurn={viewTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  liveUpdates
                  liveAppendMode={playOut?.active ? 'hold' : animateBranchTurns ? 'play' : 'follow-end'}
                  liveAppendTurn={latestBranchHistoryEntry?.turnNumber ?? null}
                  reloadKey={branchReloadKey}
                  seekRequest={navSeek}
                />
              ) : (
                <PSReplayFrame
                  key="replay"
                  log={replayData.log}
                  format={replayData.format}
                  p1={replayData.players[0]}
                  p2={replayData.players[1]}
                  height={480}
                  seekTurn={viewT0 ? 0 : viewTurn}
                  autoPlay={false}
                  viewpoint={replayData.viewpoint}
                  reloadKey={`${replayData.id}:original`}
                  onTurnChange={handleReplayTurn}
                />
              )}
            </div>

            {/* Timeline bar: always visible — one slider over main line and variation */}
            <TimelineBar
              viewT0={viewT0}
              viewTurn={viewTurn}
              viewLine={viewLine}
              variationSpan={variationSpan}
              maxTurn={maxTurn}
              endSnapshotTurn={endSnapshotTurn}
              atEndPosition={atEndPosition}
              viewingVariation={viewingVariation}
              branching={branching}
              onNavigate={navigateTo}
              onGraphSelectLine={handleGraphSelectLine}
              onDiscard={discardVariation}
            />

            {branchDivergence && !showBranch && (
              <div className="ps-panel" role="alert" style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, color: '#e6b36a' }}>
                ⚠ {branchDivergence}
              </div>
            )}
            {pendingConfirm && (
              <ConfirmBanner
                message={pendingConfirm.message}
                onProceed={pendingConfirm.proceed}
                onCancel={() => { setPendingConfirm(null); clearPendingPick(); setPlayOut(null); }}
              />
            )}

            {/* Variant B: the pickers are ALWAYS there — live sim state at the
                tip, resolved picker state (stored/snapshot) everywhere else.
                On T0 the lead picker takes their place. */}
            {playOut?.active ? (
              /* A steady stand-in while the engine plays: the per-turn picker
                 churn was the "everything keeps switching" complaint, and a
                 click here mid-run would corrupt the loop anyway. */
              <div className="ps-panel" role="status" style={{ fontSize: 11, color: '#aabbcc' }}>
                <span className="ps-spinner" aria-hidden="true" />{' '}
                The engine is picking both sides&rsquo; moves — the pickers come back when it stops.
              </div>
            ) : viewT0 ? (
              <LeadPanel
                key={`${replayData.id}:${leadOptions.p1.length}`}
                playerNames={[replayData.players[0], replayData.players[1]]}
                p1Options={leadOptions.p1}
                p2Options={leadOptions.p2}
                leadsPerSide={replayGameType === 'doubles' ? 2 : 1}
                bringCount={bringCount}
                pickedLeads={variationSpan?.startTurn === 0 ? history[0]?.leadChoices ?? null : null}
                executing={executing || branchPreparing}
                onStart={leads => startLeadVariation(bringCount !== null ? { ...leads, bring: true } : leads)}
              />
            ) : (
            <BranchPanel
              simState={liveTip ? simState : pickerSimState}
              source={liveTip ? 'live' : positionPicker?.source}
              acquiringExact={!liveTip && exactAcquiringTurn === viewTurn}
              executeError={executeError}
              executing={executing || branchPreparing}
              gen={replayGen}
              onSetChoice={handleSetChoice}
              onHypotheticalMove={handleHypotheticalMove}
              onExecuteTurn={liveTip ? handleExecuteTurn : handleExecuteDraft}
              played={playedAtView}
            />
            )}
            {(branching || variationSpan !== null) && (
              <>
                <BranchHistoryPanel
                  branchStartTurn={variationSpan?.startTurn ?? viewTurn}
                  history={history}
                  snapshots={snapshots}
                  currentPosition={{ turn: viewTurn, line: viewingVariation ? 'variation' : 'main' }}
                  onNavigate={navigateTo}
                />
                <BranchSaveSharePanel
                  replayData={replayData}
                  branchTurn={variationSpan?.startTurn ?? viewTurn}
                  history={history}
                  finalLog={simLog}
                />
              </>
            )}
            {!embed && (
              <ReplayLoader
                onLoad={loadReplay}
                onLoadFile={loadReplayFile}
                onTeamLoad={handleTeamLoad}
                loading={loading}
                error={error}
                loadedUrl={loadedReplayUrl}
                teamStatus={teamPasteStatus}
                teamError={teamPasteError}
              />
            )}
          </div>

          {/* Right column: evaluation beside the battle (chess-style), then stats */}
          <div className="ps-main-right">
            {evalAvailable && (
              <EvalPanel
                playerNames={[replayData.players[0], replayData.players[1]]}
                status={liveEvalView ? liveEvalStatus : 'idle'}
                result={analyzedResult}
                resultSettings={analyzedSettings}
                onThinkDeeper={!liveEvalView ? handleThinkDeeper : undefined}
                thinkDeeperTarget={!liveEvalView ? thinkDeeperTarget : null}
                smogonPending={smogonPending}
                progress={evaluation.progress}
                reconstructProgress={evaluation.reconstructProgress}
                error={evaluation.error}
                prefs={evaluation.prefs}
                onPrefsChange={evaluation.setPrefs}
                onEvaluate={liveEvalView ? handleEvaluate : undefined}
                onCancel={evaluation.cancel}
                onPickChoice={handleExploreChoice}
                onPickPair={handlePickPair}
                showAuto={liveEvalView}
                showTera={replayGen === 9}
                graph={evaluation.graph}
                onAnalyzeGame={handleAnalyzeGame}
                positionLabel={liveEvalView ? `Turn ${viewTurn} · ${viewingVariation ? 'variation' : 'main line'}` : null}
                playOutProgress={playOut?.active ? { startTurn: playOut.startTurn, turns: playOut.turns, atTurn: liveSimTurn } : null}
                graphMaxTurn={analyzableTurns}
                analysisTurn={analysisTurn}
                onSelectTurn={handleGraphSelectLine}
                currentTurn={viewTurn}
                currentLine={viewingVariation ? 'variation' : 'main'}
                variation={variationSpan ? { startTurn: variationSpan.startTurn, scores: variationScores } : null}
                analysis={!liveEvalView ? turnAnalysis : null}
                reads={!liveEvalView ? turnReads : null}
                leadAnalysis={!liveEvalView && analysisTurn === 0 ? leadAnalysisData : null}
                reportLeads={leadAnalysisData}
                report={!liveEvalView ? gameReport : null}
                doubles={replayGameType === 'doubles'}
              />
            )}
            {evalAvailable && (
              <PlayOutBar
                playOut={playOut}
                playOutNotice={playOutNotice}
                hasVariation={variationSpan !== null}
                viewTurn={viewTurn}
                startDisabled={branchPreparing || usageStats.loading || setAssumptions.loading}
                onStartPlayOut={startPlayOut}
                onStopPlayOut={stopPlayOut}
                onWatchFrom={watchFrom}
              />
            )}
            <BattleStatsPanel
              replayData={replayData}
              p1Info={statsP1Info}
              p2Info={statsP2Info}
            />
          </div>
        </div>
      )}

      {setsPanelOpen && replayData && (
        <SetsImportExportPanel
          exportText={buildSetsExport({
            p1Name: replayData.players[0] ?? 'p1',
            p2Name: replayData.players[1] ?? 'p2',
            p1Info: effectiveP1Info,
            p2Info: effectiveP2Info,
          })}
          onImport={text => {
            const importError = applySetsText(text);
            if (!importError) setSetsPanelOpen(false);
            return importError;
          }}
          onClose={() => setSetsPanelOpen(false)}
        />
      )}

      {editorSide === 'p1' && effectiveP1Info && (
        <TeamEditor
          title="Edit Player Team"
          teamInfo={effectiveP1Info}
          gen={replayGen}
          onSave={(info) => saveTeam('p1', info)}
          onClose={() => setEditorSide(null)}
        />
      )}

      {editorSide === 'p2' && effectiveP2Info && (
        <TeamEditor
          title="Edit Opponent Team"
          teamInfo={effectiveP2Info}
          gen={replayGen}
          onSave={(info) => saveTeam('p2', info)}
          onClose={() => setEditorSide(null)}
        />
      )}
    </div>
  );
}

export default App;
