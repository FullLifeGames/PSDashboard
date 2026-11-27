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
  // Read before the picker, which seeds its untouched slots with it.
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
  const { branching, executing, history, simState } = ctx.branch;
  const { evaluation, teamSources } = ctx;
  const { replayGameType, evalIsDoubles, bringOnlyLists, bringWorlds } = ctx.meta;
  const { setsFingerprint, sensitivityTargetsFor, editedP1Info, editedP2Info } = ctx.knowledge;
  const { playOut } = transients;
  const {
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, tip,
    serializedAtView, analysisTurn, analyzableTurns, setVariationScores,
  } = board.timeline;
  const { branchPreparing } = board.deviation;
  const { acquire, smogonPending } = acquireLayer;

  return useEvalView({
    replayData, snapshots, evaluation, replayGameType, evalIsDoubles,
    viewTurn, viewLine, viewingVariation, liveTip, liveEvalView, evalViewKey, serializedAtView,
    liveEvalStatus: board.liveEvalStatus, tip, tipEvalStatus: board.tipEvalStatus, analysisTurn, analyzableTurns, branching, executing, branchPreparing,
    playOutActive: playOut?.active ?? false, replacementPending: !!simState && (simState.p1ForceSwitch || simState.p2ForceSwitch), smogonPending,
    acquire: {
      acquireBranchPosition: acquire.acquireBranchPosition,
      acquireReplayPosition: acquire.acquireReplayPosition,
      makeReplayAcquire: acquire.makeReplayAcquire,
      makeSweepAcquireAll: acquire.makeSweepAcquireAll,
    },
    sources: teamSources, bringOnlyLists, bringWorlds, setsFingerprint, sensitivityTargetsFor,
    editedP1Info, editedP2Info, historyLength: history.length, setVariationScores,
  });
}

function useFillLayer(
  ctx: ReplayContext, transients: Transients, board: BoardController,
  evalView: ReturnType<typeof useEvalViewLayer>, acquireLayer: ReturnType<typeof useAcquireLayer>,
) {
  const { simState, branching, executing, history, variationStartTurn, getChoices, recordChoice, executePending } = ctx.branch;
  const { liveTip, evalViewKey } = board.timeline;
  const { pickerSimState, pickerStale } = acquireLayer;
  const { handleExecuteDraft } = board.deviation;
  const viewed = liveTip ? simState : pickerSimState;
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
  // A run plays the live sim wherever the pointer stands; off the tip the pickers would file the choice as a draft.
  const runAtTip = (playOut?.active ?? false) && tip !== null;
  const handleSetChoiceForWalk = useCallback<typeof handleSetChoice>(
    (side, choice, activeSlot) => (runAtTip ? setChoice(side, choice, activeSlot) : handleSetChoice(side, choice, activeSlot)),
    [runAtTip, setChoice, handleSetChoice],
  );

  const walk = useEngineWalk({
    // The walk applies the engine's own choices, which the filtered bench of the pickers must not refuse.
    simState: engineSimState, liveTip, branching, branchPreparing, executing,
    confirmOpen: pendingConfirm !== null, playOutActive: playOut?.active ?? false,
    evaluation, evalViewKey, getBattle, executeTurn, handleEvaluate, handleSetChoice: handleSetChoiceForWalk,
    requestDeviation, setBranchDivergence,
  });

  const playOutControls = usePlayOut({
    playOut, setPlayOut, setPlayOutNotice, playOutProcessedRef, playOutRef, stopPlayOutRef,
    evaluation, fastPlayOut, tip, tipEvalStatus: board.tipEvalStatus, liveTip, viewingVariation, atEndPosition, viewT0,
    viewTurn, tipTurn, holdTipFollow, navigateTo, setNavSeek,
    executing, executeError, branchPreparing, getBattle, executeTurn, handleEvaluate, applyEvalChoice: walk.applyEvalChoice,
    requestDeviation, startLeadVariation, leadPicksRef, setVariationNotice,
  });
  return { walk, playOutControls };
}

export function useEngineController(ctx: ReplayContext, transients: Transients, board: BoardController) {
  const acquireLayer = useAcquireLayer(ctx, transients, board);
  const evalView = useEvalViewLayer(ctx, transients, board, acquireLayer);
  const { fill: dockFill, dockSimState } = useFillLayer(ctx, transients, board, evalView, acquireLayer);
  const { walk, playOutControls } = usePlayLayer(ctx, transients, board, evalView);
  return { ...acquireLayer, evalView, dockFill, dockSimState, walk, playOutControls };
}

export type EngineController = ReturnType<typeof useEngineController>;
