import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmBanner } from '../../../src/components/ConfirmBanner';

describe('ConfirmBanner', () => {
  test('shows the message as an alert dialog; Replace proceeds, Cancel backs out', async () => {
    const onProceed = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmBanner message="This replaces your variation from turn 4." onProceed={onProceed} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This replaces your variation from turn 4.');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a caller names its own proceed button (H14a, H16a); the default stays Replace', async () => {
    const onProceed = vi.fn();
    render(<ConfirmBanner message="This edit makes 3 played turns invalid." proceedLabel="Apply edit" onProceed={onProceed} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Apply edit' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  test('both buttons share one wrapper, so a narrow column never leaves Cancel alone on a line (FT-1)', () => {
    render(<ConfirmBanner message="The variation has 3 played turns. Discarding drops them." proceedLabel="Discard variation" onProceed={vi.fn()} onCancel={vi.fn()} />);
    const proceed = screen.getByRole('button', { name: 'Discard variation' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(proceed.parentElement).toBe(cancel.parentElement);
    expect(proceed.parentElement).not.toBe(screen.getByRole('alertdialog'));
  });
});
