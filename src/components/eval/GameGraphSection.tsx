import type { ReactNode } from 'react';
import type { EvalPreferences, EvalResult, RankedChoice, ReadRecommendation } from '../../lib/eval/types';
import type { TurnAnalysis } from '../../lib/eval/analysis';
import type { GameReport } from '../../lib/eval/report';
import type { EvalGraphState } from '../../hooks/useEvaluation';
import type { LeadAnalysis } from '../../lib/eval/leads';
import { EvalGameReport } from '../EvalGameReport';
import { EvalGraph } from '../EvalGraph';
import { EvalLeadAnalysis, EvalTurnAnalysis } from '../EvalTurnAnalysis';

type SelectTurn = ((turn: number, line?: 'main' | 'variation') => void) | undefined;

function GraphHeader({ onAnalyzeGame, graph, onCancel, running, smogonPending, hasGraph }: {
  onAnalyzeGame?: () => void;
  graph: EvalGraphState;
  onCancel: () => void;
  running: boolean;
  smogonPending?: boolean;
  hasGraph: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#aabbcc' }}>
      <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Game graph</span>
      {onAnalyzeGame && (graph.running ? (
        <>
          <span style={{ color: '#fd6' }}>
            analyzing… turn {graph.progress?.done ?? 0}/{graph.progress?.total ?? '?'}
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
            {hasGraph ? 'Re-analyze' : 'Analyze game'}
          </button>
        </>
      ))}
    </div>
  );
}

function LineHint({ prefs }: { prefs: EvalPreferences }) {
  return (
    <div
      style={{ fontSize: 10, color: '#778', marginTop: 2 }}
      title="Analyze game paints the whole line with a fast depth-1 scan first, then converges every turn to the settings above, report-worthy swings first. Any turn can go deeper still from its view (Think deeper); Tera applies everywhere."
    >
      line: fast scan, then {prefs.mode === 'mcts' ? 'MCTS'
        : prefs.mode === 'auto' ? 'auto (matrix early, MCTS late)'
        : `depth ${prefs.depth}`} everywhere · deeper: per turn
    </div>
  );
}

interface TurnViewProps {
  report?: GameReport | null;
  onBackToReport: () => void;
  result: EvalResult | null;
  currentTurn: number;
  graph: EvalGraphState;
  /** The escalation control (null when not applicable). */
  thinkDeeper: ReactNode;
  hasThinkDeeper: boolean;
  leadAnalysis?: LeadAnalysis | null;
  analysis: TurnAnalysis | null;
  playerNames: [string, string];
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
}

function TurnView({ report, onBackToReport, result, currentTurn, graph, thinkDeeper, hasThinkDeeper, leadAnalysis, analysis, playerNames, reads, onPickChoice }: TurnViewProps) {
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
      {/* The sweep's recorded reason this turn is a hole — without
          it a blank turn view reads as app breakage. */}
      {!result && currentTurn >= 1 && graph.evalErrors[currentTurn - 1] && (
        <div role="status" style={{ fontSize: 10, color: '#e6b36a', marginTop: 4, maxWidth: 520 }}>
          ⚠ This turn could not be evaluated: {graph.evalErrors[currentTurn - 1]}
        </div>
      )}
      {/* A gap turn has no result block below — the escalation
          control still has to be reachable to analyze it at all. */}
      {!result && hasThinkDeeper && (
        <div style={{ marginTop: 4 }}>{thinkDeeper}</div>
      )}
      {leadAnalysis && <EvalLeadAnalysis leads={leadAnalysis} playerNames={playerNames} />}
      {!leadAnalysis && analysis && <EvalTurnAnalysis analysis={analysis} playerNames={playerNames} reads={reads} onExplore={onPickChoice} />}
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
  variation?: { startTurn: number; scores: (number | null)[] } | null;
  graphMaxTurn?: number;
  showReportView: boolean;
}

/** The game graph with its controls, the report overview, or the selected turn's view. */
export function GameGraphSection(props: GameGraphSectionProps) {
  const {
    onAnalyzeGame, onCancel, running, smogonPending, hasGraph, prefs, graph, playerNames, currentTurn, currentLine,
    selectTurn, reportLeads, variation, graphMaxTurn, showReportView, report, analysis,
  } = props;
  return (
    <div style={{ margin: '6px 0' }}>
      <GraphHeader onAnalyzeGame={onAnalyzeGame} graph={graph} onCancel={onCancel} running={running} smogonPending={smogonPending} hasGraph={hasGraph} />
      <LineHint prefs={prefs} />
      {/* A short or missing line says why — an unexplained blank graph
          reads as a broken app rather than a diverged reconstruction. */}
      {graph.notice && (
        <div role="status" style={{ fontSize: 10, color: '#e6b36a', marginTop: 2, maxWidth: 520 }}>
          ⚠ {graph.notice}
        </div>
      )}
      {(hasGraph || variation) && (
        <EvalGraph
          scores={graph.scores}
          playerNames={playerNames}
          currentTurn={currentTurn}
          currentLine={currentLine}
          onSelectTurn={selectTurn}
          leadScore={graph.lead?.result.score ?? null}
          leadDetail={reportLeads ?? null}
          evalErrors={graph.evalErrors}
          decided={graph.results.map(result => result?.unanswered?.decided ?? null)}
          variation={variation}
          maxTurn={graphMaxTurn}
        />
      )}
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
      {showReportView && report && (
        <EvalGameReport
          report={report}
          playerNames={playerNames}
          onSelectTurn={selectTurn}
          leads={reportLeads}
          settingsFor={turn => (turn >= 1 ? graph.settings[turn - 1] ?? null : null)}
        />
      )}
      {!showReportView && <TurnView {...props} />}
    </div>
  );
}
