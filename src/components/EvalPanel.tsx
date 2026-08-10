import type { EvalPreferences, EvalResult, RankedChoice, ReadRecommendation, SearchProgress } from '../lib/eval/types';
import type { TurnAnalysis } from '../lib/eval/analysis';
import type { GameReport } from '../lib/eval/report';
import type { EvalGraphState, EvalStatus } from '../hooks/useEvaluation';
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
  onEvaluate: () => void;
  onCancel: () => void;
  /** Click on an engine line: plays it out in a branch (entering one first when needed), the other side answering with `reply`. */
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice, reply?: RankedChoice | null) => void;
  /** Click on a matrix cell: plays EXACTLY that pair out in a branch. */
  onPickPair?: (p1: { choice: string; label: string }, p2: { choice: string; label: string }) => void;
  /** Branch mode: hides the auto checkbox on the replay view. */
  showAuto: boolean;
  /** Gen 9 only — other gens have no Tera to gate. */
  showTera: boolean;
  graph: EvalGraphState;
  /** Replay view only — starts the whole-game background sweep. */
  onAnalyzeGame?: () => void;
  /** Replay view only — analyzes just the current turn (and its follow-up). */
  onAnalyzeTurn?: () => void;
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
  graph, onAnalyzeGame, onAnalyzeTurn, onSelectTurn, currentTurn, analysis,
  reads, leadAnalysis, reportLeads, report, doubles,
}: EvalPanelProps) {
  const running = status === 'searching' || status === 'reconstructing';
  const hasGraph = graph.scores.some(score => score !== null);
  const p1Pct = result ? winPercent(result.score) : 50;

  return (
    <div className="ps-panel ps-eval-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Evaluation</span>
        <span style={{ fontSize: 10, color: '#778' }}>estimate — sim search, not an oracle</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
          Depth
          <select
            value={prefs.mode === 'mcts' ? 'mcts' : String(prefs.depth)}
            onChange={event => {
              const value = event.target.value;
              if (value === 'mcts') onPrefsChange({ ...prefs, mode: 'mcts' });
              else onPrefsChange({ ...prefs, mode: 'matrix', depth: parseInt(value, 10) as EvalPreferences['depth'] });
            }}
            disabled={running}
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="mcts">MCTS</option>
          </select>
        </label>
        {prefs.mode !== 'mcts' && (
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
        {running ? (
          <button type="button" className="ps-btn" onClick={onCancel} style={{ padding: '2px 8px', fontSize: 10 }}>
            Cancel
          </button>
        ) : (
          <button type="button" className="ps-btn" onClick={onEvaluate} style={{ padding: '2px 8px', fontSize: 10 }}>
            {result || status === 'stale' ? 'Re-evaluate' : 'Evaluate'}
          </button>
        )}
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
                  disabled={running}
                  title="Evaluate every turn of the game in the background — the line dips where the game swung."
                  style={{ padding: '1px 6px', fontSize: 10 }}
                >
                  {hasGraph ? 'Re-analyze' : 'Analyze game'}
                </button>
                {onAnalyzeTurn && (
                  <button
                    type="button"
                    className="ps-btn"
                    onClick={onAnalyzeTurn}
                    disabled={running}
                    title="Explain just this turn — evaluates it and the next one, no full sweep."
                    style={{ padding: '1px 6px', fontSize: 10 }}
                  >
                    Analyze turn {currentTurn}
                  </button>
                )}
              </>
            )}
          </div>
          <div
            style={{ fontSize: 10, color: '#778', marginTop: 2 }}
            title="Analyze game paints the whole line with a fast depth-1 scan first, then re-evaluates the biggest swings with the settings above. Analyze turn and Evaluate always use those settings directly; Tera applies everywhere."
          >
            line: fast scan · key swings &amp; analyzed turns: {prefs.mode === 'mcts' ? 'MCTS' : `depth ${prefs.depth}`}
          </div>
          {hasGraph && (
            <EvalGraph
              scores={graph.scores}
              playerNames={playerNames}
              currentTurn={currentTurn}
              onSelectTurn={onSelectTurn}
              leadScore={graph.lead?.result.score ?? null}
            />
          )}
          {hasGraph && !analysis && (
            <div style={{ fontSize: 10, color: '#778', marginTop: 2 }}>
              Click a point for that turn's analysis — its movement lights up on the line.
            </div>
          )}
          {report && <EvalGameReport report={report} playerNames={playerNames} onSelectTurn={onSelectTurn} leads={reportLeads} />}
          {leadAnalysis && <EvalLeadAnalysis leads={leadAnalysis} playerNames={playerNames} />}
          {!leadAnalysis && analysis && <EvalTurnAnalysis analysis={analysis} playerNames={playerNames} reads={reads} onExplore={onPickChoice} />}
        </div>
      )}

      {result && (
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
            <span>depth {result.depthCompleted}</span>
            {result.interval > 0.25 && (
              <span style={{ color: '#b6a46a' }} title="No safe line exists — the outcome hinges on out-predicting the opponent.">
                toss-up: prediction battle
              </span>
            )}
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
