import { useMemo, type ReactNode } from 'react';
import {
  autoTurnSettings, heldDecided,
  type EvalPreferences, type EvalResult, type RankedChoice, type ReadRecommendation, type TurnAnalysis, type GameReport, type LeadAnalysis,
} from '@fulllifegames/eval-engine';
import type { EvalGraphState } from '../../hooks/useEvaluation';
import { EvalGameReport } from '../EvalGameReport';
import { GameReviewPanel } from './GameReviewPanel';
import { reviewMarks } from './game-review';
import { EvalGraph } from '../EvalGraph';
import { REVIEW_COLORS } from '../../lib/eval-graph-view';
import { gameReviewEnabled } from '../../lib/feature-flags';
import { EvalLeadAnalysis, EvalTurnAnalysis } from '../EvalTurnAnalysis';
import { EvalReplacementAnalysis } from './EvalReplacementAnalysis';
import type { LinesHost } from '../../lib/line-view';
import type { VariationSeries } from '../../lib/eval-graph-view';

type SelectTurn = ((turn: number, line?: 'main' | 'variation') => void) | undefined;

function GraphHeader({ onAnalyzeGame, graph, onCancel, running, smogonPending, title }: {
  title: string;
  onAnalyzeGame?: () => void;
  graph: EvalGraphState;
  onCancel: () => void;
  running: boolean;
  smogonPending?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#aabbcc' }}>
      <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }} title={title}>Game graph</span>
      {onAnalyzeGame && (graph.running ? (
        <>
          <span style={{ color: '#fd6' }}>
            analyzing…{graph.progress ? ` turn ${graph.progress.done}/${graph.progress.total}` : ''}
          </span>
          <button type="button" className="ps-btn" onClick={onCancel} style={{ padding: '1px 6px', fontSize: 10 }}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="ps-btn"
            onClick={onAnalyzeGame}
            disabled={running || smogonPending}
            title={smogonPending
              ? 'Waiting for Smogon data: a sweep started now would build the teams without the guessed sets.'
              : "Evaluate every turn of the game in the background; the line dips where the game swung. The selected turn's analysis, ranked choices, and matrix follow automatically."}
            style={{ padding: '1px 6px', fontSize: 10 }}
          >
            {graph.gameSwept ? 'Re-analyze' : 'Analyze game'}
          </button>
          {graph.stopped && (
            <span role="status" style={{ color: '#e6b36a' }}>
              Analysis stopped at turn {graph.stopped.done} of {graph.stopped.total}.
            </span>
          )}
        </>
      ))}
    </div>
  );
}

function graphTitle(prefs: EvalPreferences, doubles?: boolean): string {
  const autoTreeEverywhere = autoTurnSettings(0, !!doubles).mode === 'mcts';
  const mode = prefs.mode === 'mcts' ? 'MCTS'
    : prefs.mode === 'auto' ? (autoTreeEverywhere ? 'auto (MCTS every turn)' : 'auto (matrix early, MCTS late)')
    : `depth ${prefs.depth}`;
  return `Analyze game makes a quick depth-1 pass over every turn, then re-evaluates each turn with ${mode}, starting with the swings worth reporting. Tera applies to every turn.`;
}

function ReplacementNote({ analysis, graph, playerNames }: { analysis: TurnAnalysis; graph: EvalGraphState; playerNames: [string, string] }) {
  const records = graph.replacements?.[analysis.turn - 1];
  if (!records?.length) return null;
  return <EvalReplacementAnalysis turn={analysis.turn} records={records} playerNames={playerNames} faintedFraction={analysis.faintedFraction} />;
}

interface TurnViewProps {
  report?: GameReport | null;
  onBackToReport: () => void;
  onBackToMain?: () => void;
  result: EvalResult | null;
  currentTurn: number;
  graph: EvalGraphState;
  analyzeTurn: ReactNode;
  hasAnalyzeTurn: boolean;
  leadAnalysis?: LeadAnalysis | null;
  analysis: TurnAnalysis | null;
  playerNames: [string, string];
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null, from?: EvalResult | null) => void;
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  linesHost?: LinesHost;
  doubles?: boolean;
  openTurn?: number | null;
  opponentReads?: boolean;
}

const backToMainTitle = (): string =>
  `The game report${gameReviewEnabled() ? ' and the Game review show' : ' shows'} on the main line. Same as Main line in the Line selector`;

function TurnView({ report, onBackToReport, onBackToMain, result, currentTurn, graph, analyzeTurn, hasAnalyzeTurn, leadAnalysis, analysis, playerNames, reads, onPickChoice, onPickPair, linesHost, doubles, openTurn, opponentReads }: TurnViewProps) {
  return (
    <>
      {report && (
        <button
          type="button"
          className="ps-btn"
          style={{ padding: '1px 6px', fontSize: 10, marginTop: 4 }}
          onClick={onBackToReport}
          title="Back to the game report's cards"
        >
          ← Game report
        </button>
      )}
      {!report && onBackToMain && (
        <button
          type="button"
          className="ps-btn"
          style={{ padding: '1px 6px', fontSize: 10, marginTop: 4 }}
          onClick={onBackToMain}
          title={backToMainTitle()}
        >
          Back to the main line
        </button>
      )}
      {!result && currentTurn >= 1 && graph.evalErrors[currentTurn - 1] && (
        <div role="status" style={{ fontSize: 10, color: '#e6b36a', marginTop: 4, maxWidth: 520 }}>
          ⚠ This turn could not be evaluated: {graph.evalErrors[currentTurn - 1]}
        </div>
      )}
      {!result && hasAnalyzeTurn && (
        <div style={{ marginTop: 4 }}>{analyzeTurn}</div>
      )}
      {leadAnalysis && <EvalLeadAnalysis leads={leadAnalysis} playerNames={playerNames} />}
      {!leadAnalysis && analysis && <ReplacementNote analysis={analysis} graph={graph} playerNames={playerNames} />}
      {!leadAnalysis && analysis && (
        <EvalTurnAnalysis
          analysis={analysis} playerNames={playerNames} reads={reads} onExplore={onPickChoice} onPickPair={onPickPair}
          result={graph.results[analysis.turn - 1] ?? null} linesHost={linesHost} doubles={doubles}
          open={analysis.turn === openTurn} opponentReads={opponentReads}
        />
      )}
    </>
  );
}

