import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BringWorld } from '@fulllifegames/eval-engine';
import {
  type GameRules, type OpponentTeamInfo, type ReplayData, type TurnSnapshot, formatEnforcesSleepClause,
  getBranchSimulatorFormat, inferReplayFormatId, logRules, replayRuleset,
} from '@fulllifegames/replay-core';
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

/** The actions played on a replay turn: snapshots[turn] carries the block ending at |turn|turn+1. */
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
  /** Round 89 (#112): the live sim's position (null outside a variation) and the status of the result against it. */
  tip: { key: string; turn: number; variation: boolean } | null;
  tipEvalStatus: Evaluation['status'];
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
  /** Round 89 (#124): the worlds of a short-side game (the heaviest first); null for any other game. */
  bringWorlds?: BringWorld[] | null;
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
  // Round 65: the rule set (Pokémon Champions, VGC or standard) from the
  // replay's own format: the reconstruction runs Champions as Doubles OU or a
  // custom game, and the static weighs its features by the replay's game.
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

/** What a caller may hand to Evaluate: the dock's engine fill acts on the result (round 84). */
export type EvaluateOptions = Pick<EvaluateParams, 'onResult'>;

/** The Evaluate action for whatever position the pointer holds, and the
 *  variation-score recording of finished live evals. */
function useEvaluateAction(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evalIsDoubles, evaluation, liveTip, viewingVariation, serializedAtView, viewTurn, setsFingerprint, evalViewKey, acquire, setVariationScores, tip, playOutActive } = inputs;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = format;
  // Round 89 (#112): while a run is active the live sim is what the user asked for, wherever the pointer stands (a frame
  // report can move it): the evaluation, its tag and its score slot follow the tip. Outside a run the pointer decides.
  const runAtTip = playOutActive && tip !== null ? tip : null;
  // Round 84: `onResult` is read by name, never spread: the Evaluate button hands its click event to this function. Evaluate
  // never sets `prefs.auto`; only the explore click of the engine walk does.
  const handleEvaluate = useCallback((options?: EvaluateOptions) => {
    if (!replayData) return;
    const onResult = typeof options?.onResult === 'function' ? options.onResult : undefined;
    if (liveTip || runAtTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, acquire: acquire.acquireBranchPosition, tag: runAtTip?.key ?? evalViewKey, onResult });
    } else if (viewingVariation && serializedAtView) {
      // A recorded variation position: acquisition is instant — the search
      // itself still runs at the configured settings.
      const stored = serializedAtView;
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, acquire: async () => stored, tag: evalViewKey, onResult });
    } else {
      evaluation.evaluate({
        cacheKey: `${replayData.id}:${viewTurn}:${setsFingerprint}${engineCacheTag()}`,
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
  }, [replayData, snapshots, evalIsDoubles, liveTip, runAtTip, viewingVariation, serializedAtView, evaluation, effectiveTera, effectiveSleepClause, effectiveRuleset, acquire.acquireBranchPosition, acquire.acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

  // Every eval finishing while the pointer sits on the variation feeds the
  // graph overlay — auto-evals after executed turns included. The tag guard
  // keeps a run that finished after a navigation from landing in the wrong
  // turn's slot (the score belongs to the position it was STARTED at).
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

/** Analyze game (full sweep incl. turn 0), a gap turn's single analysis,
 *  and the "always on" auto-analyze. */
function useSweepRuns(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evaluation, analyzableTurns, evalIsDoubles, acquire, sources, bringOnlyLists, bringWorlds = null, setsFingerprint, sensitivityTargetsFor, smogonPending } = inputs;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset, evalAvailable } = format;

  // Round 75 (T160): the replay's generation and mod, for the Dex reads of the played-action parser and the sweep.
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
      doubles: evalIsDoubles,
      cacheKeyFor: turn => `${replayData.id}:${turn}:${setsFingerprint}${engineCacheTag()}`,
      // Round 79 (T290): the replacement points of the knockouts, each under its own key beside the turn keys.
      replacementRounds: replacementRounds(replayData.log),
      replacementKeyFor: (turn, ordinal) => `${replayData.id}:${turn}r${ordinal}:${setsFingerprint}${engineCacheTag()}`,
      storePrefix: evalStorePrefix(replayData.id),
      acquireFor: acquire.makeReplayAcquire,
      acquireAll: acquire.makeSweepAcquireAll(analyzableTurns),
      // snapshots[turn] carries the block ENDING at |turn|turn+1 — i.e. the
      // actions actually played on `turn`.
      playedFor,
      // Turn 0: the lead decision at team preview.
      acquirePreview: makePreviewAcquire(replayData, sources, bringOnlyLists, bringWorlds),
      playedLeads: parseLeadSpecies(replayData.log),
      sensitivityTargetsFor, rolledCopy: rolledCopyParams({ replayData, snapshots, rules, setsFingerprint }),
    });
  }, [replayData, snapshots, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, effectiveRuleset, evalIsDoubles, setsFingerprint, acquire, playedFor, rules, sources, bringOnlyLists, bringWorlds, sensitivityTargetsFor]);

  // Explains ONE turn: a two-turn mini sweep (turn + its follow-up) so the
  // report can price the played outcome, at the panel's settings. Runs ONLY
  // from a gap turn's Analyze button: selecting a turn shows the stored
  // result and never re-searches.
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
      cacheKeyFor: sweepTurn => `${replayData.id}:${sweepTurn}:${setsFingerprint}${engineCacheTag()}`,
      storePrefix: evalStorePrefix(replayData.id),
      acquireFor: acquire.makeReplayAcquire,
      playedFor,
      sensitivityTargetsFor,
    });
  }, [replayData, evaluation, analyzableTurns, effectiveTera, effectiveSleepClause, effectiveRuleset, evalIsDoubles, setsFingerprint, acquire, playedFor, rules, sensitivityTargetsFor]);

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
  const { evaluation, historyLength, editedP1Info, editedP2Info, replayData, branching, liveEvalView, liveEvalStatus, tip, tipEvalStatus, executing, branchPreparing, playOutActive } = inputs;
  // A change of the position itself (a turn executed, a set edited) invalidates a displayed result. Moving the
  // pointer does not (round 77, C6): the result's position tag decides whether it fits the screen, so the result
  // is current again when the pointer returns to the position it was computed for.
  const { markStale: markEvalStale, reset: resetEval, clearGraph } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [historyLength, editedP1Info, editedP2Info, markEvalStale]);
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
    // Round 77 (C1): not while the game sweep runs; a single evaluation would stop it. The effect fires again when it ends.
    // Round 89 (#112): a run keeps the live tip fresh, whichever turn the pointer shows.
    const atTip = playOutActive && tip !== null;
    const view = atTip || liveEvalView;
    const status = atTip ? tipEvalStatus : liveEvalStatus;
    if (branching && evaluation.prefs.auto && view && status === 'stale' && !executing && !evaluation.graph.running) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, liveEvalView, liveEvalStatus, tipEvalStatus, playOutActive, tip, executing, evaluation.graph.running, handleEvaluate]);
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

