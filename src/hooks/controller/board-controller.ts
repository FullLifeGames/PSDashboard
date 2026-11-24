import { useCallback, useEffect, useMemo } from 'react';
import { useTimeline } from '../useTimeline';
import { useRequestedTurn } from '../useRequestedTurn';
import type { Timeline } from '../useTimeline';
import { useDeviation } from '../useDeviation';
import { useBranchRefresh } from '../useBranchRefresh';
import { useRestoreVariation } from '../useRestoreVariation';
import type { ReplayContext } from './replay-context';
import type { Transients } from './transients';
import { prefsAfterRun } from '../../lib/play-out';

/**
 * Guessed sets can make the branch replay DIVERGE from the real game; in the worst case the simulated game ends before the requested
 * turn (three rejected choices, sim winner declared early). Playing recommendations into that dead sim produced baffling errors
 * ("more choices than unfainted Pokémon"), so the divergence is surfaced and play-outs are refused.
 */
function useDeviationLayer(ctx: ReplayContext, transients: Transients, timeline: Timeline) {
  const { replayData, snapshots, observations } = ctx.replay;
  const { startBranch, getBattle, executeTurn, setChoice, history, branching, variationStartTurn, stopBranch } = ctx.branch;
  const { branchWindowOpenRef, teamSources } = ctx;
  const { bringOnlyLists, bringCount, replayGameType } = ctx.meta;
  const { draftChoices, setDraftChoices, setPendingConfirm, setPlayOutNotice } = transients;
  const clearPlayOutNotice = useCallback(() => setPlayOutNotice(null), [setPlayOutNotice]);
  const {
    viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores,
    setViewTurn, setViewLine, liveTip, viewTurn, restorePointer, followNextTip,
  } = timeline;

  const deviationTimeline = useMemo(() => ({
    viewTurnRef, viewTurn, viewLine, endSnapshotTurn, variationSpan, setVariationScores,
    setViewTurn, setViewLine, liveTip, restorePointer, followNextTip,
  }), [viewTurnRef, viewTurn, viewLine, endSnapshotTurn, variationSpan, setVariationScores, setViewTurn, setViewLine, liveTip,
    restorePointer, followNextTip]);
  const deviationBranch = useMemo(() => ({
    startBranch, getBattle, executeTurn, setChoice, history, stopBranch,
  }), [startBranch, getBattle, executeTurn, setChoice, history, stopBranch]);
  const { acquireRuntime } = ctx.positions;
  const deviation = useDeviation({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists, bringCount,
    replayGameType, timeline: deviationTimeline, branch: deviationBranch, acquireRuntime,
    branchWindowOpenRef, setPendingConfirm, draftChoices, setDraftChoices,
    onDeviate: clearPlayOutNotice, gameSeed: ctx.newGame.record?.seed, gameRecord: ctx.newGame.record,
  });
  useBranchRefresh({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists,
    branching, variationStartTurn, startBranch, acquireRuntime, viewTurn, session: deviation.session, branchWindowOpenRef,
    request: ctx.refreshQueue.pendingBranchRefresh, clearRequest: ctx.refreshQueue.clearRefreshRequest,
    reportEnded: deviation.reportVariationEnded, gameSeed: ctx.newGame.record?.seed,
  });
  const restoreVariation = useRestoreVariation({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists, session: deviation.session,
    branch: deviationBranch, acquireRuntime, branchWindowOpenRef, setBranchDivergence: deviation.setBranchDivergence,
    setViewTurn, setViewLine, gameSeed: ctx.newGame.record?.seed,
  });
  return { ...deviation, restoreVariation };
}

function useRequestedTurnOf(ctx: ReplayContext, maxTurn: number, landOnTurn: (turn: number) => void) {
  const { requestedReplay, requestedTurn, replayData } = ctx.replay;
  useRequestedTurn({ requestedReplay, requestedTurn, replayId: replayData?.id ?? null, maxTurn, landOnTurn });
}

