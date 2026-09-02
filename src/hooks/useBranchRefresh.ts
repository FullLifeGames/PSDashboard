import { useEffect, type MutableRefObject } from 'react';
import {
  type DamageObservation, type OpponentTeamInfo, type ReplayData, type TurnSnapshot, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '../lib/branch-choices';
import { snapshotAt, type TeamBuildSources } from '../lib/eval-acquire';
import { prepareBranchInputs } from '../lib/branch-build';
import type { BranchHistoryEntry, useBranch } from './useBranch';
import type { BranchSession } from './useDeviation';

type Branch = ReturnType<typeof useBranch>;

export interface BranchRefreshRequest {
  p1Info: OpponentTeamInfo;
  p2Info: OpponentTeamInfo;
  history: BranchHistoryEntry[];
  p1Choices: (BranchSlotChoice | null)[];
  p2Choices: (BranchSlotChoice | null)[];
}

interface RefreshContext {
  replayData: ReplayData;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  refreshTurn: number;
  bringOnly?: { p1: string[]; p2: string[] };
  session: BranchSession;
  startBranch: Branch['startBranch'];
  branchWindowOpenRef: MutableRefObject<boolean>;
  isCancelled: () => boolean;
  clearRequest: () => void;
}

/** The refresh run: rebuild the variation with the edited team knowledge,
 *  replaying the same history and pending choices. */
async function runRefresh(ctx: RefreshContext, request: BranchRefreshRequest) {
  const abortController = ctx.session.begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const inputs = await prepareBranchInputs(ctx.replayData, ctx.sources, ctx.observations, {
      p1: request.p1Info, p2: request.p2Info,
    });
    if (!ctx.isCancelled() && inputs) {
      ctx.session.bumpSession();
      await ctx.startBranch(getBranchSimulatorFormat(ctx.replayData), inputs.p1Team, inputs.p2Team, ctx.replayData.log, ctx.refreshTurn, snapshotAt(ctx.snapshots, ctx.refreshTurn), {
        replayHistory: request.history,
        p1Choices: request.p1Choices,
        p2Choices: request.p2Choices,
        playerNames: [ctx.replayData.players[0], ctx.replayData.players[1]],
        onProgress: ctx.session.reportProgress,
        abort: abortController.signal,
        snapshotFor: turn => snapshotAt(ctx.snapshots, turn),
        choiceLocks: inputs.choiceLocks,
        bringOnly: ctx.bringOnly,
      });
      if (!abortController.signal.aborted) {
        ctx.branchWindowOpenRef.current = true;
      }
    }
  } finally {
    if (!ctx.isCancelled()) {
      ctx.session.end();
      ctx.clearRequest();
    }
    ctx.session.branchAbortRef.current = null;
  }
}

/** "What if it had …" and team edits: the pending refresh request rebuilds
 *  the VARIATION, wherever the pointer wanders — its start turn, never the
 *  currently viewed position. Without a live runtime (fresh hypothetical),
 *  the viewed turn IS the target. */
export function useBranchRefresh(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  branching: boolean;
  variationStartTurn: number | null;
  startBranch: Branch['startBranch'];
  viewTurn: number;
  session: BranchSession;
  branchWindowOpenRef: MutableRefObject<boolean>;
  request: BranchRefreshRequest | null;
  clearRequest: () => void;
}) {
  const {
    replayData, snapshots, observations, sources, bringOnlyLists, branching, variationStartTurn,
    startBranch, viewTurn, session, branchWindowOpenRef, request, clearRequest,
  } = args;
  useEffect(() => {
    if (!request || !replayData) return;
    let cancelled = false;
    const refreshTurn = (branching ? variationStartTurn : null) ?? viewTurn;
    void runRefresh({
      replayData, snapshots, observations, sources, refreshTurn,
      // Bring-limited replays keep their trim through team-edit refreshes
      // too (a T0 variation re-seeds it from its lead entry).
      bringOnly: refreshTurn > 0 ? bringOnlyLists ?? undefined : undefined,
      session, startBranch, branchWindowOpenRef,
      isCancelled: () => cancelled,
      clearRequest,
    }, request);
    return () => {
      cancelled = true;
    };
  }, [
    request, replayData, snapshots, observations, sources, bringOnlyLists, branching,
    variationStartTurn, startBranch, viewTurn, session, branchWindowOpenRef, clearRequest,
  ]);
}
