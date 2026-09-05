import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchHistoryPanel } from '../../src/components/BranchHistoryPanel';
import type { BranchHistoryEntry } from '../../src/hooks/useBranch';
import { replayFixture } from '../fixtures/replay';
import { pokemon } from '../fixtures/sim-state';

const { snapshots } = replayFixture('singles');

const entry = (turnNumber: number, extra: Partial<BranchHistoryEntry> = {}): BranchHistoryEntry => ({
  turnNumber, p1Choice: 'move earthquake', p2Choice: 'switch 3',
  p1SlotChoices: [{ kind: 'move', moveId: 'earthquake', moveName: 'Earthquake' }],
  p2SlotChoices: [{ kind: 'switch', speciesId: 'rotomwash', pokemonName: 'Rotom-Wash' }],
  p1Active: pokemon('Garchomp', { isActive: true, activeSlot: 0 }), p1ActiveSlots: [pokemon('Garchomp', { isActive: true, activeSlot: 0 })],
  p2Active: pokemon('Rotom-Wash', { isActive: true, activeSlot: 0 }), p2ActiveSlots: [pokemon('Rotom-Wash', { isActive: true, activeSlot: 0 })],
  p1Pokemon: [pokemon('Garchomp')], p2Pokemon: [pokemon('Rotom-Wash')],
  ...extra,
});

describe('BranchHistoryPanel', () => {
  test('without moves it explains what the panel will show', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[]} snapshots={snapshots} />);
    expect(screen.getByText('Variation moves')).toBeInTheDocument();
    expect(screen.getByText(/Execute turns to compare/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('every executed turn gets a row with both choices, a main-line cell, and a variation cell that navigate', async () => {
    const onNavigate = vi.fn();
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), entry(3)]} snapshots={snapshots} currentPosition={{ turn: 3, line: 'variation' }} onNavigate={onNavigate} />);
    expect(screen.getByText(/click a cell to jump/)).toBeInTheDocument();
    expect(screen.getByText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('Turn 3')).toBeInTheDocument();
    expect(screen.getAllByText(/Earthquake/).length).toBeGreaterThanOrEqual(2);

    // Each executed entry stands for the position AFTER its turn: entry 2 lands on turn 3.
    await userEvent.click(screen.getByRole('button', { name: /Main line \(turn 3\)/ }));
    expect(onNavigate).toHaveBeenCalledWith({ turn: 3, line: 'main' });
    const variationCells = screen.getAllByRole('button', { name: /Variation result/ });
    await userEvent.click(variationCells[0]);
    expect(onNavigate).toHaveBeenCalledWith({ turn: 3, line: 'variation' });
    expect(variationCells[0]).toHaveStyle({ outline: '1px solid #f0c76b' });

    await userEvent.click(screen.getByRole('button', { name: /Tip of the variation/ }));
    expect(onNavigate).toHaveBeenCalledWith({ turn: 4, line: 'variation' });
  });

  test('a forced replacement is its own row and consumes no turn', () => {
    const forced = entry(3, { kind: 'forced', forcedSide: 'p2', p1Choice: '—', p2Choice: 'switch 3' });
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2), forced, entry(3)]} snapshots={snapshots} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Turn 3 · forced replacement \(P2\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tip of the variation/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Variation result/ })).toHaveLength(2);
  });

  test('without a navigation handler the cells are inert', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} />);
    expect(screen.queryByText(/click a cell to jump/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tip of the variation/ })).toBeNull();
  });
});
