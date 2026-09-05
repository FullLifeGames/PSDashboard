import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmBanner } from '../../src/components/ConfirmBanner';

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
});
