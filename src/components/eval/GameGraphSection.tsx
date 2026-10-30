import type { ReactNode } from 'react';
import {
  autoTurnSettings, heldDecided,
  type EvalPreferences, type EvalResult, type RankedChoice, type ReadRecommendation, type TurnAnalysis, type GameReport, type LeadAnalysis,
} from '@fulllifegames/eval-engine';
import type { EvalGraphState } from '../../hooks/useEvaluation';
import { EvalGameReport } from '../EvalGameReport';
import { EvalGraph } from '../EvalGraph';
import { EvalLeadAnalysis, EvalTurnAnalysis } from '../EvalTurnAnalysis';
import { EvalReplacementAnalysis } from './EvalReplacementAnalysis';
import type { VariationSeries } from '../../lib/eval-graph-view';

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
          {/* Round 77 (C1): a single evaluation took the sweep over; the status names where it stopped. */}
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

function LineHint({ prefs, doubles }: { prefs: EvalPreferences; doubles?: boolean }) {
  // Round 61: auto reads the search budget. Round 63 (T110): per game type; by default doubles run the tree on every
  // turn, singles the matrix until a quarter of all bodies fell. Round 67 (T109): no deeper stage per turn.
  const autoTreeEverywhere = autoTurnSettings(0, !!doubles).mode === 'mcts';
  return (
    <div
      style={{ fontSize: 10, color: '#778', marginTop: 2 }}
      title="Analyze game paints the whole line with a fast depth-1 scan first, then converges every turn to the settings above, report-worthy swings first. Tera applies everywhere."
    >
      line: fast scan, then {prefs.mode === 'mcts' ? 'MCTS'
        : prefs.mode === 'auto' ? (autoTreeEverywhere ? 'auto (MCTS every turn)' : 'auto (matrix early, MCTS late)')
        : `depth ${prefs.depth}`} everywhere
    </div>
  );
}

/** The replacement note of the card's turn: the points of the knockout block before it, when the sweep priced any. */
function ReplacementNote({ analysis, graph, playerNames }: { analysis: TurnAnalysis; graph: EvalGraphState; playerNames: [string, string] }) {
  const records = graph.replacements?.[analysis.turn - 1];
  if (!records?.length) return null;
  return <EvalReplacementAnalysis turn={analysis.turn} records={records} playerNames={playerNames} faintedFraction={analysis.faintedFraction} />;
}

interface TurnViewProps {
  report?: GameReport | null;
  onBackToReport: () => void;
  result: EvalResult | null;
  currentTurn: number;
  graph: EvalGraphState;
  /** A gap turn's analysis control (null when not applicable). */
  analyzeTurn: ReactNode;
  hasAnalyzeTurn: boolean;
  leadAnalysis?: LeadAnalysis | null;
  analysis: TurnAnalysis | null;
  playerNames: [string, string];
  reads?: { p1?: ReadRecommendation | null; p2?: ReadRecommendation | null } | null;
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
}

function TurnView({ report, onBackToReport, result, currentTurn, graph, analyzeTurn, hasAnalyzeTurn, leadAnalysis, analysis, playerNames, reads, onPickChoice }: TurnViewProps) {
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
      {/* A gap turn has no result block below — its analysis
          control is the one way to search it on its own. */}
      {!result && hasAnalyzeTurn && (
        <div style={{ marginTop: 4 }}>{analyzeTurn}</div>
      )}
      {leadAnalysis && <EvalLeadAnalysis leads={leadAnalysis} playerNames={playerNames} />}
      {/* Round 79 (T290): the replacement after a knockout sits above the card of the turn that follows it. */}
      {!leadAnalysis && analysis && <ReplacementNote analysis={analysis} graph={graph} playerNames={playerNames} />}
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
  variation?: VariationSeries | null;
  graphMaxTurn?: number;
  showReportView: boolean;
  /** The card's fainted share per swept turn (any engine mode); the sweep's own record exists in auto only. */
  faintedShares?: (number | null)[];
  /** Doubles replay — auto routes per game type (EvalPanel passes its own prop through). */
  doubles?: boolean;
}

/** The card's share per turn where the caller has it, else the sweep's own record (auto only). */
const graphShares = ({ faintedShares, graph }: GameGraphSectionProps) => faintedShares ?? graph.faintedFractions;

/** The game graph with its controls, the report overview, or the selected turn's view. */
export function GameGraphSection(props: GameGraphSectionProps) {
  const {
    onAnalyzeGame, onCancel, running, smogonPending, hasGraph, prefs, graph, playerNames, currentTurn, currentLine,
    selectTurn, reportLeads, variation, graphMaxTurn, showReportView, report, analysis, doubles,
  } = props;
  return (
    <div style={{ margin: '6px 0' }}>
      <GraphHeader onAnalyzeGame={onAnalyzeGame} graph={graph} onCancel={onCancel} running={running} smogonPending={smogonPending} hasGraph={hasGraph} />
      <LineHint prefs={prefs} doubles={doubles} />
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
          faintedFractions={graphShares(props)}
          decided={graph.results.map(result => (result ? heldDecided(result) ?? null : null))}
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
