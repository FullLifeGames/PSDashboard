import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExecuteButton } from '../../../../src/components/dock/ExecuteButton';
import { RawLogToggle } from '../../../../src/components/dock/RawLogToggle';

/** Round 84 (turn dock), step A3b: the cases of the old PanelStatus spec that the dock keeps. The strip's lines are in TurnDock.tray.spec. */
describe('ExecuteButton', () => {
  test('waits for every slot and names what is missing, runs the turn, and shows the running turn', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<ExecuteButton ready={false} executing={false} label="Select P2 choice" onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Select P2 choice' })).toBeDisabled();
    expect(screen.getByRole('button')).not.toHaveClass('ps-execute-btn-ready');

    rerender(<ExecuteButton ready executing={false} label="Execute Turn" onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Execute Turn' })).toHaveClass('ps-execute-btn-ready');
    await userEvent.click(screen.getByRole('button', { name: 'Execute Turn' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<ExecuteButton ready executing label="Execute Turn" onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Executing…' })).toBeDisabled();
    expect(screen.getByRole('button')).not.toHaveClass('ps-execute-btn-ready');
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
