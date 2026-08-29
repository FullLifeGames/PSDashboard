import { useCallback, useEffect, useMemo } from 'react';
import { useTimeline } from '../useTimeline';
import type { Timeline } from '../useTimeline';
import { useDeviation } from '../useDeviation';
import { useBranchRefresh } from '../useBranchRefresh';
import type { ReplayContext } from './replay-context';
import type { Transients } from './transients';

/**
 * Honest divergence notice: guessed sets can make the branch replay
 * DIVERGE from the real game — in the worst case the simulated game ends
 * before the requested turn (GPL T39: three rejected choices, sim winner
 * declared early). Playing recommendations into that dead sim produced
 * baffling errors ("more choices than unfainted Pokémon"); instead the
 * divergence is surfaced and play-outs are refused.
 */
function useDeviationLayer(ctx: ReplayContext, transients: Transients, timeline: Timeline) {
  const { replayData, snapshots, observations } = ctx.replay;
  const { startBranch, getBattle, executeTurn, setChoice, history, branching, variationStartTurn } = ctx.branch;
  const { branchWindowOpenRef, teamSources } = ctx;
  const { bringOnlyLists, bringCount, replayGameType } = ctx.meta;
  const { draftChoices, setDraftChoices, setPendingConfirm } = transients;
  const {
    viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores,
    setViewTurn, setViewLine, liveTip, viewTurn,
  } = timeline;

  // Deviation machinery: the rebuild road, the chess-rule requests, the
  // shared preparation session, and the picker draft plumbing.
  const deviationTimeline = useMemo(() => ({
    viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores,
    setViewTurn, setViewLine, liveTip,
  }), [viewTurnRef, viewLine, endSnapshotTurn, variationSpan, setVariationScores, setViewTurn, setViewLine, liveTip]);
  const deviationBranch = useMemo(() => ({
    startBranch, getBattle, executeTurn, setChoice, history,
  }), [startBranch, getBattle, executeTurn, setChoice, history]);
  const deviation = useDeviation({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists, bringCount,
    replayGameType, timeline: deviationTimeline, branch: deviationBranch,
    branchWindowOpenRef, setPendingConfirm, draftChoices, setDraftChoices,
  });
  useBranchRefresh({
    replayData, snapshots, observations, sources: teamSources, bringOnlyLists,
    branching, variationStartTurn, startBranch, viewTurn, session: deviation.session, branchWindowOpenRef,
    request: ctx.refreshQueue.pendingBranchRefresh, clearRequest: ctx.refreshQueue.clearRefreshRequest,
  });
  return deviation;
}

/**
 * Board layer: the unified-timeline pointer, the deviation/rebuild road,
 * the branch refresh, and the line lifecycle (discard, replay-load reset).
 */
export function useTimelineController(ctx: ReplayContext, transients: Transients) {
  const { replayData, snapshots } = ctx.replay;
  const { branching, variationStartTurn, history, stopBranch } = ctx.branch;
  const { evaluation, branchWindowOpenRef } = ctx;
  const { interruptPlayOut, clearDraftChoices, setPendingConfirm, setPlayOut, setPlayOutNotice, setDraftChoices } = transients;

  // ── Unified timeline: one pointer over main line + at most one variation ──
  const timeline = useTimeline({
    replayId: replayData?.id, snapshots, branching, variationStartTurn, history,
    interruptPlayOut, onNavigate: clearDraftChoices,
  });
  const evalResultMatchesView = evaluation.resultTag === null || evaluation.resultTag === timeline.evalViewKey;
  const liveEvalStatus: typeof evaluation.status =
    evaluation.status === 'done' && !evalResultMatchesView ? 'stale' : evaluation.status;

  const deviation = useDeviationLayer(ctx, transients, timeline);
  const { setBranchDivergence } = deviation;
  const { maxTurn, setViewTurn, setViewLine, setVariationScores, resetPointer } = timeline;

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
  }, [stopBranch, maxTurn, setViewTurn, setViewLine, setVariationScores, setBranchDivergence,
    branchWindowOpenRef, setPendingConfirm, setPlayOut, setPlayOutNotice, setDraftChoices]);

  // A freshly loaded replay must start clean: slider at turn 1 (B11), no live
  // branch, and no team edits carried over from the previous replay. Host
  // pages can inject replays repeatedly via ps-load-replay, so the previous
  // game's state must never leak into the next one.
  useEffect(() => {
    resetPointer();
    setBranchDivergence(null);
    branchWindowOpenRef.current = false;
    stopBranch();
  }, [replayData?.id, stopBranch, resetPointer, setBranchDivergence, branchWindowOpenRef]);

  return { timeline, deviation, evalResultMatchesView, liveEvalStatus, discardVariation };
}

export type BoardController = ReturnType<typeof useTimelineController>;
