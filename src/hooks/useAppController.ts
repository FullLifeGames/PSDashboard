import { useCallback, useMemo } from 'react';
import { useReplayContext } from './controller/replay-context';
import type { ReplayContext } from './controller/replay-context';
import { useTransients } from './controller/transients';
import { useTimelineController } from './controller/board-controller';
import type { BoardController } from './controller/board-controller';
import { useEngineController } from './controller/engine-controller';
import type { EngineController } from './controller/engine-controller';
import { useGameAnalysis } from './useGameAnalysis';
import { manualMove } from '../lib/team-info';
import type { BranchSlotChoice } from '../lib/branch-choices';
import { toId } from '../lib/ids';

/** The refresh request that re-runs the branch with the edited teams and the
 *  hypothetical move seeded as the acting slot's pending choice. */
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

/** "What if it had …": a team edit plus the normal branch refresh, with the
 *  hypothetical move pre-seeded as that slot's pending choice. */
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
    // The hypothetical seeds a pending choice where the sim will stand after
    // the refresh: the live tip, or — with no variation — the viewed turn
    // (the refresh flow rebuilds there). Mid-variation views stay inert; the
    // seeded slot would belong to the tip, not the viewed position.
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

/** Per-turn and game-level analysis plus the branch iframe's derived log. */
function useAnalysisSurface(ctx: ReplayContext, board: BoardController, engine: EngineController) {
  const { replayData, snapshots } = ctx.replay;
  const { evaluation } = ctx;
  const { replayGen } = ctx.meta;
  const { analysisTurn } = board.timeline;
  const { sweepAlignment } = engine.acquire;
  const { simState, history, branching, variationStartTurn } = ctx.branch;
  const { branchSession } = board.deviation;

  // Per-turn and game-level analysis (reads, turn card, lead analysis,
  // game report, the feedback harness's window handle).
  const { turnReads, turnAnalysis, leadAnalysisData, gameReport } = useGameAnalysis({
    replayData, snapshots, evaluation, analysisTurn, sweepAlignment, replayGen,
  });

  const simLog = useMemo(() => {
    const raw = simState?.log ?? [];
    if (raw.length === 0) return '';
    // |debug| lines would render as "[DEBUG] …" in the embed's battle log (G13).
    return raw.filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|debug|')).join('\n');
  }, [simState?.log]);
  const latestBranchHistoryEntry = history.length > 0 ? history[history.length - 1] : null;

  const showBranch = branching && simLog.length > 0;
  // Session + branch start, NOT the viewed turn: the pointer moves constantly
  // on the unified timeline, and a viewTurn-keyed reload would remount the
  // sim iframe on every navigation and every executed turn (tip advance).
  const branchReloadKey = `${branchSession}:${variationStartTurn ?? 0}`;

  return { turnReads, turnAnalysis, leadAnalysisData, gameReport, simLog, latestBranchHistoryEntry, showBranch, branchReloadKey };
}

/**
 * The App controller: the full pre-split App() wiring in four layers.
 * Hook call order matches the original top-to-bottom order exactly.
 */
export function useAppController() {
  const ctx = useReplayContext();
  const transients = useTransients(ctx.replay.replayData?.id);
  const board = useTimelineController(ctx, transients);
  const engine = useEngineController(ctx, transients, board);
  const handleHypotheticalMove = useHypotheticalMove(ctx, board);
  const { executeTurn } = ctx.branch;
  const handleExecuteTurn = useCallback(async () => {
    await executeTurn();
  }, [executeTurn]);
  const analysis = useAnalysisSurface(ctx, board, engine);
  return { ctx, transients, board, engine, handleHypotheticalMove, handleExecuteTurn, analysis };
}

export type AppController = ReturnType<typeof useAppController>;
