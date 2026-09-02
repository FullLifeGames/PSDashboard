import { useDialogFocus } from '../hooks/useDialogFocus';

/** The overlay, the dialog box with its focus handling, and the title row with the close button. */
export function ModalDialog({ title, closeLabel, onClose, children }: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { dialogRef, handleDialogKeyDown } = useDialogFocus(onClose);
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
        aria-label={title}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold' }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="ps-modal-close"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
