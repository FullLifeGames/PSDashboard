import { isGameId } from '../lib/new-game/record';
import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BringWorld } from '@fulllifegames/eval-engine';
import {
  type GameRules, type OpponentTeamInfo, type ReplayData, type TurnSnapshot, formatEnforcesSleepClause,
  getBranchSimulatorFormat, inferReplayFormatId, logRules, replayRuleset,
} from '@fulllifegames/replay-core';
import { useFormatOffersTera } from './useFormatOffersTera';
import { resolveAutoTurnSettings, type TurnEvalSettings, useEvaluation } from './useEvaluation';
import type { EvaluateParams } from './evaluation/single-eval';
import type { useEvalAcquire } from './useEvalAcquire';
import { makePreviewAcquire, type TeamBuildSources } from '../lib/eval-acquire';
import { evalStorePrefix } from '../lib/eval-cache-store';
import { rolledCopyParams } from '../lib/rolled-copy-stage';
import { engineCacheTag } from '../lib/eval/engine-setting';
import { keptPlayed } from './evaluation/sweep-core';
import {
  resolveTeraPreference, parseLeadSpecies, parsePlayedActions, parsePlayedActionsDoubles, replacementRounds,
  type SensitivityTarget, type StaticRuleset,
} from '@fulllifegames/eval-engine';

type Evaluation = ReturnType<typeof useEvaluation>;
type Acquire = ReturnType<typeof useEvalAcquire>;

// snapshots[turn] carries the block ending at |turn|turn+1.
const playedOn = (snapshots: TurnSnapshot[], turn: number, doubles: boolean, rules: GameRules) => (doubles
  ? parsePlayedActionsDoubles(snapshots[turn]?.log ?? [])
  : parsePlayedActions(snapshots[turn]?.log ?? [], rules));

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
  /** The live sim's position; null outside a variation. */
  tip: { key: string; turn: number; variation: boolean } | null;
  tipEvalStatus: Evaluation['status'];
  analysisTurn: number | null;
  analyzableTurns: number;
  branching: boolean;
  executing: boolean;
  branchPreparing: boolean;
  playOutActive: boolean;
  replacementPending: boolean;
  smogonPending: boolean;
  acquire: Pick<Acquire, 'acquireBranchPosition' | 'acquireReplayPosition' | 'makeReplayAcquire' | 'makeSweepAcquireAll'>;
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  bringWorlds?: BringWorld[] | null;
  setsFingerprint: string;
  sensitivityTargetsFor: (side: 'p1' | 'p2') => SensitivityTarget[];
  editedP1Info: OpponentTeamInfo | null;
  editedP2Info: OpponentTeamInfo | null;
  historyLength: number;
  setVariationScores: Dispatch<SetStateAction<(number | null)[]>>;
}

function useEvalFormat(inputs: EvalViewInputs) {
  const { replayData, evaluation, replayGameType } = inputs;
  const formatId = replayData ? inferReplayFormatId(replayData) : '';
  const newGame = !!replayData && isGameId(replayData.id);
  const { offers: newGameOffersTera } = useFormatOffersTera(formatId, newGame && evaluation.prefs.tera === 'auto');
  const effectiveTera = useMemo(
    () => (replayData ? resolveTeraPreference(evaluation.prefs.tera, formatId, replayData.log, { newGameOffersTera }) : false),
    [replayData, formatId, evaluation.prefs.tera, newGameOffersTera],
  );
  // Serialization strips custom rules, so the eval candidate filter needs a Sleep Clause flag from the branch format.
  const effectiveSleepClause = useMemo(
    () => (replayData ? formatEnforcesSleepClause(getBranchSimulatorFormat(replayData)) : false),
    [replayData],
  );
  // The reconstruction runs Champions as Doubles OU or a custom game: the ruleset reads the replay's own format.
  const effectiveRuleset = useMemo(
    (): StaticRuleset => (replayData ? replayRuleset(replayData) : 'standard'),
    [replayData],
  );
  const evalAvailable = useMemo(
    () => !!replayData && (replayGameType === null || replayGameType === 'singles' || replayGameType === 'doubles'),
    [replayData, replayGameType],
  );
  return { effectiveTera, effectiveSleepClause, effectiveRuleset, evalAvailable };
}

