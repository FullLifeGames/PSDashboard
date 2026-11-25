import { useEffect, useRef } from 'react';

interface ConfirmBannerProps {
  message: string;
  onProceed: () => void;
  onCancel: () => void;
  proceedLabel?: string;
}

const KEEP_WORDS = { whiteSpace: 'nowrap', flexShrink: 0 } as const;

/** Inline confirm before an action that discards work. */
export function ConfirmBanner({ message, onProceed, onCancel, proceedLabel = 'Replace' }: ConfirmBannerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  return (
    <div
      ref={ref}
      className="ps-panel"
      role="alertdialog"
      style={{
        marginTop: 6, padding: '7px 10px', display: 'flex', flexWrap: 'wrap', gap: 6, rowGap: 6, alignItems: 'center',
        fontSize: 11, borderColor: 'rgba(204,68,85,0.5)',
      }}
    >
      <span style={{ flex: '1 1 12em' }}>{message}</span>
      <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" className="ps-btn ps-btn-red" style={KEEP_WORDS} onClick={onProceed}>
          {proceedLabel}
        </button>
        <button
          type="button"
          className="ps-btn"
          style={KEEP_WORDS}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </div>
  );
}
