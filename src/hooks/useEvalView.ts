import { isGameId } from '../lib/new-game/record';
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
  /** The live sim's position (null outside a variation) and the status of the result against it. */
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
  /** The worlds of a short-side game (the heaviest first); null for any other game. */
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
  // Tera resolution: 'auto' turns enumeration off when the game never terastallized, and in draft/custom formats (per-Pokemon Tera
  // rights) restricts it to the species that did: a global switch would recommend illegal Teras and price floors against impossible threats.
  const effectiveTera = useMemo(
    () => (replayData
      ? resolveTeraPreference(evaluation.prefs.tera, inferReplayFormatId(replayData), replayData.log)
      : false),
    [replayData, evaluation.prefs.tera],
  );
  // Sleep Clause: the branch format carries it; the eval candidate filter needs a flag because serialization strips custom rules.
  const effectiveSleepClause = useMemo(
    () => (replayData ? formatEnforcesSleepClause(getBranchSimulatorFormat(replayData)) : false),
    [replayData],
  );
  // The rule set from the replay's own format: the reconstruction runs Champions as Doubles OU or a custom game, and the static
  // weighs its features by the replay's game.
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

/** The position at a new game's tip, where nothing has been played yet, caches under its own key: once the turn is played, the
 *  sweep's entry for it carries the played outcome, the verified round and the sensitivity, which an earlier entry must never serve. */
const gameTipTag = (id: string, turn: number, snapshotCount: number): string => (isGameId(id) && turn >= snapshotCount ? 't' : '');

export const turnCacheKey = (replayId: string, turn: number, snapshotCount: number, setsFingerprint: string): string =>
  `${replayId}:${turn}${gameTipTag(replayId, turn, snapshotCount)}:${setsFingerprint}${engineCacheTag()}`;

export type EvaluateOptions = Pick<EvaluateParams, 'onResult'>;

function useEvaluateAction(inputs: EvalViewInputs, format: EvalFormat) {
  const { replayData, snapshots, evalIsDoubles, evaluation, liveTip, viewingVariation, serializedAtView, viewTurn, setsFingerprint, evalViewKey, acquire, setVariationScores, tip, playOutActive } = inputs;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = format;
  // While a run is active the live sim is the wanted position, wherever the pointer stands (a frame report can move it): the
  // evaluation, its tag and its score slot follow the tip.
  const runAtTip = playOutActive && tip !== null ? tip : null;
  // `onResult` is read by name, never spread: the Evaluate button hands its click event to this function. Evaluate never sets
  // `prefs.auto`; only the explore click of the engine walk does.
  const handleEvaluate = useCallback((options?: EvaluateOptions) => {
    if (!replayData) return;
    const onResult = typeof options?.onResult === 'function' ? options.onResult : undefined;
    if (liveTip || runAtTip) {
      evaluation.evaluate({ cacheKey: null, tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset, acquire: acquire.acquireBranchPosition, tag: runAtTip?.key ?? evalViewKey, onResult });
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
  }, [replayData, snapshots, evalIsDoubles, liveTip, runAtTip, viewingVariation, serializedAtView, evaluation, effectiveTera, effectiveSleepClause, effectiveRuleset, acquire.acquireBranchPosition, acquire.acquireReplayPosition, viewTurn, setsFingerprint, evalViewKey]);

  // Every eval finishing while the pointer sits on the variation feeds the graph overlay; the tag guard keeps a run that finished
  // after a navigation out of the wrong turn's slot (the score belongs to the position it STARTED at).
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

  // Explains ONE turn: a two-turn mini sweep (turn + its follow-up) so the report can price the played outcome, at the panel's
  // settings. Runs only from a gap turn's Analyze button: selecting a turn shows the stored result and never re-searches.
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

  // With the autoAnalyze pref set, Analyze game starts by itself once a replay (and its Smogon data) is ready: one attempt per
  // replay + set knowledge + Tera resolution; a failed sweep does not retry-loop.
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
  // A change of the position itself (a turn executed, a set edited) invalidates a displayed result; moving the pointer does not:
  // the result's position tag decides whether it fits the screen.
  const { markStale: markEvalStale, reset: resetEval, clearGraph, dropGraphFrom } = evaluation;
  useEffect(() => {
    markEvalStale();
  }, [historyLength, editedP1Info, editedP2Info, markEvalStale]);
  useEffect(() => {
    resetEval();
  }, [replayData?.id, branching, resetEval]);
  // The graph is tied to a replay + set knowledge + Tera mode; the SELECTION survives the reset (analysisTurn mirrors the slider).
  useEffect(() => {
    clearGraph();
  }, [replayData?.id, inputs.setsFingerprint, format.effectiveTera, clearGraph]);
  // A new game's main line grows at its tip, and the graph's entry for the old tip was swept before anybody played that turn (no
  // played choice, no outcome): the played turn takes a new sweep, not that entry.
  const tipSeen = useRef<{ id: string; count: number } | null>(null);
  const snapshotCount = inputs.snapshots.length;
  const gameId = replayData?.id ?? null;
  useEffect(() => {
    const before = tipSeen.current;
    tipSeen.current = gameId === null ? null : { id: gameId, count: snapshotCount };
    if (before && gameId === before.id && isGameId(gameId) && snapshotCount > before.count) dropGraphFrom(before.count);
  }, [gameId, snapshotCount, dropGraphFrom]);
  // Opt-in: keep the branch evaluation fresh after each executed turn. Live positions only: without the liveEvalView gate, navigating
  // onto a main-line turn (the end sentinel included) fired a stray single-turn reconstruction (a "diverged before turn 68" error).
  useEffect(() => {
    // Not while the game sweep runs (a single evaluation would stop it); the effect fires again when it ends. A run keeps the live
    // tip fresh, whichever turn the pointer shows.
    const atTip = playOutActive && tip !== null;
    const view = atTip || liveEvalView;
    const status = atTip ? tipEvalStatus : liveEvalStatus;
    const stoppedHere = evaluation.stopped?.tag === (atTip ? tip?.key : inputs.evalViewKey);
    if (branching && evaluation.prefs.auto && view && status === 'stale' && !stoppedHere && !executing && !evaluation.graph.running) {
      handleEvaluate();
    }
  }, [branching, evaluation.prefs.auto, evaluation.stopped, inputs.evalViewKey, liveEvalView, liveEvalStatus, tipEvalStatus, playOutActive, tip, executing, evaluation.graph.running, handleEvaluate]);
  // "Always on" also covers the live sim: a freshly opened variation (or a navigation back to its tip) evaluates without the
  // Evaluate button, never while the game sweep runs (a single evaluation supersedes the run id and would silently kill the sweep).
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
  // In replay view the advantage bar, ranked lists and matrix render from the ANALYZED turn's cached sweep result (turn 0 = the lead
  // decision); the branch view keeps its live result.
  const analyzedResult = useMemo(() => {
    if (liveEvalView) return evaluation.result;
    if (analysisTurn === 0) return evaluation.graph.lead?.result ?? null;
    if (analysisTurn !== null && analysisTurn >= 1) return evaluation.graph.results[analysisTurn - 1] ?? null;
    return null;
  }, [liveEvalView, evaluation.result, evaluation.graph, analysisTurn]);
  const analyzedSettings = !liveEvalView && analysisTurn !== null && analysisTurn >= 1
    ? evaluation.graph.settings[analysisTurn - 1] ?? null
    : null;
  // A gap turn (no result yet) offers its analysis at the panel's settings; an analyzed turn offers nothing.
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
