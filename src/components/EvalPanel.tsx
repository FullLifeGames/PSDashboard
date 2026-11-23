import { useState } from 'react';
import type { EngineChoice } from '../hooks/useEngineChoice';
import type {
  EvalPreferences, EvalResult, RankedChoice, ReadRecommendation, SearchProgress, TurnAnalysis, GameReport,
  LeadAnalysis,
} from '@fulllifegames/eval-engine';
import type { EvalGraphState, EvalStatus, TurnEvalSettings } from '../hooks/useEvaluation';
import type { VariationSeries } from '../lib/eval-graph-view';
import type { LinesHost } from '../lib/line-view';
import { EvalControls } from './eval/EvalControls';
import { EvalStatus as EvalStatusBlock, type PlayOutProgress } from './eval/EvalStatus';
import { GameGraphSection } from './eval/GameGraphSection';
import { EvalResultBlock } from './eval/EvalResultBlock';
import { AnalyzePositionButton } from './eval/AnalyzePositionButton';

interface EvalPanelProps {
  playerNames: [string, string];
  status: EvalStatus;
  result: EvalResult | null;
  progress: SearchProgress | null;
  reconstructProgress: { turn: number; target: number } | null;
  error: string | null;
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  /** Branch mode only — the replay view analyzes the selected turn automatically. */
  onEvaluate?: () => void;
  onCancel: () => void;
  /** Click on an engine line: plays it out in a branch (entering one first when needed), the other side answering with `reply`. */
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null, from?: EvalResult | null) => void;
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  /** Replay view: the settings that produced the shown result (fast scan vs configured). */
  resultSettings?: TurnEvalSettings | null;
  /** A gap turn's analysis at the panel's settings — selecting a turn never re-searches. */
  onAnalyzeTurn?: () => void;
  /** The settings that analysis would run (null = the turn holds a result, or not applicable). */
  analyzeTarget?: TurnEvalSettings | { mode: 'auto' } | null;
  /** Smogon usage/sets still loading: a sweep started now would silently build teams without the guessed fills. */
  smogonPending?: boolean;
  /** Branch mode: hides the auto checkbox on the replay view. */
  showAuto: boolean;
  /** Gen 9 only — other gens have no Tera to gate. */
  showTera: boolean;
  engines?: EngineChoice;
  graph: EvalGraphState;
  /** Variation overlay for the game graph (unified timeline): the gold curve's scores, indexed like the main scores (scores[turn − 1]), and the fainted share of the variation's own board before each of them. */
  variation?: VariationSeries | null;
  currentLine?: 'main' | 'variation';
  onAnalyzeGame?: () => void;
  onSelectTurn?: (turn: number, line?: 'main' | 'variation') => void;
  currentTurn: number;
  analysis: TurnAnalysis | null;
  /** The open tip of a new game, whose analysis names an open position instead of a played choice. */
  openTurn?: number | null;
  /** With a variation open and a game report held, the way back to the main line (see GameGraphSection). */
  onBackToMain?: (cardTurn: number | null) => void;
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  /** The fainted share per swept turn as the card takes it (any engine mode): the graph tooltips print at it. */
  faintedShares?: (number | null)[];
  leadAnalysis?: LeadAnalysis | null;
  reportLeads?: LeadAnalysis | null;
  report?: GameReport | null;
  reviewAnalyses?: (TurnAnalysis | null)[] | null;
  /** Doubles replay — selects the fitted win-probability curve for percents. */
  doubles?: boolean;
  /** The host of the Lines section under a turn's rows (the game's rules, the turn's field, ▶ Play); absent: no section. */
  linesHost?: LinesHost;
  /** The user stopped the search and its partial result stands for the position: its depth. Null: no stopped run. */
  stoppedAt?: number | null;
  stoppedEmpty?: boolean;
  positionLabel?: string | null;
  /** The pointer sits on the finished end of a variation: there is nothing to evaluate, the panel says who won. */
  ended?: { winner: string | null } | null;
  /** "Let it play out" is running: one steady progress block replaces the
   *  per-turn result churn (the graph keeps growing underneath). */
  playOutProgress?: PlayOutProgress | null;
  graphMaxTurn?: number;
  /** The turn whose analysis is selected (0 = leads). Changing it — slider,
   *  arrows, graph, the T0 button — opens that turn's view. */
  analysisTurn?: number | null;
}

function useReportView(report: GameReport | null | undefined, analysisTurn: number | null | undefined) {
  const [view, setView] = useState<'report' | 'turn'>('report');
  // Render-time adjustment (not an effect): when a report first APPEARS —
  // initial sweep done, or a new replay's sweep — land on the overview.
  const [hadReport, setHadReport] = useState(false);
  // A variation takes the report away; the way back leads to where the line was started (the review, or the card of its turn). The
  // analysis turn does not follow a variation, so it still names that card.
  const [startedFrom, setStartedFrom] = useState<{ view: 'report' | 'turn'; turn: number | null } | null>(null);
  let returned = false;
  if (!!report !== hadReport) {
    setHadReport(!!report);
    if (report) {
      setView(startedFrom?.view ?? 'report');
      returned = startedFrom !== null;
      setStartedFrom(null);
    } else if (hadReport) {
      setStartedFrom({ view, turn: analysisTurn ?? null });
    }
  }
  // Same pattern for navigation: moving to another turn (slider, arrows,
  // graph, the timeline's T0 button) IS the request to see that turn's
  // evaluation — the report stays one click away via "← Game report".
  const [seenAnalysisTurn, setSeenAnalysisTurn] = useState<number | null>(analysisTurn ?? null);
  if ((analysisTurn ?? null) !== seenAnalysisTurn) {
    setSeenAnalysisTurn(analysisTurn ?? null);
    // the main line's turn that the way back lands on is no request to open its card
    if (analysisTurn !== null && analysisTurn !== undefined && report && !returned) setView('turn');
  }
  return { view, setView, startedFrom };
}

