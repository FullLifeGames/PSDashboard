import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  type OpponentTeamInfo, type ReplayData, type TurnSnapshot, formatEnforcesSleepClause,
  getBranchSimulatorFormat, inferReplayFormatId,
} from '@fulllifegames/replay-core';
import { needsSettingsUpgrade, resolveAutoTurnSettings, type TurnEvalSettings, useEvaluation } from './useEvaluation';
import type { useEvalAcquire } from './useEvalAcquire';
import { makePreviewAcquire, type TeamBuildSources } from '../lib/eval-acquire';
import {
  resolveTeraPreference, parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles,
  type SensitivityTarget,
} from '@fulllifegames/eval-engine';

type Evaluation = ReturnType<typeof useEvaluation>;
type Acquire = ReturnType<typeof useEvalAcquire>;

export interface EvalViewInputs {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  evaluation: Evaluation;
  replayGameType: string | null;
  evalIsDoubles: boolean;
  viewTurn: number;
  viewLine: 'main' | 'variation';
  viewingVariation: boolean;
  liveTip: boolean;
  liveEvalView: boolean;
  evalViewKey: string;
  serializedAtView: string | null;
  liveEvalStatus: Evaluation['status'];
  analysisTurn: number | null;
  analyzableTurns: number;
  branching: boolean;
  executing: boolean;
  branchPreparing: boolean;
  playOutActive: boolean;
  smogonPending: boolean;
  acquire: Pick<Acquire, 'acquireBranchPosition' | 'acquireReplayPosition' | 'makeReplayAcquire' | 'makeSweepAcquireAll'>;
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  setsFingerprint: string;
  sensitivityTargetsFor: (side: 'p1' | 'p2') => SensitivityTarget[];
  editedP1Info: OpponentTeamInfo | null;
  editedP2Info: OpponentTeamInfo | null;
  historyLength: number;
  setVariationScores: Dispatch<SetStateAction<(number | null)[]>>;
}

/** Format-derived evaluation switches (Tera rights, Sleep Clause, support). */
function useEvalFormat(inputs: EvalViewInputs) {
  const { replayData, evaluation, replayGameType } = inputs;
  // Tera resolution: 'auto' turns enumeration off when the game never
  // terastallized, and in draft/custom formats (per-Pokemon Tera rights)
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
  const evalAvailable = useMemo(
    () => !!replayData && (replayGameType === null || replayGameType === 'singles' || replayGameType === 'doubles'),
    [replayData, replayGameType],
  );
  return { effectiveTera, effectiveSleepClause, evalAvailable };
}

type EvalFormat = ReturnType<typeof useEvalFormat>;

/** The Evaluate action for whatever position the pointer holds, and the
 *  variation-score recording of finished live evals. */
function useEvaluateAction(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, evaluation, liveTip, viewingVariation, serializedAtView, viewTurn, setsFingerprint, evalViewKey, acquire, setVariationScores } = inputs;
  const { effectiveTera, effectiveSleepClause } = format;
  const handleEvaluate = useCallback(() => {
    if (!replayData) return;
    if (liveTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, acquire: acquire.acquireBranchPosition, tag: evalViewKey });
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
        acquire: acquire.acquireReplayPosition,
        tag: evalViewKey,
      });
    }
  }, [replayData, liveTip, viewingVariation, serializedAtView, evaluation, effectiveTera, effectiveSleepClause, acquire.acquireBranchPosition, acquire.acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

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

  return handleEvaluate;
}

/** Analyze game (full sweep incl. turn 0), the explicit per-turn deepen
 *  sweep, and the "always on" auto-analyze. */
