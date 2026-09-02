import type { EvalPreferences, EvalResult } from '@fulllifegames/eval-engine';
import type { EvalStatus } from '../../hooks/useEvaluation';

interface PrefsProps {
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  running: boolean;
}

const LABEL_STYLE = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' } as const;

function DepthSelect({ prefs, onPrefsChange, running }: PrefsProps) {
  return (
    <label style={LABEL_STYLE}>
      Depth
      <select
        value={prefs.mode === 'mcts' || prefs.mode === 'auto' ? prefs.mode : String(prefs.depth)}
        onChange={event => {
          const value = event.target.value;
          if (value === 'mcts' || value === 'auto') onPrefsChange({ ...prefs, mode: value });
          else onPrefsChange({ ...prefs, mode: 'matrix', depth: parseInt(value, 10) as EvalPreferences['depth'] });
        }}
        disabled={running}
        title="Auto routes each turn by its position: fast matrix search while boards are full, the MCTS tree once enough Pokémon have fainted; the measured-best line configuration."
      >
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="mcts">MCTS</option>
        <option value="auto">Auto</option>
      </select>
    </label>
  );
}

function SamplesSelect({ prefs, onPrefsChange, running }: PrefsProps) {
  return (
    <label
      title="Damage-roll seeds averaged per cell. Only affects cells where a KO is in range; quiet cells are roll-insensitive and always simulate once."
      style={LABEL_STYLE}
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
  );
}

function TeraSelect({ prefs, onPrefsChange, running }: PrefsProps) {
  return (
    <label
      title="Auto: off when the game never terastallized; in draft/custom formats only the Pokémon that terastallized keep the option. Revealed: force that per-Pokémon restriction for any format."
      style={LABEL_STYLE}
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
  );
}

function EvaluateButton({ running, onEvaluate, onCancel, result, status }: {
  running: boolean;
  onEvaluate: () => void;
  onCancel: () => void;
  result: EvalResult | null;
  status: EvalStatus;
}) {
  return running ? (
    <button type="button" className="ps-btn" onClick={onCancel} style={{ padding: '2px 8px', fontSize: 10 }}>
      Cancel
    </button>
  ) : (
    <button type="button" className="ps-btn" onClick={onEvaluate} style={{ padding: '2px 8px', fontSize: 10 }}>
      {result || status === 'stale' ? 'Re-evaluate' : 'Evaluate'}
    </button>
  );
}

/** The panel header: title, the engine preferences, and the Evaluate/Cancel entry. */
export function EvalControls({ prefs, onPrefsChange, running, showAuto, showTera, onEvaluate, onCancel, result, status }: PrefsProps & {
  showAuto: boolean;
  showTera: boolean;
  onEvaluate?: () => void;
  onCancel: () => void;
  result: EvalResult | null;
  status: EvalStatus;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 'bold' }}>Evaluation</span>
      <span style={{ fontSize: 10, color: '#778' }}>estimate from a sim search, no oracle</span>
      <span style={{ flex: 1 }} />
      <DepthSelect prefs={prefs} onPrefsChange={onPrefsChange} running={running} />
      {prefs.mode === 'matrix' && <SamplesSelect prefs={prefs} onPrefsChange={onPrefsChange} running={running} />}
      {showTera && <TeraSelect prefs={prefs} onPrefsChange={onPrefsChange} running={running} />}
      {showAuto && (
        <label style={LABEL_STYLE}>
          <input
            type="checkbox"
            checked={prefs.auto}
            onChange={event => onPrefsChange({ ...prefs, auto: event.target.checked })}
          />
          Auto
        </label>
      )}
      <label
        title="Evaluation as a companion: Analyze game starts by itself when a replay loads, and new variation positions evaluate without the Evaluate button. Stays on across sessions."
        style={LABEL_STYLE}
      >
        <input
          type="checkbox"
          checked={prefs.autoAnalyze}
          onChange={event => onPrefsChange({ ...prefs, autoAnalyze: event.target.checked })}
        />
        Always on
      </label>
      {onEvaluate && <EvaluateButton running={running} onEvaluate={onEvaluate} onCancel={onCancel} result={result} status={status} />}
    </div>
  );
}
