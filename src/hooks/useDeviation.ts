import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  type DamageObservation, type ReplayData, type TurnSnapshot, getBranchSimulatorFormat,
} from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '../lib/branch-choices';
import { classifyDeviation, keptEntries, type TimelinePosition } from '../lib/timeline';
import { snapshotAt, type TeamBuildSources } from '../lib/eval-acquire';
import { divergenceNoticeFor, keptHistorySlice, prepareBranchInputs } from '../lib/branch-build';
import { buildLeadOptions, defaultLeadSelectionFor } from '../lib/lead-options';
import type { BranchHistoryEntry, useBranch } from './useBranch';
import type { Timeline } from './useTimeline';

type Branch = ReturnType<typeof useBranch>;

export interface LeadSelection { p1: string[]; p2: string[]; bring?: boolean }

export type DeviationTimeline = Pick<Timeline,
  'viewTurnRef' | 'viewLine' | 'endSnapshotTurn' | 'variationSpan' | 'setVariationScores'
  | 'setViewTurn' | 'setViewLine' | 'liveTip'>;
type DeviationBranch = Pick<Branch, 'startBranch' | 'getBattle' | 'executeTurn' | 'setChoice' | 'history'>;

export interface DeviationInputs {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnlyLists: { p1: string[]; p2: string[] } | null;
  bringCount: number | null;
  replayGameType: string | null;
  timeline: DeviationTimeline;
  branch: DeviationBranch;
  branchWindowOpenRef: MutableRefObject<boolean>;
  setPendingConfirm: (confirm: { message: string; proceed: () => void } | null) => void;
  draftChoices: { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] };
  setDraftChoices: (draft: { p1: (BranchSlotChoice | null)[]; p2: (BranchSlotChoice | null)[] }) => void;
}

/** One shared preparation session for rebuilds and refreshes: the progress
 *  line, the abort handle, and the iframe reload key's session counter.
 *  The HANDLES object is render-stable (state reads go through the ref) so
 *  the refresh effect does not cancel itself when `begin` re-renders. */
function useBranchSession() {
  const [branchPreparing, setBranchPreparing] = useState(false);
  const [branchProgress, setBranchProgress] = useState<{ turn: number; target: number } | null>(null);
  const branchAbortRef = useRef<AbortController | null>(null);
  const preparingRef = useRef(false);
  const [branchSession, setBranchSession] = useState(0);
  const begin = useCallback(() => {
    const abortController = new AbortController();
    branchAbortRef.current = abortController;
    preparingRef.current = true;
    setBranchPreparing(true);
    setBranchProgress(null);
    return abortController;
  }, []);
  const end = useCallback(() => {
    preparingRef.current = false;
    setBranchPreparing(false);
    setBranchProgress(null);
    branchAbortRef.current = null;
  }, []);
  const reportProgress = useCallback((turn: number, target: number) => {
    setBranchProgress({ turn, target });
  }, []);
  const bumpSession = useCallback(() => setBranchSession(session => session + 1), []);
  const cancelPreparation = useCallback(() => {
    branchAbortRef.current?.abort();
  }, []);
  const isPreparing = useCallback(() => preparingRef.current, []);
  const handles = useMemo(
    () => ({ begin, end, reportProgress, bumpSession, cancelPreparation, isPreparing, branchAbortRef }),
    [begin, end, reportProgress, bumpSession, cancelPreparation, isPreparing],
  );
  return { branchPreparing, branchProgress, branchSession, handles };
}

export type BranchSession = ReturnType<typeof useBranchSession>['handles'];

interface RebuildContext {
  replayData: ReplayData;
  snapshots: TurnSnapshot[];
  observations: DamageObservation[];
  sources: TeamBuildSources;
  bringOnly?: { p1: string[]; p2: string[] };
  session: BranchSession;
  branch: Pick<Branch, 'startBranch' | 'getBattle'>;
  branchWindowOpenRef: MutableRefObject<boolean>;
  setBranchDivergence: (notice: string | null) => void;
  landPointer: (startTurn: number) => void;
}

/** The async heart of rebuildAt, once the plan (start turn, kept history)
 *  is fixed: build teams + locks, start the branch, surface divergence,
 *  land the pointer for an entry-less start. */