type EvalFormat = ReturnType<typeof useEvalFormat>;

// An entry from before the turn was played lacks its outcome and verification, so it must never serve the played turn.
const gameTipTag = (id: string, turn: number, snapshotCount: number): string => (isGameId(id) && turn >= snapshotCount ? 't' : '');

export const turnCacheKey = (replayId: string, turn: number, snapshotCount: number, setsFingerprint: string): string =>
  `${replayId}:${turn}${gameTipTag(replayId, turn, snapshotCount)}:${setsFingerprint}${engineCacheTag()}`;

export type EvaluateOptions = Pick<EvaluateParams, 'onResult'>;

function useEvaluateAction(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evalIsDoubles, evaluation, liveTip, viewingVariation, serializedAtView, viewTurn, setsFingerprint, evalViewKey, acquire, setVariationScores, tip, playOutActive, replacementPending } = inputs;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = format;
  // While a run is active, the live sim is the position wherever the pointer stands (a frame report can move it).
  const runAtTip = playOutActive && tip !== null ? tip : null;
  // `onResult` is read by name, never spread: the Evaluate button hands its click event to this function.
  const handleEvaluate = useCallback((options?: EvaluateOptions) => {
    if (!replayData) return;
    const onResult = typeof options?.onResult === 'function' ? options.onResult : undefined;
    if (liveTip || runAtTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, acquire: acquire.acquireBranchPosition, tag: runAtTip?.key ?? evalViewKey, replacement: replacementPending, onResult });
    } else if (viewingVariation && serializedAtView) {
      const stored = serializedAtView;
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, acquire: async () => stored, tag: evalViewKey, onResult });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${viewTurn}${gameTipTag(replayData.id, viewTurn, snapshots.length)}:${setsFingerprint}${engineCacheTag()}`,
        tera: effectiveTera,
        sleepClause: effectiveSleepClause,
        ruleset: effectiveRuleset,
        acquire: acquire.acquireReplayPosition,
        tag: evalViewKey,
        onResult,
        // The sweep stores this turn under the same key: search it with the same played action.
        keepPlayed: keptPlayed(playedOn(snapshots, viewTurn, evalIsDoubles, logRules(replayData.log))),
      });
    }
  }, [replayData, snapshots, evalIsDoubles, liveTip, runAtTip, viewingVariation, serializedAtView, replacementPending, evaluation, effectiveTera, effectiveSleepClause, effectiveRuleset, acquire.acquireBranchPosition, acquire.acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

  // The score belongs to the position the run STARTED at: the tag guard keeps it out of a later turn's slot.
  const scored = runAtTip ?? { key: evalViewKey, turn: viewTurn, variation: viewingVariation };
  useEffect(() => {
    if (evaluation.status !== 'done' || !evaluation.result || !scored.variation) return;
    if (evaluation.resultTag !== null && evaluation.resultTag !== scored.key) return;
    const score = evaluation.result.score;
    setVariationScores(previous => {
      const next = [...previous];
      next[scored.turn - 1] = score;
      return next;
    });
  }, [evaluation.status, evaluation.result, evaluation.resultTag, scored.key, scored.turn, scored.variation, setVariationScores]);

  return handleEvaluate;
}

function useSweepRuns(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evaluation, analyzableTurns, evalIsDoubles, acquire, sources, bringOnlyLists, bringWorlds = null, setsFingerprint, sensitivityTargetsFor, smogonPending } = inputs;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset, evalAvailable } = format;

  const rules = useMemo(() => logRules(replayData?.log ?? ''), [replayData]);
  const playedFor = useCallback((turn: number) => playedOn(snapshots, turn, evalIsDoubles, rules), [evalIsDoubles, snapshots, rules]);

  const handleAnalyzeGame = useCallback(() => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      rules,
      ruleset: effectiveRuleset,
      doubles: evalIsDoubles, game: isGameId(replayData.id),
      cacheKeyFor: turn => turnCacheKey(replayData.id, turn, snapshots.length, setsFingerprint),
      replacementRounds: replacementRounds(replayData.log),
      replacementKeyFor: (turn, ordinal) => `${replayData.id}:${turn}r${ordinal}:${setsFingerprint}${engineCacheTag()}`,
      storePrefix: evalStorePrefix(replayData.id),
      acquireFor: acquire.makeReplayAcquire,
      acquireAll: acquire.makeSweepAcquireAll(analyzableTurns),
      playedFor,
      acquirePreview: makePreviewAcquire(replayData, sources, bringOnlyLists, bringWorlds),
      playedLeads: parseLeadSpecies(replayData.log),
      sensitivityTargetsFor, rolledCopy: rolledCopyParams({ replayData, snapshots, rules, setsFingerprint }),
    });
  }, [replayData, snapshots, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, effectiveRuleset, evalIsDoubles, setsFingerprint, acquire, playedFor, rules, sources, bringOnlyLists, bringWorlds, sensitivityTargetsFor]);

  // Explains one turn with a two-turn mini sweep (turn plus follow-up) so the report can price the played outcome.
  const analyzeTurnNow = useCallback((turn: number) => {
    if (!replayData) return;
    evaluation.runGraphSweep({
      turns: analyzableTurns,
      from: turn,
      to: Math.min(turn + 1, analyzableTurns),
      tera: effectiveTera,
      sleepClause: effectiveSleepClause,
      rules,
      ruleset: effectiveRuleset,
      doubles: evalIsDoubles,
      cacheKeyFor: sweepTurn => turnCacheKey(replayData.id, sweepTurn, snapshots.length, setsFingerprint),
      storePrefix: evalStorePrefix(replayData.id),
      acquireFor: acquire.makeReplayAcquire,
      playedFor,
      sensitivityTargetsFor,
    });
  }, [replayData, snapshots, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, effectiveRuleset, evalIsDoubles, setsFingerprint, acquire, playedFor, rules, sensitivityTargetsFor]);

  // One attempt per replay, set knowledge and Tera resolution: a failed sweep does not retry-loop.
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

function useEvalHousekeeping(inputs: EvalViewInputs, format: EvalFormat, handleEvaluate: () => void) {
  const { evaluation, historyLength, editedP1Info, editedP2Info, replayData, branching, liveEvalView, liveEvalStatus, tip, tipEvalStatus, executing, branchPreparing, playOutActive } = inputs;
  const { markStale: markEvalStale, reset: resetEval, clearGraph, dropGraphFrom } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [historyLength, editedP1Info, editedP2Info, markEvalStale]);
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);
  useEffect(() => {
    clearGraph();
  }, [replayData?.id, inputs.setsFingerprint, format.effectiveTera, clearGraph]);
  const tipSeen = useRef<{ id: string; count: number } | null>(null);
  const snapshotCount = inputs.snapshots.length;
  const gameId = replayData?.id ?? null;
  useEffect(() => {
    const before = tipSeen.current;
    tipSeen.current = gameId === null ? null : { id: gameId, count: snapshotCount };
    if (before && gameId === before.id && isGameId(gameId) && snapshotCount > before.count) dropGraphFrom(before.count);
  }, [gameId, snapshotCount, dropGraphFrom]);
  // Live positions only: without the liveEvalView gate a main-line turn fired a stray single-turn reconstruction.
  useEffect(() => {
    // Not while the game sweep runs (a single evaluation would stop it).
    const atTip = playOutActive && tip !== null;
    const view = atTip || liveEvalView;
    const status = atTip ? tipEvalStatus : liveEvalStatus;
    const stoppedHere = evaluation.stopped?.tag === (atTip ? tip?.key : inputs.evalViewKey);
    if (branching && evaluation.prefs.auto && view && status === 'stale' && !stoppedHere && !executing && !evaluation.graph.running) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, evaluation.stopped, inputs.evalViewKey, liveEvalView, liveEvalStatus, tipEvalStatus, playOutActive, tip, executing, evaluation.graph.running, handleEvaluate]);
  useEffect(() => {
    if (!evaluation.prefs.autoAnalyze || !format.evalAvailable) return;
    if (!inputs.liveTip || executing || branchPreparing || playOutActive) return;
    if (evaluation.graph.running) return;
    if (liveEvalStatus !== 'idle' && liveEvalStatus !== 'stale') return;
    if (evaluation.stopped?.tag === inputs.evalViewKey) return;
    handleEvaluate();
  }, [
    evaluation.prefs.autoAnalyze, evaluation.stopped, inputs.evalViewKey, format.evalAvailable, inputs.liveTip, executing, branchPreparing,
    playOutActive, evaluation.graph.running, liveEvalStatus, handleEvaluate,
  ]);
}

function useAnalyzedTurn(inputs: EvalViewInputs, analyzeTurnNow: (turn: number) => void) {
  const { evaluation, liveEvalView, analysisTurn, evalIsDoubles } = inputs;
  // Replay view shows the analyzed turn's cached sweep result (turn 0 = lead decision); the branch view its live one.
  const analyzedResult = useMemo(() => {
    if (liveEvalView) return evaluation.result;
    if (analysisTurn === 0) return evaluation.graph.lead?.result ?? null;
    if (analysisTurn !== null && analysisTurn >= 1) return evaluation.graph.results[analysisTurn - 1] ?? null;
    return null;
  }, [liveEvalView, evaluation.result, evaluation.graph, analysisTurn]);
  const analyzedSettings = !liveEvalView && analysisTurn !== null && analysisTurn >= 1
    ? evaluation.graph.settings[analysisTurn - 1] ?? null
    : null;
  const analyzeTarget = useMemo(
    () => resolveAnalyzeTarget(liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs, evalIsDoubles),
    [liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs, evalIsDoubles],
  );
  const handleAnalyzeTurn = useCallback(() => {
    if (analysisTurn === null || analysisTurn < 1 || !analyzeTarget) return;
    analyzeTurnNow(analysisTurn);
  }, [analysisTurn, analyzeTarget, analyzeTurnNow]);
  return { analyzedResult, analyzedSettings, analyzeTarget, handleAnalyzeTurn };
}

function resolveAnalyzeTarget(
  liveEvalView: boolean,
  analysisTurn: number | null,
  graph: Evaluation['graph'],
  prefs: Evaluation['prefs'],
  doubles: boolean,
): TurnEvalSettings | { mode: 'auto' } | null {
  if (liveEvalView || analysisTurn === null || analysisTurn < 1) return null;
  if (graph.settings[analysisTurn - 1]) return null;
  if (prefs.mode === 'auto') {
    const fraction = graph.faintedFractions[analysisTurn - 1] ?? null;
    return fraction !== null ? resolveAutoTurnSettings(fraction, doubles) : { mode: 'auto' };
  }
  return { depth: prefs.depth, samples: prefs.samples, mode: prefs.mode };
}

export function useEvalView(inputs: EvalViewInputs) {
  const format = useEvalFormat(inputs);
  const handleEvaluate = useEvaluateAction(inputs, format);
  const sweeps = useSweepRuns(inputs, format);
  useEvalHousekeeping(inputs, format, handleEvaluate);
  const analyzed = useAnalyzedTurn(inputs, sweeps.analyzeTurnNow);
  return { ...format, handleEvaluate, ...sweeps, ...analyzed };
}