export interface GameGraphSectionProps extends TurnViewProps {
  onAnalyzeGame?: () => void;
  onCancel: () => void;
  running: boolean;
  smogonPending?: boolean;
  hasGraph: boolean;
  prefs: EvalPreferences;
  currentLine?: 'main' | 'variation';
  selectTurn: SelectTurn;
  reportLeads?: LeadAnalysis | null;
  variation?: VariationSeries | null;
  graphMaxTurn?: number;
  showReportView: boolean;
  reviewAnalyses?: (TurnAnalysis | null)[] | null;
  /** The card's fainted share per swept turn (any engine mode); the sweep's own record exists in auto only. */
  faintedShares?: (number | null)[];
}

const graphShares = ({ faintedShares, graph }: GameGraphSectionProps) => faintedShares ?? graph.faintedFractions;

function GraphMarksLegend({ marks, playerNames }: { marks: ReturnType<typeof reviewMarks>; playerNames: [string, string] }) {
  const sides = (['p1', 'p2'] as const).filter(side => marks.some(mark => mark.side === side));
  if (sides.length === 0) return null;
  return (
    <div data-testid="graph-marks-legend" style={{ fontSize: 10, color: '#778', marginTop: 2 }}>
      {sides.map((side, index) => (
        <span key={side}>
          {index > 0 ? ' · ' : ''}
          <span aria-hidden style={{ color: REVIEW_COLORS[side] }}>{side === 'p1' ? '○' : '□'}</span> {playerNames[side === 'p1' ? 0 : 1]}
        </span>
      ))}
      : graded turns (an inaccuracy, a mistake or a blunder), listed in the Game review
    </div>
  );
}

function GraphView(props: GameGraphSectionProps) {
  const { graph, playerNames, currentTurn, currentLine, selectTurn, reportLeads, variation, graphMaxTurn, reviewAnalyses } = props;
  const marks = useMemo(() => (gameReviewEnabled() ? reviewMarks(reviewAnalyses) : []), [reviewAnalyses]);
  return (
    <>
      <EvalGraph
        scores={graph.scores}
        playerNames={playerNames}
        currentTurn={currentTurn}
        currentLine={currentLine}
        onSelectTurn={selectTurn}
        leadScore={graph.lead?.result.score ?? null}
        leadDetail={reportLeads ?? null}
        evalErrors={graph.evalErrors}
        faintedFractions={graphShares(props)}
        decided={graph.results.map(result => (result ? heldDecided(result) ?? null : null))}
        variation={variation}
        maxTurn={graphMaxTurn}
        reviewMarks={marks}
      />
      <GraphMarksLegend marks={marks} playerNames={playerNames} />
    </>
  );
}

function ReportOverview({ report, ...props }: GameGraphSectionProps & { report: GameReport }) {
  const { graph, playerNames, selectTurn, reportLeads, reviewAnalyses, linesHost, doubles } = props;
  return (
    <>
      <EvalGameReport
        report={report}
        playerNames={playerNames}
        onSelectTurn={selectTurn}
        leads={reportLeads}
        settingsFor={turn => (turn >= 1 ? graph.settings[turn - 1] ?? null : null)}
      />
      {gameReviewEnabled() && reviewAnalyses && linesHost && (
        <GameReviewPanel
          analyses={reviewAnalyses} results={graph.results} playerNames={playerNames} doubles={!!doubles}
          host={linesHost} onSelectTurn={selectTurn}
        />
      )}
    </>
  );
}

export function GameGraphSection(props: GameGraphSectionProps) {
  const {
    onAnalyzeGame, onCancel, running, smogonPending, hasGraph, prefs, graph,
    variation, showReportView, report, analysis, doubles,
  } = props;
  return (
    <div style={{ margin: '6px 0' }}>
      <GraphHeader onAnalyzeGame={onAnalyzeGame} graph={graph} onCancel={onCancel} running={running} smogonPending={smogonPending} title={graphTitle(prefs, doubles)} />
      {graph.notice && (
        <div role="status" style={{ fontSize: 10, color: '#e6b36a', marginTop: 2, maxWidth: 520 }}>
          ⚠ {graph.notice}
        </div>
      )}
      {(hasGraph || variation) && <GraphView {...props} />}
      {!hasGraph && variation && (
        <div style={{ fontSize: 10, color: '#778', marginTop: 2 }}>
          Gold = your variation. The main line has no curve yet; Analyze game fills it for comparison.
        </div>
      )}
      {hasGraph && (showReportView || !analysis) && (
        <div style={{ fontSize: 10, color: '#778', marginTop: 2 }}>
          Click a point for that turn's analysis; its movement lights up on the line.
        </div>
      )}
      {showReportView && report && <ReportOverview {...props} report={report} />}
      {!showReportView && <TurnView {...props} opponentReads={!!prefs.hardMode} />}
    </div>
  );
}
