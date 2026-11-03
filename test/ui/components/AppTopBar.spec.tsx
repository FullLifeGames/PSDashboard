import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppTopBar } from '../../../src/components/AppTopBar';
import { simState } from '../fixtures/sim-state';

type Props = Parameters<typeof AppTopBar>[0];

function props(overrides: Partial<Props> = {}): Props {
  return {
    replayData: { format: '[Gen 9] OU', players: ['Alice', 'Bob'] },
    usageStats: { loading: false, error: null }, setAssumptions: { loading: false, error: null },
    branchPreparing: false, branchProgress: null, showBranch: false, simState: null, animateBranchTurns: true,
    branchDivergence: null, onCancelPreparation: vi.fn(), onAnimateChange: vi.fn(), onEditSide: vi.fn(), onOpenSets: vi.fn(),
    embed: false, onReportIssue: vi.fn(),
    ...overrides,
  };
}

describe('AppTopBar', () => {
  test('with a replay loaded the bar ends with the name, Beta, Report issue and the creator link (round 77)', async () => {
    const wired = props();
    const { rerender } = render(<AppTopBar {...wired} />);
    const links = document.querySelector('.ps-topbar > .ps-support-links') as HTMLElement;
    expect(links).toHaveTextContent('PS Dashboard Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Report issue' }));
    expect(wired.onReportIssue).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'by Bene (FullLifeGames)' })).toBeInTheDocument();
    rerender(<AppTopBar {...wired} embed />);
    expect(screen.queryByRole('link', { name: 'by Bene (FullLifeGames)' })).toBeNull();
  });

  test('names the match; the Setup menu holds the edit and sets buttons and closes after a pick', async () => {
    // Round 77 (user request 28.10.2026): one row; the animate toggle, Edit Player, Edit Opp and Import/Export Sets
    // moved into one menu.
    const wired = props();
    render(<AppTopBar {...wired} />);
    expect(screen.getByText('[Gen 9] OU')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Player' })).toBeNull();
    const setup = screen.getByRole('button', { name: 'Setup' });
    expect(setup).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(setup);
    expect(setup).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Player' }));
    expect(wired.onEditSide).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('button', { name: 'Edit Opp' })).toBeNull();
    await userEvent.click(setup);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Opp' }));
    expect(wired.onEditSide).toHaveBeenCalledWith('p2');
    await userEvent.click(setup);
    await userEvent.click(screen.getByRole('button', { name: 'Import/Export Sets' }));
    expect(wired.onOpenSets).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Smogon/)).toBeNull();
  });

  // Round 84 (A7f, ruling 19a): a long format name shortens first; the full names ride in the titles.
  test('the format tag and both player names carry their full text in a title', () => {
    render(<AppTopBar {...props({ replayData: { format: '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)', players: ['SpiringOcean', 'sigueinventando'] } })} />);
    expect(screen.getByText('[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)')).toHaveAttribute('title', '[Gen 9 Champions] VGC 2026 Reg M-B (Bo3)');
    expect(screen.getByText('SpiringOcean')).toHaveAttribute('title', 'SpiringOcean');
    expect(screen.getByText('sigueinventando')).toHaveAttribute('title', 'sigueinventando');
  });

  test('the Setup menu closes on Escape and on a click outside it', async () => {
    render(<AppTopBar {...props()} />);
    const setup = screen.getByRole('button', { name: 'Setup' });
    await userEvent.click(setup);
    await userEvent.keyboard('{Escape}');
    expect(setup).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(setup);
    await userEvent.click(screen.getByText('Alice'));
    expect(setup).toHaveAttribute('aria-expanded', 'false');
  });

  test('the Load button stands beside Setup once the workspace passes a loader, and a bar without one has none (the embedded view)', async () => {
    // Round 84 (turn dock, Q20 a): the loader folds into the top bar when a replay is loaded.
    const loader = { onLoad: vi.fn(), onLoadFile: vi.fn(), onTeamLoad: vi.fn(), loading: false, error: null };
    const { rerender } = render(<AppTopBar {...props()} />);
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();
    rerender(<AppTopBar {...props({ loader })} />);
    const load = screen.getByRole('button', { name: 'Load' });
    const setup = screen.getByRole('button', { name: 'Setup' });
    expect(load.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(load.closest('.ps-topbar-actions')).toBe(setup.closest('.ps-topbar-actions'));
    await userEvent.click(load);
    await userEvent.type(screen.getByRole('textbox', { name: 'Replay URL or ID' }), '{Enter}');
    expect(loader.onLoad).toHaveBeenCalledTimes(1);
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

  test('a live branch shows its turn and the divergence notice; the animate toggle sits in the Setup menu', async () => {
    const wired = props({ showBranch: true, simState: simState('singles', { turnNumber: 7, ended: true, winner: 'Alice' }), branchDivergence: 'The simulated replay diverged' });
    render(<AppTopBar {...wired} />);
    expect(screen.getByText('Branching · Turn 7')).toBeInTheDocument();
    // The winner shows in the branch panel, where the pickers were (round 77).
    expect(screen.queryByText(/Alice wins/)).toBeNull();
    expect(screen.getByTitle('The simulated replay diverged')).toHaveTextContent('⚠ The simulated replay diverged');
    await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
    const toggle = screen.getByRole('checkbox', { name: 'Animate branch turns' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(wired.onAnimateChange).toHaveBeenCalledWith(false);
    // A toggle keeps the menu open: the user sees the new state.
    expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-expanded', 'true');
  });
});
