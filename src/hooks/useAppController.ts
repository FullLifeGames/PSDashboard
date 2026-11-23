import { useCallback, useMemo } from 'react';
import { useReplayContext } from './controller/replay-context';
import type { ReplayContext } from './controller/replay-context';
import { useTransients } from './controller/transients';
import { useTimelineController } from './controller/board-controller';
import type { BoardController } from './controller/board-controller';
import { useEngineController } from './controller/engine-controller';
import type { EngineController } from './controller/engine-controller';
import { useGameAnalysis } from './useGameAnalysis';
import { useEarlyLines } from './useEarlyLines';
import { turnCacheKey } from './useEvalView';
import { useSupport } from './useSupport';
import { useOpenSharedGame } from './useOpenSharedGame';
import { useRestorePendingTurn } from './useRestorePendingTurn';
import { branchFrameLog } from '../lib/branch-log';
import { manualMove, toId } from '@fulllifegames/replay-core';
import type { BranchSlotChoice } from '@fulllifegames/eval-engine';

function seededRefreshRequest(args: {
  nextP1: NonNullable<ReplayContext['knowledge']['effectiveP1Info']>;
  nextP2: NonNullable<ReplayContext['knowledge']['effectiveP2Info']>;
  history: ReplayContext['branch']['history'];
  simState: ReplayContext['branch']['simState'];
  liveTip: boolean;
  side: 'p1' | 'p2';
  activeSlot: number;
  move: string;
}) {
  const { nextP1, nextP2, history, simState, liveTip, side, activeSlot, move } = args;
  const seedChoices = (choices: (BranchSlotChoice | null)[], seedSide: 'p1' | 'p2') => {
    const next = [...choices];
    if (seedSide === side) {
      next[activeSlot] = { kind: 'move' as const, moveId: toId(move), moveName: move };
    }
    return next;
  };
  return {
    p1Info: nextP1,
    p2Info: nextP2,
    history: [...history],
    p1Choices: seedChoices((liveTip && simState?.p1Choices) || [], 'p1'),
    p2Choices: seedChoices((liveTip && simState?.p2Choices) || [], 'p2'),
  };
}

/** "What if it had ...": a team edit plus the normal branch refresh. */
function useHypotheticalMove(ctx: ReplayContext, board: BoardController) {
  const { effectiveP1Info, effectiveP2Info, setEditedP1Info, setEditedP2Info } = ctx.knowledge;
  const { setPendingBranchRefresh } = ctx.refreshQueue;
  const { simState, history } = ctx.branch;
  const { liveTip, variationSpan } = board.timeline;
  return useCallback((
    side: 'p1' | 'p2',
    activeSlot: number,
    params: { species: string; move: string; replace: string | null },
  ) => {
    const sideInfo = side === 'p1' ? effectiveP1Info : effectiveP2Info;
    if (!sideInfo) return;
    // The hypothetical seeds a pending choice where the sim will stand after the refresh: the live tip, or the viewed turn when
    // there is no variation. Mid-variation views stay inert: the seeded slot would belong to the tip.
    if (variationSpan !== null && !liveTip) return;

    const pokemon = sideInfo.pokemon.map(entry => {
      if (toId(entry.species) !== toId(params.species)) return entry;
      const withoutReplaced = params.replace
        ? entry.moves.filter(move => move.name !== params.replace)
        : entry.moves.slice(0, 3);
      return { ...entry, moves: [...withoutReplaced, manualMove(params.move)].slice(0, 4) };
    });
    const updated = { pokemon };

    const nextP1 = side === 'p1' ? updated : effectiveP1Info;
    const nextP2 = side === 'p2' ? updated : effectiveP2Info;
    if (side === 'p1') setEditedP1Info(updated); else setEditedP2Info(updated);

    if (nextP1 && nextP2) {
      setPendingBranchRefresh(seededRefreshRequest({
        nextP1, nextP2, history, simState, liveTip, side, activeSlot, move: params.move,
      }));
    }
  }, [effectiveP1Info, effectiveP2Info, setEditedP1Info, setEditedP2Info, simState, history, liveTip, variationSpan, setPendingBranchRefresh]);
}

