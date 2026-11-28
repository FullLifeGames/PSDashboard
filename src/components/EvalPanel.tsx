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
  onEvaluate?: () => void;
  onCancel: () => void;
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null, from?: EvalResult | null) => void;
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  resultSettings?: TurnEvalSettings | null;
  onAnalyzeTurn?: () => void;
  analyzeTarget?: TurnEvalSettings | { mode: 'auto' } | null;
  /** Smogon usage/sets still loading: a sweep started now builds teams without the guessed fills. */
  smogonPending?: boolean;
  showAuto: boolean;
  engines?: EngineChoice;
  graph: EvalGraphState;
  /** The gold curve's scores (`scores[turn − 1]`) and the fainted share of the variation's own board before each. */
  variation?: VariationSeries | null;
  currentLine?: 'main' | 'variation';
  onAnalyzeGame?: () => void;
  onSelectTurn?: (turn: number, line?: 'main' | 'variation') => void;
  currentTurn: number;
  analysis: TurnAnalysis | null;
  openTurn?: number | null;
  onBackToMain?: (cardTurn: number | null) => void;
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  faintedShares?: (number | null)[];
  leadAnalysis?: LeadAnalysis | null;
  reportLeads?: LeadAnalysis | null;
  report?: GameReport | null;
  reviewAnalyses?: (TurnAnalysis | null)[] | null;
  doubles?: boolean;
  linesHost?: LinesHost;
  /** Depth of the partial result a user stop kept; null: no stopped run. */
  stoppedAt?: number | null;
  stoppedEmpty?: boolean;
  positionLabel?: string | null;
  ended?: { winner: string | null } | null;
  playOutProgress?: PlayOutProgress | null;
  graphMaxTurn?: number;
  analysisTurn?: number | null;
  gameId?: string;
}

function useReportView(report: GameReport | null | undefined, analysisTurn: number | null | undefined) {
  const [view, setView] = useState<'report' | 'turn'>('report');
  const [hadReport, setHadReport] = useState(false);
  // A variation takes the report away; this remembers where the line started (the review or a turn card).
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
  const [seenAnalysisTurn, setSeenAnalysisTurn] = useState<number | null>(analysisTurn ?? null);
  if ((analysisTurn ?? null) !== seenAnalysisTurn) {
    setSeenAnalysisTurn(analysisTurn ?? null);
    // the main line's turn that the way back lands on is no request to open its card
    if (analysisTurn !== null && analysisTurn !== undefined && report && !returned) setView('turn');
  }
  return { view, setView, startedFrom };
}

function useReviewFold(gameId: string | undefined) {
  const [fold, setFold] = useState({ gameId, open: false });
  if (fold.gameId !== gameId) setFold({ gameId, open: false });
  return { reviewOpen: fold.gameId === gameId && fold.open, onReviewToggle: (open: boolean) => setFold({ gameId, open }) };
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
  const reviewFold = useReviewFold(props.gameId);
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
          {...reviewFold}
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
