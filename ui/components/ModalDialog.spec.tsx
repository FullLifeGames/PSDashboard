import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalDialog } from '../../src/components/ModalDialog';

describe('ModalDialog', () => {
  test('renders a labelled modal dialog with its title, content, and close button', async () => {
    const onClose = vi.fn();
    render(<ModalDialog title="Edit Player" closeLabel="Close team editor" onClose={onClose}><p>Body</p></ModalDialog>);
    const dialog = screen.getByRole('dialog', { name: 'Edit Player' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Edit Player');
    expect(dialog).toHaveTextContent('Body');
    expect(document.activeElement).toBe(dialog);

    await userEvent.click(screen.getByRole('button', { name: 'Close team editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape and a click on the backdrop close it; a click inside does not', () => {
    const onClose = vi.fn();
    render(<ModalDialog title="Sets" closeLabel="Close" onClose={onClose}><button type="button">Inside</button></ModalDialog>);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