function EndedResultNotice({ winner, positionLabel }: { winner: string | null; positionLabel?: string | null }) {
  return (
    <div role="status" style={{ fontSize: 11, color: '#cde', marginTop: 4 }}>
      {positionLabel && <div style={{ fontSize: 10, color: '#8fa3bd', marginBottom: 2 }}>{positionLabel}</div>}
      {winner ? `${winner} wins this variation.` : 'The variation ended without a winner.'} Go back a turn to evaluate a position.
    </div>
  );
}

function PanelHeader({ running, ...props }: EvalPanelProps & { running: boolean }) {
  return (
    <>
      <EvalControls
        prefs={props.prefs}
        onPrefsChange={props.onPrefsChange}
        running={running}
        showAuto={props.showAuto}
        showTera={props.showTera}
        onEvaluate={props.ended ? undefined : props.onEvaluate}
        onCancel={props.onCancel}
        result={props.result}
        status={props.status}
        engines={props.engines}
      />
      <EvalStatusBlock
        playOutProgress={props.playOutProgress}
        status={props.ended ? 'idle' : props.status}
        reconstructProgress={props.reconstructProgress}
        progress={props.progress}
        error={props.error}
        stoppedAt={props.stoppedAt ?? null}
        stoppedEmpty={!props.ended && !!props.stoppedEmpty}
      />
    </>
  );
}

/**
 * The fainted share of the board the shown result was searched on, so the panel prints the same percents the graph and the turn card
 * print for that position.
 * - The graph's own result of the analyzed turn: the turn card's share.
 * - A branch result: the share of its own board. On the variation line that is the variation's board at the viewed turn (the share its
 *   gold tooltip prints at), never the main line's share of that turn number; on the main line (a branch that has not played a move
 *   yet) it is the main line's share of the viewed turn.
 * - The lead result (before any body fell) and a board whose share is unknown: the opening map.
 */
function shownShare({ result, graph, analysis, analysisTurn, faintedShares, variation, currentLine, currentTurn }: EvalPanelProps): number | null {
  if (!result || result === graph.lead?.result) return null;
  const mainLineShare = (turn: number) => faintedShares?.[turn - 1] ?? graph.faintedFractions[turn - 1] ?? null;
  if (analysisTurn !== null && analysisTurn !== undefined && analysisTurn >= 1 && graph.results[analysisTurn - 1] === result) {
    return analysis?.turn === analysisTurn && analysis.faintedFraction !== undefined ? analysis.faintedFraction : mainLineShare(analysisTurn);
  }
  return currentLine === 'variation' ? variation?.shares?.[currentTurn - 1] ?? null : mainLineShare(currentTurn);
}

function SingleResult(props: EvalPanelProps) {
  const { playerNames, status, result, onPickChoice, onPickPair, resultSettings, positionLabel, doubles, ended } = props;
  if (ended) return <EndedResultNotice winner={ended.winner} positionLabel={positionLabel} />;
  if (!result) return null;
  return (
    <EvalResultBlock
      result={result}
      // a stopped run's result is the position's answer: not greyed, its rows play like a finished result's
      status={status === 'stale' && props.stoppedAt != null ? 'done' : status}
      playerNames={playerNames}
      positionLabel={positionLabel}
      resultSettings={resultSettings}
      onPickChoice={onPickChoice}
      onPickPair={onPickPair}
      doubles={doubles}
      faintedFraction={shownShare(props)}
      opponentReads={!!props.prefs.hardMode}
    />
  );
}

export function EvalPanel(props: EvalPanelProps) {
  const {
    status,
    graph, variation, onAnalyzeGame, onSelectTurn, onAnalyzeTurn, analyzeTarget, smogonPending,
    analysisTurn, playOutProgress, report,
  } = props;
  const running = status === 'searching' || status === 'reconstructing';
  const hasGraph = graph.scores.some(score => score !== null);

  const { view, setView, startedFrom } = useReportView(report, analysisTurn);
  const selectTurn = onSelectTurn
    ? (turn: number, line?: 'main' | 'variation') => {
      onSelectTurn(turn, line);
      setView('turn');
    }
    : undefined;
  const showReportView = view === 'report' && !!report;
  const analyzeTurn = (
    <AnalyzePositionButton
      onAnalyze={onAnalyzeTurn}
      target={analyzeTarget}
      disabled={graph.running || smogonPending}
      smogonPending={smogonPending}
    />
  );

  return (
    <div className="ps-panel ps-eval-panel">
      <PanelHeader {...props} running={running} />
      {(onAnalyzeGame || hasGraph || variation) && (
        <GameGraphSection
          {...props}
          running={running}
          hasGraph={hasGraph}
          selectTurn={selectTurn}
          showReportView={showReportView}
          onBackToReport={() => setView('report')}
          onBackToMain={props.onBackToMain && (() => props.onBackToMain?.(startedFrom?.view === 'turn' ? startedFrom.turn : null))}
          analyzeTurn={analyzeTurn}
          hasAnalyzeTurn={!!(onAnalyzeTurn && analyzeTarget)}
        />
      )}

      {!showReportView && !playOutProgress && <SingleResult {...props} />}
    </div>
  );
}
