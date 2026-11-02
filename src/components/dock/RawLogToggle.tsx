import { useState } from 'react';

/** Round 84 (turn dock): the Raw Protocol Log toggle, moved out of PanelStatus.tsx. It stays above the dock at every position. */
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
