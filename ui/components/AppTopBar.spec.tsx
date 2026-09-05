import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppTopBar } from '../../src/components/AppTopBar';
import { simState } from '../fixtures/sim-state';

type Props = Parameters<typeof AppTopBar>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    replayData: { format: '[Gen 9] OU', players: ['Alice', 'Bob'] },
    usageStats: { loading: false, error: null }, setAssumptions: { loading: false, error: null },
    branchPreparing: false, branchProgress: null, showBranch: false, simState: null, animateBranchTurns: true,
    branchDivergence: null, onCancelPreparation: vi.fn(), onAnimateChange: vi.fn(), onEditSide: vi.fn(), onOpenSets: vi.fn(),
    ...overrides,
  };
}

describe('AppTopBar', () => {
  test('names the match and routes the edit and sets buttons', async () => {
    const wired = props();
    render(<AppTopBar {...wired} />);
    expect(screen.getByText('[Gen 9] OU')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Player' }));
    expect(wired.onEditSide).toHaveBeenCalledWith('p1');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Opp' }));
    expect(wired.onEditSide).toHaveBeenCalledWith('p2');
    await userEvent.click(screen.getByRole('button', { name: 'Import/Export Sets' }));
    expect(wired.onOpenSets).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Smogon/)).toBeNull();
  });

  test('the Smogon states read as loading or unavailable', () => {
    render(<AppTopBar {...props({ usageStats: { loading: true, error: null }, setAssumptions: { loading: false, error: 'gone' } })} />);
    expect(screen.getByText('Smogon stats loading...')).toBeInTheDocument();
    expect(screen.getByText('Smogon sets unavailable')).toBeInTheDocument();
  });

  test('a branch in preparation shows its progress and can be cancelled', async () => {
    const wired = props({ branchPreparing: true, branchProgress: { turn: 3, target: 12 } });
    render(<AppTopBar {...wired} />);
    expect(screen.getByText('Preparing branch... (turn 3/12)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(wired.onCancelPreparation).toHaveBeenCalledTimes(1);
  });

  test('a live branch shows its turn, the animate toggle, the end tag, and the divergence notice', async () => {
    const wired = props({ showBranch: true, simState: simState('singles', { turnNumber: 7, ended: true, winner: 'Alice' }), branchDivergence: 'The simulated replay diverged' });
    render(<AppTopBar {...wired} />);
    expect(screen.getByText('Branching · Turn 7')).toBeInTheDocument();
    expect(screen.getByText('Alice wins!')).toBeInTheDocument();
    expect(screen.getByTitle('The simulated replay diverged')).toHaveTextContent('⚠ The simulated replay diverged');
    const toggle = screen.getByRole('checkbox', { name: 'Animate branch turns' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(wired.onAnimateChange).toHaveBeenCalledWith(false);
  });
});
