import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { switchOptionKey } from '@fulllifegames/eval-engine';
import { SideControls, type SideControlsProps } from '../../../src/components/branch/SideControls';
import { NO_MODIFIERS, simState } from '../../fixtures/sim-state';

// The legal move pool is heavy dex data; a fixed pool keeps the what-if row deterministic here.
vi.mock('../../../src/lib/pokemon-options', () => ({ getMovePool: async () => ['Dragon Claw', 'Fire Fang'] }));

const singles = simState('singles');

function props(overrides: Partial<SideControlsProps> = {}): SideControlsProps {
  return {
    label: 'P1', activeName: 'Garchomp', activeSpecies: 'Garchomp', activeFainted: false,
    moves: singles.p1MovesBySlot[0], switches: singles.p1SwitchesBySlot[0], forceSwitch: false, pending: null,
    blockedSwitchKeys: new Set(), modifiers: NO_MODIFIERS, dmgResults: [], spreadDamageResults: {}, targetDamageResults: {},
    gen: 9, advanced: false, onChoice: vi.fn(), onHypotheticalMove: vi.fn(), ...overrides,
  };
}

describe('SideControls', () => {
  test('compact: the header asks what the active does; moves and switches sit together as chips', async () => {
    const wired = props();
    render(<SideControls {...wired} />);
    expect(screen.getByText(/What will/)).toHaveTextContent('P1 What will Garchomp do?');
    expect(screen.queryByRole('button', { name: 'Fight' })).toBeNull();
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveClass('ps-movebtn-compact');
    expect(screen.getByRole('button', { name: /Heatran/ })).toHaveClass('ps-switchbtn-compact');
    await userEvent.click(screen.getByRole('button', { name: /Heatran/ }));
    expect(wired.onChoice).toHaveBeenCalledWith({ kind: 'switch', speciesId: 'heatran', pokemonName: 'Heatran' });
  });

  test('a pending choice shows in notation; the played note and badge mark what the line did', () => {
    const { rerender } = render(<SideControls {...props({ played: { kind: 'move', name: 'Earthquake' } })} />);
    expect(screen.getByText('played:')).toHaveTextContent('played: Earthquake');
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveTextContent('played');

    const pending = { kind: 'move' as const, moveId: 'earthquake', moveName: 'Earthquake', modifier: 'terastallize' as const };
    rerender(<SideControls {...props({ played: { kind: 'switch', name: 'Heatran', species: 'Heatran' }, pending })} />);
    expect(screen.queryByText('played:')).toBeNull();
    expect(screen.getByText('[Earthquake (Tera)]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Heatran/ })).toHaveTextContent('played');
    expect(screen.getByRole('button', { name: /Earthquake/ })).toHaveClass('ps-movebtn-selected');
  });

  test('advanced: the Fight and Pokémon tabs split moves from switches, with the power tools under Fight', async () => {
    render(<SideControls {...props({ advanced: true })} />);
    expect(screen.getByRole('button', { name: /Earthquake/ })).not.toHaveClass('ps-movebtn-compact');
    expect(screen.queryByRole('button', { name: /Heatran/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Choice picker for P1' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Hypothetical move for P1' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Pokémon' }));
    expect(screen.getByRole('button', { name: /Heatran/ })).not.toHaveClass('ps-switchbtn-compact');
    expect(screen.queryByRole('button', { name: /Earthquake/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Fight' }));
    expect(screen.getByRole('button', { name: /Earthquake/ })).toBeInTheDocument();
  });

  test('a forced replacement shows the hint and only the bench, tabs hidden', () => {
    const { rerender } = render(<SideControls {...props({ forceSwitch: true, activeFainted: true, advanced: true })} />);
    expect(screen.getByText(/Choose a replacement/)).toHaveTextContent('P1 Choose a replacement for Garchomp');
    expect(screen.getByText('Garchomp fainted! Choose who to send in:')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fight' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Earthquake/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Heatran/ })).not.toHaveClass('ps-switchbtn-compact');

    rerender(<SideControls {...props({ forceSwitch: true, activeFainted: false })} />);
    expect(screen.getByText('Garchomp is switching out. Choose who to send in:')).toBeInTheDocument();
    expect(screen.getByText(/Choose a replacement/)).not.toHaveTextContent('for Garchomp');
  });

  test('a reserved switch-in is disabled with the reason; the selected one stays clickable', () => {
    const [heatran, latias] = singles.p1SwitchesBySlot[0];
    const pending = { kind: 'switch' as const, speciesId: 'latias', pokemonName: 'Latias' };
    render(<SideControls {...props({ blockedSwitchKeys: new Set([switchOptionKey(heatran), switchOptionKey(latias)]), pending })} />);
    expect(screen.getByRole('button', { name: /Heatran/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Heatran/ })).toHaveAttribute('title', 'Heatran is already chosen as the switch-in for your other slot.');
    expect(screen.getByRole('button', { name: /Latias/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Latias/ })).toHaveClass('ps-switchbtn-selected');
    expect(screen.getByText('[→ Latias]')).toBeInTheDocument();
  });
});
