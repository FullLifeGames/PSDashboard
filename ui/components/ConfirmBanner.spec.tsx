import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmBanner } from '../../src/components/ConfirmBanner';

describe('ConfirmBanner', () => {
  test('shows the message as an alert dialog and routes both buttons', async () => {
    const onProceed = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmBanner message="Replace the variation from turn 12?" onProceed={onProceed} onCancel={onCancel} />);

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Replace the variation from turn 12?');

    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledTimes(1);
  });
});
