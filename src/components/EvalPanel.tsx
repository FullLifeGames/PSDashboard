import { useState } from 'react';
import type { EvalPreferences, EvalResult, RankedChoice, ReadRecommendation, SearchProgress } from '../lib/eval/types';
import type { TurnAnalysis } from '../lib/eval/analysis';
import type { GameReport } from '../lib/eval/report';
import type { EvalGraphState, EvalStatus, TurnEvalSettings } from '../hooks/useEvaluation';
import { EvalGameReport } from './EvalGameReport';
import { EvalGraph } from './EvalGraph';
import { EvalLeadAnalysis, EvalTurnAnalysis, MiniBar } from './EvalTurnAnalysis';
import { EvalMatrixView } from './EvalMatrixView';
import { winDeltaText, winPercent } from '../lib/eval/winprob';
import type { LeadAnalysis } from '../lib/eval/leads';

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
  /** Replay view only — starts the whole-game background sweep. */
  onAnalyzeGame?: () => void;
  onSelectTurn?: (turn: number) => void;
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
}

// Displayed values are win probabilities ("52%") and point deltas ("−8%").

function ChoiceList({
  side, choices, reply, onPickChoice,
}: {
  side: 'p1' | 'p2';
  choices: RankedChoice[];
  /** The other side's engine answer, committed alongside a clicked line. */
  reply: RankedChoice | null;
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
  doubles?: boolean;
}) {
  const best = choices[0];
  return (
    <div className="ps-eval-column">
      {choices.slice(0, 3).map((choice, index) => {
        // The equilibrium value in the eval bar's own language: the win odds
        // this choice is worth against balanced play. The guaranteed floor
        // and the punishing reply live in the tooltip.
        const evPct = winPercent(choice.ev);
        const gap = best ? choice.ev - best.ev : 0;
        const tooltip = `Win probability ${evPct}% vs balanced play — higher is better for this side` +
          ` · guaranteed at least ${winPercent(choice.worstCase)}%` +
          (choice.punishedBy ? ` (worst reply: ${choice.punishedBy})` : '') +
          '. Choices are ranked by their value against balanced play.' +
          (onPickChoice ? ' Click to play this turn out against the engine’s reply.' : '');
        const detail = (
          <>
            <span className="ps-eval-choice-main">
              <span style={{ color: '#778' }}>{index + 1}.</span>
              <span style={{ color: '#cde', flex: '1 1 auto', minWidth: 0 }}>{choice.label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', color: '#aab' }}>
                <MiniBar value={choice.ev} />
                {evPct}%
                {index > 0 && gap < 0 && <span style={{ color: '#778' }}>({winDeltaText(gap)})</span>}
              </span>
            </span>
            {choice.line && choice.line.length > 0 && (
              <span className="ps-eval-line">
                then {choice.line.map(step => `${step.p1} · ${step.p2}`).join(' → ')}
              </span>
            )}
          </>
        );
        return onPickChoice ? (
          <button
            key={choice.choice}
            type="button"
            className="ps-btn ps-eval-choice"
            title={tooltip}
            onClick={() => onPickChoice(side, choice, reply)}
          >
            {detail}
          </button>
        ) : (
          <div key={choice.choice} className="ps-eval-choice" title={tooltip}>
            {detail}
          </div>
        );
      })}
    </div>
  );
}

export function EvalPanel({
  playerNames, status, result, progress, reconstructProgress, error,
  prefs, onPrefsChange, onEvaluate, onCancel, onPickChoice, onPickPair, showAuto, showTera,
  graph, onAnalyzeGame, onSelectTurn, currentTurn, analysis,
  reads, leadAnalysis, reportLeads, report, doubles, resultSettings, onThinkDeeper, thinkDeeperTarget, smogonPending,
}: EvalPanelProps) {
  const running = status === 'searching' || status === 'reconstructing';
  const hasGraph = graph.scores.some(score => score !== null);
  const p1Pct = result ? winPercent(result.score) : 50;

  // One escalation control for both faces of the turn view: a gap turn gets
  // its first analysis, an analyzed turn re-searches one step deeper. The
  // label names the target so the click is never a surprise. Both faces
  // acquire through the HEALED single-turn reconstruction (per-turn
  // snapshot corrections, with the reached guard as the loud-failure
  // backstop) — the 2026-08-11 hide is resolved; see the calibration
  // header's think-deeper entries.
  const thinkDeeperButton = onThinkDeeper && thinkDeeperTarget ? (
    <button
      type="button"
      className="ps-btn"
      disabled={graph.running || smogonPending}
      onClick={onThinkDeeper}
      title={smogonPending
        ? 'Waiting for Smogon data — searching now would build the teams without the guessed sets.'
        : 'Re-search this position (and its follow-up turn) at the named settings — the score, ranked moves, matrix, graph, and report update together.'}
      style={{ padding: '1px 6px', fontSize: 10 }}
    >
      {result ? 'Think deeper about this position' : 'Analyze this position'}
      {` (${thinkDeeperTarget.mode === 'mcts' ? 'MCTS'
        : thinkDeeperTarget.mode === 'auto' ? 'auto'
        : `depth ${thinkDeeperTarget.depth}`})`}
    </button>
  ) : null;

  // Two screens, not one stack: the game report (the cards) is the
  // overview; clicking a turn switches to that turn's full view (analysis,
  // bar, ranked lists, matrix) with a way back — "click a card, deal with
  // it, return to the cards".
  const [view, setView] = useState<'report' | 'turn'>('report');
  // Render-time adjustment (not an effect): when a report first APPEARS —
  // initial sweep done, or a new replay's sweep — land on the overview.
  const [hadReport, setHadReport] = useState(false);
  if (!!report !== hadReport) {
    setHadReport(!!report);
    if (report) setView('report');
  }
  const selectTurn = onSelectTurn
    ? (turn: number) => {
      onSelectTurn(turn);
      setView('turn');
    }
    : undefined;
  const showReportView = view === 'report' && !!report;

  return (
    <div className="ps-panel ps-eval-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Evaluation</span>
        <span style={{ fontSize: 10, color: '#778' }}>estimate — sim search, not an oracle</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
          Depth
          <select
            value={prefs.mode === 'mcts' || prefs.mode === 'auto' ? prefs.mode : String(prefs.depth)}
            onChange={event => {
              const value = event.target.value;
              if (value === 'mcts' || value === 'auto') onPrefsChange({ ...prefs, mode: value });
              else onPrefsChange({ ...prefs, mode: 'matrix', depth: parseInt(value, 10) as EvalPreferences['depth'] });
            }}
            disabled={running}
            title="Auto routes each turn by its position: fast matrix search while boards are full, the MCTS tree once enough Pokémon have fainted — the measured-best line configuration."
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="mcts">MCTS</option>
            <option value="auto">Auto</option>
          </select>
        </label>
        {prefs.mode === 'matrix' && (
          <label
            title="Damage-roll seeds averaged per cell. Only affects cells where a KO is in range — quiet cells are roll-insensitive and always simulate once."
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}
          >
            Samples
            <select
              value={prefs.samples}
              onChange={event => onPrefsChange({ ...prefs, samples: parseInt(event.target.value, 10) as EvalPreferences['samples'] })}
              disabled={running}
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </label>
        )}
        {showTera && (
          <label
            title="Auto: off when the game never terastallized; in draft/custom formats only the Pokémon that actually did keep the option. Revealed: force that per-Pokémon restriction for any format."
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}
          >
            Tera
            <select
              value={prefs.tera}
              onChange={event => onPrefsChange({ ...prefs, tera: event.target.value as EvalPreferences['tera'] })}
              disabled={running}
            >
              <option value="auto">Auto</option>
              <option value="on">On</option>
              <option value="off">Off</option>
              <option value="revealed">Revealed</option>
            </select>
          </label>
        )}
        {showAuto && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
            <input
              type="checkbox"
              checked={prefs.auto}
              onChange={event => onPrefsChange({ ...prefs, auto: event.target.checked })}
            />
            Auto
          </label>
        )}
        {onEvaluate && (running ? (
          <button type="button" className="ps-btn" onClick={onCancel} style={{ padding: '2px 8px', fontSize: 10 }}>
            Cancel
          </button>
        ) : (
          <button type="button" className="ps-btn" onClick={onEvaluate} style={{ padding: '2px 8px', fontSize: 10 }}>
            {result || status === 'stale' ? 'Re-evaluate' : 'Evaluate'}
          </button>
        ))}
      </div>

      {status === 'reconstructing' && (
        <div style={{ fontSize: 11, color: '#fd6' }}>
          Rebuilding position…{reconstructProgress ? ` (turn ${reconstructProgress.turn}/${reconstructProgress.target})` : ''}
        </div>
      )}
      {status === 'searching' && (
        <>
          <div style={{ fontSize: 11, color: '#fd6' }}>
            Searching… depth {progress?.depth ?? 1}
          </div>
          <div className="ps-eval-progress">
            <div style={{ width: `${progress && progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0}%` }} />
          </div>
        </>
      )}
      {status === 'error' && (
        <div role="alert" style={{ fontSize: 11, color: '#f3a6a6' }}>
          Evaluation failed: {error}
        </div>
      )}
      {status === 'stale' && (
        <div style={{ fontSize: 11, color: '#b6a46a', marginBottom: 4 }}>
          Position changed — re-evaluate.
        </div>
      )}

      {onAnalyzeGame && (
        <div style={{ margin: '6px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#aabbcc' }}>
            <span style={{ fontWeight: 'bold', fontSize: 11, color: '#cde' }}>Game graph</span>
            {graph.running ? (
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
                    ? 'Waiting for Smogon data — a sweep started now would build the teams without the guessed sets.'
                    : "Evaluate every turn of the game in the background — the line dips where the game swung. The selected turn's analysis, ranked choices, and matrix follow automatically."}
                  style={{ padding: '1px 6px', fontSize: 10 }}
                >
                  {hasGraph ? 'Re-analyze' : 'Analyze game'}
                </button>
              </>
            )}
          </div>
          <div
            style={{ fontSize: 10, color: '#778', marginTop: 2 }}
            title="Analyze game paints the whole line with a fast depth-1 scan first, then converges every turn to the settings above — report-worthy swings first. Any turn can go deeper still from its view (Think deeper); Tera applies everywhere."
          >
            line: fast scan, then {prefs.mode === 'mcts' ? 'MCTS'
              : prefs.mode === 'auto' ? 'auto (matrix early, MCTS late)'
              : `depth ${prefs.depth}`} everywhere · deeper: per turn
          </div>
          {/* A short or missing line says why — an unexplained blank graph
              reads as a broken app rather than a diverged reconstruction. */}
          {graph.notice && (
            <div role="status" style={{ fontSize: 10, color: '#e6b36a', marginTop: 2, maxWidth: 520 }}>
              ⚠ {graph.notice}
            </div>
          )}
          {hasGraph && (
            <EvalGraph
              scores={graph.scores}
              playerNames={playerNames}
              currentTurn={currentTurn}
              onSelectTurn={selectTurn}
              leadScore={graph.lead?.result.score ?? null}
              evalErrors={graph.evalErrors}
              decided={graph.results.map(result => result?.unanswered?.decided ?? null)}
            />
          )}
          {hasGraph && (showReportView || !analysis) && (
            <div style={{ fontSize: 10, color: '#778', marginTop: 2 }}>
              Click a point for that turn's analysis — its movement lights up on the line.
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
          {!showReportView && (
            <>
              {report && (
                <button
                  type="button"
                  className="ps-btn"
                  style={{ padding: '1px 6px', fontSize: 10, marginTop: 4 }}
                  onClick={() => setView('report')}
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
              {!result && thinkDeeperButton && (
                <div style={{ marginTop: 4 }}>{thinkDeeperButton}</div>
              )}
              {leadAnalysis && <EvalLeadAnalysis leads={leadAnalysis} playerNames={playerNames} />}
              {!leadAnalysis && analysis && <EvalTurnAnalysis analysis={analysis} playerNames={playerNames} reads={reads} onExplore={onPickChoice} />}
            </>
          )}
        </div>
      )}

      {result && !showReportView && (
        <div className={status === 'stale' ? 'ps-eval-stale' : undefined}>
          <div className="ps-eval-labels">
            <span className="ps-eval-bar-p1">{playerNames[0]} {p1Pct}%</span>
            <span className="ps-eval-bar-p2">{playerNames[1]} {100 - p1Pct}%</span>
          </div>
          <div className="ps-eval-bar" role="img" aria-label={`Advantage estimate: ${playerNames[0]} ${p1Pct}%, ${playerNames[1]} ${100 - p1Pct}%`}>
            <div className="ps-eval-bar-fill" style={{ width: `${p1Pct}%` }} />
            <div className="ps-eval-bar-tick" />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 10, color: '#778', marginTop: 2 }}>
            <span title="What produced the numbers shown for this turn.">
              {resultSettings
                ? (resultSettings.mode === 'mcts'
                  ? 'MCTS'
                  : `depth ${resultSettings.depth} · ${resultSettings.samples} sample${resultSettings.samples > 1 ? 's' : ''}`)
                : `depth ${result.depthCompleted}`}
            </span>
            {result.interval > 0.25 && (
              <span style={{ color: '#b6a46a' }} title="No safe line exists — the outcome hinges on out-predicting the opponent.">
                toss-up: prediction battle
              </span>
            )}
            {thinkDeeperButton}
          </div>
          <div className="ps-eval-columns">
            {/* Stale results describe the PREVIOUS position — clicking them
                would map old choices onto the new state (wrong switches). */}
            <ChoiceList side="p1" choices={result.perSide.p1} reply={result.perSide.p2[0] ?? null} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} />
            <ChoiceList side="p2" choices={result.perSide.p2} reply={result.perSide.p1[0] ?? null} onPickChoice={status === 'stale' ? undefined : onPickChoice} doubles={doubles} />
          </div>
          {result.matrix && (
            <EvalMatrixView
              matrix={result.matrix}
              playerNames={playerNames}
              onPickPair={status === 'stale' ? undefined : onPickPair}
            />
          )}
        </div>
      )}
    </div>
  );
}