function useSweepRuns(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evaluation, analyzableTurns, evalIsDoubles, acquire, sources, bringOnlyLists, setsFingerprint, sensitivityTargetsFor, smogonPending } = inputs;
  const { effectiveTera, effectiveSleepClause, evalAvailable } = format;

  const playedFor = useCallback((turn: number) => (evalIsDoubles
    ? parsePlayedActionsDoubles(snapshots[turn]?.log ?? [])
    : parsePlayedActions(snapshots[turn]?.log ?? [])), [evalIsDoubles, snapshots]);

  const handleAnalyzeGame = useCallback(() => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: turn => `${replayData.id}:${turn}:${setsFingerprint}`,
      acquireFor: acquire.makeReplayAcquire,
      acquireAll: acquire.makeSweepAcquireAll(analyzableTurns),
      // snapshots[turn] carries the block ENDING at |turn|turn+1 — i.e. the
      // actions actually played on `turn`.
      playedFor,
      // Turn 0: the lead decision at team preview.
      acquirePreview: makePreviewAcquire(replayData, sources, bringOnlyLists),
      playedLeads: parseLeadSpecies(replayData.log),
      sensitivityTargetsFor,
    });
  }, [replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, acquire, playedFor, sources, bringOnlyLists, sensitivityTargetsFor]);

  // Explains ONE turn: a two-turn mini sweep (turn + its follow-up) so the
  // report can price the played outcome. Runs ONLY from the explicit deepen
  // button — selecting a turn shows the stored result and never re-searches.
  const analyzeTurnNow = useCallback((turn: number, settings?: TurnEvalSettings) => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      from: turn,
      to: Math.min(turn + 1, analyzableTurns),
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      cacheKeyFor: sweepTurn => `${replayData.id}:${sweepTurn}:${setsFingerprint}`,
      acquireFor: acquire.makeReplayAcquire,
      playedFor,
      sensitivityTargetsFor,
      settings,
    });
  }, [replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, setsFingerprint, acquire, playedFor, sensitivityTargetsFor]);

  /**
   * "Always on": with the autoAnalyze pref set, Analyze game starts by
   * itself once a replay (and its Smogon data) is ready. One attempt per
   * replay + set knowledge + Tera resolution; a failed sweep does not
   * retry-loop (Re-analyze stays manual).
   */
  const autoAnalyzeAttemptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !replayData || !evalAvailable) return;
    if (smogonPending) return;
    if (snapshots.length === 0) return;
    if (evaluation.graph.running || evaluation.graph.scores.some(score => score !== null)) return;
    const key = `${replayData.id}:${setsFingerprint}:${JSON.stringify(effectiveTera)}`;
    if (autoAnalyzeAttemptRef.current === key) return;
    autoAnalyzeAttemptRef.current = key;
    handleAnalyzeGame();
  }, [
    evaluation.prefs.autoAnalyze, replayData, evalAvailable, smogonPending,
    snapshots.length, evaluation.graph.running, evaluation.graph.scores, setsFingerprint, effectiveTera, handleAnalyzeGame,
  ]);

  return { handleAnalyzeGame, analyzeTurnNow };
}

/** Invalidations and the auto re-evaluations of live positions. */
function useEvalHousekeeping(inputs: EvalViewInputs, format: EvalFormat, handleEvaluate: () => void) {
  const { evaluation, viewTurn, viewLine, historyLength, editedP1Info, editedP2Info, replayData, branching, liveEvalView, liveEvalStatus, executing, branchPreparing, playOutActive } = inputs;
  // Any position change invalidates a displayed result.
  const { markStale: markEvalStale, reset: resetEval, clearGraph } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [viewTurn, viewLine, historyLength, editedP1Info, editedP2Info, markEvalStale]);
  // A different replay or entering/leaving branch mode is a new position context.
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);
  // The graph is tied to a specific replay + set knowledge + Tera mode. The
  // SELECTION survives the reset — analysisTurn mirrors the slider and
  // simply has nothing to show until fresh data arrives.
  useEffect(() => {
    clearGraph();
  }, [replayData?.id, inputs.setsFingerprint, format.effectiveTera, clearGraph]);
  // Opt-in: keep the branch evaluation fresh after each executed turn. Live
  // positions only: without the liveEvalView gate, navigating onto a
  // main-line turn (the end sentinel included) fired a stray single-turn
  // reconstruction — the "diverged before turn 68" error on a 67-turn game.
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
    if (!evaluation.prefs.autoAnalyze || !format.evalAvailable) return;
    if (!inputs.liveTip || executing || branchPreparing || playOutActive) return;
    if (evaluation.graph.running) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    handleEvaluate();
  }, [
    evaluation.prefs.autoAnalyze, format.evalAvailable, inputs.liveTip, executing, branchPreparing,
    playOutActive, evaluation.graph.running, liveEvalStatus, handleEvaluate,
  ]);
}

