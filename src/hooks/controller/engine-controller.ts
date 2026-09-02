import { useEvalAcquire } from '../useEvalAcquire';
import { usePlayedAtView, usePositionPicker } from '../usePositionPicker';
import { useEvalView } from '../useEvalView';
import { useEngineWalk } from '../useEngineWalk';
import { usePlayOut } from '../usePlayOut';
import { useEvaluation } from '../useEvaluation';
import { parsePlayedActions, parsePlayedActionsDoubles } from '@fulllifegames/eval-engine';
import type { ReplayContext } from './replay-context';
import type { Transients } from './transients';
import type { BoardController } from './board-controller';

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

function useAcquireLayer(ctx: ReplayContext, transients: Transients, board: BoardController) {
  const { replayData, snapshots, observations } = ctx.replay;
  const { getBattle, executing, variationStartTurn, startSerialized } = ctx.branch;
  const { evaluation, teamSources } = ctx;
  const { setsFingerprint, replayGenNumber } = ctx.knowledge;
  const { bringOnlyLists } = ctx.meta;
  const { playOut, draftChoices } = transients;
  const { liveTip, viewingVariation, atEndPosition, viewTurn, serializedAtView } = board.timeline;
  const { branchPreparing } = board.deviation;

  const { dwellEnabled, smogonPending } = acquireGates({
    liveTip, viewingVariation, atEndPosition, executing, branchPreparing,
    playOut, evaluation, usageStats: ctx.smogon.usageStats, setAssumptions: ctx.smogon.setAssumptions,
  });
  const acquire = useEvalAcquire({
    replayData, snapshots, observations, sources: teamSources, setsFingerprint,
    bringOnlyLists, getBattle, viewTurn, dwellEnabled, smogonPending,
  });
  const { positionPicker, pickerSimState } = usePositionPicker({
    replayData, snapshots, sources: teamSources, bringOnlyLists, replayGenNumber,
    liveTip, viewingVariation, serializedAtView, viewTurn, variationStartTurn, startSerialized,
    getExact: acquire.getExact, exactPositionsVersion: acquire.exactPositionsVersion, draftChoices,
  });
  const playedAtView = usePlayedAtView({
    viewingVariation, variationSpan: board.timeline.variationSpan, viewTurn,
    history: ctx.branch.history, snapshots, doubles: ctx.meta.evalIsDoubles,
    parseSingles: parsePlayedActions, parseDoubles: parsePlayedActionsDoubles,
  });
  return { acquire, smogonPending, positionPicker, pickerSimState, playedAtView };
}

function useEvalViewLayer(
  ctx: ReplayContext, transients: Transients, board: BoardController,
  acquireLayer: ReturnType<typeof useAcquireLayer>,
) {
  const { replayData, snapshots } = ctx.replay;
  const { branching, executing, history } = ctx.branch;
  const { evaluation, teamSources } = ctx;
  const { replayGameType, evalIsDoubles, bringOnlyLists } = ctx.meta;
  const { setsFingerprint, sensitivityTargetsFor, editedP1Info, editedP2Info } = ctx.knowledge;
  const { playOut } = transients;
  const {
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey,
    serializedAtView, analysisTurn, analyzableTurns, setVariationScores,
  } = board.timeline;
  const { branchPreparing } = board.deviation;
  const { acquire, smogonPending } = acquireLayer;

  // Evaluation view glue: format switches, Evaluate, sweeps, invalidations,
  // and the think-deeper ladder.
  return useEvalView({
    replayData, snapshots, evaluation, replayGameType, evalIsDoubles,
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, serializedAtView,
    liveEvalStatus: board.liveEvalStatus, analysisTurn, analyzableTurns, branching, executing, branchPreparing,
    playOutActive: playOut?.active ?? false, smogonPending,
    acquire: {
      acquireBranchPosition: acquire.acquireBranchPosition,
      acquireReplayPosition: acquire.acquireReplayPosition,
      makeReplayAcquire: acquire.makeReplayAcquire,
      makeSweepAcquireAll: acquire.makeSweepAcquireAll,
    },
    sources: teamSources, bringOnlyLists, setsFingerprint, sensitivityTargetsFor,
    editedP1Info, editedP2Info, historyLength: history.length, setVariationScores,
  });
}

function usePlayLayer(
  ctx: ReplayContext, transients: Transients, board: BoardController,
  evalView: ReturnType<typeof useEvalViewLayer>,
) {
  const { simState, branching, executing, getBattle, executeTurn } = ctx.branch;
  const { evaluation } = ctx;
  const {
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    pendingConfirm,
  } = transients;
  const {
    liveTip, viewingVariation, atEndPosition, viewT0, viewTurn, variationSpan, tipTurn,
    navigateTo, setNavSeek, setVariationScores, evalViewKey,
  } = board.timeline;
  const {
    branchPreparing, handleSetChoice, requestDeviation, setBranchDivergence,
    rebuildAt, startLeadVariation, defaultLeadSelection,
  } = board.deviation;
  const { handleEvaluate } = evalView;

  // Engine walk: clicking a line plays the turn out; queued picks follow
  // a rebuild; interludes finish forced replacements.
  const walk = useEngineWalk({
    simState, liveTip, branching, branchPreparing, executing,
    confirmOpen: pendingConfirm !== null, playOutActive: playOut?.active ?? false,
    evaluation, evalViewKey, getBattle, executeTurn, handleEvaluate, handleSetChoice,
    requestDeviation, setBranchDivergence,
  });

  // "Let it play out": the engine plays both sides from the viewed position.
  const playOutControls = usePlayOut({
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    evaluation, evalViewKey, liveEvalStatus: board.liveEvalStatus, liveTip, viewingVariation, atEndPosition, viewT0,
    viewTurn, variationSpan, tipTurn, navigateTo, setNavSeek, setVariationScores,
    executing, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice: walk.applyEvalChoice,
    rebuildAt, requestDeviation, startLeadVariation, defaultLeadSelection,
  });
  return { walk, playOutControls };
}

/**
 * Engine layer: position acquisition, the evaluation view glue, the engine
 * walk, and the play-out loop. Call order matches the pre-split App().
 */
export function useEngineController(ctx: ReplayContext, transients: Transients, board: BoardController) {
  const acquireLayer = useAcquireLayer(ctx, transients, board);
  const evalView = useEvalViewLayer(ctx, transients, board, acquireLayer);
  const { walk, playOutControls } = usePlayLayer(ctx, transients, board, evalView);
  return { ...acquireLayer, evalView, walk, playOutControls };
}

export type EngineController = ReturnType<typeof useEngineController>;
