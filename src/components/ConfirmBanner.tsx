import { useEffect, useRef } from 'react';

interface ConfirmBannerProps {
  message: string;
  onProceed: () => void;
  onCancel: () => void;
  /** The red button's words; "Replace" for the deviation confirm (round 89, H14a and H16a name their own). */
  proceedLabel?: string;
}

/**
 * Inline confirm for main-line deviations that would replace the variation, and for the other questions that ask before they throw
 * something away (round 89: a team edit that cuts played turns, Start or a load that closes an unsaved variation). It scrolls into view
 * when it appears: the question may stand below the part of the page the user is looking at.
 */
export function ConfirmBanner({ message, onProceed, onCancel, proceedLabel = 'Replace' }: ConfirmBannerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  return (
    <div
      ref={ref}
      className="ps-panel"
      role="alertdialog"
      style={{
        marginTop: 6, padding: '7px 10px', display: 'flex', gap: 10, alignItems: 'center',
        fontSize: 11, borderColor: 'rgba(204,68,85,0.5)',
      }}
    >
      <span>{message}</span>
      <button type="button" className="ps-btn ps-btn-red" onClick={onProceed}>
        {proceedLabel}
      </button>
      <button
        type="button"
        className="ps-btn"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
