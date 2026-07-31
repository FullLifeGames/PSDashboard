import type { EvalPreferences, EvalResult, RankedChoice, SearchProgress } from '../lib/eval/types';
import type { EvalStatus } from '../hooks/useEvaluation';

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
  /** Present only in branch mode — enables click-to-prefill. */
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice) => void;
  /** Branch mode: hides the auto checkbox on the replay view. */
  showAuto: boolean;
  /** Gen 9 only — other gens have no Tera to gate. */
  showTera: boolean;
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

function ChoiceList({
  side, choices, onPickChoice,
}: {
  side: 'p1' | 'p2';
  choices: RankedChoice[];
  onPickChoice?: (side: 'p1' | 'p2', choice: RankedChoice) => void;
}) {
  return (
    <div className="ps-eval-column">
      {choices.slice(0, 3).map(choice => {
        const detail = (
          <>
            <span className="ps-eval-choice-main">
              <span style={{ color: '#cde' }}>{choice.label}</span>
              <span style={{ color: '#aab', whiteSpace: 'nowrap' }}>
                {signed(choice.worstCase)} / {signed(choice.expected)}
                {choice.punishedBy ? <span style={{ color: '#778' }}> · worst vs {choice.punishedBy}</span> : null}
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
            title="Use this choice in the branch"
            onClick={() => onPickChoice(side, choice)}
          >
            {detail}
          </button>
        ) : (
          <div key={choice.choice} className="ps-eval-choice">
            {detail}
          </div>
        );
      })}
    </div>
  );
}

export function EvalPanel({
  playerNames, status, result, progress, reconstructProgress, error,
  prefs, onPrefsChange, onEvaluate, onCancel, onPickChoice, showAuto, showTera,
}: EvalPanelProps) {
  const running = status === 'searching' || status === 'reconstructing';
  const p1Pct = result ? Math.round(50 + 50 * result.score) : 50;

  return (
    <div className="ps-panel ps-eval-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 'bold' }}>Evaluation</span>
        <span style={{ fontSize: 10, color: '#778' }}>estimate — sim search, not an oracle</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
          Depth
          <select
            value={prefs.depth}
            onChange={event => onPrefsChange({ ...prefs, depth: parseInt(event.target.value, 10) as EvalPreferences['depth'] })}
            disabled={running}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
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
        {showTera && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' }}>
            Tera
            <select
              value={prefs.tera}
              onChange={event => onPrefsChange({ ...prefs, tera: event.target.value as EvalPreferences['tera'] })}
              disabled={running}
            >
              <option value="auto">Auto</option>
              <option value="on">On</option>
              <option value="off">Off</option>
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
            <ChoiceList side="p1" choices={result.perSide.p1} onPickChoice={onPickChoice} />
            <ChoiceList side="p2" choices={result.perSide.p2} onPickChoice={onPickChoice} />
          </div>
        </div>
      )}
    </div>
  );
}
