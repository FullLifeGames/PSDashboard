import { useState } from 'react';
import type { PickerSource } from '../../lib/picker-state';

/** Where the choices come from, plus the Basic/Advanced toggle. */
export function PickerSourceLine({ source, acquiringExact, advanced, onToggleAdvanced }: {
  source?: PickerSource;
  acquiringExact?: boolean;
  advanced: boolean;
  onToggleAdvanced: () => void;
}) {
  return (
    <div style={{ fontSize: 10, color: '#9fb2cc', margin: '4px 0 2px', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
      {source === 'stored' && (
        <span>Choices from the reconstructed position</span>
      )}
      {source === 'snapshot' && (
        <span>
          {acquiringExact
            ? 'Choices approximated · reconstructing the exact position…'
            : 'Choices approximated from the replay; the sim checks legality when you play a move'}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onToggleAdvanced}
        className="ps-btn"
        style={{ padding: '0 6px', fontSize: 10 }}
        aria-expanded={advanced}
        title="Grows the compact action chips into the full picker: type and damage details, the Fight/Pokémon tabs, the free choice dropdown, and the &quot;What if it had…&quot; move loader."
      >
        {advanced ? 'Advanced ▾' : 'Advanced ▸'}
      </button>
    </div>
  );
}

/** The execute error and the Execute Turn button (hidden during forced switches). */
export function ExecuteRow({ executeError, isForceSwitch, bothChosen, executing, pendingLabel, onExecuteTurn }: {
  executeError: string | null;
  isForceSwitch: boolean;
  bothChosen: boolean;
  executing: boolean;
  pendingLabel: string;
  onExecuteTurn: () => void;
}) {
  return (
    <>
      {executeError && (
        <div className="ps-choice-error ps-execute-error" role="alert">
          {executeError}
        </div>
      )}

      {/* Execute turn button */}
      {!isForceSwitch && (
        <div className="ps-execute-wrap">
          <button
            type="button"
            onClick={onExecuteTurn}
            disabled={!bothChosen || executing}
            className="ps-execute-btn"
            style={{ background: bothChosen && !executing ? '#cc4455' : '#555' }}
          >
            {executing ? 'Executing…' : pendingLabel}
          </button>
        </div>
      )}
    </>
  );
}

/** Raw battle log toggle. */
export function RawLogToggle({ log }: { log: string[] }) {
  const [showLog, setShowLog] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setShowLog(!showLog)}
        className="ps-log-toggle"
      >
        {showLog ? 'Hide' : 'Show'} Raw Protocol Log
      </button>
      {showLog && (
        <div className="ps-log" style={{ marginTop: 6 }}>
          {log
            .filter(l => l && !l.startsWith('|split|') && !l.startsWith('|c|') && !l.startsWith('|t:|'))
            .join('\n')}
        </div>
      )}
    </div>
  );
}