async function executeRebuild(
  ctx: RebuildContext,
  startTurn: number,
  replayHistory: BranchHistoryEntry[],
  prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null,
  leadOverride?: LeadSelection,
) {
  const abortController = ctx.session.begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  try {
    const inputs = await prepareBranchInputs(ctx.replayData, ctx.sources, ctx.observations);
    if (inputs) {
      ctx.session.bumpSession();
      const selectedSnapshot = snapshotAt(ctx.snapshots, startTurn);
      await ctx.branch.startBranch(getBranchSimulatorFormat(ctx.replayData), inputs.p1Team, inputs.p2Team, ctx.replayData.log, startTurn, selectedSnapshot, {
        replayHistory,
        p1Choices: prefill?.p1Choices ?? [],
        p2Choices: prefill?.p2Choices ?? [],
        playerNames: [ctx.replayData.players[0], ctx.replayData.players[1]],
        onProgress: ctx.session.reportProgress,
        abort: abortController.signal,
        snapshotFor: turn => snapshotAt(ctx.snapshots, turn),
        choiceLocks: inputs.choiceLocks,
        leadOverride,
        bringOnly: ctx.bringOnly,
      });
      if (!abortController.signal.aborted) {
        ctx.branchWindowOpenRef.current = true;
        ctx.setBranchDivergence(divergenceNoticeFor(ctx.branch.getBattle(), startTurn));
        // The pointer lands where the sim now stands; the tip-follow effect
        // covers replayed histories (and the turn-0 lead entry, which is
        // seeded by startBranch), this covers the entry-less start.
        if (replayHistory.length === 0 && startTurn > 0) {
          ctx.landPointer(startTurn);
        }
      }
    }
  } finally {
    ctx.session.end();
  }
}

/** The replace-confirm text: the caller's lead-in, then the variation about to go. */
function replaceVariationMessage(leadIn: string, span: { startTurn: number; length: number }): string {
  const turnCount = span.length;
  return `${leadIn}: replace the existing variation ` +
    `from turn ${span.startTurn} (${turnCount} ${turnCount === 1 ? 'turn' : 'turns'})?`;
}

export function useDeviation(inputs: DeviationInputs) {
  const {
    replayData, snapshots, observations, sources, bringOnlyLists, bringCount, replayGameType,
    timeline, branch, branchWindowOpenRef, setPendingConfirm, draftChoices, setDraftChoices,
  } = inputs;
  const { branchPreparing, branchProgress, branchSession, handles: session } = useBranchSession();
  const [branchDivergence, setBranchDivergence] = useState<string | null>(null);
  const { variationSpan } = timeline;

  /**
   * Rebuilds the live sim at `position` and prefills the pickers: the proven
   * team-edit-refresh path (reconstruct to the variation start + replay the
   * kept history entries), the single road every deviation takes. Only an
   * EXECUTED move truncates — callers invoke this at execute time, never
   * for navigation.
   */
  const rebuildAt = useCallback(async (
    position: TimelinePosition,
    prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null,
    leadOverride?: LeadSelection,
  ) => {
    if (!replayData || session.isPreparing()) return;
    const kind = classifyDeviation(variationSpan, position);
    const insideVariation = (kind === 'extend' || kind === 'truncate') && variationSpan !== null;
    const startTurn = insideVariation ? variationSpan!.startTurn : position.turn;
    const keepTurns = insideVariation ? keptEntries(variationSpan!, position) : 0;
    const replayHistory = keptHistorySlice(branch.history, keepTurns);
    // Turn-0 variation: startBranch needs leads — the caller's (fresh lead
    // branch) or the recorded lead entry's (truncation/refresh rebuild).
    if (startTurn === 0 && !leadOverride && !replayHistory[0]?.leadChoices) return;
    await executeRebuild({
      replayData, snapshots, observations, sources,
      // Bring-limited replays (VGC 4 of 6): the interactive branch fields
      // only what the real game brought. The T0 picker carries its own
      // selection; per-side fail-open when the protocol does not pin a side.
      bringOnly: startTurn > 0 ? bringOnlyLists ?? undefined : undefined,
      session, branch, branchWindowOpenRef, setBranchDivergence,
      landPointer: (turn) => {
        timeline.setViewTurn(turn);
        timeline.setViewLine('main');
      },
    }, startTurn, replayHistory, prefill, leadOverride);
  }, [replayData, session, variationSpan, branch, snapshots, observations, sources, bringOnlyLists, branchWindowOpenRef, timeline]);

  const requests = useDeviationRequests({
    timeline, rebuildAt, executeTurn: branch.executeTurn, setPendingConfirm, setBranchDivergence,
  });

  const handleSetChoice = useCallback((side: 'p1' | 'p2', choice: BranchSlotChoice, activeSlot?: number) => {
    if (!timeline.liveTip) {
      const slot = activeSlot ?? 0;
      const next = { p1: [...draftChoices.p1], p2: [...draftChoices.p2] };
      next[side][slot] = choice;
      setDraftChoices(next);
      return;
    }
    branch.setChoice(side, choice, activeSlot);
  }, [timeline.liveTip, draftChoices, setDraftChoices, branch]);

  const handleExecuteDraft = useCallback(() => {
    requests.requestDeviation({ p1Choices: draftChoices.p1, p2Choices: draftChoices.p2 });
  }, [requests, draftChoices]);

  const leadOptions = useMemo(() => buildLeadOptions(snapshots), [snapshots]);
  const defaultLeadSelection = useCallback(
    () => defaultLeadSelectionFor(leadOptions, bringCount, replayGameType),
    [leadOptions, bringCount, replayGameType],
  );

  return {
    session, branchDivergence, setBranchDivergence,
    branchPreparing, branchProgress, branchSession,
    cancelPreparation: session.cancelPreparation,
    rebuildAt, ...requests, handleSetChoice, handleExecuteDraft, leadOptions, defaultLeadSelection,
  };
}

