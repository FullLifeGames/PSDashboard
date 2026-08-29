interface ConfirmBannerProps {
  message: string;
  onProceed: () => void;
  onCancel: () => void;
}

/** Inline confirm for main-line deviations that would replace the variation. */
export function ConfirmBanner({ message, onProceed, onCancel }: ConfirmBannerProps) {
  return (
    <div
      className="ps-panel"
      role="alertdialog"
      style={{
        marginTop: 6, padding: '7px 10px', display: 'flex', gap: 10, alignItems: 'center',
        fontSize: 11, borderColor: 'rgba(204,68,85,0.5)',
      }}
    >
      <span>{message}</span>
      <button type="button" className="ps-btn ps-btn-red" onClick={onProceed}>
        Replace
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
