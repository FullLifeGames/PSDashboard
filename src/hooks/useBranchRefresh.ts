import { useEffect, type MutableRefObject } from 'react';
import {
  type DamageObservation, type OpponentTeamInfo, type ReplayData, type TurnSnapshot, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';
import { snapshotAt, type TeamBuildSources } from '../lib/eval-acquire';
import { prepareBranchInputs } from '../lib/branch-build';
import type { BranchHistoryEntry, useBranch } from './useBranch';
import type { AcquireRuntime } from './branch/session';
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
  acquireRuntime: AcquireRuntime;
  branchWindowOpenRef: MutableRefObject<boolean>;
  isCancelled: () => boolean;
  clearRequest: () => void;
  reportEnded: (notice: string) => void;
  seed?: string;
}

async function runRefresh(ctx: RefreshContext, request: BranchRefreshRequest) {
  const abortController = ctx.session.begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const inputs = await prepareBranchInputs(ctx.replayData, ctx.sources, ctx.observations, {
      p1: request.p1Info, p2: request.p2Info,
    });
    if (!ctx.isCancelled() && inputs) {
      ctx.session.bumpSession();
      const outcome = await ctx.startBranch(getBranchSimulatorFormat(ctx.replayData), inputs.p1Team, inputs.p2Team, ctx.replayData.log, ctx.refreshTurn, snapshotAt(ctx.snapshots, ctx.refreshTurn), {
        replayHistory: request.history,
        p1Choices: request.p1Choices,
        p2Choices: request.p2Choices,
        playerNames: [ctx.replayData.players[0], ctx.replayData.players[1]],
        onProgress: ctx.session.reportProgress,
        abort: abortController.signal,
        snapshotFor: turn => snapshotAt(ctx.snapshots, turn),
        choiceLocks: inputs.choiceLocks,
        bringOnly: ctx.bringOnly,
        acquireRuntime: ctx.acquireRuntime,
        ...(ctx.seed ? { seed: ctx.seed } : {}),
      });
      if (outcome?.endedNotice) {
        ctx.branchWindowOpenRef.current = false;
        ctx.reportEnded(outcome.endedNotice);
      } else if (!abortController.signal.aborted) {
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

/** Rebuilds the variation from its start turn; with no live runtime the viewed turn is the target. */
export function useBranchRefresh(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  branching: boolean;
  variationStartTurn: number | null;
  startBranch: Branch['startBranch'];
  acquireRuntime: AcquireRuntime;
  viewTurn: number;
  session: BranchSession;
  branchWindowOpenRef: MutableRefObject<boolean>;
  request: BranchRefreshRequest | null;
  clearRequest: () => void;
  reportEnded: (notice: string) => void;
  /** A new game's dice seed; a replay passes none. */
  gameSeed?: string;
}) {
  const {
    replayData, snapshots, observations, sources, bringOnlyLists, branching, variationStartTurn,
    startBranch, acquireRuntime, viewTurn, session, branchWindowOpenRef, request, clearRequest, reportEnded, gameSeed,
  } = args;
  useEffect(() => {
    if (!request || !replayData) return;
    let cancelled = false;
    const refreshTurn = (branching ? variationStartTurn : null) ?? viewTurn;
    void runRefresh({
      replayData, snapshots, observations, sources, refreshTurn,
      bringOnly: refreshTurn > 0 ? bringOnlyLists ?? undefined : undefined,
      session, startBranch, acquireRuntime, branchWindowOpenRef,
      isCancelled: () => cancelled,
      clearRequest, reportEnded, seed: gameSeed,
    }, request);
    return () => {
      cancelled = true;
    };
  }, [
    request, replayData, snapshots, observations, sources, bringOnlyLists, branching,
    variationStartTurn, startBranch, acquireRuntime, viewTurn, session, branchWindowOpenRef, clearRequest, reportEnded, gameSeed,
  ]);
}