/** The chess rules of leaving the line: an explicit deviation request from
 *  the viewed position, and the turn-0 lead variation, both guarded by the
 *  replace confirm. */
function useDeviationRequests(args: {
  timeline: DeviationTimeline;
  rebuildAt: (position: TimelinePosition, prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null, leadOverride?: LeadSelection) => Promise<void>;
  executeTurn: Branch['executeTurn'];
  setPendingConfirm: DeviationInputs['setPendingConfirm'];
  setBranchDivergence: (notice: string | null) => void;
}) {
  const { timeline, rebuildAt, executeTurn, setPendingConfirm, setBranchDivergence } = args;
  const { variationSpan } = timeline;

  const requestDeviation = useCallback((
    prefill: { p1Choices: (BranchSlotChoice | null)[]; p2Choices: (BranchSlotChoice | null)[] } | null,
  ) => {
    // The ref, not the closure: see viewTurnRef (slider→click race).
    const position: TimelinePosition = { turn: timeline.viewTurnRef.current, line: timeline.viewLine };
    // The end snapshot is the post-battle sentinel, not a playable turn.
    if (position.line === 'main' && timeline.endSnapshotTurn !== null && position.turn >= timeline.endSnapshotTurn) {
      setBranchDivergence('The battle is already over at the end position: pick an earlier turn to play from.');
      return;
    }
    const kind = classifyDeviation(variationSpan, position);
    const run = () => {
      // The overlay dies with the entries it belonged to.
      if (kind === 'replace' || kind === 'open') {
        timeline.setVariationScores([]);
      } else if (kind === 'truncate') {
        timeline.setVariationScores(previous => previous.map((value, index) => (index + 1 > position.turn ? null : value)));
      }
      void rebuildAt(position, prefill).then(() => {
        if (prefill) void executeTurn();
      });
    };
    if (kind === 'replace' && variationSpan) {
      setPendingConfirm({
        message: replaceVariationMessage(`You are on the main line (turn ${position.turn})`, variationSpan),
        proceed: () => { setPendingConfirm(null); run(); },
      });
      return;
    }
    run();
  }, [timeline, variationSpan, rebuildAt, executeTurn, setPendingConfirm, setBranchDivergence]);

  /**
   * Turn-0 branching: replace the game's leads and play from team preview.
   * Same chess rules as any deviation — an existing variation is replaced
   * only after the confirm.
   */
  const startLeadVariation = useCallback((leads: LeadSelection, opts?: { onStart?: () => void }) => {
    const run = () => {
      opts?.onStart?.();
      timeline.setVariationScores([]);
      void rebuildAt({ turn: 0, line: 'main' }, null, leads);
    };
    if (variationSpan) {
      setPendingConfirm({
        message: replaceVariationMessage('Start a new game from turn 0', variationSpan),
        proceed: () => { setPendingConfirm(null); run(); },
      });
      return;
    }
    run();
  }, [timeline, variationSpan, rebuildAt, setPendingConfirm]);

  return { requestDeviation, startLeadVariation };
}
