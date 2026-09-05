import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { winPercent } from '@fulllifegames/eval-engine';
import { EvalMatrixView } from '../../src/components/EvalMatrixView';
import { evalResult } from '../fixtures/eval-result';

const names: [string, string] = ['Alice', 'Bob'];

describe('EvalMatrixView', () => {
  test('collapsed by default; opening lists every pair at its win probability with the equilibrium mixes on the headers', async () => {
    const matrix = evalResult().matrix!;
    render(<EvalMatrixView matrix={matrix} playerNames={names} />);
    expect(screen.queryByRole('table')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Alice \\ Bob')).toBeInTheDocument();
    expect(table.getByText('Leech Seed').closest('th')).toHaveTextContent('Leech Seed 100%');
    expect(table.getByText('Earthquake').closest('th')).toHaveTextContent('Earthquake 100%');
    expect(table.getByText('Swords Dance').closest('th')).toHaveTextContent(/^Swords Dance$/);
    const cells = table.getAllByRole('cell');
    expect(cells).toHaveLength(9);
    const pct = winPercent(matrix.values[0][0]);
    expect(cells[0]).toHaveTextContent(`${pct}%`);
    expect(cells[0]).toHaveAttribute('title', `Earthquake × Leech Seed: Alice ${pct}% · Bob ${100 - pct}%`);

    await userEvent.click(screen.getByRole('button', { name: 'Hide matrix' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('with a handler every cell plays exactly that pair out; results without choice ids stay read-only', async () => {
    const onPickPair = vi.fn();
    const matrix = evalResult().matrix!;
    const { rerender } = render(<EvalMatrixView matrix={matrix} playerNames={names} onPickPair={onPickPair} />);
    await userEvent.click(screen.getByRole('button', { name: 'Matrix' }));
    const cell = screen.getByTitle(/^Swords Dance × Body Press:/);
    expect(cell.tagName).toBe('BUTTON');
    expect(cell).toHaveAttribute('title', expect.stringMatching(/Click to play exactly this pair out\.$/));
    await userEvent.click(cell);
    expect(onPickPair).toHaveBeenCalledWith({ choice: 'move swordsdance', label: 'Swords Dance' }, { choice: 'move bodypress', label: 'Body Press' });

    rerender(<EvalMatrixView matrix={{ ...matrix, p1Choices: undefined, p2Choices: undefined }} playerNames={names} onPickPair={onPickPair} />);
    const legacy = screen.getByTitle(/^Swords Dance × Body Press:/);
    expect(legacy.tagName).toBe('TD');
    expect(legacy).not.toHaveAttribute('title', expect.stringMatching(/Click/));
  });
});
