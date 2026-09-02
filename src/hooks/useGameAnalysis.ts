import { useEffect, useMemo, useState } from 'react';
import type { ReplayData, TurnSnapshot } from '@fulllifegames/replay-core';
import { allTurnEvents } from '../lib/eval/played';
import { parseTendencies } from '../lib/eval/opponent-model';
import { analyzeLeads } from '../lib/eval/leads';
import type { GameReport } from '../lib/eval/report';
import type { TurnAnalysis } from '../lib/eval/analysis';
import { summarizeAlignment, type TurnAlignmentRecord } from '../lib/hax-alignment';
import {
  analyzeTurnAt, buildPlayedHistory, computeGameReportData, computeTurnReads,
  type TurnAnalysisContext,
} from '../lib/analysis-context';
import type { useEvaluation } from './useEvaluation';

type Evaluation = ReturnType<typeof useEvaluation>;

/** Replay-derived analysis context: tendencies and the turn-event index
 *  depend only on the loaded replay; actives and played history feed the
 *  narrative channels. */
function useAnalysisContext(args: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  graphPlayed: Evaluation['graph']['played'];
  replayGen: number;
}) {
  const { replayData, snapshots, graphPlayed, replayGen } = args;
  const tendencies = useMemo(() => (replayData
    ? { p1: parseTendencies(replayData.log, 'p1'), p2: parseTendencies(replayData.log, 'p2') }
    : null), [replayData]);
  const turnEventsIndex = useMemo(
    () => (replayData ? allTurnEvents(replayData.log) : []),
    [replayData],
  );
  const context = useMemo<TurnAnalysisContext>(() => ({
    snapshots,
    turnEventsIndex,
    // Null-move guard board context: the PRE-TURN active species per side,
    // singles only — anything but exactly one live active passes null and
    // keeps the guard off (fail closed, doubles out of scope).
    activesForTurn: (turn: number) => {
      const snapshot = snapshots[turn - 1] ?? null;
      if (!snapshot) return null;
      const activeOf = (side: typeof snapshot.p1): string | null => {
        const active = side.pokemon.filter(pokemon => pokemon.isActive && !pokemon.fainted);
        return active.length === 1 ? active[0].speciesForme : null;
      };
      return { p1: activeOf(snapshot.p1), p2: activeOf(snapshot.p2), gen: replayGen };
    },
    playedHistory: buildPlayedHistory(graphPlayed, snapshots, turnEventsIndex),
  }), [snapshots, turnEventsIndex, graphPlayed, replayGen]);
  return { tendencies, context };
}

/** Game-level root cause, once enough of the game is swept. The memo keeps
 *  the per-turn analyses next to the report: the feedback drift harness
 *  (and manual debugging) read both through the window handle. */
function useGameReportData(args: {
  replayData: ReplayData | null;
  graph: Evaluation['graph'];
  context: TurnAnalysisContext;
}) {
  const { replayData, graph, context } = args;
  const replayWinner = useMemo<'p1' | 'p2' | null>(() => {
    if (!replayData) return null;
    const name = replayData.log.match(/\|win\|(.+)/)?.[1]?.trim();
    if (!name) return null;
    if (name === replayData.players[0]) return 'p1';
    if (name === replayData.players[1]) return 'p2';
    return null;
  }, [replayData]);
  // While a sweep runs, the LAST report stays up — recomputing waits for
  // completion (per-tick rebuilds are expensive), but returning null there
  // made the report blink on every turn click once selection started
  // triggering 2-turn upgrade sweeps. 'hold' keeps the previous data via a
  // render-phase adjustment (the react-hooks gate forbids ref writes here).
  const computed = useMemo(() => {
    if (!replayData) return null;
    if (graph.running) return 'hold' as const;
    return computeGameReportData({ replayData, graph, context, winner: replayWinner });
  }, [replayData, graph, context, replayWinner]);
  const [held, setHeld] = useState<{ report: GameReport; analyses: (TurnAnalysis | null)[] } | null>(null);
  if (computed !== 'hold' && computed !== held) setHeld(computed);
  return computed === 'hold' ? held : computed;
}

export function useGameAnalysis(inputs: {
  replayData: ReplayData | null;
  snapshots: TurnSnapshot[];
  evaluation: Evaluation;
  analysisTurn: number | null;
  sweepAlignment: TurnAlignmentRecord[] | null;
  replayGen: number;
}) {
  const { replayData, snapshots, evaluation, analysisTurn, sweepAlignment, replayGen } = inputs;
  const { tendencies, context } = useAnalysisContext({
    replayData, snapshots, graphPlayed: evaluation.graph.played, replayGen,
  });

  const turnReads = useMemo(
    () => (analysisTurn === null ? null : computeTurnReads(analysisTurn, evaluation.graph, tendencies)),
    [analysisTurn, evaluation.graph, tendencies],
  );

  const turnAnalysis = useMemo(() => {
    if (analysisTurn === null) return null;
    return analyzeTurnAt({
      turn: analysisTurn, graph: evaluation.graph, context,
      includeSacks: !!replayData, reads: turnReads,
    });
  }, [analysisTurn, evaluation.graph, context, replayData, turnReads]);

  const leadAnalysisData = useMemo(() => {
    const lead = evaluation.graph.lead;
    if (!lead) return null;
    return analyzeLeads(lead.result, lead.played);
  }, [evaluation.graph.lead]);

  const gameReportData = useGameReportData({ replayData, graph: evaluation.graph, context });

  // Structured handle for the feedback drift harness: the SAME objects the
  // UI renders — no recomputation, no behavior change.
  useEffect(() => {
    (window as Window & { __psDebug?: unknown }).__psDebug = {
      graph: evaluation.graph,
      analyses: gameReportData?.analyses ?? null,
      gameReport: gameReportData?.report ?? null,
      haxAlignment: sweepAlignment
        ? { records: sweepAlignment, summary: summarizeAlignment(sweepAlignment) }
        : null,
    };
  }, [evaluation.graph, gameReportData, sweepAlignment]);

  return { turnReads, turnAnalysis, leadAnalysisData, gameReport: gameReportData?.report ?? null };
}
