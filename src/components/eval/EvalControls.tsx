import type { EvalPreferences, EvalResult } from '@fulllifegames/eval-engine';
import type { EvalStatus } from '../../hooks/useEvaluation';
import type { EngineChoice } from '../../hooks/useEngineChoice';
import { BUILTIN_ENGINE, engineNote } from '../../lib/engines/registry';
import { EngineControls } from './EngineControls';

interface PrefsProps {
  prefs: EvalPreferences;
  onPrefsChange: (prefs: EvalPreferences) => void;
  running: boolean;
}

const LABEL_STYLE = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aabbcc' } as const;

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

export function EvalControls({ prefs, onPrefsChange, running, showAuto, onEvaluate, onCancel, result, status, engines }: PrefsProps & {
  showAuto: boolean;
  engines?: EngineChoice;
  onEvaluate?: () => void;
  onCancel: () => void;
  result: EvalResult | null;
  status: EvalStatus;
}) {
  return (
    <div className="ps-eval-controls">
      <span className="ps-eval-controls-title" title={engineNote(engines?.selected ?? BUILTIN_ENGINE)}>Evaluation</span>
      {engines && <EngineControls engines={engines.engines} onAdd={engines.add} onRemove={engines.remove} />}
      {showAuto && (
        <label
          title="After your first Evaluate in a variation, each position you play or step to evaluates by itself. The engine walk and Play line switch this on. Stays on across sessions."
          style={LABEL_STYLE}
        >
          <input
            type="checkbox"
            checked={prefs.auto}
            onChange={event => onPrefsChange({ ...prefs, auto: event.target.checked })}
          />
          Follow
        </label>
      )}
      <label
        title="Analyze game starts by itself when a replay loads, and the newest position of a variation evaluates without a click. Stays on across sessions."
        style={LABEL_STYLE}
      >
        <input
          type="checkbox"
          checked={prefs.autoAnalyze}
          onChange={event => onPrefsChange({ ...prefs, autoAnalyze: event.target.checked })}
        />
        On load
      </label>
      {onEvaluate && <EvaluateButton running={running} onEvaluate={onEvaluate} onCancel={onCancel} result={result} status={status} />}
    </div>
  );
}
