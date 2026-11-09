import { useCallback, useMemo } from 'react';
import { logRules } from '@fulllifegames/replay-core';
import { useEvalAcquire } from '../useEvalAcquire';
import { usePlayedAtView, usePositionPicker } from '../usePositionPicker';
import { useEvalView } from '../useEvalView';
import { useEngineWalk } from '../useEngineWalk';
import { useDockFill } from '../useDockFill';
import { usePlayOut } from '../usePlayOut';
import { useEvaluation } from '../useEvaluation';
import { parsePlayedActions, parsePlayedActionsDoubles } from '@fulllifegames/eval-engine';
import type { ReplayContext } from './replay-context';
import type { Transients } from './transients';
import type { BoardController } from './board-controller';
import { dropStaleDraft } from './draft-guard';
import { overlayFill } from '../../lib/dock-fill';
import type { SideChoices } from '../../lib/dock-seed';

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
  const { replayData, snapshots } = ctx.replay;
  const { getBattle, executing, variationStartTurn, startSerialized } = ctx.branch;
  const { evaluation, teamSources, positions } = ctx;
  const { replayGenNumber } = ctx.knowledge;
  const { bench } = ctx.meta;
  const { playOut, draftChoices } = transients;
  const { liveTip, viewingVariation, atEndPosition, viewTurn, serializedAtView } = board.timeline;
  const { branchPreparing } = board.deviation;

  const { dwellEnabled, smogonPending } = acquireGates({
    liveTip, viewingVariation, atEndPosition, executing, branchPreparing,
    playOut, evaluation, usageStats: ctx.smogon.usageStats, setAssumptions: ctx.smogon.setAssumptions,
  });
  const acquire = useEvalAcquire({ replayData, source: positions, getBattle, viewTurn, dwellEnabled, smogonPending });
  // Round 84 (turn dock): read before the picker, which seeds its untouched slots with it.
  // Round 75 (T160): the played-action parser reads the replay's own Dex (generation and mod).
  const rules = useMemo(() => logRules(replayData?.log ?? ''), [replayData]);
  const parseSingles = useCallback((lines: string[]) => parsePlayedActions(lines, rules), [rules]);
  const playedAtView = usePlayedAtView({
    viewingVariation, variationSpan: board.timeline.variationSpan, viewTurn,
    history: ctx.branch.history, snapshots, doubles: ctx.meta.evalIsDoubles,
    parseSingles, parseDoubles: parsePlayedActionsDoubles,
  });
  const { positionPicker, pickerSimState, pickerSeed, pickerStale, getPickerBattle, pickerReplayLog } = usePositionPicker({
    replayData, snapshots, sources: teamSources, bench, replayGenNumber,
    liveTip, viewingVariation, serializedAtView, viewTurn, variationStartTurn, startSerialized,
    getExact: acquire.getExact, exactPositionsVersion: acquire.exactPositionsVersion, draftChoices,
    liveSimState: ctx.branch.simState, played: playedAtView,
  });
  // Round 77 (D2): a draft pick that the rebuilt position no longer offers goes, instead of failing on Execute. The
  // reconciliation runs in render: the draft state lives in this same component.
  const resolvedForView = !liveTip ? positionPicker?.simState ?? null : null;
  if (resolvedForView) {
    const kept = dropStaleDraft(draftChoices, resolvedForView);
    if (kept !== draftChoices) transients.setDraftChoices(kept);
  }
  return { acquire, smogonPending, positionPicker, pickerSimState, pickerSeed, pickerStale, getPickerBattle, pickerReplayLog, playedAtView };
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
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, tip,
    serializedAtView, analysisTurn, analyzableTurns, setVariationScores,
  } = board.timeline;
  const { branchPreparing } = board.deviation;
  const { acquire, smogonPending } = acquireLayer;

  // Evaluation view glue: format switches, Evaluate, sweeps, invalidations,
  // and the single-turn analysis of a gap turn.
  return useEvalView({
    replayData, snapshots, evaluation, replayGameType, evalIsDoubles,
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, serializedAtView,
    liveEvalStatus: board.liveEvalStatus, tip, tipEvalStatus: board.tipEvalStatus, analysisTurn, analyzableTurns, branching, executing, branchPreparing,
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

/**
 * Round 84 (turn dock): the engine fill. At the live tip it reads the evaluation the view layer drives and writes into the branch's
 * picks. At a replay turn (Q19 b) it works on the picker's effective choices (the logged seed under the user's picks), keeps what
 * it writes in the view, and hands the dock the state with that fill laid over the empty slots.
 */
function useFillLayer(
  ctx: ReplayContext, transients: Transients, board: BoardController,
  evalView: ReturnType<typeof useEvalViewLayer>, acquireLayer: ReturnType<typeof useAcquireLayer>,
) {
  const { simState, branching, executing, history, variationStartTurn, getChoices, recordChoice, executePending } = ctx.branch;
  const { liveTip, evalViewKey } = board.timeline;
  const { pickerSimState, pickerStale } = acquireLayer;
  const { handleExecuteDraft } = board.deviation;
  const viewed = liveTip ? simState : pickerSimState;
  // The picks of a replay turn are the picker state's own: the logged actions under the user's.
  const getPickerChoices = useCallback(() => ({ p1: pickerSimState?.p1Choices ?? [], p2: pickerSimState?.p2Choices ?? [] }), [pickerSimState]);
  const runTurn = useCallback((choices: SideChoices) => (
    liveTip ? executePending() : handleExecuteDraft(choices)
  ), [liveTip, executePending, handleExecuteDraft]);
  const fill = useDockFill({
    simState: viewed, liveTip, branching, executing, branchPreparing: board.deviation.branchPreparing,
    playOutActive: transients.playOut?.active ?? false, evalAvailable: evalView.evalAvailable, evaluation: ctx.evaluation,
    liveEvalStatus: board.liveEvalStatus, evalViewKey, historyLength: liveTip ? history.length : 0, stale: pickerStale,
    sessionKey: `${ctx.replay.replayData?.id ?? ''}:${board.deviation.branchSession}:${variationStartTurn ?? 0}`,
    handleEvaluate: evalView.handleEvaluate, getChoices: liveTip ? getChoices : getPickerChoices, setChoice: recordChoice, executeTurn: runTurn,
  });
  const dockSimState = useMemo(() => overlayFill(pickerSimState, fill.choices), [pickerSimState, fill.choices]);
  return { fill, dockSimState };
}

function usePlayLayer(
  ctx: ReplayContext, transients: Transients, board: BoardController,
  evalView: ReturnType<typeof useEvalViewLayer>,
) {
  const { engineSimState, branching, executing, executeError, getBattle, executeTurn, setChoice } = ctx.branch;
  const { evaluation } = ctx;
  const {
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    pendingConfirm, fastPlayOut, leadPicksRef,
  } = transients;
  const {
    liveTip, viewingVariation, atEndPosition, viewT0, viewTurn, tipTurn,
    holdTipFollow, navigateTo, setNavSeek, evalViewKey, tip,
  } = board.timeline;
  const {
    branchPreparing, handleSetChoice, requestDeviation, setBranchDivergence, startLeadVariation, setVariationNotice,
  } = board.deviation;
  const { handleEvaluate } = evalView;
  // Round 89 (#112): a run plays the live sim wherever the pointer stands. The pickers' handler files the choice as a draft
  // for the viewed turn when the pointer is off the tip, which would leave the run's turn without its choices.
  const runAtTip = (playOut?.active ?? false) && tip !== null;
  const handleSetChoiceForWalk = useCallback<typeof handleSetChoice>(
    (side, choice, activeSlot) => (runAtTip ? setChoice(side, choice, activeSlot) : handleSetChoice(side, choice, activeSlot)),
    [runAtTip, setChoice, handleSetChoice],
  );

  // Engine walk: clicking a line plays the turn out; queued picks follow
  // a rebuild; interludes finish forced replacements.
  const walk = useEngineWalk({
    // Round 88 (M3): the walk applies the engine's own choices, which the filtered bench of the pickers must not refuse.
    simState: engineSimState, liveTip, branching, branchPreparing, executing,
    confirmOpen: pendingConfirm !== null, playOutActive: playOut?.active ?? false,
    evaluation, evalViewKey, getBattle, executeTurn, handleEvaluate, handleSetChoice: handleSetChoiceForWalk,
    requestDeviation, setBranchDivergence,
  });

  // "Let it play out": the engine plays both sides from the viewed position.
  const playOutControls = usePlayOut({
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    evaluation, fastPlayOut, tip, tipEvalStatus: board.tipEvalStatus, liveTip, viewingVariation, atEndPosition, viewT0,
    viewTurn, tipTurn, holdTipFollow, navigateTo, setNavSeek,
    executing, executeError, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice: walk.applyEvalChoice,
    requestDeviation, startLeadVariation, leadPicksRef, setVariationNotice,
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
  const { fill: dockFill, dockSimState } = useFillLayer(ctx, transients, board, evalView, acquireLayer);
  const { walk, playOutControls } = usePlayLayer(ctx, transients, board, evalView);
  return { ...acquireLayer, evalView, dockFill, dockSimState, walk, playOutControls };
}

export type EngineController = ReturnType<typeof useEngineController>;
