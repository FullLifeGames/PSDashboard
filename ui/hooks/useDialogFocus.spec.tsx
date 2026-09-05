import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDialogFocus } from '../../src/hooks/useDialogFocus';

function Dialog({ onClose }: { onClose: () => void }) {
  const { dialogRef, handleDialogKeyDown } = useDialogFocus(onClose);
  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="Edit" onKeyDown={handleDialogKeyDown}>
      <button type="button">First</button>
      <button type="button">Last</button>
    </div>
  );
}

function Host({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <button type="button">Trigger</button>
      {open && <Dialog onClose={onClose} />}
    </>
  );
}

describe('useDialogFocus', () => {
  test('moves focus into the dialog on open and hands it back to the trigger on close', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Host open={false} onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Host open onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(<Host open={false} onClose={onClose} />);
    expect(document.activeElement).toBe(trigger);
  });

  test('Escape closes, Tab wraps from the last control to the first and back', () => {
    const onClose = vi.fn();
    render(<Host open onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Tab from a middle position is the browser's business: nothing moves here.
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
