import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BranchHistoryPanel } from '../../../src/components/BranchHistoryPanel';
import type { BranchHistoryEntry } from '../../../src/hooks/useBranch';
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

  describe('the variation cell names the Pokemon that stands at the row\'s position (A-5)', () => {
    const live = (species: string, slot = 0) => pokemon(species, { isActive: true, activeSlot: slot });
    const variationCell = (index: number) => screen.getAllByRole('button', { name: /Variation result/ })[index];

    test('singles: a pivot turn followed by the forced replacement shows the replacement', () => {
      const pivot = entry(8, {
        p1Choice: 'move uturn', p2Choice: 'move recover',
        p1Active: live('Talonflame'), p1ActiveSlots: [live('Talonflame')],
      });
      const replacement = entry(8, {
        kind: 'forced', forcedSide: 'p1', p1Choice: 'switch 3', p2Choice: '—',
        p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')],
      });
      render(<BranchHistoryPanel branchStartTurn={7} history={[pivot, replacement]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Tentacruel');
      expect(variationCell(0)).not.toHaveTextContent('Talonflame');
    });

    test('singles: a knock-out followed by two chained forced entries shows the last state', () => {
      const knockOut = entry(8, { p1Active: live('Palossand'), p1ActiveSlots: [live('Palossand')] });
      const first = entry(8, { kind: 'forced', forcedSide: 'p1', p1Active: live('Kyurem'), p1ActiveSlots: [live('Kyurem')] });
      const second = entry(8, { kind: 'forced', forcedSide: 'p2', p1Active: live('Kyurem'), p1ActiveSlots: [live('Kyurem')], p2Active: live('Rotom-Wash'), p2ActiveSlots: [live('Rotom-Wash')] });
      render(<BranchHistoryPanel branchStartTurn={7} history={[knockOut, first, second]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Kyurem');
      expect(variationCell(0)).toHaveTextContent('P2: Rotom-Wash');
    });

    test('doubles: only the replaced slot changes in the cell', () => {
      const turn = entry(8, {
        p1ActiveSlots: [live('Talonflame', 0), live('Garchomp', 1)],
        p2ActiveSlots: [live('Rotom-Wash', 0), live('Kyurem', 1)],
      });
      const replacement = entry(8, {
        kind: 'forced', forcedSide: 'p1',
        p1ActiveSlots: [live('Tentacruel', 0), live('Garchomp', 1)],
        p2ActiveSlots: [live('Rotom-Wash', 0), live('Kyurem', 1)],
      });
      render(<BranchHistoryPanel branchStartTurn={7} history={[turn, replacement]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent(/P1: Tentacruel \d+% \/ Garchomp/);
      expect(variationCell(0)).not.toHaveTextContent('Talonflame');
    });

    test('a forced entry in the middle only changes the row it follows', () => {
      const first = entry(8, { p1Active: live('Talonflame'), p1ActiveSlots: [live('Talonflame')] });
      const replacement = entry(8, { kind: 'forced', forcedSide: 'p1', p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')] });
      const second = entry(9, { p1Active: live('Tentacruel'), p1ActiveSlots: [live('Tentacruel')] });
      render(<BranchHistoryPanel branchStartTurn={7} history={[first, replacement, second]} snapshots={snapshots} />);
      expect(variationCell(0)).toHaveTextContent('P1: Tentacruel');
      expect(variationCell(1)).toHaveTextContent('P1: Tentacruel');
    });
  });

  test('without a navigation handler the cells are inert', () => {
    render(<BranchHistoryPanel branchStartTurn={2} history={[entry(2)]} snapshots={snapshots} />);
    expect(screen.queryByText(/click a cell to jump/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Tip of the variation/ })).toBeNull();
  });
});