/** The analyzed-turn result surface and a gap turn's first analysis. */
function useAnalyzedTurn(inputs: EvalViewInputs, analyzeTurnNow: (turn: number) => void) {
  const { evaluation, liveEvalView, analysisTurn, evalIsDoubles } = inputs;
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
  // A gap turn (no result yet) offers its analysis at the panel's settings.
  // An analyzed turn offers nothing: the deeper stage left with "Think
  // deeper" (round 67, T109, gate answer 5b).
  const analyzeTarget = useMemo(
    () => resolveAnalyzeTarget(liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs, evalIsDoubles),
    [liveEvalView, analysisTurn, evaluation.graph, evaluation.prefs, evalIsDoubles],
  );
  const handleAnalyzeTurn = useCallback(() => {
    if (analysisTurn === null || analysisTurn < 1 || !analyzeTarget) return;
    // No override: the sweep runs the panel's settings and resolves auto per
    // turn from its position, exactly like Analyze game.
    analyzeTurnNow(analysisTurn);
  }, [analysisTurn, analyzeTarget, analyzeTurnNow]);
  return { analyzedResult, analyzedSettings, analyzeTarget, handleAnalyzeTurn };
}

/** The settings a gap turn's analysis runs, as its button names them; null for a stored turn. */
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
    // The engine the sweep will resolve; a gap turn's routing signal is
    // unknown until swept, and the sweep resolves it itself.
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
