import { useEffect, useMemo, useState } from 'react';
import { logRules, type ReplayData, type TurnSnapshot } from '@fulllifegames/replay-core';
import {
  allTurnEvents, parseTendencies, analyzeLeads, type GameReport, type TurnAnalysis, summarizeAlignment,
  type TurnAlignmentRecord,
} from '@fulllifegames/eval-engine';
import {
  analyzeTurnAt, buildAnalysisContext, graphFaintedFractions, computeGameReportData, computeTurnReads, replayWinnerOf,
  type ReplayTendencies, type TurnAnalysisContext,
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
  // Round 75 (T160): the replay's mod rides with its generation, so the analysis reads the game's own Dex.
  const mod = useMemo(() => (replayData ? logRules(replayData.log).mod : undefined), [replayData]);
  const tendencies = useMemo(() => (replayData
    ? { p1: parseTendencies(replayData.log, 'p1'), p2: parseTendencies(replayData.log, 'p2') }
    : null), [replayData]);
  const turnEventsIndex = useMemo(
    () => (replayData ? allTurnEvents(replayData.log) : []),
    [replayData],
  );
  const context = useMemo<TurnAnalysisContext>(
    () => buildAnalysisContext({ snapshots, turnEventsIndex, graphPlayed, replayGen, mod }),
    [snapshots, turnEventsIndex, graphPlayed, replayGen, mod],
  );
  return { tendencies, context };
}

/** Game-level root cause, once enough of the game is swept. The memo keeps
 *  the per-turn analyses next to the report: the feedback drift harness
 *  (and manual debugging) read both through the window handle. */
function useGameReportData(args: {
  replayData: ReplayData | null;
  graph: Evaluation['graph'];
  context: TurnAnalysisContext;
  tendencies: ReplayTendencies | null;
}) {
  const { replayData, graph, context, tendencies } = args;
  const replayWinner = useMemo<'p1' | 'p2' | null>(() => (replayData ? replayWinnerOf(replayData) : null), [replayData]);
  // While a sweep runs, the LAST report stays up — recomputing waits for
  // completion (per-tick rebuilds are expensive), but returning null there
  // made the report blink on every turn click once selection started
  // triggering 2-turn upgrade sweeps. 'hold' keeps the previous data via a
  // render-phase adjustment (the react-hooks gate forbids ref writes here).
  const computed = useMemo(() => {
    if (!replayData) return null;
    if (graph.running) return 'hold' as const;
    return computeGameReportData({ replayData, graph, context, winner: replayWinner, tendencies });
  }, [replayData, graph, context, replayWinner, tendencies]);
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
      includeSacks: !!replayData, reads: turnReads, tendencies,
    });
  }, [analysisTurn, evaluation.graph, context, replayData, turnReads, tendencies]);

  // The graph's tooltips take the card's share in every engine mode (the sweep records its own only in auto).
  const faintedShares = useMemo(() => graphFaintedFractions(evaluation.graph, snapshots), [evaluation.graph, snapshots]);

  const leadAnalysisData = useMemo(() => {
    const lead = evaluation.graph.lead;
    if (!lead) return null;
    return analyzeLeads(lead.result, lead.played);
  }, [evaluation.graph.lead]);

  const gameReportData = useGameReportData({ replayData, graph: evaluation.graph, context, tendencies });

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

  return { turnReads, turnAnalysis, faintedShares, leadAnalysisData, gameReport: gameReportData?.report ?? null };
}
