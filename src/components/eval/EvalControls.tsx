import type { EvalPreferences, EvalResult } from '@fulllifegames/eval-engine';
import type { EvalStatus } from '../../hooks/useEvaluation';
import type { EngineChoice } from '../../hooks/useEngineChoice';
import { EngineControls } from './EngineControls';

interface PrefsProps {
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  running: boolean;
}

const LABEL_STYLE = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' } as const;

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

/**
 * The panel header: title, the engine link, Tera, and the Evaluate/Cancel entry. "Always on" shares the row with the title, the engine link
 * and Tera at the right column's desktop width (380 px, see `.ps-eval-controls` in eval-panel.css); a narrower column wraps it. Depth and
 * Samples live in the Setup menu (`SearchSelects`).
 */
export function EvalControls({ prefs, onPrefsChange, running, showAuto, showTera, onEvaluate, onCancel, result, status, engines }: PrefsProps & {
  showAuto: boolean;
  /** The engines on offer; another engine than the own search decides its own depth. */
  engines?: EngineChoice;
  showTera: boolean;
  onEvaluate?: () => void;
  onCancel: () => void;
  result: EvalResult | null;
  status: EvalStatus;
}) {
  const external = !!engines && engines.selected.source !== 'builtin';
  const engineNote = external ? `Estimate from ${engines.selected.name}.` : 'Built-in engine: it plays the turns in the simulator.';
  return (
    <div className="ps-eval-controls">
      <span className="ps-eval-controls-title" title={engineNote}>Evaluation</span>
      {engines && <EngineControls engines={engines.engines} selected={engines.selected} running={running} note={engineNote} onSelect={engines.select} onAdd={engines.add} onRemove={engines.remove} />}
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
