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
import { needsSettingsUpgrade, resolveAutoTurnSettings, useEvaluation, type TurnEvalSettings } from './hooks/useEvaluation';
import { buildSetsExport } from './lib/sets-io';
import { manualMove } from './lib/team-info';
import { useTeamKnowledge } from './hooks/useTeamKnowledge';
import type { OpponentTeamInfo } from './types';
import { SharedBranchView } from './components/SharedBranchView';
import { useSharedBranch } from './hooks/useSharedBranch';
import { formatEnforcesSleepClause, getBranchSimulatorFormat, getReplayBringCount, getReplayGameType, getReplayGeneration, inferReplayFormatId, replayBringOnly } from './lib/replay-format';
import { resolveTeraPreference } from './lib/eval/tera';
import { useEvalAcquire } from './hooks/useEvalAcquire';
import { useGameAnalysis } from './hooks/useGameAnalysis';
import { choiceId, type BranchSlotChoice } from './lib/branch-choices';
import type { EvalResult } from './lib/eval/types';
import { parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles } from './lib/eval/played';
import { sliderMax, variationTip } from './lib/timeline';
import { useTimeline } from './hooks/useTimeline';
import { useDeviation } from './hooks/useDeviation';
import { useBranchRefresh } from './hooks/useBranchRefresh';
import { usePlayedAtView, usePositionPicker } from './hooks/usePositionPicker';
import { useEngineWalk } from './hooks/useEngineWalk';
import { usePlayOut } from './hooks/usePlayOut';

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
    setDraftChoices({ p1: [], p2: [] });
    setPendingConfirm(null);
    setPlayOut(null);
    setPlayOutNotice(null);
    setBranchDivergence(null);
    branchWindowOpenRef.current = false;
    stopBranch();
  }, [replayData?.id, stopBranch, resetPointer, setBranchDivergence]);

  const evalAvailable = useMemo(
    () => !!replayData && (replayGameType === null || replayGameType === 'singles' || replayGameType === 'doubles'),
    [replayData, replayGameType],
  );


  // Tera resolution: 'auto' turns enumeration off when the game never
  // terastallized, and in draft/custom formats (per-Pokémon Tera rights)
  // restricts it to the species that actually did — a global switch would
  // recommend illegal Teras and price floors against impossible threats.
  const effectiveTera = useMemo(
    () => (replayData
      ? resolveTeraPreference(evaluation.prefs.tera, inferReplayFormatId(replayData), replayData.log)
      : false),
    [replayData, evaluation.prefs.tera],
  );

  // Sleep Clause resolution: the branch format carries it (declared |rule|
  // lines, or the singles default for rule-less logs) — the eval candidate
  // filter needs it as a flag because serialization strips custom rules.
  const effectiveSleepClause = useMemo(
    () => (replayData ? formatEnforcesSleepClause(getBranchSimulatorFormat(replayData)) : false),
    [replayData],
  );

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

  const handleEvaluate = useCallback(() => {
    if (!replayData) return;
    if (liveTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: acquireBranchPosition, tag: evalViewKey });
    } else if (viewingVariation && serializedAtView) {
      // A recorded variation position: acquisition is instant — the search
      // itself still runs at the configured settings.
      const stored = serializedAtView;
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: async () => stored, tag: evalViewKey });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${viewTurn}:${setsFingerprint}`,
        tera: effectiveTera,
        sleepClause: effectiveSleepClause,
        acquire: acquireReplayPosition,
        tag: evalViewKey,
      });
    }
  }, [replayData, liveTip, viewingVariation, serializedAtView, evaluation, effectiveTera, effectiveSleepClause, acquireBranchPosition, acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

  // Every eval finishing while the pointer sits on the variation feeds the
  // graph overlay — auto-evals after executed turns included. The tag guard
  // keeps a run that finished after a navigation from landing in the wrong
  // turn's slot (the score belongs to the position it was STARTED at).
  useEffect(() => {
    if (evaluation.status !== 'done' || !evaluation.result || !viewingVariation) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== evalViewKey) return;
    const score = evaluation.result.score;
    setVariationScores(previous => {
      const next = [...previous];
      next[viewTurn - 1] = score;
      return next;
    });
  }, [evaluation.status, evaluation.result, evaluation.resultTag, evalViewKey, viewingVariation, viewTurn, setVariationScores]);

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

  const handleAnalyzeGame = useCallback(() => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: turn => `${replayData.id}:${turn}:${setsFingerprint}`,
      acquireFor: makeReplayAcquire,
      acquireAll: makeSweepAcquireAll(analyzableTurns),
      // snapshots[turn] carries the block ENDING at |turn|turn+1 — i.e. the
      // actions actually played on `turn`. Doubles logs carry two actions
      // per side and use the per-slot parser.
      playedFor: turn => (evalIsDoubles
        ? parsePlayedActionsDoubles(snapshots[turn]?.log ?? [])
        : parsePlayedActions(snapshots[turn]?.log ?? [])),
      // Turn 0: the lead decision at team preview.
      acquirePreview: async () => {
        const { buildTeamsFromReplay } = await import('./lib/team-builder');
        const branchEngine = await import('./lib/branch-engine');
        const { p1Team, p2Team } = buildTeamsFromReplay(replayData.log, {
          userTeamText: teamText || undefined,
          p1Info: effectiveP1Info,
          p2Info: effectiveP2Info,
          usageStats: usageStats.stats,
          setAssumptions: setAssumptions.assumptions,
          inferredSpreads: await getInferredSpreads(),
          hpEvidence,
        });
        if (p1Team.length === 0 || p2Team.length === 0) return null;
        // Bring-limited replays: the lead analysis enumerates pairs over
        // the four actually brought, not the whole six (A.3c). Per-side
        // fail-open keeps an unpinned side's full pool.
        return branchEngine.serializePreviewPosition(getBranchSimulatorFormat(replayData), p1Team, p2Team, bringOnlyLists);
      },
      playedLeads: parseLeadSpecies(replayData.log),
      sensitivityTargetsFor,
    });
  }, [
    replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, makeReplayAcquire,
    makeSweepAcquireAll, snapshots, getInferredSpreads, evalIsDoubles, teamText, effectiveP1Info, effectiveP2Info,
    usageStats.stats, setAssumptions.assumptions, hpEvidence, sensitivityTargetsFor, bringOnlyLists,
  ]);

  /**
   * "Always on": with the autoAnalyze pref set, Analyze game starts by
   * itself once a replay (and its Smogon data) is ready — the game graph and
   * report are simply there. One attempt per replay + set knowledge + Tera
   * resolution; a failed sweep does not retry-loop (Re-analyze stays manual).
   */
  const autoAnalyzeAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !replayData || !evalAvailable) return;
    if (usageStats.loading || setAssumptions.loading) return;
    if (snapshots.length === 0) return;
    if (evaluation.graph.running || evaluation.graph.scores.some(score => score !== null)) return;
    const key = `${replayData.id}:${setsFingerprint}:${JSON.stringify(effectiveTera)}`;
    if (autoAnalyzeAttemptRef.current === key) return;
    autoAnalyzeAttemptRef.current = key;
    handleAnalyzeGame();
  }, [
    evaluation.prefs.autoAnalyze, replayData, evalAvailable, usageStats.loading, setAssumptions.loading,
    snapshots.length, evaluation.graph.running, evaluation.graph.scores, setsFingerprint, effectiveTera, handleAnalyzeGame,
  ]);

  // Explains ONE turn: a two-turn mini sweep (turn + its follow-up) so the
  // report can price the played outcome. Runs ONLY from the explicit deepen
  // button — selecting a turn shows the stored result and never re-searches
  // (silent score swaps read as disagreement between the report and the
  // turn view).
  const analyzeTurnNow = useCallback((turn: number, settings?: TurnEvalSettings) => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      from: turn,
      to: Math.min(turn + 1, analyzableTurns),
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: sweepTurn => `${replayData.id}:${sweepTurn}:${setsFingerprint}`,
      acquireFor: makeReplayAcquire,
      playedFor: sweepTurn => (evalIsDoubles
        ? parsePlayedActionsDoubles(snapshots[sweepTurn]?.log ?? [])
        : parsePlayedActions(snapshots[sweepTurn]?.log ?? [])),
      sensitivityTargetsFor,
      settings,
    });
  }, [replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, makeReplayAcquire, snapshots, evalIsDoubles, sensitivityTargetsFor]);

  // Any position change invalidates a displayed result.
  const { markStale: markEvalStale, reset: resetEval, clearGraph } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [viewTurn, viewLine, history.length, editedP1Info, editedP2Info, markEvalStale]);

  // A different replay or entering/leaving branch mode is a new position context.
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);

  // The graph is tied to a specific replay + set knowledge + Tera mode.
  // The SELECTION survives the reset — analysisTurn mirrors the slider and
  // simply has nothing to show until fresh data arrives (nulling it here
  // raced the mirror effect whenever usage stats landed after load, leaving
  // the merged panel permanently empty).
  useEffect(() => {
    clearGraph();
  }, [replayData?.id, setsFingerprint, effectiveTera, clearGraph]);

  // Opt-in: keep the branch evaluation fresh after each executed turn. Runs
  // on the effective status, so a result that finished for a position the
  // user has meanwhile left (tag mismatch) also re-evaluates. Live positions
  // only: without the liveEvalView gate, navigating onto a main-line turn
  // (the end sentinel included) fired a stray single-turn reconstruction —
  // the "diverged before turn 68" error on a 67-turn game.
  useEffect(() => {
    if (branching && evaluation.prefs.auto && liveEvalView && liveEvalStatus === 'stale' && !executing) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, liveEvalView, liveEvalStatus, executing, handleEvaluate]);

  // "Always on" also covers the live sim: a freshly opened variation (or a
  // navigation back to its tip) evaluates without the Evaluate button. Never
  // while the game sweep runs — a single evaluation supersedes the run id
  // and would silently kill the sweep.
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !evalAvailable) return;
    if (!liveTip || executing || branchPreparing || playOut?.active) return;
    if (evaluation.graph.running) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    handleEvaluate();
  }, [
    evaluation.prefs.autoAnalyze, evalAvailable, liveTip, executing, branchPreparing,
    playOut?.active, evaluation.graph.running, liveEvalStatus, handleEvaluate,
  ]);

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

  // ONE place for everything: in replay view the advantage bar, ranked
  // lists, and matrix render from the ANALYZED turn's cached sweep result
  // (turn 0 = the lead decision) — the branch view keeps its live result.
  const analyzedResult = useMemo(() => {
    if (liveEvalView) return evaluation.result;
    if (analysisTurn === 0) return evaluation.graph.lead?.result ?? null;
    if (analysisTurn !== null && analysisTurn >= 1) return evaluation.graph.results[analysisTurn - 1] ?? null;
    return null;
  }, [liveEvalView, evaluation.result, evaluation.graph, analysisTurn]);

  // What produced the shown result — the panel chip names it instead of
  // silently swapping numbers.
  const analyzedSettings = !liveEvalView && analysisTurn !== null && analysisTurn >= 1
    ? evaluation.graph.settings[analysisTurn - 1] ?? null
    : null;

  // The explicit deepening ladder: a sketch (or gap) first rises to the
  // configured settings, then one depth further (cap 3). Selecting a turn
  // never re-searches — this target is the only escalation.
  const thinkDeeperTarget = useMemo((): TurnEvalSettings | { mode: 'auto' } | null => {
    if (liveEvalView || analysisTurn === null || analysisTurn < 1) return null;
    const stored = evaluation.graph.settings[analysisTurn - 1] ?? null;
    const fraction = evaluation.graph.faintedFractions[analysisTurn - 1] ?? null;
    if (!stored || needsSettingsUpgrade(stored, evaluation.prefs, fraction)) {
      if (evaluation.prefs.mode === 'auto') {
        // Rise to the turn's auto-resolved engine; a gap turn's routing
        // signal is unknown until swept — the sweep resolves it itself.
        return fraction !== null ? resolveAutoTurnSettings(fraction) : { mode: 'auto' };
      }
      return { depth: evaluation.prefs.depth, samples: evaluation.prefs.samples, mode: evaluation.prefs.mode };
    }
    // From an MCTS turn the button crosses into the matrix ladder at depth
    // 2 — the same rung the early d1s1 line escalates to. The escalation-
    // keep rule (supersedesStored) makes the product survive later sweeps.
    if (stored.mode === 'mcts') {
      return {
        depth: 2,
        samples: Math.max(stored.samples, evaluation.prefs.samples) as TurnEvalSettings['samples'],
        mode: 'matrix',
      };
    }
    // The matrix ladder caps at the engine's depth 3.
    if (stored.depth >= 3) return null;
    return {
      depth: (stored.depth + 1) as 2 | 3,
      // Never shed samples on the way up — a d3s3 run must supersede d2s5.
      samples: Math.max(stored.samples, evaluation.prefs.samples) as TurnEvalSettings['samples'],
      mode: 'matrix',
    };
  }, [liveEvalView, analysisTurn, evaluation.graph.settings, evaluation.graph.faintedFractions, evaluation.prefs]);

  const handleThinkDeeper = useCallback(() => {
    if (analysisTurn === null || analysisTurn < 1 || !thinkDeeperTarget) return;
    // The 'auto' sentinel means "no override" — the sweep resolves the
    // turn's engine from its position, exactly like Analyze game.
    analyzeTurnNow(analysisTurn, 'depth' in thinkDeeperTarget ? thinkDeeperTarget : undefined);
  }, [analysisTurn, thinkDeeperTarget, analyzeTurnNow]);

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
            <div className="ps-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span className="ps-format-tag">{replayData.format}</span>
                <span style={{ fontSize: 11, color: '#8ac' }}>{replayData.players[0]}</span>
                <span style={{ fontSize: 10, color: '#556' }}>vs</span>
                <span style={{ fontSize: 11, color: '#c8a' }}>{replayData.players[1]}</span>
                {usageStats.loading && (
                  <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon stats loading...</span>
                )}
                {usageStats.error && (
                  <span style={{ fontSize: 10, color: '#987' }}>Smogon stats unavailable</span>
                )}
                {setAssumptions.loading && (
                  <span style={{ fontSize: 10, color: '#b6a46a' }}>Smogon sets loading...</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {branchPreparing && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fd6' }}>
                      Preparing branch...
                      {branchProgress ? ` (turn ${branchProgress.turn}/${branchProgress.target})` : ''}
                    </span>
                    <button
                      type="button"
                      className="ps-btn"
                      onClick={cancelPreparation}
                      style={{ padding: '2px 8px', fontSize: 10 }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {showBranch && !branchPreparing && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: '#8cf' }}>
                      Branching · Turn {simState?.turnNumber ?? '…'}
                    </span>
                    {simState?.ended && (
                      <span className="ps-ended-tag">
                        {simState.winner ? `${simState.winner} wins!` : 'Ended'}
                      </span>
                    )}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
                      <input
                        type="checkbox"
                        checked={animateBranchTurns}
                        onChange={event => setAnimateBranchTurns(event.target.checked)}
                      />
                      Animate branch turns
                    </label>
                    {branchDivergence && (
                      <span
                        style={{ fontSize: 10, color: '#e6b36a', maxWidth: 520 }}
                        title={branchDivergence}
                      >
                        ⚠ {branchDivergence}
                      </span>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setEditorSide('p1')}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Edit Player
                </button>
                <button
                  type="button"
                  onClick={() => setEditorSide('p2')}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Edit Opp
                </button>
                <button
                  type="button"
                  onClick={() => setSetsPanelOpen(true)}
                  className="ps-btn"
                  style={{ padding: '2px 8px', fontSize: 10 }}
                >
                  Import/Export Sets
                </button>
              </div>
            </div>

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
            <div className="ps-branch-bar">
              <span style={{ fontSize: 11, fontWeight: 'bold', whiteSpace: 'nowrap', color: '#cde' }}>Timeline</span>
              <button
                type="button"
                className="ps-btn"
                onClick={() => handleGraphSelectLine(0)}
                title="Turn 0: team preview. Pick different leads and play the game from the start."
                aria-pressed={viewT0}
                style={{
                  padding: '2px 6px', fontSize: 10,
                  ...(viewT0 ? { borderColor: '#8cf', color: '#8cf' } : {}),
                }}
              >T0</button>
              <button
                type="button"
                onClick={() => (viewTurn <= 1 && !viewT0
                  ? handleGraphSelectLine(0)
                  : navigateTo({ turn: viewTurn - 1, line: viewLine }))}
                disabled={viewTurn <= 1 && viewT0}
                className="ps-btn"
                style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
              >&#9664;</button>
              <span className="ps-timeline-track">
                {variationSpan && (() => {
                  // Gold stripe under the slider marking where the variation
                  // lives — without it nothing on the timeline said so.
                  const max = sliderMax(maxTurn, variationSpan);
                  const pos = (turn: number) => (max <= 1 ? 0 : ((turn - 1) / (max - 1)) * 100);
                  // A turn-0 variation starts left of the slider's domain.
                  const from = Math.max(0, pos(variationSpan.startTurn));
                  const to = pos(variationTip(variationSpan));
                  return (
                    <span
                      className="ps-timeline-stripe"
                      style={{ left: `${from}%`, width: `${Math.max(to - from, 0.8)}%` }}
                      title={`Variation: turns ${variationSpan.startTurn}–${variationTip(variationSpan)}`}
                    />
                  );
                })()}
                <input
                  type="range"
                  min={1}
                  max={sliderMax(maxTurn, variationSpan)}
                  value={viewTurn}
                  onChange={e => navigateTo({ turn: parseInt(e.target.value, 10), line: viewLine })}
                  aria-label="Timeline turn selector"
                />
              </span>
              <button
                type="button"
                onClick={() => navigateTo({ turn: viewT0 ? 1 : viewTurn + 1, line: viewLine })}
                disabled={!viewT0 && viewTurn >= sliderMax(maxTurn, variationSpan)}
                className="ps-btn"
                style={{ padding: '2px 8px', fontSize: 12, lineHeight: 1 }}
              >&#9654;</button>
              <span style={{ fontSize: 11, color: '#aab', minWidth: 60, textAlign: 'center' }}>
                {viewT0 ? (
                  <strong style={{ color: '#fff' }}>T0</strong>
                ) : atEndPosition && !viewingVariation ? (
                  <strong style={{ color: '#fff' }}>End</strong>
                ) : (
                  <>
                    {/* The total counts PLAYED turns — the end snapshot is the
                        "End" sentinel, not a 68th turn of a 67-turn game. */}
                    T<strong style={{ color: '#fff' }}>{viewTurn}</strong>/{sliderMax(endSnapshotTurn !== null ? endSnapshotTurn - 1 : maxTurn, variationSpan)}
                  </>
                )}
              </span>
              {/* The chip stays put while a variation exists — flickering away
                  outside the covered turns made the whole bar jump around. */}
              {variationSpan !== null && (
                <span className="ps-line-chip" role="group" aria-label="Line selector">
                  <button
                    type="button"
                    className={!viewingVariation ? 'on-main' : ''}
                    onClick={() => navigateTo({ turn: Math.min(viewTurn, maxTurn), line: 'main' })}
                  >Main line</button>
                  <button
                    type="button"
                    className={viewingVariation ? 'on-vari' : ''}
                    onClick={() => navigateTo({
                      turn: Math.min(Math.max(viewTurn, variationSpan.startTurn + 1), variationTip(variationSpan)),
                      line: 'variation',
                    })}
                  >Variation</button>
                </span>
              )}
              {(variationSpan !== null || branching) && (
                <button
                  type="button"
                  className="ps-btn ps-btn-red"
                  onClick={discardVariation}
                  title="Drops every played variation move."
                  style={{ padding: '3px 10px', fontSize: 11 }}
                >
                  Discard variation
                </button>
              )}
            </div>

            {branchDivergence && !showBranch && (
              <div className="ps-panel" role="alert" style={{ marginTop: 6, padding: '6px 10px', fontSize: 11, color: '#e6b36a' }}>
                ⚠ {branchDivergence}
              </div>
            )}
            {pendingConfirm && (
              <div
                className="ps-panel"
                role="alertdialog"
                style={{
                  marginTop: 6, padding: '7px 10px', display: 'flex', gap: 10, alignItems: 'center',
                  fontSize: 11, borderColor: 'rgba(204,68,85,0.5)',
                }}
              >
                <span>{pendingConfirm.message}</span>
                <button type="button" className="ps-btn ps-btn-red" onClick={pendingConfirm.proceed}>
                  Replace
                </button>
                <button
                  type="button"
                  className="ps-btn"
                  onClick={() => { setPendingConfirm(null); clearPendingPick(); setPlayOut(null); }}
                >
                  Cancel
                </button>
              </div>
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
              <div className="ps-panel" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {playOut?.active ? (
                  <>
                    <span className="ps-spinner" aria-hidden="true" />
                    {/* The detailed progress line lives in the Evaluation
                        panel (beside the growing graph) — one place, not two. */}
                    <span style={{ fontSize: 11, color: '#f0c76b' }}>
                      Engine play-out running
                    </span>
                    <button type="button" className="ps-btn" onClick={() => stopPlayOut()} style={{ padding: '2px 10px', fontSize: 11 }}>
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ps-btn"
                      onClick={startPlayOut}
                      disabled={branchPreparing || usageStats.loading || setAssumptions.loading}
                      title="The engine plays BOTH sides' best moves from the position you are viewing until the game ends. The view stays on this turn while it runs; when it stops, press play (or Watch) to see the finished line. Stop anytime; played turns stay in the variation."
                      style={{ padding: '3px 10px', fontSize: 11, borderColor: 'rgba(240,199,107,0.5)' }}
                    >
                      &#9658; Let it play out
                    </button>
                    <span style={{ fontSize: 10, color: '#8fa3bd' }}>
                      engine finishes the game from turn {viewTurn}; watch the result from here afterwards
                    </span>
                  </>
                )}
                {playOutNotice && !playOut?.active && (
                  <span role="status" style={{ fontSize: 10, color: '#d4f5e0', display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {playOutNotice.text}
                    {variationSpan !== null && (
                      <button
                        type="button"
                        className="ps-btn"
                        onClick={() => watchFrom(playOutNotice.watchTurn)}
                        title="Seek the battle window to where the play-out started and play it."
                        style={{ padding: '1px 8px', fontSize: 10 }}
                      >
                        &#9658; Watch from turn {playOutNotice.watchTurn}
                      </button>
                    )}
                  </span>
                )}
              </div>
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