export function useTimelineController(ctx: ReplayContext, transients: Transients) {
  const { replayData, snapshots } = ctx.replay;
  const { branching, variationStartTurn, history, stopBranch } = ctx.branch;
  const { evaluation, branchWindowOpenRef } = ctx;
  const { interruptPlayOut, clearDraftChoices, setPendingConfirm, playOut, setPlayOut, setPlayOutNotice, setDraftChoices } = transients;

  const timeline = useTimeline({
    replayId: replayData?.id, snapshots, branching, variationStartTurn, history,
    interruptPlayOut, onNavigate: clearDraftChoices, variationEnded: branching && (ctx.branch.simState?.ended ?? false),
    executing: ctx.branch.executing,
  });
  const evalResultMatchesView = evaluation.resultTag === null || evaluation.resultTag === timeline.evalViewKey;
  const liveEvalStatus: typeof evaluation.status =
    evaluation.status === 'done' && !evalResultMatchesView ? 'stale' : evaluation.status;

  // The same reading against the live tip's position, for the play-out and the Auto evaluation of a run: the pointer may stand elsewhere
  // (the frame reported another turn) while the run plays on at the tip.
  const tipEvalStatus: typeof evaluation.status =
    evaluation.status === 'done' && evaluation.resultTag !== null && evaluation.resultTag !== (timeline.tip?.key ?? null) ? 'stale' : evaluation.status;

  const deviation = useDeviationLayer(ctx, transients, timeline);
  const { setBranchDivergence } = deviation;
  const { restorePointer } = timeline;
  const { landRef } = ctx;
  useEffect(() => {
    landRef.current = turn => restorePointer({ turn, line: 'main' }, null);
  }, [landRef, restorePointer]);
  const { maxTurn, setViewTurn, setViewLine, setVariationScores, resetPointer } = timeline;

  const discardVariation = useCallback(() => {
    branchWindowOpenRef.current = false;
    stopBranch();
    setBranchDivergence(null);
    setPendingConfirm(null);
    const restored = playOut ? prefsAfterRun(evaluation.prefs, playOut) : null;
    if (restored) evaluation.setPrefs(restored);
    setPlayOut(null);
    setPlayOutNotice(null);
    setDraftChoices({ p1: [], p2: [] });
    setVariationScores([]);
    setViewLine('main');
    setViewTurn(current => Math.min(current, maxTurn));
  }, [stopBranch, maxTurn, setViewTurn, setViewLine, setVariationScores, setBranchDivergence, evaluation, playOut,
    branchWindowOpenRef, setPendingConfirm, setPlayOut, setPlayOutNotice, setDraftChoices]);

  // A freshly loaded replay starts clean (slider at turn 1, no live branch, no team edits); host pages inject replays repeatedly via
  // ps-load-replay, so the previous game's state must never leak into the next one.
  const { takeLanding } = ctx.newGame;
  const landOnTurn = timeline.landOnTurn;
  useEffect(() => {
    resetPointer();
    setBranchDivergence(null);
    branchWindowOpenRef.current = false;
    stopBranch();
    // A game opens on its tip, where the next turn is played from: turn 0 (the lead picker) before the lead is picked.
    const tip = takeLanding(replayData?.id);
    // The landing is the game's own id's: the run before its document arrives (a reload mounts the board first) takes none.
    // A selection, not a restore: the frame of a game that opens at start (a reload) is not there yet and reports turn 1 while it
    // loads; the guard of the landing drops that report until the frame confirms the tip, however long it loads.
    if (tip !== null) landOnTurn(tip);
  }, [replayData?.id, stopBranch, resetPointer, setBranchDivergence, branchWindowOpenRef, takeLanding, landOnTurn]);
  useRequestedTurnOf(ctx, maxTurn, landOnTurn);

  return { timeline, deviation, evalResultMatchesView, liveEvalStatus, tipEvalStatus, discardVariation };
}

export type BoardController = ReturnType<typeof useTimelineController>;