/** The analyzed-turn result surface and the explicit deepening ladder. */
function useThinkDeeper(inputs: EvalViewInputs, analyzeTurnNow: (turn: number, settings?: TurnEvalSettings) => void) {
  const { evaluation, liveEvalView, analysisTurn } = inputs;
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
  // configured settings, then one depth further (cap 3).
  const thinkDeeperTarget = useMemo(
    () => resolveThinkDeeperTarget(liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs),
    [liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs],
  );
  const handleThinkDeeper = useCallback(() => {
    if (analysisTurn === null || analysisTurn < 1 || !thinkDeeperTarget) return;
    // The 'auto' sentinel means "no override" — the sweep resolves the
    // turn's engine from its position, exactly like Analyze game.
    analyzeTurnNow(analysisTurn, 'depth' in thinkDeeperTarget ? thinkDeeperTarget : undefined);
  }, [analysisTurn, thinkDeeperTarget, analyzeTurnNow]);
  return { analyzedResult, analyzedSettings, thinkDeeperTarget, handleThinkDeeper };
}

function resolveThinkDeeperTarget(
  liveEvalView: boolean,
  analysisTurn: number | null,
  graph: Evaluation['graph'],
  prefs: Evaluation['prefs'],
): TurnEvalSettings | { mode: 'auto' } | null {
  if (liveEvalView || analysisTurn === null || analysisTurn < 1) return null;
  const stored = graph.settings[analysisTurn - 1] ?? null;
  const fraction = graph.faintedFractions[analysisTurn - 1] ?? null;
  if (!stored || needsSettingsUpgrade(stored, prefs, fraction)) {
    if (prefs.mode === 'auto') {
      // Rise to the turn's auto-resolved engine; a gap turn's routing
      // signal is unknown until swept — the sweep resolves it itself.
      return fraction !== null ? resolveAutoTurnSettings(fraction) : { mode: 'auto' };
    }
    return { depth: prefs.depth, samples: prefs.samples, mode: prefs.mode };
  }
  // From an MCTS turn the button crosses into the matrix ladder at depth 2 —
  // the same rung the early d1s1 line escalates to.
  if (stored.mode === 'mcts') {
    return {
      depth: 2,
      samples: Math.max(stored.samples, prefs.samples) as TurnEvalSettings['samples'],
      mode: 'matrix',
    };
  }
  // The matrix ladder caps at the engine's depth 3.
  if (stored.depth >= 3) return null;
  return {
    depth: (stored.depth + 1) as 2 | 3,
    // Never shed samples on the way up — a d3s3 run must supersede d2s5.
    samples: Math.max(stored.samples, prefs.samples) as TurnEvalSettings['samples'],
    mode: 'matrix',
  };
}

export function useEvalView(inputs: EvalViewInputs) {
  const format = useEvalFormat(inputs);
  const handleEvaluate = useEvaluateAction(inputs, format);
  const sweeps = useSweepRuns(inputs, format);
  useEvalHousekeeping(inputs, format, handleEvaluate);
  const deeper = useThinkDeeper(inputs, sweeps.analyzeTurnNow);
  return { ...format, handleEvaluate, ...sweeps, ...deeper };
}
