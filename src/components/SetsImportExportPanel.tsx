import { useState } from 'react';
import { AlertBox } from './AlertBox';
import { ModalDialog } from './ModalDialog';

interface Props {
  exportText: string;
  /** Returns an error message to display, or null when the import applied. */
  onImport: (text: string) => string | null;
  onClose: () => void;
}

/**
 * Text import/export for both players' sets. The textarea starts as the
 * current export (revealed + guessed + manual, exactly what the stats panel
 * shows); imported text overlays both sides as manual knowledge.
 */
export function SetsImportExportPanel({ exportText, onImport, onClose }: Props) {
  const [text, setText] = useState(exportText);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <ModalDialog title="Import / Export Sets" closeLabel="Close sets panel" onClose={onClose}>
      <div style={{ fontSize: 10, color: '#8899aa', marginBottom: 8 }}>
        Both teams in Showdown export format under "=== p1 ===" / "=== p2 ===" headers.
        Edit the text (or paste the real sets) and import; imported values show as green
        manual data and are remembered for this replay.
      </div>
      <textarea
        value={text}
        onChange={event => setText(event.target.value)}
        rows={18}
        className="ps-input"
        style={{ width: '100%', fontFamily: 'Consolas, monospace', fontSize: 11, resize: 'vertical' }}
      />
      {error && (
        <AlertBox style={{ marginTop: 8, fontSize: 11, padding: '5px 8px' }}>
          {error}
        </AlertBox>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="ps-btn ps-btn-red"
          style={{ flex: 1 }}
          onClick={() => setError(onImport(text))}
        >
          Import
        </button>
        <button
          type="button"
          className="ps-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button type="button" className="ps-btn" onClick={onClose}>Close</button>
      </div>
    </ModalDialog>
  );
}
