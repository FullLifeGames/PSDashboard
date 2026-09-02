import { useState } from 'react';
import type {
  EvalPreferences, EvalResult, RankedChoice, ReadRecommendation, SearchProgress, TurnAnalysis, GameReport,
  LeadAnalysis,
} from '@fulllifegames/eval-engine';
import type { EvalGraphState, EvalStatus, TurnEvalSettings } from '../hooks/useEvaluation';
import { EvalControls } from './eval/EvalControls';
import { EvalStatus as EvalStatusBlock } from './eval/EvalStatus';
import { GameGraphSection } from './eval/GameGraphSection';
import { EvalResultBlock } from './eval/EvalResultBlock';
import { ThinkDeeperButton } from './eval/ThinkDeeperButton';

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
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
  /** Click on a matrix cell: plays EXACTLY that pair out in a branch. */
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  /** Replay view: the settings that produced the shown result (fast scan vs configured). */
  resultSettings?: TurnEvalSettings | null;
  /** Explicit per-position deepening — selecting a turn never re-searches. */
  onThinkDeeper?: () => void;
  /** The settings the deepen button would run (null = at the cap / not applicable). */
  thinkDeeperTarget?: TurnEvalSettings | { mode: 'auto' } | null;
  /** Smogon usage/sets still loading — a sweep started now would silently
   * build teams without the guessed fills (the T35 one-move Iron Valiant). */
  smogonPending?: boolean;
  /** Branch mode: hides the auto checkbox on the replay view. */
  showAuto: boolean;
  /** Gen 9 only — other gens have no Tera to gate. */
  showTera: boolean;
  graph: EvalGraphState;
  /** Variation overlay for the game graph (unified timeline): the gold
   *  curve's scores, indexed like the main scores (scores[turn − 1]). */
  variation?: { startTurn: number; scores: (number | null)[] } | null;
  /** Which line the pointer sits on — the graph's ring marker follows it. */
  currentLine?: 'main' | 'variation';
  /** Replay view only — starts the whole-game background sweep. */
  onAnalyzeGame?: () => void;
  onSelectTurn?: (turn: number, line?: 'main' | 'variation') => void;
  currentTurn: number;
  /** Analysis of the graph-selected turn (replay view only). */
  analysis: TurnAnalysis | null;
  /** Exploitative Read recommendations for the selected turn (advisory). */
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  /** Turn-0 analysis, shown when the graph's leads point is selected. */
  leadAnalysis?: LeadAnalysis | null;
  /** Lead verdicts for the report chips (independent of selection). */
  reportLeads?: LeadAnalysis | null;
  /** Game-level root-cause report, once a sweep covers enough turns. */
  report?: GameReport | null;
  /** Doubles replay — selects the fitted win-probability curve for percents. */
  doubles?: boolean;
  /** Which position the shown single result belongs to (e.g. "Turn 5 · variation"). */
  positionLabel?: string | null;
  /** "Let it play out" is running: one steady progress block replaces the
   *  per-turn result churn (the graph keeps growing underneath). */
  playOutProgress?: { startTurn: number; turns: number; atTurn: number | null } | null;
  /** Full main-line length — keeps the graph's x-axis honest pre-analysis. */
  graphMaxTurn?: number;
  /** The turn whose analysis is selected (0 = leads). Changing it — slider,
   *  arrows, graph, the T0 button — opens that turn's view. */
  analysisTurn?: number | null;
}

/**
 * Two screens, not one stack: the game report (the cards) is the
 * overview; clicking a turn switches to that turn's full view (analysis,
 * bar, ranked lists, matrix) with a way back — "click a card, deal with
 * it, return to the cards".
 */
function useReportView(report: GameReport | null | undefined, analysisTurn: number | null | undefined) {
  const [view, setView] = useState<'report' | 'turn'>('report');
  // Render-time adjustment (not an effect): when a report first APPEARS —
  // initial sweep done, or a new replay's sweep — land on the overview.
  const [hadReport, setHadReport] = useState(false);
  if (!!report !== hadReport) {
    setHadReport(!!report);
    if (report) setView('report');
  }
  // Same pattern for navigation: moving to another turn (slider, arrows,
  // graph, the timeline's T0 button) IS the request to see that turn's
  // evaluation — the report stays one click away via "← Game report".
  const [seenAnalysisTurn, setSeenAnalysisTurn] = useState<number | null>(analysisTurn ?? null);
  if ((analysisTurn ?? null) !== seenAnalysisTurn) {
    setSeenAnalysisTurn(analysisTurn ?? null);
    if (analysisTurn !== null && analysisTurn !== undefined && report) setView('turn');
  }
  return { view, setView };
}

/** The header row and the run-state block, both fed straight from the panel props. */
function PanelHeader({ running, ...props }: EvalPanelProps & { running: boolean }) {
  return (
    <>
      <EvalControls
        prefs={props.prefs}
        onPrefsChange={props.onPrefsChange}
        running={running}
        showAuto={props.showAuto}
        showTera={props.showTera}
        onEvaluate={props.onEvaluate}
        onCancel={props.onCancel}
        result={props.result}
        status={props.status}
      />
      <EvalStatusBlock
        playOutProgress={props.playOutProgress}
        status={props.status}
        reconstructProgress={props.reconstructProgress}
        progress={props.progress}
        error={props.error}
      />
    </>
  );
}

export function EvalPanel(props: EvalPanelProps) {
  const {
    playerNames, status, result, onPickChoice, onPickPair,
    graph, variation, onAnalyzeGame, onSelectTurn, resultSettings, onThinkDeeper, thinkDeeperTarget, smogonPending,
    positionLabel, analysisTurn, playOutProgress, report, doubles,
  } = props;
  const running = status === 'searching' || status === 'reconstructing';
  const hasGraph = graph.scores.some(score => score !== null);

  const { view, setView } = useReportView(report, analysisTurn);
  const selectTurn = onSelectTurn
    ? (turn: number, line?: 'main' | 'variation') => {
      onSelectTurn(turn, line);
      setView('turn');
    }
    : undefined;
  const showReportView = view === 'report' && !!report;
  const thinkDeeper = (
    <ThinkDeeperButton
      onThinkDeeper={onThinkDeeper}
      thinkDeeperTarget={thinkDeeperTarget}
      disabled={graph.running || smogonPending}
      smogonPending={smogonPending}
      result={result}
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
          thinkDeeper={thinkDeeper}
          hasThinkDeeper={!!(onThinkDeeper && thinkDeeperTarget)}
        />
      )}

      {result && !showReportView && !playOutProgress && (
        <EvalResultBlock
          result={result}
          status={status}
          playerNames={playerNames}
          positionLabel={positionLabel}
          resultSettings={resultSettings}
          thinkDeeper={thinkDeeper}
          onPickChoice={onPickChoice}
          onPickPair={onPickPair}
          doubles={doubles}
        />
      )}
    </div>
  );
}