/** The early-lines stage after the game report; its progress goes to the Game review's header. */
function useEarlyLinesStage(ctx: ReplayContext, engine: EngineController, analyses: ReturnType<typeof useGameAnalysis>['gameAnalyses']) {
  const { evaluation } = ctx;
  const { replayData, snapshots } = ctx.replay;
  const { setsFingerprint } = ctx.knowledge;
  const { makeReplayAcquire } = engine.acquire;
  const { effectiveTera, effectiveSleepClause, effectiveRuleset } = engine.evalView;
  const replayId = replayData?.id ?? null;
  const positionFor = useCallback((turn: number) => makeReplayAcquire(turn)(() => {}), [makeReplayAcquire]);
  const cacheKeyFor = useCallback(
    (turn: number) => turnCacheKey(replayId ?? '', turn, snapshots.length, setsFingerprint),
    [replayId, snapshots.length, setsFingerprint],
  );
  return useEarlyLines({
    replayId, analyses, graph: evaluation.graph, prefsMode: evaluation.prefs.mode,
    tera: effectiveTera, sleepClause: effectiveSleepClause, ruleset: effectiveRuleset,
    searchLines: evaluation.searchLines, attachLines: evaluation.attachLines, cancel: evaluation.cancel, positionFor, cacheKeyFor,
  });
}

function useAnalysisSurface(ctx: ReplayContext, board: BoardController, engine: EngineController) {
  const { replayData, snapshots } = ctx.replay;
  const { evaluation } = ctx;
  const { replayGen } = ctx.meta;
  const { analysisTurn } = board.timeline;
  const { sweepAlignment } = engine.acquire;
  const { simState, history, branching, variationStartTurn } = ctx.branch;
  const { branchSession } = board.deviation;

  const { turnReads, turnAnalysis, faintedShares, leadAnalysisData, gameReport, gameAnalyses } = useGameAnalysis({
    replayData, snapshots, evaluation, analysisTurn, sweepAlignment, replayGen,
  });

  const { progress: earlyLines, lineComing } = useEarlyLinesStage(ctx, engine, gameAnalyses);

  const simLines = simState?.log;
  // The display lines of the forced dice join the frame's log, never the battle's own.
  const simLog = useMemo(() => {
    if (!simLines || simLines.length === 0) return '';
    return branchFrameLog(simLines, history.flatMap(entry => entry.dieLines ?? []));
  }, [simLines, history]);
  const latestBranchHistoryEntry = history.length > 0 ? history[history.length - 1] : null;

  const showBranch = branching && simLog.length > 0;
  // Keyed on session and branch start, not the viewed turn: a viewTurn key would remount the sim iframe on every navigation and executed turn.
  const branchReloadKey = `${branchSession}:${variationStartTurn ?? 0}`;

  return { turnReads, turnAnalysis, faintedShares, leadAnalysisData, gameReport, gameAnalyses, earlyLines, lineComing, simLog, latestBranchHistoryEntry, showBranch, branchReloadKey };
}

/** The App controller: the App() wiring in four layers; the hook call order is fixed. */
export function useAppController() {
  const ctx = useReplayContext();
  const transients = useTransients(ctx.replay.replayData?.id);
  const board = useTimelineController(ctx, transients);
  const engine = useEngineController(ctx, transients, board);
  const handleHypotheticalMove = useHypotheticalMove(ctx, board);
  // The dock's Execute also sends a forced replacement the engine filled.
  const { executePending } = ctx.branch;
  const handleExecuteTurn = useCallback(async () => {
    await executePending();
  }, [executePending]);
  const analysis = useAnalysisSurface(ctx, board, engine);
  const support = useSupport({ ctx, transients, board });
  // A game's share link opens the game, its branch and the sharer's turn.
  const sharedGame = useOpenSharedGame({ ctx, board });
  // A reload while the tip turn waits for its replacement plays that turn again.
  useRestorePendingTurn({ ctx, board }, sharedGame.opening || ctx.shared.sharedGame !== null);
  return { ctx, transients, board, engine, handleHypotheticalMove, handleExecuteTurn, analysis, support, sharedGame };
}

export type AppController = ReturnType<typeof useAppController>;
