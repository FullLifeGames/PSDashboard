import { useEffect, useRef, useState } from 'react';

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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
      }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleDialogKeyDown}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          background: '#2a3a5c', border: '2px solid #8aa', borderRadius: 8,
          padding: 20, maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto', outline: 'none',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Import / Export Sets"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>Import / Export Sets</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sets panel"
            className="ps-modal-close"
          >
            &times;
          </button>
        </div>
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
          <div
            role="alert"
            style={{
              marginTop: 8, fontSize: 11, color: '#f3a6a6',
              background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)',
              borderRadius: 4, padding: '5px 8px',
            }}
          >
            {error}
          </div>
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
      </div>
    </div>
  );
}
