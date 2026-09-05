import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecuteRow, PickerSourceLine, RawLogToggle } from '../../../src/components/branch/PanelStatus';

describe('PickerSourceLine', () => {
  test('names where the choices come from and carries the Advanced toggle', async () => {
    const onToggleAdvanced = vi.fn();
    const { rerender } = render(<PickerSourceLine source="live" advanced={false} onToggleAdvanced={onToggleAdvanced} />);
    expect(screen.queryByText(/Choices/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Advanced ▸' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(onToggleAdvanced).toHaveBeenCalledTimes(1);

    rerender(<PickerSourceLine source="stored" advanced onToggleAdvanced={onToggleAdvanced} />);
    expect(screen.getByText('Choices from the reconstructed position')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced ▾' })).toHaveAttribute('aria-expanded', 'true');

    rerender(<PickerSourceLine source="snapshot" advanced={false} onToggleAdvanced={onToggleAdvanced} />);
    expect(screen.getByText(/approximated from the replay; the sim checks legality/)).toBeInTheDocument();
    rerender(<PickerSourceLine source="snapshot" acquiringExact advanced={false} onToggleAdvanced={onToggleAdvanced} />);
    expect(screen.getByText('Choices approximated · reconstructing the exact position…')).toBeInTheDocument();
  });
});

describe('ExecuteRow', () => {
  test('the button waits for both choices, names what is missing, and hides during a forced switch', async () => {
    const onExecuteTurn = vi.fn();
    const base = { executeError: null, isForceSwitch: false, executing: false, onExecuteTurn };
    const { rerender } = render(<ExecuteRow {...base} bothChosen={false} pendingLabel="Select P2 choice" />);
    expect(screen.getByRole('button', { name: 'Select P2 choice' })).toBeDisabled();

    rerender(<ExecuteRow {...base} bothChosen pendingLabel="Execute Turn" />);
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(onExecuteTurn).toHaveBeenCalledTimes(1);

    rerender(<ExecuteRow {...base} bothChosen executing pendingLabel="Execute Turn" />);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();

    rerender(<ExecuteRow {...base} executeError="Garchomp is trapped and cannot switch" isForceSwitch bothChosen pendingLabel="Execute Turn" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Garchomp is trapped and cannot switch');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RawLogToggle', () => {
  test('opens the protocol log without chat, split, and timestamp lines', async () => {
    render(<RawLogToggle log={['|turn|1', '|c|☆Alice|gl', '|split|p1', '|t:|1700000000', '|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn']} />);
    expect(screen.queryByText(/\|turn\|1/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show Raw Protocol Log' }));
    const log = screen.getByText(/\|turn\|1/);
    expect(log).toHaveTextContent('|move|p1a: Garchomp|Earthquake|p2a: Ferrothorn');
    expect(log.textContent).not.toMatch(/\|c\||\|split\||\|t:\|/);
    await userEvent.click(screen.getByRole('button', { name: 'Hide Raw Protocol Log' }));
    expect(screen.queryByText(/\|turn\|1/)).toBeNull();
  });
});
